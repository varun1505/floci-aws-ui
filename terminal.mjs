// Browser terminal for EC2 instances. No dependencies.
//
// floci runs each EC2 instance as a Docker container. This module opens a shell in that
// container with the Docker Engine API (`docker exec` with a TTY) and streams it to the
// page over a WebSocket. It is the console's stand-in for EC2 Instance Connect and Session
// Manager, which floci does not provide for EC2.
//
// It is off unless EC2_TERMINAL=1, and it needs the Docker daemon that floci uses:
//   DOCKER_HOST   unix:///path/to/docker.sock (default unix:///var/run/docker.sock) or tcp://host:2375
// Access to the Docker daemon is root on the Docker host. Only turn this on where that is acceptable.
//
// Routes:
//   GET /api/terminal                  -> { enabled, reason }
//   GET /api/terminal/<instance-id>    -> { enabled, reason, state, sshPort }
//   WebSocket /api/terminal/<instance-id>/ws?cols=80&rows=24
//     page -> server: binary frames are keystrokes; text frames are JSON {"type":"resize","cols","rows"}
//     server -> page: binary frames are terminal output; a close frame's reason says why it ended
import crypto from "node:crypto";
import http from "node:http";

const INSTANCE_ID = /^i-[0-9a-f]{8,17}$/;
const ROUTE = /^\/api\/terminal(?:\/([^/]+))?(\/ws)?$/;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1024 * 1024;
// Prefer bash, as an Amazon Linux or Ubuntu login would. Images without bash get sh.
const SHELL = ["/bin/sh", "-c", "cd ~ 2>/dev/null; if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"];

const on = (v) => !["", "0", "false", "no", "off"].includes(String(v ?? "").toLowerCase());

/** Where the Docker Engine API listens, as options for http.request. */
export function dockerTarget(value) {
  const raw = value || "unix:///var/run/docker.sock";
  if (raw.startsWith("unix://")) return { socketPath: raw.slice("unix://".length) };
  if (raw.startsWith("tcp://") || raw.startsWith("http://")) {
    const u = new URL(raw.replace(/^tcp:/, "http:"));
    return { hostname: u.hostname, port: Number(u.port || 2375) };
  }
  throw new Error(`DOCKER_HOST=${raw} is not supported. Use unix:///path/to/docker.sock or tcp://host:2375.`);
}

/** Clamps a terminal size from the page to something a TTY accepts. */
function size(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : fallback;
}

export function createTerminal(env = process.env) {
  const enabled = on(env.EC2_TERMINAL);
  let target;
  let configError = null;
  if (enabled) {
    try {
      target = dockerTarget(env.DOCKER_HOST);
    } catch (e) {
      configError = e.message;
    }
  }

  // One call to the Docker Engine API. Resolves with the status and the parsed body.
  function docker(method, path, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { ...target, method, path, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}, timeout: 10000 },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            let json;
            try {
              json = text ? JSON.parse(text) : undefined;
            } catch {
              json = { message: text };
            }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("the Docker daemon did not answer in 10 s")));
      req.on("error", (err) => reject(new Error(`Cannot reach the Docker daemon: ${err.message || err.code}`)));
      req.end(payload);
    });
  }

  // POST /exec/<id>/start and take over the connection. Docker answers 101 and then the
  // socket carries the raw TTY in both directions.
  function startExec(execId) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ Detach: false, Tty: true });
      const req = http.request({
        ...target,
        method: "POST",
        path: `/exec/${execId}/start`,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), connection: "Upgrade", upgrade: "tcp" },
      });
      req.on("upgrade", (_res, socket, head) => resolve({ socket, head }));
      req.on("response", (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => reject(new Error(`Docker could not start the shell: HTTP ${res.statusCode} ${text.trim()}`)));
      });
      req.on("error", (err) => reject(new Error(`Cannot reach the Docker daemon: ${err.message || err.code}`)));
      req.end(payload);
    });
  }

  async function findInstance(id) {
    const filters = JSON.stringify({ label: ["io.floci.service=ec2", `io.floci.resource-id=${id}`] });
    const { status, json } = await docker("GET", `/containers/json?all=true&filters=${encodeURIComponent(filters)}`);
    if (status !== 200) throw new Error(`Docker answered HTTP ${status}: ${json?.message ?? ""}`.trim());
    const c = Array.isArray(json) ? json[0] : undefined;
    if (!c) return undefined;
    const ssh = (c.Ports ?? []).find((p) => p.PrivatePort === 22 && p.PublicPort);
    return { containerId: c.Id, state: c.State, sshPort: ssh?.PublicPort ?? null };
  }

  function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  const disabledReason = () =>
    configError ?? "The browser terminal is off. Start the console with EC2_TERMINAL=1 and access to floci's Docker daemon to turn it on.";

  /** Answers GET /api/terminal and /api/terminal/<id>. Returns false for other paths. */
  function handleRequest(req, res) {
    const m = ROUTE.exec(req.url.split("?")[0]);
    if (!m || m[2]) return false;
    const id = m[1];
    if (!enabled || configError) {
      json(res, 200, { enabled: false, reason: disabledReason() });
      return true;
    }
    if (!id) {
      docker("GET", "/_ping")
        .then(({ status }) => json(res, 200, status === 200 ? { enabled: true, reason: null } : { enabled: false, reason: `The Docker daemon answered HTTP ${status}.` }))
        .catch((e) => json(res, 200, { enabled: false, reason: e.message }));
      return true;
    }
    if (!INSTANCE_ID.test(id)) {
      json(res, 400, { message: `'${id}' is not an instance ID.` });
      return true;
    }
    findInstance(id)
      .then((found) =>
        json(res, 200, found ? { enabled: true, reason: null, state: found.state, sshPort: found.sshPort } : { enabled: true, reason: `No container for ${id}. Is it running?`, state: null, sshPort: null }),
      )
      .catch((e) => json(res, 200, { enabled: false, reason: e.message }));
    return true;
  }

  /** Takes the WebSocket upgrade for /api/terminal/<id>/ws. Returns false for other paths. */
  function handleUpgrade(req, socket) {
    const url = new URL(req.url, "http://x");
    const m = ROUTE.exec(url.pathname);
    if (!m || !m[2] || !m[1]) return false;
    const refuse = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${text}`);
      return true;
    };
    if (!enabled || configError) return refuse(404, disabledReason());
    if (!INSTANCE_ID.test(m[1])) return refuse(400, "Not an instance ID.");
    // The console has no login, so at least stop other web sites from opening a shell
    // through a visitor's browser. Browsers always send Origin on a WebSocket.
    const origin = req.headers.origin;
    if (origin) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        /* refused below */
      }
      if (originHost !== req.headers.host) return refuse(403, "The terminal only accepts connections from the console's own pages.");
    }
    const key = req.headers["sec-websocket-key"];
    if (String(req.headers.upgrade).toLowerCase() !== "websocket" || !key) return refuse(400, "Expected a WebSocket.");

    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
    const ws = new WebSocket(socket);
    attach(ws, m[1], size(url.searchParams.get("cols"), 80), size(url.searchParams.get("rows"), 24));
    return true;
  }

  async function attach(ws, id, cols, rows) {
    let tty;
    let execId;
    const pending = [];
    ws.onMessage = (data, binary) => {
      if (!binary) {
        let msg;
        try {
          msg = JSON.parse(data.toString("utf8"));
        } catch {
          return;
        }
        if (msg?.type === "resize") {
          cols = size(msg.cols, cols);
          rows = size(msg.rows, rows);
          if (execId) docker("POST", `/exec/${execId}/resize?h=${rows}&w=${cols}`).catch(() => {});
        }
        return;
      }
      if (tty) tty.write(data);
      else pending.push(data);
    };
    ws.onClose = () => tty?.end();

    try {
      const found = await findInstance(id);
      if (!found) throw new Error(`No container for ${id}. Is the instance running?`);
      if (found.state !== "running") throw new Error(`The instance container is ${found.state}. Start the instance first.`);
      const created = await docker("POST", `/containers/${found.containerId}/exec`, {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        ConsoleSize: [rows, cols],
        Env: ["TERM=xterm-256color"],
        Cmd: SHELL,
      });
      if (created.status !== 201) throw new Error(`Docker could not create the shell: HTTP ${created.status} ${created.json?.message ?? ""}`.trim());
      execId = created.json.Id;
      if (ws.closed) return;
      const started = await startExec(execId);
      tty = started.socket;
      if (ws.closed) return tty.destroy();
      if (started.head?.length) ws.send(started.head);
      tty.on("data", (d) => ws.send(d));
      tty.on("close", () => ws.close(1000, "The shell exited."));
      tty.on("error", () => ws.close(1011, "The connection to the shell failed."));
      for (const d of pending.splice(0)) tty.write(d);
      docker("POST", `/exec/${execId}/resize?h=${rows}&w=${cols}`).catch(() => {});
    } catch (e) {
      ws.close(1011, e.message);
    }
  }

  return { enabled: enabled && !configError, handleRequest, handleUpgrade };
}

/** The server half of RFC 6455, enough for one terminal: no extensions, no subprotocols. */
class WebSocket {
  constructor(socket) {
    this.socket = socket;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.onMessage = () => {};
    this.onClose = () => {};
    socket.setNoDelay(true);
    socket.on("data", (chunk) => this.read(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  read(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 2 && !this.closed) {
      const b = this.buffer;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        offset = 10;
      }
      // Browsers always mask. An unmasked or oversized frame is not from our page.
      if (!masked) return this.close(1002, "Frames from the page must be masked.");
      if (len > MAX_MESSAGE) return this.close(1009, "Message too big.");
      if (b.length < offset + 4 + len) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(offset + 4 + len);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    if (op === 0x8) return this.close(1000);
    if (op === 0x9) return this.write(0xa, payload);
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) return this.onMessage(payload, op === 0x2);
      this.fragments = { binary: op === 0x2, parts: [payload], size: payload.length };
      return;
    }
    if (op === 0x0 && this.fragments) {
      this.fragments.parts.push(payload);
      this.fragments.size += payload.length;
      if (this.fragments.size > MAX_MESSAGE) return this.close(1009, "Message too big.");
      if (fin) {
        const { parts, binary } = this.fragments;
        this.fragments = null;
        this.onMessage(Buffer.concat(parts), binary);
      }
      return;
    }
    this.close(1002, "Unknown frame.");
  }

  write(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | op;
    if (len < 126) head[1] = len;
    else if (len < 65536) {
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(data) {
    this.write(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    // A close reason must fit in a control frame (125 bytes, 2 of them for the code).
    // Cut by characters, not bytes: a browser drops a close frame whose reason is not valid UTF-8.
    let str = String(reason);
    if (Buffer.byteLength(str) > 123) {
      while (Buffer.byteLength(str) > 120) str = str.slice(0, -1);
      str += "...";
    }
    const text = Buffer.from(str, "utf8");
    const body = Buffer.alloc(2 + text.length);
    body.writeUInt16BE(code, 0);
    text.copy(body, 2);
    this.write(0x8, body);
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}
