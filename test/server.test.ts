// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real server.mjs against a fake floci, with a small fake build in dist/.

let dir: string;
let fake: http.Server;
let server: ChildProcess;
let base: string;
const seen: { method?: string; url?: string; host?: string; body: string }[] = [];

function listen(s: http.Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));
}

async function freePort(): Promise<number> {
  const s = http.createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

function start(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, "server.mjs")], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout!.on("data", (d) => String(d).includes("Console on") && resolve(child));
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`server.mjs exited with code ${code}`)));
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "console-server-"));
  fs.copyFileSync(path.resolve("server.mjs"), path.join(dir, "server.mjs"));
  fs.mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "index.html"), "<html>app</html>");
  fs.writeFileSync(path.join(dir, "dist", "assets", "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "secret.txt"), "outside dist");

  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, body });
      res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "application/json", "x-fake": "floci" });
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

describe("floci is down", () => {
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
