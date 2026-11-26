// Re-signing of /aws requests for floci with FLOCI_AUTH_VALIDATE_SIGNATURES=true. No dependencies.
//
// The browser signs for the web console's host and the /aws path, with its account ID as the access key.
// floci checks the signature against its own host and path, and accepts only keys it knows. So when
// floci checks signatures, this module signs each request again for floci: with the server's own
// credentials (AWS_ACCESS_KEY_ID, default test/test) for floci's default account, and with credentials
// from sts:AssumeRole into FLOCI_CONSOLE_ROLE_NAME for any other account. Presigned URLs are presigned
// again. When floci does not check, nothing changes: handleRequest returns false and the server forwards
// the request as it came.
//
// Both servers use it: server.mjs for the built web console, and vite.config.ts for the dev server.
//   const signing = createAwsSigning(env, flociUrl);  // throws when a setting is not valid
//   if (!(await signing.handleRequest(req, res))) { /* forward as it came */ }
//   signing.passedThrough(answer);                     // floci's answer to a request forwarded as it came
//
// Settings: FLOCI_AUTH_VALIDATE_SIGNATURES, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN,
// FLOCI_CONSOLE_ROLE_NAME, FLOCI_CONSOLE_HOSTS, HOST, FLOCI_INFO_URL, FLOCI_DEFAULT_ACCOUNT_ID and
// FLOCI_TLS_SKIP_VERIFY. See docs/SIGNATURE_VALIDATION.md.
import http from "node:http";
import https from "node:https";
import { amzDate, decodeAwsChunked, parseAuthorization, parsePresigned, partitionOf, presignQuery, sha256Hex, signRequest, xmlText } from "./sigv4.mjs";

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

// Not copied from the browser's request: its signature, hop-by-hop headers, and what a proxy in front of
// the server adds. signFor sets host, content-length and the x-amz signing headers again itself.
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

const CREDENTIAL_ERRORS = new Set([
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidAccessKeyId",
  "ExpiredToken",
  "ExpiredTokenException",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
]);

const isAccountId = (id) => /^\d{12}$/.test(id);
const isAwsPath = (url) => url === "/aws" || url.startsWith("/aws/") || url.startsWith("/aws?");
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.codePointAt(0)};`);
const bareHost = (name) => name.trim().toLowerCase().replace(/^\[|\]$/g, "");

// Whether a presigned URL with this access key is presigned again. These are the keys the web console and
// the CLI profile it suggests sign with: "test" and 12-digit account IDs. floci refuses an account ID key
// when it checks signatures, and a "test" URL signed for the web console's host and /aws path cannot verify
// at floci either. Any other key, such as one floci issued for its own presigned URLs, goes as it came.
const represigned = (accessKeyId) => accessKeyId === "test" || isAccountId(accessKeyId);

// The host name of a Host header, without its port. Empty when there is none.
function hostName(header) {
  try {
    return bareHost(new URL(`http://${header}`).hostname);
  } catch {
    return "";
  }
}

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) {
    return res.destroy();
  }
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// An AWS-style error the browser's SDK reads: JSON for a JSON request, XML otherwise.
function sendError(req, res, status, code, message, headers = {}) {
  const all = { "x-amzn-errortype": code, "cache-control": "no-store", ...headers };
  if (/json/.test(String(req.headers["content-type"] || ""))) {
    return sendJson(res, status, { __type: code, message }, all);
  }
  if (res.headersSent) {
    return res.destroy();
  }
  res.writeHead(status, { ...all, "content-type": "text/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><ErrorResponse><Error><Type>Sender</Type><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error></ErrorResponse>`);
}

// Whether floci's answer refuses the credentials themselves, not the request. JSON protocols name the
// error in x-amzn-errortype; an XML answer without it counts when it is a 403.
function credentialsRefused(status, headers) {
  const type = String(headers?.["x-amzn-errortype"] || "").split(":")[0];
  return type ? CREDENTIAL_ERRORS.has(type) : status === 403;
}

// Calls `refused` when floci's answer refuses the request's credentials, judged by its error code only:
// x-amzn-errortype when floci sends it, otherwise the code in the first few KB of the body, which is
// read alongside the answer on its way to the browser.
function onCredentialError(answer, refused) {
  if (answer.statusCode !== 400 && answer.statusCode !== 403) {
    return;
  }
  const type = String(answer.headers?.["x-amzn-errortype"] || "").split(":")[0];
  if (type) {
    if (CREDENTIAL_ERRORS.has(type)) {
      refused();
    }
    return;
  }
  let text = "";
  answer.on("data", (c) => {
    if (text.length < 4096) {
      text += c.toString("utf8");
    }
  });
  answer.on("end", () => {
    const code = xmlText(text, "Code") || /"__type"\s*:\s*"(?:[^"#]*#)?([^"]+)"/.exec(text)?.[1];
    if (code && CREDENTIAL_ERRORS.has(code)) {
      refused();
    }
  });
}

// One request, its answer read whole. `options` are http.request's. Rejects when the answer does not
// come within `timeoutMs`, so a slow answer cannot hold an AssumeRole (and every request waiting on it) forever.
function requestWhole(transport, options, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 502, headers: res.headers, body: Buffer.concat(parts).toString("utf8") }));
      res.on("error", (err) => reject(new Error(err.message || "the answer broke off")));
      res.on("aborted", () => reject(new Error("the answer broke off")));
    });
    const timer = setTimeout(() => req.destroy(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (err) => reject(new Error(err.message || err.code || "connection failed")));
    req.end(body);
  });
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

// Decodes an aws-chunked body. Its trailers become headers, and the aws-chunked encoding and the headers
// that describe it are removed. Throws, changing nothing, when the body cannot be read.
function unchunk(body, headers, encodings) {
  const decoded = decodeAwsChunked(body);
  Object.assign(headers, decoded.trailers);
  const rest = encodings.filter((e) => e !== "aws-chunked");
  if (rest.length) {
    headers["content-encoding"] = rest.join(", ");
  } else {
    delete headers["content-encoding"];
  }
  delete headers["x-amz-decoded-content-length"];
  delete headers["x-amz-trailer"];
  return decoded.body;
}

// Reads the settings and gives { handleRequest, passedThrough }. `floci` is the URL of floci, as the server
// reaches it. Throws when FLOCI_AUTH_VALIDATE_SIGNATURES or FLOCI_CONSOLE_ROLE_NAME is not valid.
export function createAwsSigning(env, floci) {
  const target = new URL(floci);
  const secure = target.protocol === "https:";
  // floci sets FLOCI_TLS_SKIP_VERIFY when its certificate is self-signed. This applies to requests to floci only.
  const skipVerify = !["", "0", "false"].includes((env.FLOCI_TLS_SKIP_VERIFY || "").toLowerCase());
  const tls = secure && skipVerify ? { rejectUnauthorized: false } : {};
  const transport = secure ? https : http;
  const flociPort = target.port || (secure ? 443 : 80);

  const ownCredentials = {
    accessKeyId: env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || "test",
    sessionToken: env.AWS_SESSION_TOKEN || undefined,
  };
  const roleName = env.FLOCI_CONSOLE_ROLE_NAME || "OrganizationAccountAccessRole";
  if (!/^[\w+=,.@-]{1,64}$/.test(roleName)) {
    throw new Error(`FLOCI_CONSOLE_ROLE_NAME must be an IAM role name, like OrganizationAccountAccessRole. Got: ${roleName}`);
  }
  // FLOCI_AUTH_VALIDATE_SIGNATURES, set on the server to the value floci has, says whether floci checks
  // signatures, so the server does not ask: "true" signs every signed request again, "false" forwards every
  // request as it came. Not set, the server asks floci.
  const signaturesSetting = String(env.FLOCI_AUTH_VALIDATE_SIGNATURES ?? "").trim().toLowerCase();
  if (!["", "true", "false"].includes(signaturesSetting)) {
    throw new Error(`FLOCI_AUTH_VALIDATE_SIGNATURES must be true or false, the value floci has. Got: ${env.FLOCI_AUTH_VALIDATE_SIGNATURES}`);
  }
  let configuredChecks;
  if (signaturesSetting) {
    configuredChecks = signaturesSetting === "true";
  }

  // Host names the server signs requests for. A request under any other name is refused before the
  // server adds its credentials, so a web page that points its own name at the server (DNS rebinding)
  // cannot use them. FLOCI_CONSOLE_HOSTS adds names, for people who open the web console from another machine.
  const signingHosts = new Set(
    ["localhost", "127.0.0.1", "::1", env.HOST || "", ...(env.FLOCI_CONSOLE_HOSTS || "").split(",")]
      .map(bareHost)
      .filter((name) => name && name !== "0.0.0.0" && name !== "::"),
  );

  const unreachable = (res, err) => sendJson(res, 502, { message: `Cannot reach floci at ${target.origin}: ${err.message}` });

  // Sends one signed request to floci and streams the answer back. `body` is a Buffer, or the incoming
  // request to stream from. `onStatus` sees floci's status code and headers before the answer goes to the browser.
  function upstream(method, path, headers, body, res, onStatus) {
    const up = transport.request({ ...tls, hostname: target.hostname, port: flociPort, method, path, headers }, (answer) => {
      onStatus?.(answer.statusCode, answer.headers);
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    });
    up.on("error", (err) => unreachable(res, err));
    if (Buffer.isBuffer(body)) {
      up.end(body);
    } else {
      body.pipe(up);
    }
  }

  // One request to floci, read whole. For the probe and AssumeRole.
  const call = (method, path, headers, body) => requestWhole(transport, { ...tls, hostname: target.hostname, port: flociPort, method, path, headers }, body, 10000);

  // A signed request with only the headers that may go to floci, and a signature from these credentials.
  // `body` is a Buffer, whose hash is signed, or null for an S3 body that is streamed: then the payload
  // is signed as UNSIGNED-PAYLOAD and the incoming content-length is kept.
  function signFor(method, path, query, incoming, body, scope, credentials) {
    const headers = {};
    for (const [name, value] of Object.entries(incoming)) {
      if (!STRIPPED.has(name) && value !== undefined) {
        headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
    headers.host = target.host;
    headers["x-amz-date"] = amzDate();
    headers["x-amz-content-sha256"] = body ? sha256Hex(body) : "UNSIGNED-PAYLOAD";
    if (credentials.sessionToken) {
      headers["x-amz-security-token"] = credentials.sessionToken;
    }
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
      if (incoming["content-length"] !== undefined) {
        headers["content-length"] = incoming["content-length"];
      }
    } else if (body.length > 0 || incoming["content-length"] !== undefined || incoming["transfer-encoding"] !== undefined) {
      headers["content-length"] = String(body.length);
    }
    return headers;
  }

  // A Query-protocol STS call, signed with these credentials.
  function sts(params, region, credentials) {
    const body = Buffer.from(new URLSearchParams({ ...params, Version: "2011-06-15" }).toString());
    const headers = signFor("POST", "/", "", { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, body, { region, service: "sts" }, credentials);
    return call("POST", "/", headers, body);
  }

  // floci's default account: the one it uses for a non-numeric access key such as "test". floci's manifest
  // says which it is; FLOCI_DEFAULT_ACCOUNT_ID when it does not.
  let manifestAccount;
  async function defaultAccountId() {
    if (!manifestAccount) {
      try {
        const info = new URL(env.FLOCI_INFO_URL || "/_floci/info", target);
        const options = { ...tls, hostname: info.hostname, port: info.port || undefined, method: "GET", path: `${info.pathname}${info.search}` };
        const { status, body } = await requestWhole(info.protocol === "https:" ? https : http, options, undefined, 2000);
        if (status === 200) {
          manifestAccount = JSON.parse(body).defaults?.account_id;
        }
      } catch {
        /* older floci, or floci is down */
      }
    }
    return [manifestAccount, env.FLOCI_DEFAULT_ACCOUNT_ID].find((id) => isAccountId(id || "")) || "000000000000";
  }

  // Whether floci checks signatures. FLOCI_AUTH_VALIDATE_SIGNATURES on the server says so when it is set.
  // Otherwise the server asks: floci refuses a key it never issued only when it checks, and it does not
  // report the setting itself. The server asks with one request and keeps the answer. Requests that arrive
  // while it asks share that one request.
  let probe;
  let probing;
  function flociChecksSignatures(region) {
    if (configuredChecks !== undefined) {
      return Promise.resolve(configuredChecks);
    }
    if (probe && Date.now() < probe.until) {
      return Promise.resolve(probe.value);
    }
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
    if (probe && !probe.value) {
      probe.until = Math.min(probe.until, probe.at + RECHECK_MS);
    }
  }

  // Role credentials per partition and account: { credentials, expiresAt } or { pending }.
  const roles = new Map();

  // Credentials for the role in this account, from the cache or from sts:AssumeRole.
  // Gives { credentials, expiresAt } or { error: <STS answer> }.
  function roleCredentials(account, region) {
    const partition = partitionOf(region);
    const key = `${partition}:${account}`;
    const hit = roles.get(key);
    if (hit?.pending) {
      return hit.pending;
    }
    if (hit && Date.now() < hit.expiresAt - REFRESH_MS) {
      return Promise.resolve({ credentials: hit.credentials, expiresAt: hit.expiresAt });
    }
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
    if (roles.get(key)?.credentials === credentials) {
      roles.delete(key);
    }
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

  // The credentials to sign with for the account the request names: the server's own for floci's default
  // account, the role's in any other. Gives { credentials, expiresAt?, onStatus? }, or undefined once it
  // has answered the browser itself (AssumeRole refused, or floci unreachable).
  async function credentialsFor(req, res, scope) {
    const account = isAccountId(scope.accessKeyId) ? scope.accessKeyId : undefined;
    if (!account || account === (await defaultAccountId())) {
      return { credentials: ownCredentials };
    }
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
    // When floci refuses the role's credentials, they are dropped so the next request assumes the role again.
    const onStatus = (status, answerHeaders) => {
      if (credentialsRefused(status, answerHeaders)) {
        forgetRole(account, scope.region, credentials);
      }
    };
    return { credentials, expiresAt, onStatus };
  }

  // Presigns the URL again for floci. It stays valid for as long as it had left, and no longer than the
  // credentials it is signed with.
  function forwardPresigned(req, res, path, query, presigned, { credentials, expiresAt, onStatus }) {
    const seconds = Math.floor((Math.min(presigned.expiresAt, expiresAt ?? Infinity) - Date.now()) / 1000);
    if (seconds <= 0) {
      return sendError(req, res, 403, "AccessDenied", "Request has expired");
    }
    const signedQuery = presignQuery({ method: req.method, path, query, host: target.host, date: amzDate(), expires: seconds, region: presigned.region, service: presigned.service, credentials });
    const headers = { ...req.headers, host: target.host };
    delete headers.authorization;
    return upstream(req.method, `${path}?${signedQuery}`, headers, req, res, onStatus);
  }

  // Signs a request with an Authorization header again for floci.
  async function forwardSigned(req, res, path, query, scope, { credentials, onStatus }) {
    const incoming = { ...req.headers };
    const encodings = String(incoming["content-encoding"] || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const chunked = encodings.includes("aws-chunked") || String(incoming["x-amz-content-sha256"] || "").startsWith("STREAMING-");
    const url = query ? `${path}?${query}` : path;

    // A plain S3 body is streamed to floci as it arrives, as it is when floci does not check signatures.
    // Its payload is signed as UNSIGNED-PAYLOAD, which S3 accepts.
    if (scope.service === "s3" && !chunked && incoming["transfer-encoding"] === undefined) {
      return upstream(req.method, url, signFor(req.method, path, query, incoming, null, scope, credentials), req, res, onStatus);
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err.tooLarge) {
        sendJson(res, 413, { message: `The request body is larger than ${MAX_BODY} bytes.` }, { connection: "close" });
      }
      return;
    }
    if (chunked) {
      try {
        body = unchunk(body, incoming, encodings);
      } catch (err) {
        return sendJson(res, 400, { message: `The console server cannot read this aws-chunked body: ${err.message}.` });
      }
    }
    upstream(req.method, url, signFor(req.method, path, query, incoming, body, scope, credentials), body, res, onStatus);
  }

  // Signs the request again when floci checks signatures. Gives false, having touched nothing, when the
  // request should be forwarded as it came: it is not an /aws request, it is not signed, it is presigned
  // with a key the server does not presign again, or floci does not check signatures.
  async function resign(req, res) {
    const [pathname, query = ""] = req.url.split(/\?(.*)/s);
    const path = pathname.replace(/^\/aws/, "") || "/";
    const presigned = parsePresigned(query);
    const scope = presigned ? presigned.valid && represigned(presigned.accessKeyId) && presigned : parseAuthorization(req.headers.authorization);
    if (!scope || !(await flociChecksSignatures(scope.region))) {
      return false;
    }

    // From here the server adds its own credentials, so only for host names it knows.
    const name = hostName(req.headers.host || "");
    if (!signingHosts.has(name)) {
      sendError(
        req,
        res,
        403,
        "HostNotAllowed",
        `The console server does not sign requests for the host name "${name}". To open the web console under this name, add it to FLOCI_CONSOLE_HOSTS.`,
      );
      return true;
    }

    const found = await credentialsFor(req, res, scope);
    if (!found) {
      return true;
    }
    if (presigned) {
      forwardPresigned(req, res, path, query, presigned, found);
    } else {
      await forwardSigned(req, res, path, query, scope, found);
    }
    return true;
  }

  return {
    // Handles an /aws request when it must be signed again, and gives true. Gives false when the server
    // should forward it as it came. Never rejects: nothing a request carries may stop the server.
    async handleRequest(req, res) {
      if (!isAwsPath(req.url || "")) {
        return false;
      }
      try {
        return await resign(req, res);
      } catch (err) {
        sendJson(res, 400, { message: `The console server cannot forward this request: ${err.message}` });
        return true;
      }
    },
    // floci's answer to a request the server forwarded as it came. When the server asks floci whether it
    // checks signatures and floci refuses these credentials, floci may have started checking since the
    // server last asked, so the server asks again soon.
    passedThrough(answer) {
      if (configuredChecks === undefined) {
        onCredentialError(answer, recheckSoon);
      }
    },
  };
}
