import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { EC2Client } from "@aws-sdk/client-ec2";

export const REGIONS = [
  { id: "us-east-1", label: "US East (N. Virginia)" },
  { id: "us-east-2", label: "US East (Ohio)" },
  { id: "us-west-2", label: "US West (Oregon)" },
  { id: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { id: "eu-west-1", label: "Europe (Ireland)" },
  { id: "eu-central-1", label: "Europe (Frankfurt)" },
];

export const ACCOUNT_ID = "000000000000";

export function getRegion(): string {
  try {
    return localStorage.getItem("region") || "us-east-1";
  } catch {
    return "us-east-1";
  }
}

export function setRegion(region: string) {
  try {
    localStorage.setItem("region", region);
  } catch {
    /* storage can be blocked; the default region still works */
  }
  window.location.reload();
}

/** All API calls go to /aws on this same origin. The server forwards them to floci. */
export const PROXY_BASE = `${window.location.origin}/aws`;

const base = {
  region: getRegion(),
  endpoint: PROXY_BASE,
  // floci accepts any credentials. These never reach real AWS.
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

export const lambda = new LambdaClient(base);
export const s3 = new S3Client({
  ...base,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
export const logs = new CloudWatchLogsClient(base);
export const cloudwatch = new CloudWatchClient(base);
export const ec2 = new EC2Client(base);

/** floci returns absolute URLs to itself. Rewrite them so the browser goes through the proxy. */
export function viaProxy(url: string): string {
  const u = new URL(url);
  return `${PROXY_BASE}${u.pathname}${u.search}`;
}
