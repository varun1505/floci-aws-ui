// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// aws-signing.mjs as the dev server uses it: mounted ahead of a proxy that forwards what it does not sign.
// server.test.ts covers the same module inside server.mjs.

type Signing = {
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>;
  passedThrough(answer: http.IncomingMessage): void;
};
type CreateAwsSigning = (env: Record<string, string | undefined>, floci: string) => Signing;

let createAwsSigning: CreateAwsSigning;
let floci: http.Server;
let flociUrl: string;
let checking = true;
let probes = 0;
const reached: { url?: string; host?: string; authorization?: string }[] = [];
const servers: http.Server[] = [];

const AUTHORIZATION = "AWS4-HMAC-SHA256 Credential=test/20250101/us-east-1/sqs/aws4_request, SignedHeaders=host;x-amz-date, Signature=abc";

function listen(s: http.Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));
}

// A server that mounts the module the way vite.config.ts does. What the module does not handle reaches
// `next`, which answers 299 here in place of Vite's /aws proxy.
async function mount(env: Record<string, string>): Promise<string> {
  const signing = createAwsSigning({ FLOCI_INFO_URL: "", ...env }, flociUrl);
  const s = http.createServer((req, res) => {
    const next = () => {
      res.writeHead(299);
      res.end("next");
    };
    signing.handleRequest(req, res).then((handled) => {
      if (!handled) {
        next();
      }
    }, next);
  });
  servers.push(s);
  return `http://127.0.0.1:${await listen(s)}`;
}

beforeAll(async () => {
  createAwsSigning = (await import(pathToFileURL(path.resolve("aws-signing.mjs")).href)).createAwsSigning;
  floci = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/_floci/info") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ defaults: { account_id: "000000000000" } }));
      }
      if (new URLSearchParams(body).get("Action") === "GetCallerIdentity") {
        probes++;
        res.writeHead(checking ? 403 : 200, { "content-type": "text/xml" });
        return res.end(checking ? "<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>" : "<GetCallerIdentityResponse/>");
      }
      reached.push({ url: req.url, host: req.headers.host, authorization: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  flociUrl = `http://127.0.0.1:${await listen(floci)}`;
});

beforeEach(() => {
  checking = true;
  probes = 0;
  reached.length = 0;
});

afterAll(() => {
  for (const s of servers) {
    s.close();
  }
  floci?.close();
});

describe("aws-signing.mjs", () => {
  it("leaves requests outside /aws to the server", async () => {
    const base = await mount({ FLOCI_AUTH_VALIDATE_SIGNATURES: "true" });
    const res = await fetch(`${base}/awsome`, { headers: { authorization: AUTHORIZATION } });
    expect(res.status).toBe(299);
    expect(reached).toHaveLength(0);
  });

  it("leaves unsigned requests to the server, without asking floci", async () => {
    const base = await mount({});
    const res = await fetch(`${base}/aws/`);
    expect(res.status).toBe(299);
    expect(probes).toBe(0);
  });

  it("signs again for floci when FLOCI_AUTH_VALIDATE_SIGNATURES is true, without asking floci", async () => {
    const base = await mount({ FLOCI_AUTH_VALIDATE_SIGNATURES: "true", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" });
    const res = await fetch(`${base}/aws/queue?Action=ListQueues`, { headers: { authorization: AUTHORIZATION } });
    expect(res.status).toBe(200);
    expect(probes).toBe(0);
    expect(reached).toHaveLength(1);
    expect(reached[0].url).toBe("/queue?Action=ListQueues");
    expect(reached[0].host).toBe(new URL(flociUrl).host);
    expect(reached[0].authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test\/\d{8}\/us-east-1\/sqs\/aws4_request, /);
    expect(reached[0].authorization).not.toBe(AUTHORIZATION);
  });

  it("leaves signed requests to the server when FLOCI_AUTH_VALIDATE_SIGNATURES is false", async () => {
    const base = await mount({ FLOCI_AUTH_VALIDATE_SIGNATURES: "false" });
    const res = await fetch(`${base}/aws/`, { headers: { authorization: AUTHORIZATION } });
    expect(res.status).toBe(299);
    expect(probes).toBe(0);
    expect(reached).toHaveLength(0);
  });

  it("asks floci once when the setting is not set, and follows the answer", async () => {
    checking = false;
    const off = await mount({});
    expect((await fetch(`${off}/aws/`, { headers: { authorization: AUTHORIZATION } })).status).toBe(299);
    expect((await fetch(`${off}/aws/`, { headers: { authorization: AUTHORIZATION } })).status).toBe(299);
    expect(probes).toBe(1);

    checking = true;
    const on = await mount({});
    expect((await fetch(`${on}/aws/`, { headers: { authorization: AUTHORIZATION } })).status).toBe(200);
    expect(probes).toBe(2);
    expect(reached).toHaveLength(1);
  });

  it("refuses to sign for a host name it does not know", async () => {
    const base = await mount({ FLOCI_AUTH_VALIDATE_SIGNATURES: "true" });
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(`${base}/aws/`, { headers: { authorization: AUTHORIZATION, host: "evil.test" } }, resolve);
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-amzn-errortype"]).toBe("HostNotAllowed");
    expect(reached).toHaveLength(0);
  });

  it("throws on a setting that is not valid, so the server can report it", () => {
    expect(() => createAwsSigning({ FLOCI_AUTH_VALIDATE_SIGNATURES: "yes" }, flociUrl)).toThrow(/FLOCI_AUTH_VALIDATE_SIGNATURES must be true or false/);
    expect(() => createAwsSigning({ FLOCI_CONSOLE_ROLE_NAME: "not a role" }, flociUrl)).toThrow(/FLOCI_CONSOLE_ROLE_NAME must be an IAM role name/);
  });
});
