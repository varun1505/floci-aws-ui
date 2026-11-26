// AWS Signature Version 4 for the /aws proxy in server.mjs. No dependencies: Node's crypto only.
//
// The canonical request follows floci's own verifiers, so floci accepts what this signs when it runs
// with FLOCI_AUTH_VALIDATE_SIGNATURES=true:
// - Query string: every pair percent-decoded (a raw "+" stays a plus sign), encoded again per RFC 3986,
//   then sorted by encoded name and then by encoded value.
// - Path: S3 signs the path as it travels. Every other service encodes each segment a second time.
// - Header values: trimmed, with runs of whitespace (S3: runs of spaces) collapsed to one space.
import crypto from "node:crypto";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();

// Orders strings by UTF-16 code unit, as SigV4 requires. Not localeCompare: a locale can order
// "-", "_" and upper case differently, and the signature would no longer match.
function byCodeUnit(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** RFC 3986 percent-encoding as SigV4 defines it: only A-Z a-z 0-9 - . _ ~ stay as they are. */
export function uriEncode(value) {
  let out = "";
  for (const b of Buffer.from(value, "utf8")) {
    const c = String.fromCodePoint(b);
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// Percent-decodes one query component. SigV4 signers write a space as %20, so a raw "+" is a plus sign.
function decodeQueryComponent(value) {
  try {
    return decodeURIComponent(value.replaceAll("+", "%2B"));
  } catch {
    return value;
  }
}

/** The canonical query string of a raw (still encoded) query string, without the leading "?". */
export function canonicalQuery(rawQuery) {
  if (!rawQuery) {
    return "";
  }
  const pairs = [];
  for (const pair of rawQuery.split("&")) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf("=");
    const name = decodeQueryComponent(eq >= 0 ? pair.slice(0, eq) : pair);
    const value = decodeQueryComponent(eq >= 0 ? pair.slice(eq + 1) : "");
    pairs.push([uriEncode(name), uriEncode(value)]);
  }
  pairs.sort((a, b) => byCodeUnit(a[0], b[0]) || byCodeUnit(a[1], b[1]));
  return pairs.map(([n, v]) => `${n}=${v}`).join("&");
}

/** The canonical URI of a raw (still encoded) path. S3 does not encode the path a second time. */
export function canonicalUri(rawPath, service) {
  const raw = rawPath || "/";
  if (service === "s3") {
    return raw;
  }
  return raw
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

/** A header value as the canonical request carries it. */
export function canonicalHeaderValue(value, service) {
  const trimmed = String(value ?? "").trim();
  return service === "s3" ? trimmed.replace(/ +/g, " ") : trimmed.replace(/\s+/g, " ");
}

/** The SigV4 signing key for one day, region and service. */
export function signingKey(secretAccessKey, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
}

/** The current time in SigV4's basic ISO 8601 form, like 20150830T123600Z. */
export function amzDate(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Signs a request. `headers` maps lower-case names to values, and every header in it is signed.
 * `path` and `query` are as they travel: still percent-encoded, the query without "?".
 * Gives back the Authorization header value, with the pieces that made it for tests.
 */
export function signRequest({ method, path, query, headers, payloadHash, date, region, service, credentials }) {
  const names = Object.keys(headers)
    .map((n) => n.toLowerCase())
    .sort(byCodeUnit);
  const lower = Object.fromEntries(Object.entries(headers).map(([n, v]) => [n.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${canonicalHeaderValue(lower[n], service)}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method.toUpperCase(), canonicalUri(path, service), canonicalQuery(query), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const day = date.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(credentials.secretAccessKey, day, region, service), stringToSign).toString("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signature,
    signedHeaders,
    canonicalRequest,
  };
}

/** Milliseconds since the epoch of a basic ISO 8601 time like 20150830T123600Z, or NaN. */
export function parseAmzDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value ?? ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Number.NaN;
}

// The query parameters that make up a presigned URL's signature. presignQuery replaces all of them.
const PRESIGN_PARAMS = new Set(["x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires", "x-amz-signedheaders", "x-amz-signature", "x-amz-security-token"]);
// The longest a presigned URL may be valid, in seconds: 7 days.
export const MAX_PRESIGN_EXPIRES = 7 * 24 * 60 * 60;

const paramName = (pair) => {
  const eq = pair.indexOf("=");
  return decodeQueryComponent(eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase();
};

/**
 * The signing parameters of a presigned URL, from its raw (still encoded) query string.
 * Undefined when the query has no X-Amz-Signature. `{ valid: false }` when it has one but the credential
 * scope, date or expiry cannot be read. Otherwise the access key ID, region, service and the time the URL
 * stops being valid, in milliseconds since the epoch. The signature itself is not checked.
 */
export function parsePresigned(rawQuery) {
  const params = new Map();
  for (const pair of String(rawQuery ?? "").split("&")) {
    if (!pair) {
      continue;
    }
    const name = paramName(pair);
    const eq = pair.indexOf("=");
    if (PRESIGN_PARAMS.has(name)) {
      params.set(name, decodeQueryComponent(eq >= 0 ? pair.slice(eq + 1) : ""));
    }
  }
  if (!params.has("x-amz-signature")) {
    return undefined;
  }
  const parts = (params.get("x-amz-credential") ?? "").split("/");
  const signedAt = parseAmzDate(params.get("x-amz-date"));
  const expires = Number(params.get("x-amz-expires"));
  if (parts.length !== 5 || parts[4] !== "aws4_request" || parts.some((p) => !p) || Number.isNaN(signedAt) || !Number.isInteger(expires) || expires <= 0) {
    return { valid: false };
  }
  const [accessKeyId, , region, service] = parts;
  return { valid: true, accessKeyId, region, service, expiresAt: signedAt + Math.min(expires, MAX_PRESIGN_EXPIRES) * 1000 };
}

/**
 * Presigns a request again with these credentials. `query` is the raw query string as it travels: its
 * own signing parameters are replaced, and every other parameter is kept as it is. Only `host` is signed.
 * S3 signs the payload as UNSIGNED-PAYLOAD, as S3 presigned URLs do; other services sign an empty payload.
 * Gives back the new raw query string, without the leading "?".
 */
export function presignQuery({ method, path, query, host, date, expires, region, service, credentials }) {
  const kept = String(query ?? "")
    .split("&")
    .filter((pair) => pair && !PRESIGN_PARAMS.has(paramName(pair)));
  const scope = `${date.slice(0, 8)}/${region}/${service}/aws4_request`;
  const signing = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(expires)],
    ...(credentials.sessionToken ? [["X-Amz-Security-Token", credentials.sessionToken]] : []),
    ["X-Amz-SignedHeaders", "host"],
  ].map(([n, v]) => `${n}=${uriEncode(v)}`);
  const unsigned = [...kept, ...signing].join("&");
  const payloadHash = service === "s3" ? "UNSIGNED-PAYLOAD" : EMPTY_SHA256;
  const { signature } = signRequest({ method, path, query: unsigned, headers: { host }, payloadHash, date, region, service, credentials });
  return `${unsigned}&X-Amz-Signature=${signature}`;
}

/**
 * The credential scope of a header-signed SigV4 request, or undefined when the header is not one.
 * Gives the access key ID, date, region and service. The signature itself is not checked.
 */
export function parseAuthorization(header) {
  const text = String(header ?? "").trim();
  const algorithm = "AWS4-HMAC-SHA256";
  const rest = text.slice(algorithm.length);
  if (!text.startsWith(algorithm) || !/^\s/.test(rest)) {
    return undefined;
  }
  const credential = /(?:^|[\s,])Credential=([^,\s]+)/.exec(rest)?.[1];
  const parts = credential?.split("/");
  if (parts?.length !== 5 || parts[4] !== "aws4_request" || parts.some((p) => !p)) {
    return undefined;
  }
  const [accessKeyId, date, region, service] = parts;
  return { accessKeyId, date, region, service };
}

/** The AWS partition of a region. */
export function partitionOf(region) {
  if (region.startsWith("us-gov-")) {
    return "aws-us-gov";
  }
  if (region.startsWith("cn-")) {
    return "aws-cn";
  }
  return "aws";
}

/**
 * Decodes an aws-chunked body: "<hex size>[;chunk-signature=...]\r\n<data>\r\n" repeated, a zero-size
 * chunk, then optional trailer lines such as "x-amz-checksum-crc32:...". Gives the plain body and the
 * trailers (lower-case names; the trailer signature is left out). Throws on a body it cannot read.
 */
export function decodeAwsChunked(buf) {
  const { chunks, end } = readChunks(buf);
  return { body: Buffer.concat(chunks), trailers: readTrailers(buf, end) };
}

// The data chunks of an aws-chunked body, and where the line of its zero-size chunk ends.
function readChunks(buf) {
  const chunks = [];
  let pos = 0;
  for (;;) {
    const eol = buf.indexOf("\r\n", pos);
    if (eol < 0) {
      throw new Error("a chunk header has no line end");
    }
    const sizeText = buf.toString("latin1", pos, eol).split(";")[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) {
      throw new Error("a chunk size is not hexadecimal");
    }
    const size = Number.parseInt(sizeText, 16);
    pos = eol + 2;
    if (size === 0) {
      return { chunks, end: pos };
    }
    if (pos + size + 2 > buf.length || buf.toString("latin1", pos + size, pos + size + 2) !== "\r\n") {
      throw new Error("a chunk is shorter than its size");
    }
    chunks.push(buf.subarray(pos, pos + size));
    pos += size + 2;
  }
}

// The trailer lines from `start`, up to an empty line or the end of the body. The trailer signature is left out.
function readTrailers(buf, start) {
  const trailers = {};
  let pos = start;
  while (pos < buf.length) {
    let eol = buf.indexOf("\r\n", pos);
    if (eol < 0) {
      eol = buf.length;
    }
    const line = buf.toString("latin1", pos, eol);
    pos = eol + 2;
    if (!line) {
      break;
    }
    const [name, value] = trailerLine(line);
    if (name !== "x-amz-trailer-signature") {
      trailers[name] = value;
    }
  }
  return trailers;
}

// One trailer line as a lower-case name and a value. Throws when it is not a valid header line.
function trailerLine(line) {
  const colon = line.indexOf(":");
  if (colon <= 0) {
    throw new Error("a trailer is not a header line");
  }
  const name = line.slice(0, colon).trim().toLowerCase();
  const value = line.slice(colon + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || !/^[\t\x20-\x7e\x80-\xff]*$/.test(value)) {
    throw new Error("a trailer is not a valid header");
  }
  return [name, value];
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text of the first <tag> element in an XML document, entities decoded, or undefined. */
export function xmlText(xml, tag) {
  const m = new RegExp(String.raw`<${tag}>([\s\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]).trim() : undefined;
}
