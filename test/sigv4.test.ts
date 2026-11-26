// @vitest-environment node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";

// Tests sigv4.mjs, the signer of the /aws proxy: against the AWS SigV4 test suite, and against the
// signatures the AWS SDK itself makes for the same requests.

type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
type Sigv4 = {
  EMPTY_SHA256: string;
  sha256Hex(data: string | Uint8Array): string;
  uriEncode(value: string): string;
  canonicalQuery(rawQuery: string): string;
  canonicalUri(rawPath: string, service: string): string;
  signRequest(r: {
    method: string;
    path: string;
    query: string;
    headers: Record<string, string>;
    payloadHash: string;
    date: string;
    region: string;
    service: string;
    credentials: Credentials;
  }): { authorization: string; signature: string; signedHeaders: string; canonicalRequest: string };
  parseAuthorization(header: string | undefined): { accessKeyId: string; date: string; region: string; service: string } | undefined;
  parseAmzDate(value: string | undefined): number;
  parsePresigned(rawQuery: string): { valid: false } | { valid: true; accessKeyId: string; region: string; service: string; expiresAt: number } | undefined;
  presignQuery(r: { method: string; path: string; query: string; host: string; date: string; expires: number; region: string; service: string; credentials: Credentials }): string;
  partitionOf(region: string): string;
  decodeAwsChunked(buf: Buffer): { body: Buffer; trailers: Record<string, string> };
  xmlText(xml: string, tag: string): string | undefined;
};
const sigv4: Sigv4 = await import(pathToFileURL(path.resolve("sigv4.mjs")).href);

// The credentials of the AWS SigV4 test suite.
const SUITE = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

describe("the AWS SigV4 test suite", () => {
  it("signs get-vanilla", () => {
    const { authorization } = sigv4.signRequest({
      method: "GET",
      path: "/",
      query: "",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: sigv4.EMPTY_SHA256,
      date: "20150830T123600Z",
      region: "us-east-1",
      service: "service",
      credentials: SUITE,
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
  it("signs get-vanilla-query-order-key-case, sorting the query", () => {
    const { signature } = sigv4.signRequest({
      method: "GET",
      path: "/",
      query: "Param2=value2&Param1=value1",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: sigv4.EMPTY_SHA256,
      date: "20150830T123600Z",
      region: "us-east-1",
      service: "service",
      credentials: SUITE,
    });
    expect(signature).toBe("b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  });
});

// Sends one command through a client whose transport only records the signed request.
async function signedBySdk(client: { send(c: unknown): Promise<unknown> }, command: unknown) {
  const stop = new Error("captured");
  let captured: { method: string; path: string; query?: Record<string, string | string[] | null>; headers: Record<string, string>; body?: unknown } | undefined;
  (client as unknown as { config: { requestHandler: unknown } }).config.requestHandler = {
    handle: async (request: typeof captured) => {
      captured = request;
      throw stop;
    },
  };
  await expect(client.send(command)).rejects.toBe(stop);
  return captured!;
}

// Signs what the SDK signed, the same way the proxy does, and compares the signatures.
function resign(request: Awaited<ReturnType<typeof signedBySdk>>, service: string) {
  const sdkAuth = request.headers.authorization;
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(sdkAuth)![1].split(";");
  const headers = Object.fromEntries(signedHeaders.map((n) => [n, Object.entries(request.headers).find(([k]) => k.toLowerCase() === n)![1]]));
  const query = Object.entries(request.query ?? {})
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((one) => (one === null ? sigv4.uriEncode(k) : `${sigv4.uriEncode(k)}=${sigv4.uriEncode(one)}`)))
    .join("&");
  const body = request.body === undefined ? "" : (request.body as string | Uint8Array);
  const payloadHash = request.headers["x-amz-content-sha256"] ?? sigv4.sha256Hex(body);
  const scope = sigv4.parseAuthorization(sdkAuth)!;
  const ours = sigv4.signRequest({ method: request.method, path: request.path, query, headers, payloadHash, date: request.headers["x-amz-date"], region: scope.region, service, credentials: { accessKeyId: "AKID", secretAccessKey: "secret/key+1" } });
  return { ours: ours.authorization, sdk: sdkAuth };
}

const sdkConfig = { region: "us-west-2", endpoint: "http://floci.test:4566", credentials: { accessKeyId: "AKID", secretAccessKey: "secret/key+1" } };

describe("the same signature as the AWS SDK", () => {
  it("for a JSON request with a body (SQS)", async () => {
    const req = await signedBySdk(new SQSClient(sdkConfig), new ListQueuesCommand({ QueueNamePrefix: "orders" }));
    const { ours, sdk } = resign(req, "sqs");
    expect(ours).toBe(sdk);
  });
  it("for a path with escapes outside S3, encoded a second time (Lambda)", async () => {
    const req = await signedBySdk(new LambdaClient(sdkConfig), new GetFunctionCommand({ FunctionName: "arn:aws:lambda:us-west-2:111111111111:function:f" }));
    expect(req.path).toContain("%3A");
    const { ours, sdk } = resign(req, "lambda");
    expect(ours).toBe(sdk);
  });
  it("for an S3 key with escapes, not encoded again", async () => {
    const req = await signedBySdk(new S3Client({ ...sdkConfig, forcePathStyle: true }), new GetObjectCommand({ Bucket: "b", Key: "dir/a b+ü(1)*.txt" }));
    expect(req.path).toContain("%20");
    const { ours, sdk } = resign(req, "s3");
    expect(ours).toBe(sdk);
  });
  it("for an S3 query string with reserved characters", async () => {
    const req = await signedBySdk(new S3Client({ ...sdkConfig, forcePathStyle: true }), new ListObjectsV2Command({ Bucket: "b", Prefix: "a b/+c~", Delimiter: "/" }));
    const { ours, sdk } = resign(req, "s3");
    expect(ours).toBe(sdk);
  });
});

describe("canonical forms, as floci builds them", () => {
  it("decodes and encodes the query again, keeps a raw + as a plus sign, and sorts by name then value", () => {
    expect(sigv4.canonicalQuery("b=2&a=z&a=y&c&x=a+b&sp=a%20b&t=%7e")).toBe("a=y&a=z&b=2&c=&sp=a%20b&t=~&x=a%2Bb");
    expect(sigv4.canonicalQuery("")).toBe("");
  });
  it("encodes the path a second time outside S3, and keeps it as it is for S3", () => {
    expect(sigv4.canonicalUri("/f/arn%3Aaws/a b", "lambda")).toBe("/f/arn%253Aaws/a%20b");
    expect(sigv4.canonicalUri("/bucket/a%20b//c", "s3")).toBe("/bucket/a%20b//c");
    expect(sigv4.canonicalUri("", "sqs")).toBe("/");
  });
  it("trims header values and collapses their inner whitespace", () => {
    const { canonicalRequest } = sigv4.signRequest({
      method: "GET",
      path: "/",
      query: "",
      headers: { host: "h", "x-amz-date": "20250101T000000Z", "x-amz-meta-a": "  one   two\tthree " },
      payloadHash: sigv4.EMPTY_SHA256,
      date: "20250101T000000Z",
      region: "us-east-1",
      service: "sqs",
      credentials: SUITE,
    });
    expect(canonicalRequest).toContain("x-amz-meta-a:one two three\n");
  });
  it("collapses only spaces in S3 header values, as floci's S3 does", () => {
    const { canonicalRequest } = sigv4.signRequest({
      method: "GET",
      path: "/b/k",
      query: "",
      headers: { host: "h", "x-amz-date": "20250101T000000Z", "x-amz-meta-a": "one\t  two" },
      payloadHash: sigv4.EMPTY_SHA256,
      date: "20250101T000000Z",
      region: "us-east-1",
      service: "s3",
      credentials: SUITE,
    });
    expect(canonicalRequest).toContain("x-amz-meta-a:one\t two\n");
  });
});

describe("helpers", () => {
  it("reads the credential scope of an Authorization header", () => {
    expect(sigv4.parseAuthorization("AWS4-HMAC-SHA256 Credential=222222222222/20250101/us-gov-west-1/s3/aws4_request, SignedHeaders=host, Signature=ab")).toEqual({
      accessKeyId: "222222222222",
      date: "20250101",
      region: "us-gov-west-1",
      service: "s3",
    });
    expect(sigv4.parseAuthorization(undefined)).toBeUndefined();
    expect(sigv4.parseAuthorization("AWS4-ECDSA-P256-SHA256 Credential=a/b/s3/aws4_request")).toBeUndefined();
    expect(sigv4.parseAuthorization("AWS4-HMAC-SHA256 Credential=a/b/c")).toBeUndefined();
  });
  it("finds the partition of a region", () => {
    expect(sigv4.partitionOf("us-gov-west-1")).toBe("aws-us-gov");
    expect(sigv4.partitionOf("cn-north-1")).toBe("aws-cn");
    expect(sigv4.partitionOf("us-west-2")).toBe("aws");
  });
  it("decodes an aws-chunked body with its trailers", () => {
    const raw = Buffer.from("5;chunk-signature=aa\r\nhello\r\n6\r\n world\r\n0\r\nx-amz-checksum-crc32:AAAAAA==\r\nx-amz-trailer-signature:bb\r\n\r\n");
    expect(sigv4.decodeAwsChunked(raw)).toEqual({ body: Buffer.from("hello world"), trailers: { "x-amz-checksum-crc32": "AAAAAA==" } });
    expect(() => sigv4.decodeAwsChunked(Buffer.from("zz\r\nhello"))).toThrow(/hexadecimal/);
    expect(() => sigv4.decodeAwsChunked(Buffer.from("9\r\nhello\r\n0\r\n\r\n"))).toThrow(/shorter/);
    expect(() => sigv4.decodeAwsChunked(Buffer.from("0\r\nbad name: x\r\n\r\n"))).toThrow(/valid header/);
    expect(() => sigv4.decodeAwsChunked(Buffer.from("0\r\nx-amz-checksum-crc32:a\u0000b\r\n\r\n"))).toThrow(/valid header/);
  });
  it("reads a SigV4 date", () => {
    expect(sigv4.parseAmzDate("20130524T000000Z")).toBe(Date.UTC(2013, 4, 24));
    expect(sigv4.parseAmzDate("2013-05-24")).toBeNaN();
    expect(sigv4.parseAmzDate(undefined)).toBeNaN();
  });
  it("reads the signing parameters of a presigned URL", () => {
    const query =
      "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=222222222222%2F20130524%2Fus-gov-west-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=host&X-Amz-Signature=ab";
    expect(sigv4.parsePresigned(query)).toEqual({ valid: true, accessKeyId: "222222222222", region: "us-gov-west-1", service: "s3", expiresAt: Date.UTC(2013, 4, 24) + 600_000 });
    expect(sigv4.parsePresigned("versionId=1")).toBeUndefined();
    expect(sigv4.parsePresigned("")).toBeUndefined();
    expect(sigv4.parsePresigned("X-Amz-Signature=ab&X-Amz-Credential=a%2Fb")).toEqual({ valid: false });
    expect(sigv4.parsePresigned(query.replace("X-Amz-Expires=600", "X-Amz-Expires=soon"))).toEqual({ valid: false });
    // No URL is valid for longer than 7 days, whatever it says.
    expect((sigv4.parsePresigned(query.replace("X-Amz-Expires=600", "X-Amz-Expires=99999999")) as { expiresAt: number }).expiresAt).toBe(Date.UTC(2013, 4, 24) + 7 * 86400_000);
  });
  it("presigns the S3 example from the AWS documentation", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const query = sigv4.presignQuery({
      method: "GET",
      path: "/test.txt",
      query: "",
      host: "examplebucket.s3.amazonaws.com",
      date: "20130524T000000Z",
      expires: 86400,
      region: "us-east-1",
      service: "s3",
      credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    });
    expect(query).toBe(
      "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
  it("replaces a presigned URL's signing parameters, keeps the others, and adds a session token", () => {
    const query = sigv4.presignQuery({
      method: "GET",
      path: "/b/k",
      query: "response-content-type=text%2Fplain&X-Amz-Credential=old&x-amz-signature=old&X-Amz-Security-Token=old&X-Amz-Expires=1",
      host: "floci:4566",
      date: "20250101T000000Z",
      expires: 60,
      region: "us-west-2",
      service: "s3",
      credentials: { accessKeyId: "ASIA1", secretAccessKey: "s", sessionToken: "t&1" },
    });
    expect(query).toMatch(
      /^response-content-type=text%2Fplain&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA1%2F20250101%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20250101T000000Z&X-Amz-Expires=60&X-Amz-Security-Token=t%261&X-Amz-SignedHeaders=host&X-Amz-Signature=[0-9a-f]{64}$/,
    );
    expect(query).not.toContain("old");
  });
  it("reads XML text with entities", () => {
    expect(sigv4.xmlText("<a><SessionToken>x&amp;y&lt;</SessionToken></a>", "SessionToken")).toBe("x&y<");
    expect(sigv4.xmlText("<a/>", "Code")).toBeUndefined();
  });
});
