// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real bin/cli.mjs from a copy of the package with a small fake build in dist/.

let dir: string;
let cli: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "console-cli-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "dist"));
  fs.copyFileSync(path.resolve("bin/cli.mjs"), path.join(dir, "bin", "cli.mjs"));
  fs.copyFileSync(path.resolve("server.mjs"), path.join(dir, "server.mjs"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "9.8.7", type: "module" }));
  fs.writeFileSync(path.join(dir, "dist", "index.html"), "<html>app</html>");
  cli = path.join(dir, "bin", "cli.mjs");
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// The variables of the person running the tests must not leak in.
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.FLOCI_ENDPOINT;
  delete env.PORT;
  delete env.HOST;
  return env;
};

const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: cleanEnv() });

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

/** Starts `serve` and gives back its first line of output. */
function serve(args: string[], env: Record<string, string> = {}): Promise<{ line: string; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "serve", ...args], { env: { ...cleanEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => resolve({ line: String(d).trim(), stop: () => child.kill() }));
    child.on("exit", (code) => reject(new Error(`cli exited with code ${code}: ${err}`)));
  });
}

describe("floci-aws-ui command", () => {
  it("prints the help with no command", () => {
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("floci-aws-ui serve [options]");
  });

  it("prints the help with --help", () => {
    expect(run("--help").stdout).toContain("--floci <url>");
  });

  it("prints the version", () => {
    expect(run("--version").stdout.trim()).toBe("9.8.7");
  });

  it("rejects an unknown command", () => {
    const res = run("deploy");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: deploy");
  });

  it("rejects an unknown option", () => {
    const res = run("serve", "--nope");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--nope");
  });

  it("rejects a port that is not a number", () => {
    const res = run("serve", "--port", "abc");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--port must be a number from 1 to 65535. Got: abc");
  });

  it("rejects a floci address that is not http", () => {
    const res = run("serve", "--floci", "https://floci.example");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--floci must be an http:// URL");
  });

  it("says so when the app is not built", () => {
    const html = path.join(dir, "dist", "index.html");
    fs.renameSync(html, `${html}.off`);
    try {
      const res = run("serve");
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("The built app is missing.");
    } finally {
      fs.renameSync(`${html}.off`, html);
    }
  });
});

describe("floci-aws-ui serve", () => {
  it("serves the app on this machine only by default", async () => {
    const port = await freePort();
    const server = await serve(["--port", String(port), "--floci", "http://floci.test:4566"]);
    try {
      expect(server.line).toBe(`Console on http://127.0.0.1:${port}  ->  floci at http://floci.test:4566`);
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("<html>app</html>");
      expect(await (await fetch(`http://127.0.0.1:${port}/console-config.json`)).json()).toEqual({ flociHost: "floci.test" });
    } finally {
      server.stop();
    }
  });

  it("reads the environment variables", async () => {
    const port = await freePort();
    const server = await serve([], { PORT: String(port), FLOCI_ENDPOINT: "http://from-env:4566", HOST: "localhost" });
    try {
      expect(server.line).toBe(`Console on http://localhost:${port}  ->  floci at http://from-env:4566`);
    } finally {
      server.stop();
    }
  });

  it("lets an option win over its variable", async () => {
    const port = await freePort();
    const server = await serve(["--port", String(port), "-f", "http://from-option:4566"], { PORT: "1", FLOCI_ENDPOINT: "http://from-env:4566" });
    try {
      expect(server.line).toBe(`Console on http://127.0.0.1:${port}  ->  floci at http://from-option:4566`);
    } finally {
      server.stop();
    }
  });
});
