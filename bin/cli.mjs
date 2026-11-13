#!/usr/bin/env node
// Command line entry. `floci-aws-ui serve` starts the console server from server.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `floci-aws-ui: a web console for floci, the local AWS emulator.

Usage:
  floci-aws-ui serve [options]

Options:
  -f, --floci <url>   Where floci listens.            Default: http://localhost:4566
  -p, --port <port>   Port for the console.           Default: 8080
  -H, --host <host>   Address to listen on.           Default: 127.0.0.1
  -v, --version       Print the version.
  -h, --help          Print this help.

The environment variables FLOCI_ENDPOINT, PORT and HOST set the same three values.
An option wins over its variable.

The console has no login. With the default host, only this machine can open it.
Use --host 0.0.0.0 to let other machines in, and only on a network you trust.`;

function fail(message) {
  console.error(`${message}\n\nRun "floci-aws-ui --help" to see the options.`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      floci: { type: "string", short: "f" },
      port: { type: "string", short: "p" },
      host: { type: "string", short: "H" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  fail(e.message);
}

const { values, positionals } = args;
const command = positionals[0];

if (values.version) {
  console.log(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  process.exit(0);
}
if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}
if (command !== "serve" || positionals.length > 1) fail(`Unknown command: ${positionals.join(" ")}`);

const floci = values.floci ?? process.env.FLOCI_ENDPOINT ?? "http://localhost:4566";
const port = values.port ?? process.env.PORT ?? "8080";
const host = values.host ?? process.env.HOST ?? "127.0.0.1";

let url;
try {
  url = new URL(floci);
} catch {
  /* reported below */
}
if (!url || url.protocol !== "http:") fail(`--floci must be an http:// URL, like http://localhost:4566. Got: ${floci}`);
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail(`--port must be a number from 1 to 65535. Got: ${port}`);
if (!fs.existsSync(path.join(root, "dist", "index.html"))) fail(`The built app is missing. Run "pnpm build" in ${root} first.`);

process.env.FLOCI_ENDPOINT = floci;
process.env.PORT = port;
process.env.HOST = host;

await import("../server.mjs");

// The console is useless without floci. Check once, and say how to fix it. The console keeps running either way.
try {
  const res = await fetch(new URL("/_floci/health", url), { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const health = await res.json().catch(() => ({}));
  console.log(`floci${health.version ? ` ${health.version}` : ""} is running at ${url.origin}.`);
} catch {
  console.error(`
Warning: no floci answers at ${url.origin}. The console is open, but every page will show an error.

  Start floci with Docker:
    docker run -d --name floci -p 127.0.0.1:4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest

  Or, if floci runs somewhere else, stop this and point to it:
    floci-aws-ui serve --floci http://your-floci-host:4566

  More options: floci-aws-ui --help
  floci docs:   https://floci.io
`);
}
