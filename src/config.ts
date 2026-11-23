export const REGIONS = [
  { id: "us-east-1", label: "US East (N. Virginia)" },
  { id: "us-east-2", label: "US East (Ohio)" },
  { id: "us-west-2", label: "US West (Oregon)" },
  { id: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { id: "eu-west-1", label: "Europe (Ireland)" },
  { id: "eu-central-1", label: "Europe (Frankfurt)" },
];

/** floci's default account, unless FLOCI_DEFAULT_ACCOUNT_ID changes it. */
export const DEFAULT_ACCOUNT_ID = "000000000000";

export const isAccountId = (id: string) => /^\d{12}$/.test(id);

let defaultAccountId = DEFAULT_ACCOUNT_ID;

/**
 * The account the console works in. floci picks the account from the access key ID:
 * a 12-digit key is used as the account ID, and any other key means floci's default account.
 * Empty means floci's default account.
 */
export function getSelectedAccount(): string {
  try {
    const id = localStorage.getItem("account") ?? "";
    return isAccountId(id) ? id : "";
  } catch {
    return "";
  }
}

/** Switches to another account. An empty ID goes back to floci's default account. The page reloads. */
export function setAccount(id: string) {
  try {
    if (id && id !== defaultAccountId) localStorage.setItem("account", id);
    else localStorage.removeItem("account");
  } catch {
    /* storage can be blocked; the default account still works */
  }
  window.location.reload();
}

/** The account ID that pages show and put in ARNs. */
export function accountId(): string {
  return getSelectedAccount() || defaultAccountId;
}

/** Records floci's real default account, read from its manifest at start-up. */
export function setDefaultAccountId(id: string) {
  if (isAccountId(id)) defaultAccountId = id;
}

/** The access key ID that makes floci use this account. */
export function accessKeyFor(account: string): string {
  return isAccountId(account) ? account : "test";
}

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
  // The access key ID chooses the account. "test" means floci's default account.
  credentials: { accessKeyId: accessKeyFor(getSelectedAccount()), secretAccessKey: "test" },
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

export type AccountSettings = {
  /** floci's default account, from its manifest. */
  defaultAccountId: string;
  /** Accounts set with FLOCI_ACCOUNTS or --accounts on the console server. */
  accounts: { id: string; name?: string }[];
};

let accountSettingsPromise: Promise<AccountSettings> | undefined;

/** The default account and the preset accounts, from the console server. */
export function accountSettings(): Promise<AccountSettings> {
  accountSettingsPromise ??= fetch("/console-accounts.json")
    .then((r) => r.json())
    .then((c: Partial<AccountSettings>) => ({
      defaultAccountId: isAccountId(c.defaultAccountId ?? "") ? c.defaultAccountId! : DEFAULT_ACCOUNT_ID,
      accounts: (c.accounts ?? []).filter((a) => isAccountId(a.id)),
    }))
    .catch(() => ({ defaultAccountId: DEFAULT_ACCOUNT_ID, accounts: [] }));
  return accountSettingsPromise;
}

/** The name shown in the top bar, the page title and the help panel. */
export const APP_NAME = "Floci Console";

/** The AWS CLI profile name the console suggests in its examples. */
export const CLI_PROFILE = "floci";
