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
    const child = spawn(process.execPath, [path.join(dir, "server.mjs")], { env: { ...process.env, AWS_ENDPOINT_URL: "", FLOCI_INFO_URL: "", EC2_TERMINAL: "", DOCKER_HOST: "", ...env }, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout!.on("data", (d) => String(d).includes("Console on") && resolve(child));
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`server.mjs exited with code ${code}`)));
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "console-server-"));
  fs.copyFileSync(path.resolve("server.mjs"), path.join(dir, "server.mjs"));
  fs.copyFileSync(path.resolve("terminal.mjs"), path.join(dir, "terminal.mjs"));
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
      if (req.url === "/_floci/info") return res.end(JSON.stringify({ endpoint: "http://outside.test:4566", unknown: 1 }));
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
