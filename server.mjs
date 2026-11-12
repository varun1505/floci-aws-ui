// Production server. Serves the built app from ./dist and forwards /aws/* to floci.
// No dependencies. Run: FLOCI_ENDPOINT=http://floci:4566 PORT=8080 node server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = new URL(process.env.FLOCI_ENDPOINT || "http://localhost:4566");
const port = Number(process.env.PORT || 8080);
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

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
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
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

http
  .createServer((req, res) => {
    if (req.url === "/aws" || req.url.startsWith("/aws/") || req.url.startsWith("/aws?")) return proxy(req, res);
    serveStatic(req, res);
  })
  .listen(port, () => console.log(`Console on http://localhost:${port}  ->  floci at ${target.origin}`));
