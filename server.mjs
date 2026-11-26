// Production server. Serves the built app from ./dist and forwards /aws/* to floci.
// No dependencies. Run: AWS_ENDPOINT_URL=http://floci:4566 PORT=8080 node server.mjs
// EC2_TERMINAL=1 adds a browser terminal for EC2 instances. See terminal.mjs.
// FLOCI_ENDPOINT is read when AWS_ENDPOINT_URL is not set.
// Set HOST to listen on one address only. Without it the server listens on all of them.
// When floci checks signatures (FLOCI_AUTH_VALIDATE_SIGNATURES=true), signed /aws requests are signed
// again for floci, and presigned ones presigned again. See "Re-signing" below and sigv4.mjs.
//
// Follows the Floci Console Contract v1 (https://floci.io/floci/ui/console-contract/),
// so floci can start this server as its console sidecar. See GET /api/health below.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminal } from "./terminal.mjs";
import { amzDate, decodeAwsChunked, parseAuthorization, parsePresigned, partitionOf, presignQuery, sha256Hex, signRequest, xmlText } from "./sigv4.mjs";

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

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const unreachable = (res, err) => sendJson(res, 502, { message: `Cannot reach floci at ${target.origin}: ${err.message}` });

// Sends one request to floci. `body` is a Buffer, or the incoming request to stream from.
// `onStatus` sees floci's status code, headers and answer stream before the answer goes to the browser.
function upstream(method, path, headers, body, res, onStatus) {
  const up = (secure ? https : http).request(
    { ...tls, hostname: target.hostname, port: target.port || (secure ? 443 : 80), method, path, headers },
    (answer) => {
      onStatus?.(answer.statusCode, answer.headers, answer);
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    },
  );
  up.on("error", (err) => unreachable(res, err));
  if (Buffer.isBuffer(body)) up.end(body);
  else body.pipe(up);
}

// Forwards the request as it came, signature and all. When floci refuses its credentials, floci may have
// started checking signatures since the server last asked, so the server asks again soon.
function passThrough(req, res) {
  upstream(req.method, req.url.replace(/^\/aws/, "") || "/", { ...req.headers, host: target.host }, req, res, (status, headers, answer) =>
    onCredentialError(status, headers, answer, recheckSoon),
  );
}

const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// An AWS-style error the browser's SDK reads: JSON for a JSON request, XML otherwise.
function sendError(req, res, status, code, message, headers = {}) {
  const all = { "x-amzn-errortype": code, "cache-control": "no-store", ...headers };
  if (/json/.test(String(req.headers["content-type"] || ""))) return sendJson(res, status, { __type: code, message }, all);
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { ...all, "content-type": "text/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><ErrorResponse><Error><Type>Sender</Type><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error></ErrorResponse>`);
}

// ---- Re-signing for floci with FLOCI_AUTH_VALIDATE_SIGNATURES=true --------------------------------
//
// The browser signs for this server's host and the /aws path, with its account ID as the access key.
// floci checks the signature against its own host and path, and accepts only keys it knows. So when
// floci checks signatures, this server signs each request again for floci: as itself (AWS_ACCESS_KEY_ID,
// default test/test) for floci's default account, and with credentials from sts:AssumeRole into
// FLOCI_CONSOLE_ROLE_NAME for any other account. When floci does not check, nothing changes.

const ownCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
};
const roleName = process.env.FLOCI_CONSOLE_ROLE_NAME || "OrganizationAccountAccessRole";
if (!/^[\w+=,.@-]{1,64}$/.test(roleName)) {
  console.error(`FLOCI_CONSOLE_ROLE_NAME must be an IAM role name, like OrganizationAccountAccessRole. Got: ${roleName}`);
  process.exit(1);
}
const ROLE_SESSION_NAME = "floci-aws-ui";
// Role credentials are used until 5 minutes before they expire.
const REFRESH_MS = 5 * 60 * 1000;
// How long the answer to "does floci check signatures?" is kept.
const PROBE_TTL_MS = 5 * 60 * 1000;
// After floci refuses the credentials of a request passed through as it came, the server asks again,
// but no sooner than this after it last asked.
const RECHECK_MS = 1000;
// Signed requests other than plain S3 bodies are read whole before they are signed again.
// S3 bodies with a known length are streamed.
const MAX_BODY = 1024 * 1024 * 1024;

// Host names the server signs requests for. A request under any other name is refused before the
// server adds its credentials, so a web page that points its own name at this server (DNS rebinding)
// cannot use them. FLOCI_CONSOLE_HOSTS adds names, for people who open the web console from another machine.
const bareHost = (name) => name.trim().toLowerCase().replace(/^\[|\]$/g, "");
const signingHosts = new Set(
  ["localhost", "127.0.0.1", "::1", host || "", ...(process.env.FLOCI_CONSOLE_HOSTS || "").split(",")]
    .map(bareHost)
    .filter((name) => name && name !== "0.0.0.0" && name !== "::"),
);

// The host name of a Host header, without its port. Empty when there is none.
function hostName(header) {
  try {
    return bareHost(new URL(`http://${header}`).hostname);
  } catch {
    return "";
  }
}

// Not copied from the browser's request: its signature, hop-by-hop headers, and what a proxy in front of
// this server adds. signFor sets host, content-length and the x-amz signing headers again itself.
const STRIPPED = new Set([
  "authorization",
  "x-amz-date",
  "x-amz-security-token",
  "x-amz-content-sha256",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "expect",
  "cookie",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

// A signed request with only the headers that may go to floci, and a signature from these credentials.
// `body` is a Buffer, whose hash is signed, or null for an S3 body that is streamed: then the payload
// is signed as UNSIGNED-PAYLOAD and the incoming content-length is kept.
function signFor(method, path, query, incoming, body, scope, credentials) {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (!STRIPPED.has(name) && value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers.host = target.host;
  headers["x-amz-date"] = amzDate();
  headers["x-amz-content-sha256"] = body ? sha256Hex(body) : "UNSIGNED-PAYLOAD";
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;
  const signed = Object.fromEntries(Object.entries(headers).filter(([n]) => n === "host" || n === "content-type" || n.startsWith("x-amz-")));
  const { authorization } = signRequest({
    method,
    path,
    query,
    headers: signed,
    payloadHash: headers["x-amz-content-sha256"],
    date: headers["x-amz-date"],
    region: scope.region,
    service: scope.service,
    credentials,
  });
  headers.authorization = authorization;
  if (!body) {
    if (incoming["content-length"] !== undefined) headers["content-length"] = incoming["content-length"];
  } else if (body.length > 0 || incoming["content-length"] !== undefined || incoming["transfer-encoding"] !== undefined) {
    headers["content-length"] = String(body.length);
  }
  return headers;
}

// One signed request to floci, read whole. For the probe and AssumeRole.
function call(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(
      { ...tls, hostname: target.hostname, port: target.port || (secure ? 443 : 80), method, path, headers },
      (res) => {
        const parts = [];
        res.on("data", (c) => parts.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 502, headers: res.headers, body: Buffer.concat(parts).toString("utf8") }));
        res.on("error", (err) => reject(new Error(err.message || "the answer broke off")));
        res.on("aborted", () => reject(new Error("the answer broke off")));
      },
    );
    // An overall limit, so a slow answer cannot hold an AssumeRole (and every request waiting on it) forever.
    const timer = setTimeout(() => req.destroy(new Error("no answer in 10000 ms")), 10000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (err) => reject(new Error(err.message || err.code || "connection failed")));
    req.end(body);
  });
}

// A Query-protocol STS call, signed with these credentials.
function sts(params, region, credentials) {
  const body = Buffer.from(new URLSearchParams({ ...params, Version: "2011-06-15" }).toString());
  const headers = signFor("POST", "/", "", { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, body, { region, service: "sts" }, credentials);
  return call("POST", "/", headers, body);
}

// Whether floci checks signatures: it refuses a key it never issued only when it does.
// floci does not report the setting itself, so the server asks with one request and keeps the answer.
// Requests that arrive while it asks share that one request.
let probe;
let probing;
function flociChecksSignatures(region) {
  if (probe && Date.now() < probe.until) return Promise.resolve(probe.value);
  probing ??= sts({ Action: "GetCallerIdentity" }, region, { accessKeyId: "floci-console-probe", secretAccessKey: "floci-console-probe" })
    .then(
      ({ status }) => {
        const now = Date.now();
        probe = { value: status === 403, at: now, until: now + PROBE_TTL_MS };
        return probe.value;
      },
      () => false, // floci cannot be reached: the request is passed through, which reports that
    )
    .finally(() => {
      probing = undefined;
    });
  return probing;
}

// floci refused the credentials of a request passed through as it came. When the server's answer is
// "floci does not check", floci may have restarted with checks on, so the answer is dropped once
// RECHECK_MS has passed since the server asked. When the answer is "floci checks", nothing changes.
function recheckSoon() {
  if (probe && !probe.value) probe.until = Math.min(probe.until, probe.at + RECHECK_MS);
}

// Role credentials per partition and account: { credentials, expiresAt } or { pending }.
const roles = new Map();

// Credentials for the role in this account, from the cache or from sts:AssumeRole.
// Gives { credentials, expiresAt } or { error: <STS answer> }.
function roleCredentials(account, region) {
  const partition = partitionOf(region);
  const key = `${partition}:${account}`;
  const hit = roles.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() < hit.expiresAt - REFRESH_MS) return Promise.resolve({ credentials: hit.credentials, expiresAt: hit.expiresAt });
  const roleArn = `arn:${partition}:iam::${account}:role/${roleName}`;
  const pending = sts({ Action: "AssumeRole", RoleArn: roleArn, RoleSessionName: ROLE_SESSION_NAME, DurationSeconds: "3600" }, region, ownCredentials).then(
    (answer) => {
      const credentials = {
        accessKeyId: xmlText(answer.body, "AccessKeyId"),
        secretAccessKey: xmlText(answer.body, "SecretAccessKey"),
        sessionToken: xmlText(answer.body, "SessionToken"),
      };
      if (answer.status !== 200 || !credentials.accessKeyId || !credentials.secretAccessKey) {
        roles.delete(key);
        const code = (xmlText(answer.body, "Code") || `HTTP ${answer.status}`).replace(/[^\w .-]/g, "?");
        console.warn(`AssumeRole into ${roleArn} failed: ${code}`);
        return { error: answer.status === 200 ? { status: 502, headers: {}, body: "" } : answer };
      }
      const expiresAt = Date.parse(xmlText(answer.body, "Expiration") || "") || 0;
      roles.set(key, { credentials, expiresAt });
      return { credentials, expiresAt };
    },
    (err) => {
      roles.delete(key);
      throw err;
    },
  );
  roles.set(key, { pending });
  return pending;
}

// Forgets role credentials that floci refused (it restarted and lost its sessions, say),
// unless they were already replaced. The next request assumes the role again.
function forgetRole(account, region, credentials) {
  const key = `${partitionOf(region)}:${account}`;
  if (roles.get(key)?.credentials === credentials) roles.delete(key);
}

const CREDENTIAL_ERRORS = new Set([
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidAccessKeyId",
  "ExpiredToken",
  "ExpiredTokenException",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
]);

// Whether floci's answer refuses the credentials themselves, not the request. JSON protocols name the
// error in x-amzn-errortype; an XML answer without it counts when it is a 403.
function credentialsRefused(status, headers) {
  const type = String(headers?.["x-amzn-errortype"] || "").split(":")[0];
  return type ? CREDENTIAL_ERRORS.has(type) : status === 403;
}

// Calls `refused` when floci's answer refuses the request's credentials, judged by its error code only:
// x-amzn-errortype when floci sends it, otherwise the code in the first few KB of the body, which is
// read alongside the answer on its way to the browser.
function onCredentialError(status, headers, answer, refused) {
  if (status !== 400 && status !== 403) return;
  const type = String(headers?.["x-amzn-errortype"] || "").split(":")[0];
  if (type) {
    if (CREDENTIAL_ERRORS.has(type)) refused();
    return;
  }
  let text = "";
  answer.on("data", (c) => {
    if (text.length < 4096) text += c.toString("utf8");
  });
  answer.on("end", () => {
    const code = xmlText(text, "Code") || /"__type"\s*:\s*"(?:[^"#]*#)?([^"]+)"/.exec(text)?.[1];
    if (code && CREDENTIAL_ERRORS.has(code)) refused();
  });
}

// Hands an AssumeRole refusal to the browser in a form its SDK reads: the STS XML as it came for
// XML protocols, or the same code and message as JSON for JSON protocols.
function assumeRoleFailed(req, res, answer) {
  const code = xmlText(answer.body, "Code") || "AssumeRoleFailed";
  const message = xmlText(answer.body, "Message") || `floci gave no credentials for role ${roleName}`;
  const headers = { "x-amzn-errortype": code, "x-floci-console-error": "assume-role", "x-floci-console-role": roleName, "cache-control": "no-store" };
  if (/json/.test(String(req.headers["content-type"] || "")) || !answer.body) {
    return sendJson(res, answer.status, { __type: code, message }, headers);
  }
  res.writeHead(answer.status, { ...headers, "content-type": answer.headers["content-type"] || "text/xml" });
  res.end(answer.body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop keeping the body but read it to the end, so the browser still gets the 413.
        req.removeAllListeners("data");
        req.resume();
        return reject(Object.assign(new Error("too large"), { tooLarge: true }));
      }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

// Whether a presigned URL with this access key is presigned again. These are the keys the web console and
// the CLI profile it suggests sign with: "test" and 12-digit account IDs. floci refuses an account ID key
// when it checks signatures, and a "test" URL signed for this server's host and /aws path cannot verify at
// floci either. Any other key, such as one floci issued for its own presigned URLs, goes as it came.
const represigned = (accessKeyId) => accessKeyId === "test" || isAccountId(accessKeyId);

// The credentials to sign with for the account the request names: the server's own for floci's default
// account, the role's in any other. Gives { credentials, expiresAt?, onStatus? }, or undefined once it
// has answered the browser itself (AssumeRole refused, or floci unreachable).
async function credentialsFor(req, res, scope) {
  const account = isAccountId(scope.accessKeyId) ? scope.accessKeyId : undefined;
  if (!account || account === (await accounts()).defaultAccountId) return { credentials: ownCredentials };
  let role;
  try {
    role = await roleCredentials(account, scope.region);
  } catch (err) {
    unreachable(res, err);
    return undefined;
  }
  if (role.error) {
    assumeRoleFailed(req, res, role.error);
    return undefined;
  }
  const { credentials, expiresAt } = role;
  return { credentials, expiresAt, onStatus: (status, answerHeaders) => credentialsRefused(status, answerHeaders) && forgetRole(account, scope.region, credentials) };
}

async function proxy(req, res) {
  const [pathname, query = ""] = req.url.split(/\?(.*)/s);
  const path = pathname.replace(/^\/aws/, "") || "/";
  const presigned = parsePresigned(query);
  const scope = presigned ? presigned.valid && represigned(presigned.accessKeyId) && presigned : parseAuthorization(req.headers.authorization);
  // Unsigned requests, and presigned ones the server does not presign again, go as they came.
  if (!scope || !(await flociChecksSignatures(scope.region))) return passThrough(req, res);

  // From here the server adds its own credentials, so only for host names it knows.
  const name = hostName(req.headers.host || "");
  if (!signingHosts.has(name)) {
    return sendError(
      req,
      res,
      403,
      "HostNotAllowed",
      `The console server does not sign requests for the host name "${name}". To open the web console under this name, add it to FLOCI_CONSOLE_HOSTS.`,
    );
  }

  const found = await credentialsFor(req, res, scope);
  if (!found) return;
  const { credentials, expiresAt, onStatus } = found;

  if (presigned) {
    // The URL stays valid for as long as it had left, and no longer than the credentials it is signed with.
    const seconds = Math.floor((Math.min(presigned.expiresAt, expiresAt ?? Infinity) - Date.now()) / 1000);
    if (seconds <= 0) return sendError(req, res, 403, "AccessDenied", "Request has expired");
    const signedQuery = presignQuery({ method: req.method, path, query, host: target.host, date: amzDate(), expires: seconds, region: scope.region, service: scope.service, credentials });
    const headers = { ...req.headers, host: target.host };
    delete headers.authorization;
    return upstream(req.method, `${path}?${signedQuery}`, headers, req, res, onStatus);
  }

  const incoming = { ...req.headers };
  const encodings = String(incoming["content-encoding"] || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const chunked = encodings.includes("aws-chunked") || /^STREAMING-/.test(String(incoming["x-amz-content-sha256"] || ""));

  // A plain S3 body is streamed to floci as it arrives, as the server does when floci does not check
  // signatures. Its payload is signed as UNSIGNED-PAYLOAD, which S3 accepts.
  if (scope.service === "s3" && !chunked && incoming["transfer-encoding"] === undefined) {
    const headers = signFor(req.method, path, query, incoming, null, scope, credentials);
    return upstream(req.method, query ? `${path}?${query}` : path, headers, req, res, onStatus);
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return err.tooLarge ? sendJson(res, 413, { message: `The request body is larger than ${MAX_BODY} bytes.` }, { connection: "close" }) : undefined;
  }
  if (chunked) {
    try {
      const decoded = decodeAwsChunked(body);
      body = decoded.body;
      Object.assign(incoming, decoded.trailers);
    } catch (err) {
      return sendJson(res, 400, { message: `The console server cannot read this aws-chunked body: ${err.message}.` });
    }
    const rest = encodings.filter((e) => e !== "aws-chunked");
    if (rest.length) incoming["content-encoding"] = rest.join(", ");
    else delete incoming["content-encoding"];
    delete incoming["x-amz-decoded-content-length"];
    delete incoming["x-amz-trailer"];
  }
  const headers = signFor(req.method, path, query, incoming, body, scope, credentials);
  upstream(req.method, query ? `${path}?${query}` : path, headers, body, res, onStatus);
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

const isAccountId = (id) => /^\d{12}$/.test(id);

// FLOCI_ACCOUNTS presets the account menu: "111111111111=dev,222222222222=staging". Names are optional.
const presetAccounts = (process.env.FLOCI_ACCOUNTS || "")
  .split(",")
  .map((entry) => {
    const [id, ...name] = entry.split("=");
    return { id: id.trim(), name: name.join("=").trim() || undefined };
  })
  .filter((a) => isAccountId(a.id));

// floci's default account: the one it uses for a non-numeric access key such as "test".
// floci's manifest says which it is. Without a sidecar, ask floci for its manifest directly.
let manifestAccount;
async function accounts() {
  if (!manifestAccount) {
    try {
      const { status, body } = await get(new URL(process.env.FLOCI_INFO_URL || "/_floci/info", target), 2000);
      if (status === 200) manifestAccount = JSON.parse(body).defaults?.account_id;
    } catch {
      /* older floci, or floci is down */
    }
  }
  const defaultAccountId = [manifestAccount, process.env.FLOCI_DEFAULT_ACCOUNT_ID].find((id) => isAccountId(id || "")) || "000000000000";
  return { defaultAccountId, accounts: presetAccounts };
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
  if (pathname === "/console-accounts.json") {
    return accounts().then((body) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      res.end(JSON.stringify(body));
    });
  }
  if (req.url === "/aws" || req.url.startsWith("/aws/") || req.url.startsWith("/aws?")) {
    // Nothing a request carries may stop the server.
    return proxy(req, res).catch((err) => sendJson(res, 400, { message: `The console server cannot forward this request: ${err.message}` }));
  }
  serveStatic(req, res);
});
server.on("upgrade", (req, socket) => {
  socket.on("error", () => {});
  if (!terminal.handleUpgrade(req, socket)) socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
});
server.listen(port, host, () =>
  console.log(`Console on http://${host || "localhost"}:${port}  ->  floci at ${target.origin}${terminal.enabled ? "  (EC2 browser terminal on)" : ""}`),
);
