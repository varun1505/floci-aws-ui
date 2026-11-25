// Production server. Serves the built app from ./dist and forwards /aws/* to floci.
// No dependencies. Run: AWS_ENDPOINT_URL=http://floci:4566 PORT=8080 node server.mjs
// EC2_TERMINAL=1 adds a browser terminal for EC2 instances. See terminal.mjs.
// FLOCI_ENDPOINT is read when AWS_ENDPOINT_URL is not set.
// Set HOST to listen on one address only. Without it the server listens on all of them.
//
// Follows the Floci Console Contract v1 (https://floci.io/floci/ui/console-contract/),
// so floci can start this server as its console sidecar. See GET /api/health below.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminal } from "./terminal.mjs";

const target = new URL(process.env.AWS_ENDPOINT_URL || process.env.FLOCI_ENDPOINT || "http://localhost:4566");
const secure = target.protocol === "https:";
// floci sets FLOCI_TLS_SKIP_VERIFY when its certificate is self-signed. This applies to requests to floci only.
const skipVerify = !["", "0", "false"].includes((process.env.FLOCI_TLS_SKIP_VERIFY || "").toLowerCase());
const tls = secure && skipVerify ? { rejectUnauthorized: false } : {};
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || undefined;
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
// Browser terminal for EC2 instances. Off unless EC2_TERMINAL=1. See terminal.mjs.
const terminal = createTerminal(process.env);

let version;
try {
  version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
} catch {
  /* package.json is not always next to this file */
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function proxy(req, res) {
  const headers = { ...req.headers, host: target.host };
  const upstream = (secure ? https : http).request(
    {
      ...tls,
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      method: req.method,
      path: req.url.replace(/^\/aws/, "") || "/",
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `Cannot reach floci at ${target.origin}: ${err.message}` }));
  });
  req.pipe(upstream);
}

// One GET to floci. Resolves with the status and the body, or rejects with the reason.
function get(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, { ...tls, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeoutMs} ms`)));
    req.on("error", (err) => reject(new Error(err.message || err.code || "connection failed")));
  });
}

// floci polls this before it sends the browser here. "ok" means this server reached floci just now.
async function health(res) {
  let error = null;
  try {
    const { status } = await get(new URL("/_floci/health", target), 800);
    if (status !== 200) error = `floci answered HTTP ${status} on /_floci/health`;
  } catch (err) {
    error = `Cannot reach floci at ${target.origin}: ${err.message}`;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(
    JSON.stringify({
      status: error ? "unavailable" : "ok",
      endpoint: target.origin,
      error,
      console: { name: "floci-aws-ui", version },
    }),
  );
}

// The host name people use to reach floci from their own machine. Pages show it in endpoints and commands.
// As a sidecar, this server reaches floci on a container address that nobody outside Docker can use.
// floci's manifest has the outside address, so prefer that.
let publicHost;
async function flociHost() {
  if (!publicHost && process.env.FLOCI_INFO_URL) {
    try {
      const { status, body } = await get(new URL(process.env.FLOCI_INFO_URL), 2000);
      if (status === 200) publicHost = new URL(JSON.parse(body).endpoint).hostname;
    } catch {
      /* fall back to the address this server uses */
    }
  }
  return publicHost || target.hostname;
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(dist, urlPath));
  if (!file.startsWith(dist)) {
    res.writeHead(403);
    return res.end();
  }
  // Any path that is not a real file is a page route. Send the app.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split("?")[0];
  if (pathname === "/api/health") return health(res);
  if (terminal.handleRequest(req, res)) return;
  if (pathname === "/console-config.json") {
    return flociHost().then((flociHost) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      res.end(JSON.stringify({ flociHost }));
    });
  }
  if (req.url === "/aws" || req.url.startsWith("/aws/") || req.url.startsWith("/aws?")) return proxy(req, res);
  serveStatic(req, res);
});
server.on("upgrade", (req, socket) => {
  socket.on("error", () => {});
  if (!terminal.handleUpgrade(req, socket)) socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
});
server.listen(port, host, () =>
  console.log(`Console on http://${host || "localhost"}:${port}  ->  floci at ${target.origin}${terminal.enabled ? "  (EC2 browser terminal on)" : ""}`),
);
