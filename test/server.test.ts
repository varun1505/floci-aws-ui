// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real server.mjs against a fake floci, with a small fake build in dist/.

let dir: string;
let fake: http.Server;
let server: ChildProcess;
let base: string;
const seen: { method?: string; url?: string; host?: string; authorization?: string; body: string }[] = [];

function listen(s: http.Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));
}

async function freePort(): Promise<number> {
  const s = http.createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

// One request with headers that fetch does not send as given, such as Host.
function raw(url: string, headers: Record<string, string>, method = "GET", body?: string): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (r) => {
      let text = "";
      r.on("data", (c) => (text += c));
      r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function start(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, "server.mjs")], { env: { ...process.env, AWS_ENDPOINT_URL: "", FLOCI_INFO_URL: "", EC2_TERMINAL: "", DOCKER_HOST: "", FLOCI_AUTH_VALIDATE_SIGNATURES: "", ...env }, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout!.on("data", (d) => String(d).includes("Console on") && resolve(child));
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`server.mjs exited with code ${code}`)));
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "console-server-"));
  fs.copyFileSync(path.resolve("server.mjs"), path.join(dir, "server.mjs"));
  fs.copyFileSync(path.resolve("terminal.mjs"), path.join(dir, "terminal.mjs"));
  fs.copyFileSync(path.resolve("sigv4.mjs"), path.join(dir, "sigv4.mjs"));
  fs.mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "index.html"), "<html>app</html>");
  fs.writeFileSync(path.join(dir, "dist", "assets", "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "secret.txt"), "outside dist");

  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, authorization: req.headers.authorization, body });
      res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "application/json", "x-fake": "floci" });
      if (req.url === "/_floci/info") return res.end(JSON.stringify({ endpoint: "http://outside.test:4566", defaults: { region: "us-east-1", account_id: "123456789012" }, unknown: 1 }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const flociPort = await listen(fake);
  const port = await freePort();
  server = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}` });
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.removeAllListeners("exit");
  server?.kill();
  fake?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("proxy", () => {
  it("forwards /aws/* to floci without the /aws prefix", async () => {
    const res = await fetch(`${base}/aws/my-bucket/key.txt?versionId=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fake")).toBe("floci");
    expect(await res.json()).toEqual({ ok: true });
    expect(seen.at(-1)).toMatchObject({ method: "GET", url: "/my-bucket/key.txt?versionId=1" });
  });
  it("forwards the method and the body", async () => {
    await fetch(`${base}/aws/`, { method: "POST", body: "Action=ListQueues" });
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/", body: "Action=ListQueues" });
  });
  it("sends floci its own host name", async () => {
    await fetch(`${base}/aws/x`);
    expect(seen.at(-1)?.host).toBe(`127.0.0.1:${(fake.address() as AddressInfo).port}`);
  });
  it("forwards a bare /aws as /", async () => {
    await fetch(`${base}/aws`);
    expect(seen.at(-1)?.url).toBe("/");
  });
  it("passes floci error codes through", async () => {
    expect((await fetch(`${base}/aws/missing`)).status).toBe(404);
  });
  it("does not proxy paths that only start with the letters aws", async () => {
    const count = seen.length;
    const res = await fetch(`${base}/awsome`);
    expect(await res.text()).toBe("<html>app</html>");
    expect(seen.length).toBe(count);
  });
  it("forwards a signed request as it came when floci does not check signatures", async () => {
    const authorization = "AWS4-HMAC-SHA256 Credential=222222222222/20250101/us-east-1/sqs/aws4_request, SignedHeaders=host;x-amz-date, Signature=abc";
    await fetch(`${base}/aws/queue`, { method: "POST", headers: { authorization }, body: "Action=ListQueues" });
    expect(seen.at(-1)).toMatchObject({ url: "/queue", authorization, body: "Action=ListQueues" });
  });
  it("forwards signed and presigned requests under any host name when floci does not check signatures", async () => {
    const authorization = "AWS4-HMAC-SHA256 Credential=test/20250101/us-east-1/sqs/aws4_request, SignedHeaders=host, Signature=abc";
    expect((await raw(`${base}/aws/queue`, { host: "evil.example", authorization }, "POST", "Action=ListQueues")).status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ url: "/queue", authorization });
    const presigned = "/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test%2F20250101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250101T000000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=host&X-Amz-Signature=abc";
    expect((await raw(`${base}/aws${presigned}`, { host: "evil.example" })).status).toBe(200);
    expect(seen.at(-1)?.url).toBe(presigned);
  });
});

describe("static files", () => {
  it("serves a built file with a long cache", async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });
  it("serves the app for page routes", async () => {
    const res = await fetch(`${base}/s3/buckets`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>app</html>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
  it("does not serve files outside dist", async () => {
    const res = await new Promise<{ status?: number; body: string }>((resolve) => {
      // fetch would normalise the path, so send it raw.
      http.get(`${base}/..%2Fsecret.txt`, (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () => resolve({ status: r.statusCode, body }));
      });
    });
    expect(res.body).not.toContain("outside dist");
    expect(res.status).toBe(403);
  });
  it("tells the page the floci host name", async () => {
    const res = await fetch(`${base}/console-config.json`);
    expect(await res.json()).toEqual({ flociHost: "127.0.0.1" });
  });
});

describe("console contract", () => {
  it("reports ok on /api/health when floci answers", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      endpoint: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
      error: null,
      console: { name: "floci-aws-ui" },
    });
    expect(seen.at(-1)?.url).toBe("/_floci/health");
  });
  it("reads AWS_ENDPOINT_URL before FLOCI_ENDPOINT", async () => {
    const flociPort = (fake.address() as AddressInfo).port;
    const port = await freePort();
    const child = await start({ PORT: String(port), AWS_ENDPOINT_URL: `http://127.0.0.1:${flociPort}`, FLOCI_ENDPOINT: "http://wrong.test:1" });
    try {
      expect((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).endpoint).toBe(`http://127.0.0.1:${flociPort}`);
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
  it("gives the page floci's default account and the preset accounts", async () => {
    const flociPort = (fake.address() as AddressInfo).port;
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}`, FLOCI_ACCOUNTS: "111111111111=dev, 222222222222 ,bad=x" });
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/console-accounts.json`)).json()).toEqual({
        defaultAccountId: "123456789012",
        accounts: [{ id: "111111111111", name: "dev" }, { id: "222222222222" }],
      });
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
  it("uses FLOCI_DEFAULT_ACCOUNT_ID when floci's manifest does not say", async () => {
    const dead = await freePort();
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${dead}`, FLOCI_DEFAULT_ACCOUNT_ID: "222222222222" });
    try {
      expect((await (await fetch(`http://127.0.0.1:${port}/console-accounts.json`)).json()).defaultAccountId).toBe("222222222222");
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
  it("falls back to 000000000000 when floci does not say", async () => {
    const dead = await freePort();
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${dead}` });
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/console-accounts.json`)).json()).toEqual({ defaultAccountId: "000000000000", accounts: [] });
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
  it("takes the floci host name from the manifest when floci gives one", async () => {
    const flociPort = (fake.address() as AddressInfo).port;
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}`, FLOCI_INFO_URL: `http://127.0.0.1:${flociPort}/_floci/info` });
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/console-config.json`)).json()).toEqual({ flociHost: "outside.test" });
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
});

describe("floci is down", () => {
  it("reports unavailable on /api/health, with the address and the reason", async () => {
    const dead = await freePort();
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${dead}` });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ status: "unavailable", endpoint: `http://127.0.0.1:${dead}` });
      expect(body.error).toContain(`Cannot reach floci at http://127.0.0.1:${dead}`);
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
  it("answers 502 with a clear message", async () => {
    const dead = await freePort();
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${dead}` });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/aws/`);
      expect(res.status).toBe(502);
      expect((await res.json()).message).toContain(`Cannot reach floci at http://127.0.0.1:${dead}`);
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  });
});

describe("re-signing when floci checks signatures", () => {
  const MANAGEMENT = "111111111111";
  const MEMBER = "222222222222";
  const SHORT_LIVED = "333333333333"; // its role credentials expire within the 5-minute refresh window
  const DENIED = "444444444444";
  type Got = { method?: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer; account?: string; verified: boolean };
  const got: Got[] = [];
  const assumed: { account: string; roleArn: string; session: string; signedWith: string }[] = [];
  let probes = 0;
  let issued = 0;
  // Keys floci knows: test/test in the management account, and those it hands out for roles.
  const keys = new Map<string, { secret: string; token?: string; account: string }>([["test", { secret: "test", account: MANAGEMENT }]]);
  let flociServer: http.Server;
  let child: ChildProcess;
  let rbase: string;
  let sigv4: {
    parseAuthorization(h?: string): { accessKeyId: string; date: string; region: string; service: string } | undefined;
    parseAmzDate(value: string): number;
    amzDate(now?: Date): string;
    signRequest(r: Record<string, unknown>): { authorization: string; signature: string };
  };

  // Checks a request's signature as floci does, with the secret of the key it names: the Authorization
  // header, or the query of a presigned URL. S3 accepts UNSIGNED-PAYLOAD in place of the body's hash.
  function verify(req: http.IncomingMessage, body: Buffer): { ok: boolean; account?: string; keyId?: string } {
    const [p, q = ""] = (req.url ?? "/").split(/\?(.*)/s);
    const params = new URLSearchParams(q);
    if (params.has("X-Amz-Signature")) {
      const [keyId, , region, service] = (params.get("X-Amz-Credential") ?? "").split("/");
      const key = keys.get(keyId);
      if (!key || !region || !service || (key.token && params.get("X-Amz-Security-Token") !== key.token)) {
        return { ok: false };
      }
      const date = params.get("X-Amz-Date") ?? "";
      const expired = Date.now() > sigv4.parseAmzDate(date) + Number(params.get("X-Amz-Expires")) * 1000;
      const { signature } = sigv4.signRequest({
        method: req.method,
        path: p,
        query: q
          .split("&")
          .filter((pair) => !pair.startsWith("X-Amz-Signature="))
          .join("&"),
        headers: { host: String(req.headers.host) },
        payloadHash: service === "s3" ? "UNSIGNED-PAYLOAD" : createHash("sha256").update("").digest("hex"),
        date,
        region,
        service,
        credentials: { accessKeyId: keyId, secretAccessKey: key.secret },
      });
      return { ok: !expired && signature === params.get("X-Amz-Signature"), account: key.account, keyId };
    }
    const scope = sigv4.parseAuthorization(req.headers.authorization);
    const key = scope && keys.get(scope.accessKeyId);
    if (!scope || !key || (key.token && req.headers["x-amz-security-token"] !== key.token)) {
      return { ok: false };
    }
    const signedHeaders = /SignedHeaders=([^,]+)/.exec(req.headers.authorization!)![1].split(";");
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const payloadHash = scope.service === "s3" && req.headers["x-amz-content-sha256"] === "UNSIGNED-PAYLOAD" ? "UNSIGNED-PAYLOAD" : bodyHash;
    const { authorization } = sigv4.signRequest({
      method: req.method,
      path: p,
      query: q,
      headers: Object.fromEntries(signedHeaders.map((n) => [n, String(req.headers[n] ?? "")])),
      payloadHash,
      date: req.headers["x-amz-date"],
      region: scope.region,
      service: scope.service,
      credentials: { accessKeyId: scope.accessKeyId, secretAccessKey: key.secret },
    });
    return { ok: authorization === req.headers.authorization && req.headers["x-amz-content-sha256"] === payloadHash, account: key.account, keyId: scope.accessKeyId };
  }

  const xml = (res: http.ServerResponse, status: number, body: string) => {
    res.writeHead(status, { "content-type": "text/xml" });
    res.end(body);
  };
  const stsError = (code: string, message: string) => `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error></ErrorResponse>`;

  beforeAll(async () => {
    sigv4 = await import(pathToFileURL(path.resolve("sigv4.mjs")).href);
    flociServer = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        const body = Buffer.concat(parts);
        if (req.url === "/_floci/info") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ defaults: { account_id: MANAGEMENT } }));
        }
        const form = new URLSearchParams(body.toString());
        const check = verify(req, body);
        if (req.method === "POST" && req.url === "/" && form.get("Action") === "GetCallerIdentity") {
          probes++;
          return check.ok ? xml(res, 200, "<GetCallerIdentityResponse/>") : xml(res, 403, stsError("InvalidClientTokenId", "The security token included in the request is invalid."));
        }
        if (req.method === "POST" && req.url === "/" && form.get("Action") === "AssumeRole") {
          const roleArn = form.get("RoleArn") ?? "";
          const account = roleArn.split(":")[4];
          assumed.push({ account, roleArn, session: form.get("RoleSessionName") ?? "", signedWith: check.ok ? check.keyId! : "bad signature" });
          if (!check.ok) {
            return xml(res, 403, stsError("SignatureDoesNotMatch", "no"));
          }
          if (account === DENIED) {
            return xml(res, 403, stsError("AccessDenied", `Not authorized to perform sts:AssumeRole on ${roleArn}`));
          }
          issued++;
          const id = `ASIA${String(issued).padStart(16, "0")}`;
          keys.set(id, { secret: `secret/${issued}+&`, token: `token&${issued}`, account });
          const expiration = new Date(Date.now() + (account === SHORT_LIVED ? 2 : 60) * 60 * 1000).toISOString();
          return xml(
            res,
            200,
            `<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>${id}</AccessKeyId><SecretAccessKey>secret/${issued}+&amp;</SecretAccessKey><SessionToken>token&amp;${issued}</SessionToken><Expiration>${expiration}</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
          );
        }
        got.push({ method: req.method, url: req.url ?? "", headers: req.headers, body, account: check.account, verified: check.ok });
        // /denied stands for floci refusing credentials it no longer knows; /invalid for an ordinary client error.
        if (check.ok && req.url?.startsWith("/invalid")) {
          res.writeHead(400, { "content-type": "application/x-amz-json-1.0", "x-amzn-errortype": "ValidationException" });
          return res.end(JSON.stringify({ __type: "ValidationException", message: "bad" }));
        }
        const ok = check.ok && !req.url?.startsWith("/denied");
        res.writeHead(ok ? 200 : 403, { "content-type": "application/x-amz-json-1.0", ...(ok ? {} : { "x-amzn-errortype": "InvalidClientTokenId" }) });
        res.end(ok ? "{}" : JSON.stringify({ __type: "InvalidClientTokenId", message: "no" }));
      });
    });
    const flociPort = await listen(flociServer);
    const port = await freePort();
    child = await start({
      PORT: String(port),
      FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}`,
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_SESSION_TOKEN: "",
      FLOCI_CONSOLE_ROLE_NAME: "",
      FLOCI_CONSOLE_HOSTS: " Console.LAN , ",
    });
    rbase = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    child?.removeAllListeners("exit");
    child?.kill();
    flociServer?.close();
  });

  const as = (accessKeyId: string) => ({ region: "us-west-2", endpoint: `${rbase}/aws`, credentials: { accessKeyId, secretAccessKey: "test" }, maxAttempts: 1 });
  const listQueues = (accessKeyId: string) => new SQSClient({ ...as(accessKeyId), useQueueUrlAsEndpoint: false }).send(new ListQueuesCommand({}));

  it("signs floci's default account with the server's own key, whatever key the browser used", async () => {
    await listQueues("test");
    await listQueues(MANAGEMENT);
    expect(got.slice(-2).map((g) => [g.verified, g.account, sigv4.parseAuthorization(g.headers.authorization as string)?.accessKeyId])).toEqual([
      [true, MANAGEMENT, "test"],
      [true, MANAGEMENT, "test"],
    ]);
    expect(got.at(-1)!.headers["x-amz-security-token"]).toBeUndefined();
    expect(assumed).toEqual([]);
  });

  it("assumes OrganizationAccountAccessRole in a member account, once while its credentials last", async () => {
    await listQueues(MEMBER);
    await listQueues(MEMBER);
    expect(assumed).toEqual([{ account: MEMBER, roleArn: `arn:aws:iam::${MEMBER}:role/OrganizationAccountAccessRole`, session: "floci-aws-ui", signedWith: "test" }]);
    const last = got.at(-1)!;
    expect([last.verified, last.account]).toEqual([true, MEMBER]);
    expect(last.headers["x-amz-security-token"]).toBe("token&1");
    expect(/SignedHeaders=([^,]+)/.exec(last.headers.authorization as string)![1]).toContain("x-amz-security-token");
  });

  it("assumes the role again when its credentials expire within 5 minutes", async () => {
    const before = assumed.length;
    await listQueues(SHORT_LIVED);
    await listQueues(SHORT_LIVED);
    expect(assumed.slice(before).map((a) => a.account)).toEqual([SHORT_LIVED, SHORT_LIVED]);
    expect(got.at(-1)!.account).toBe(SHORT_LIVED);
  });

  it("assumes the role once for requests that arrive together", async () => {
    const before = assumed.length;
    await Promise.all([listQueues("666666666666"), listQueues("666666666666"), listQueues("666666666666")]);
    expect(assumed.slice(before).map((a) => a.account)).toEqual(["666666666666"]);
  });

  it("assumes the role again after floci refuses the cached credentials, but not after an ordinary error", async () => {
    const account = "777777777777";
    const before = assumed.length;
    await listQueues(account);
    const signed = (path: string) =>
      fetch(`${rbase}/aws${path}`, { method: "POST", headers: { authorization: `AWS4-HMAC-SHA256 Credential=${account}/20250101/us-west-2/sqs/aws4_request, SignedHeaders=host, Signature=x` } });
    expect((await signed("/invalid")).status).toBe(400);
    await listQueues(account);
    expect(assumed.slice(before).map((a) => a.account)).toEqual([account]);
    expect((await signed("/denied")).status).toBe(403);
    await listQueues(account);
    expect(assumed.slice(before).map((a) => a.account)).toEqual([account, account]);
  });

  it("uses the partition of the region in the role ARN, and keeps credentials per partition", async () => {
    await new SQSClient({ ...as(MEMBER), region: "us-gov-west-1", useQueueUrlAsEndpoint: false }).send(new ListQueuesCommand({}));
    expect(assumed.at(-1)!.roleArn).toBe(`arn:aws-us-gov:iam::${MEMBER}:role/OrganizationAccountAccessRole`);
  });

  it("gives the browser STS's refusal, as JSON for a JSON request and as STS's XML for S3, and asks again next time", async () => {
    const before = assumed.length;
    const json = await listQueues(DENIED).catch((e) => e);
    expect(json.name).toBe("AccessDenied");
    expect(json.message).toContain("sts:AssumeRole");
    expect(json.$metadata.httpStatusCode).toBe(403);
    expect(json.$response.headers["x-floci-console-error"]).toBe("assume-role");
    expect(json.$response.headers["x-floci-console-role"]).toBe("OrganizationAccountAccessRole");
    const s3 = await new S3Client({ ...as(DENIED), forcePathStyle: true }).send(new GetObjectCommand({ Bucket: "b", Key: "k" })).catch((e) => e);
    expect(s3.name).toBe("AccessDenied");
    expect(s3.$metadata.httpStatusCode).toBe(403);
    expect(assumed.slice(before).map((a) => a.account)).toEqual([DENIED, DENIED]);
  });

  it("drops the browser's signature and headers floci must not see, and signs the x-amz headers", async () => {
    const res = await fetch(`${rbase}/aws/my-bucket/k?versionId=1`, {
      method: "PUT",
      headers: {
        authorization: "AWS4-HMAC-SHA256 Credential=test/20250101/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=browser",
        "x-amz-date": "20000101T000000Z",
        "x-amz-security-token": "browser-token",
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
        "x-amz-meta-colour": "  dark   blue ",
        "content-type": "text/plain",
        cookie: "session=1",
        "x-forwarded-host": "evil.test",
      },
      body: "hello",
    });
    expect(res.status).toBe(200);
    const last = got.at(-1)!;
    expect(last.verified).toBe(true);
    expect(last.url).toBe("/my-bucket/k?versionId=1");
    expect(last.body.toString()).toBe("hello");
    expect(last.headers.host).toBe(`127.0.0.1:${(flociServer.address() as AddressInfo).port}`);
    expect(last.headers.cookie).toBeUndefined();
    expect(last.headers["x-forwarded-host"]).toBeUndefined();
    expect(last.headers["x-amz-security-token"]).toBeUndefined();
    expect(last.headers["x-amz-date"]).not.toBe("20000101T000000Z");
    expect(/SignedHeaders=([^,]+)/.exec(last.headers.authorization as string)![1]).toBe("content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-colour");
  });

  it("signs an S3 path as it travels, and other paths encoded again", async () => {
    await new S3Client({ ...as("test"), forcePathStyle: true }).send(new GetObjectCommand({ Bucket: "b", Key: "dir/a b+ü(1).txt" }));
    expect(got.at(-1)).toMatchObject({ url: "/b/dir/a%20b%2B%C3%BC%281%29.txt?x-id=GetObject", verified: true });
    await new LambdaClient(as("test")).send(new GetFunctionCommand({ FunctionName: `arn:aws:lambda:us-west-2:${MANAGEMENT}:function:f` })).catch(() => undefined);
    expect(got.at(-1)).toMatchObject({ url: `/2015-03-31/functions/arn%3Aaws%3Alambda%3Aus-west-2%3A${MANAGEMENT}%3Afunction%3Af`, verified: true });
  });

  it("decodes an aws-chunked upload and signs the plain body with its trailers", async () => {
    const chunked = "5;chunk-signature=aa\r\nhello\r\n0\r\nx-amz-checksum-crc32:NhCmhg==\r\n\r\n";
    const status = await new Promise<number | undefined>((resolve) => {
      const req = http.request(`${rbase}/aws/b/upload.txt`, {
        method: "PUT",
        headers: {
          authorization: "AWS4-HMAC-SHA256 Credential=test/20250101/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=browser",
          "content-encoding": "aws-chunked",
          "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
          "x-amz-decoded-content-length": "5",
          "x-amz-trailer": "x-amz-checksum-crc32",
          "content-length": String(chunked.length),
        },
      });
      req.on("response", (r) => {
        r.resume();
        resolve(r.statusCode);
      });
      req.end(chunked);
    });
    expect(status).toBe(200);
    const last = got.at(-1)!;
    expect(last).toMatchObject({ verified: true, body: Buffer.from("hello") });
    expect(last.headers["content-encoding"]).toBeUndefined();
    expect(last.headers["x-amz-decoded-content-length"]).toBeUndefined();
    expect(last.headers["x-amz-trailer"]).toBeUndefined();
    expect(last.headers["x-amz-checksum-crc32"]).toBe("NhCmhg==");
    expect(last.headers["content-length"]).toBe("5");
  });

  it("refuses an aws-chunked body it cannot read, and keeps running", async () => {
    const count = got.length;
    const send = (body: string) =>
      fetch(`${rbase}/aws/b/k`, {
        method: "PUT",
        headers: { authorization: "AWS4-HMAC-SHA256 Credential=test/20250101/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=x", "content-encoding": "aws-chunked" },
        body,
      });
    const res = await send("not chunks");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("aws-chunked");
    expect((await send("0\r\nbad name: x\r\n\r\n")).status).toBe(400);
    expect(got.length).toBe(count);
    expect((await fetch(`${rbase}/api/health`)).status).toBe(200);
  });

  // A presigned query as the AWS CLI makes it for the web console's /aws address. Its signature is the
  // browser's, which floci could not verify.
  const presignedQuery = (key: string, { expires = 600, signedAt = new Date() } = {}) => {
    const date = sigv4.amzDate(signedAt);
    return `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(`${key}/${date.slice(0, 8)}/us-west-2/s3/aws4_request`)}&X-Amz-Date=${date}&X-Amz-Expires=${expires}&X-Amz-SignedHeaders=host&X-Amz-Signature=madeforconsole`;
  };
  const browserAuth = (service: string) => `AWS4-HMAC-SHA256 Credential=test/20250101/us-west-2/${service}/aws4_request, SignedHeaders=host, Signature=browser`;

  it("streams a plain S3 body signed as UNSIGNED-PAYLOAD, and signs the hash of other bodies", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const res = await fetch(`${rbase}/aws/b/big.bin`, { method: "PUT", headers: { authorization: browserAuth("s3"), "content-type": "application/octet-stream" }, body: big });
    expect(res.status).toBe(200);
    const last = got.at(-1)!;
    expect(last.verified).toBe(true);
    expect(last.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(last.headers["content-length"]).toBe(String(big.length));
    expect(last.body.equals(big)).toBe(true);
    await listQueues("test");
    expect(got.at(-1)!.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns a URL made with test again, for floci's host and path, keeping its other parameters", async () => {
    const res = await fetch(`${rbase}/aws/b/k.txt?response-content-type=text%2Fplain&${presignedQuery("test")}`);
    expect(res.status).toBe(200);
    const last = got.at(-1)!;
    expect([last.verified, last.account]).toEqual([true, MANAGEMENT]);
    expect(last.headers.authorization).toBeUndefined();
    const [p, q] = last.url.split("?");
    expect(p).toBe("/b/k.txt");
    const params = new URLSearchParams(q);
    expect(params.get("response-content-type")).toBe("text/plain");
    expect(params.get("X-Amz-Signature")).not.toBe("madeforconsole");
    expect(Number(params.get("X-Amz-Expires"))).toBeGreaterThan(590);
    expect(Number(params.get("X-Amz-Expires"))).toBeLessThanOrEqual(600);
  });

  it("presigns a URL made with an account ID again with the role's session, and streams its body", async () => {
    const res = await fetch(`${rbase}/aws/b/k.txt?${presignedQuery(MEMBER)}`, { method: "PUT", body: "uploaded" });
    expect(res.status).toBe(200);
    const last = got.at(-1)!;
    expect(last).toMatchObject({ verified: true, account: MEMBER, body: Buffer.from("uploaded") });
    expect(new URLSearchParams(last.url.split("?")[1]).get("X-Amz-Security-Token")).toMatch(/^token&/);
  });

  it("refuses an expired presigned URL without asking floci", async () => {
    const count = got.length;
    const res = await fetch(`${rbase}/aws/b/k.txt?${presignedQuery("test", { expires: 60, signedAt: new Date(Date.now() - 120_000) })}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Request has expired");
    expect(got.length).toBe(count);
  });

  it("forwards unsigned requests, and presigned ones with other keys, as they came", async () => {
    await fetch(`${rbase}/aws/plain`, { method: "POST", body: "x=1" });
    expect(got.at(-1)).toMatchObject({ url: "/plain", body: Buffer.from("x=1") });
    expect(got.at(-1)!.headers.authorization).toBeUndefined();
    // floci's own presigned URLs, such as a Lambda function's code location, carry keys floci issued.
    const own = `/b/k?${presignedQuery("ASIAFLOCIISSUED")}`;
    await fetch(`${rbase}/aws${own}`);
    expect(got.at(-1)!.url).toBe(own);
    // A presigned URL whose signing parameters cannot be read goes as it came too, for floci to answer.
    const unreadable = "/b/k?X-Amz-Credential=test&X-Amz-Signature=abc";
    await fetch(`${rbase}/aws${unreadable}`);
    expect(got.at(-1)!.url).toBe(unreadable);
  });

  it("adds its credentials only for the host names it knows", async () => {
    const port = new URL(rbase).port;
    const count = got.length;
    const signedAs = (host: string) => raw(`${rbase}/aws/`, { host, authorization: browserAuth("sqs"), "content-type": "application/x-amz-json-1.0" }, "POST", "{}");
    const refused = await signedAs(`evil.example:${port}`);
    expect(refused.status).toBe(403);
    expect(refused.headers["x-amzn-errortype"]).toBe("HostNotAllowed");
    expect(JSON.parse(refused.body).message).toContain("FLOCI_CONSOLE_HOSTS");
    const presignedRefused = await raw(`${rbase}/aws/b/k?${presignedQuery("test")}`, { host: `evil.example:${port}` });
    expect(presignedRefused.status).toBe(403);
    expect(presignedRefused.body).toContain("<Code>HostNotAllowed</Code>");
    expect(got.length).toBe(count);
    // localhost, the loopback addresses, and the names in FLOCI_CONSOLE_HOSTS, in any case, with or without a port.
    for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `console.lan:${port}`, "Console.Lan"]) {
      expect((await signedAs(host)).status, host).toBe(200);
    }
    // An unsigned request carries none of the server's credentials, so it goes as before, under any name.
    await raw(`${rbase}/aws/plain`, { host: `evil.example:${port}` });
    expect(got.at(-1)!.url).toBe("/plain");
    expect(got.at(-1)!.headers.authorization).toBeUndefined();
  });

  it("asks floci once whether it checks signatures", () => {
    expect(probes).toBe(1);
  });
});

describe("asking floci again whether it checks signatures", () => {
  // floci starts without signature checks, then restarts with them while the console server runs.
  let checking = false;
  let probes = 0;
  const forwarded: { url: string; authorization?: string }[] = [];
  let flociServer: http.Server;
  let child: ChildProcess;
  let cbase: string;

  beforeAll(async () => {
    flociServer = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        if (req.url === "/_floci/info") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ defaults: { account_id: "111111111111" } }));
        }
        if (new URLSearchParams(Buffer.concat(parts).toString()).get("Action") === "GetCallerIdentity") {
          probes++;
          res.writeHead(checking ? 403 : 200, { "content-type": "text/xml" });
          return res.end(checking ? "<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>" : "<GetCallerIdentityResponse/>");
        }
        forwarded.push({ url: req.url ?? "", authorization: req.headers.authorization });
        // S3 names its errors only in the XML body. With checks on, floci refuses the browser's own signature.
        const xmlError = (code: string) => {
          res.writeHead(403, { "content-type": "application/xml" });
          res.end(`<Error><Code>${code}</Code><Message>no</Message></Error>`);
        };
        if (req.url === "/accessdenied") {
          return xmlError("AccessDenied");
        }
        if (checking && /Signature=browser/.test(String(req.headers.authorization))) {
          return xmlError("SignatureDoesNotMatch");
        }
        res.writeHead(200);
        res.end("ok");
      });
    });
    const flociPort = await listen(flociServer);
    const port = await freePort();
    child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}`, AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_SESSION_TOKEN: "" });
    cbase = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    child?.removeAllListeners("exit");
    child?.kill();
    flociServer?.close();
  });

  const send = async (path: string) => {
    const res = await fetch(`${cbase}/aws${path}`, { headers: { authorization: "AWS4-HMAC-SHA256 Credential=test/20250101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=browser" } });
    await res.text();
    return res.status;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("asks again once after floci refuses credentials, but not after another error", async () => {
    expect(await send("/b/k")).toBe(200);
    expect(probes).toBe(1);
    expect(forwarded.at(-1)!.authorization).toContain("Signature=browser");

    // An error that is not about credentials changes nothing, even after the wait.
    expect(await send("/accessdenied")).toBe(403);
    await wait(1100);
    expect(await send("/b/k")).toBe(200);
    expect(probes).toBe(1);

    // floci restarts with checks on. The first request still goes as it came, and floci refuses it.
    checking = true;
    expect(await send("/b/k")).toBe(403);
    expect(forwarded.at(-1)!.authorization).toContain("Signature=browser");

    // The next requests make the server ask again, once for all of them, and are signed again.
    expect(await Promise.all([send("/b/k"), send("/b/k"), send("/b/k")])).toEqual([200, 200, 200]);
    expect(probes).toBe(2);
    expect(forwarded.at(-1)!.authorization).not.toContain("Signature=browser");
  });
});

describe("FLOCI_AUTH_VALIDATE_SIGNATURES on the console server", () => {
  // A floci that checks signatures: it refuses the browser's own signature.
  let probes = 0;
  const forwarded: { authorization?: string }[] = [];
  let flociServer: http.Server;
  let flociPort: number;
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    flociServer = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        if (new URLSearchParams(Buffer.concat(parts).toString()).get("Action") === "GetCallerIdentity") {
          probes++;
          res.writeHead(403, { "content-type": "text/xml" });
          return res.end("<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>");
        }
        forwarded.push({ authorization: req.headers.authorization });
        if (/Signature=browser/.test(String(req.headers.authorization))) {
          res.writeHead(403, { "content-type": "application/xml" });
          return res.end("<Error><Code>SignatureDoesNotMatch</Code><Message>no</Message></Error>");
        }
        res.writeHead(200);
        res.end("ok");
      });
    });
    flociPort = await listen(flociServer);
  });

  afterAll(() => {
    for (const child of children) {
      child.removeAllListeners("exit");
      child.kill();
    }
    flociServer?.close();
  });

  const startWith = async (value: string) => {
    const port = await freePort();
    const child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${flociPort}`, AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_SESSION_TOKEN: "", FLOCI_AUTH_VALIDATE_SIGNATURES: value });
    children.push(child);
    return `http://127.0.0.1:${port}`;
  };
  const send = async (cbase: string) => {
    const res = await fetch(`${cbase}/aws/b/k`, { headers: { authorization: "AWS4-HMAC-SHA256 Credential=test/20250101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=browser" } });
    await res.text();
    return res.status;
  };

  it("signs every request again without asking floci when it is true, in any case", async () => {
    probes = 0;
    const cbase = await startWith(" TRUE ");
    expect(await send(cbase)).toBe(200);
    expect(await send(cbase)).toBe(200);
    expect(probes).toBe(0);
    expect(forwarded.at(-1)!.authorization).not.toContain("Signature=browser");
  });

  it("forwards every request as it came, and never asks floci, when it is false", async () => {
    probes = 0;
    const cbase = await startWith("false");
    expect(await send(cbase)).toBe(403);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await send(cbase)).toBe(403);
    expect(probes).toBe(0);
    expect(forwarded.at(-1)!.authorization).toContain("Signature=browser");
  });

  it("refuses to start with any other value", async () => {
    await expect(startWith("yes")).rejects.toThrow("exited with code 1");
  });
});

describe("EC2 browser terminal", () => {
  const RUNNING = "i-0123456789abcdef0";
  const STOPPED = "i-0fedcba9876543210";
  const calls: { method?: string; url: string; body: string }[] = [];
  let docker: http.Server;
  let sock: string;
  let child: ChildProcess;
  let tbase: string;

  // A fake Docker daemon: finds the container by floci's labels, creates an exec,
  // and on start upgrades the connection and echoes what it reads, like a TTY would.
  const containers = (url: string) => {
    const filters = JSON.parse(new URL(url, "http://x").searchParams.get("filters") ?? "{}");
    const labels: string[] = filters.label ?? [];
    if (!labels.includes("io.floci.service=ec2")) return [];
    if (labels.includes(`io.floci.resource-id=${RUNNING}`)) return [{ Id: "c1", State: "running", Ports: [{ PrivatePort: 22, PublicPort: 2201, Type: "tcp" }] }];
    if (labels.includes(`io.floci.resource-id=${STOPPED}`)) return [{ Id: "c2", State: "exited", Ports: [] }];
    return [];
  };

  beforeAll(async () => {
    sock = path.join(dir, "docker.sock");
    docker = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ method: req.method, url: req.url ?? "", body });
        const send = (status: number, value: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (req.url === "/_ping") return send(200, "OK");
        if (req.url?.startsWith("/containers/json")) return send(200, containers(req.url));
        if (req.url === "/containers/c1/exec") return send(201, { Id: "e1" });
        if (req.url?.startsWith("/exec/e1/resize")) return send(200, {});
        send(404, { message: "no such route" });
      });
    });
    docker.on("upgrade", (req, socket, head) => {
      calls.push({ method: req.method, url: req.url ?? "", body: String(head) });
      socket.write("HTTP/1.1 101 UPGRADED\r\nconnection: Upgrade\r\nupgrade: tcp\r\n\r\nwelcome$ ");
      socket.on("data", (d) => {
        // The start request's JSON body can arrive after the headers. It is not a keystroke.
        if (String(d).startsWith('{"Detach"')) return;
        if (String(d) === "exit\r") return socket.end();
        socket.write(`echo:${d}`);
      });
    });
    await new Promise<void>((r) => docker.listen(sock, r));
    const port = await freePort();
    child = await start({ PORT: String(port), FLOCI_ENDPOINT: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, EC2_TERMINAL: "1", DOCKER_HOST: `unix://${sock}` });
    tbase = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    child?.removeAllListeners("exit");
    child?.kill();
    docker?.close();
  });

  // Opens the terminal WebSocket and collects what the shell prints.
  function open(id: string, query = "") {
    const ws = new WebSocket(`${tbase.replace("http", "ws")}/api/terminal/${id}/ws${query}`);
    ws.binaryType = "arraybuffer";
    let out = "";
    const waiters: { text: string; resolve: () => void }[] = [];
    ws.addEventListener("message", (e) => {
      out += new TextDecoder().decode(e.data as ArrayBuffer);
      for (const w of waiters.splice(0)) (out.includes(w.text) ? w.resolve : () => waiters.push(w))();
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })));
    const until = (text: string) => new Promise<void>((resolve) => (out.includes(text) ? resolve() : waiters.push({ text, resolve })));
    return { ws, closed, until, output: () => out };
  }

  // A raw upgrade request, so a test can set the Origin header and read a refusal.
  function rawUpgrade(base: string, pathname: string, headers: Record<string, string> = {}) {
    return new Promise<number | undefined>((resolve) => {
      const req = http.request(`${base}${pathname}`, {
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode);
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
  }

  it("is off by default", async () => {
    const body = await (await fetch(`${base}/api/terminal`)).json();
    expect(body.enabled).toBe(false);
    expect(body.reason).toContain("EC2_TERMINAL=1");
    expect(await rawUpgrade(base, `/api/terminal/${RUNNING}/ws`)).toBe(404);
  });

  it("reports on when the Docker daemon answers", async () => {
    expect(await (await fetch(`${tbase}/api/terminal`)).json()).toEqual({ enabled: true, reason: null });
  });

  it("finds the instance's container and its SSH port", async () => {
    expect(await (await fetch(`${tbase}/api/terminal/${RUNNING}`)).json()).toEqual({ enabled: true, reason: null, state: "running", sshPort: 2201 });
    const missing = await (await fetch(`${tbase}/api/terminal/i-00000000000000000`)).json();
    expect(missing).toMatchObject({ enabled: true, state: null, sshPort: null });
    expect((await fetch(`${tbase}/api/terminal/not-an-id`)).status).toBe(400);
  });

  it("streams a shell in both directions and passes resizes to Docker", async () => {
    const t = open(RUNNING, "?cols=100&rows=30");
    await t.until("welcome$ ");
    t.ws.send(new TextEncoder().encode("ls\r"));
    await t.until("echo:ls\r");

    const create = calls.find((c) => c.url === "/containers/c1/exec");
    expect(JSON.parse(create!.body)).toMatchObject({ Tty: true, AttachStdin: true, ConsoleSize: [30, 100], Cmd: ["/bin/sh", "-c", expect.stringContaining("bash")] });
    expect(calls.some((c) => c.url.startsWith("/exec/e1/start"))).toBe(true);

    t.ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await expect.poll(() => calls.some((c) => c.url === "/exec/e1/resize?h=40&w=120")).toBe(true);

    t.ws.send(new TextEncoder().encode("exit\r"));
    expect((await t.closed).reason).toBe("The shell exited.");
  });

  it("closes with the reason when the instance is not running", async () => {
    const t = open(STOPPED);
    const { code, reason } = await t.closed;
    expect(code).toBe(1011);
    expect(reason).toContain("exited");
  });

  it("refuses a WebSocket from another web site", async () => {
    expect(await rawUpgrade(tbase, `/api/terminal/${RUNNING}/ws`, { origin: "http://evil.test" })).toBe(403);
    expect(await rawUpgrade(tbase, `/api/terminal/${RUNNING}/ws`, { origin: tbase })).toBe(101);
  });

  it("refuses a WebSocket for something that is not an instance ID", async () => {
    expect(await rawUpgrade(tbase, "/api/terminal/i-nope/ws")).toBe(400);
    expect(await rawUpgrade(tbase, "/somewhere-else")).toBe(404);
  });

  it("reports off with the reason when the Docker daemon cannot be reached", async () => {
    const port = await freePort();
    const other = await start({ PORT: String(port), FLOCI_ENDPOINT: "http://127.0.0.1:1", EC2_TERMINAL: "1", DOCKER_HOST: `unix://${path.join(dir, "missing.sock")}` });
    try {
      const body = await (await fetch(`http://127.0.0.1:${port}/api/terminal`)).json();
      expect(body.enabled).toBe(false);
      expect(body.reason).toContain("Cannot reach the Docker daemon");
    } finally {
      other.removeAllListeners("exit");
      other.kill();
    }
  });
});
