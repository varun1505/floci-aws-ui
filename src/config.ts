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

/** Shared settings for every AWS SDK client. */
export const clientBase = {
  region: getRegion(),
  endpoint: PROXY_BASE,
  // floci accepts any credentials. These never reach real AWS.
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

/** floci returns absolute URLs to itself. Rewrite them so the browser goes through the proxy. */
export function viaProxy(url: string): string {
  const u = new URL(url);
  return `${PROXY_BASE}${u.pathname}${u.search}`;
}

let flociHostPromise: Promise<string> | undefined;

/** Host name of the floci machine, as the console server sees it. Empty if unknown. */
export function flociHost(): Promise<string> {
  flociHostPromise ??= fetch("/console-config.json")
    .then((r) => r.json())
    .then((c: { flociHost?: string }) => c.flociHost ?? "")
    .catch(() => "");
  return flociHostPromise;
}
