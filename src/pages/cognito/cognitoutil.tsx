import {
  AdminConfirmSignUpCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  AdminResetUserPasswordCommand,
  type AttributeType,
  DeleteUserPoolCommand,
  DeleteUserPoolDomainCommand,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
  type GroupType,
  ListGroupsCommand,
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  ListUsersCommand,
  type PasswordPolicyType,
  type UserPoolClientType,
  type UserPoolDescriptionType,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { cognito } from "../../clients/cognito";

/** What `useLoad` gives back, for passing a loaded list to a tab. */
export type Load<T> = { data: T | undefined; loading: boolean; error: string | undefined; reload: (silent?: boolean) => Promise<void> };

export const poolHref = (id: string) => `/cognito/user-pools/${id}`;
export const userHref = (poolId: string, username: string) => `${poolHref(poolId)}/user?username=${encodeURIComponent(username)}`;

export const attr = (list: AttributeType[] | undefined, name: string) => list?.find((a) => a.Name === name)?.Value;

export async function listPools(): Promise<UserPoolDescriptionType[]> {
  const out: UserPoolDescriptionType[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken }));
    out.push(...(res.UserPools ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listUsers(UserPoolId: string): Promise<UserType[]> {
  const out: UserType[] = [];
  let PaginationToken: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId, Limit: 60, PaginationToken }));
    out.push(...(res.Users ?? []));
    PaginationToken = res.PaginationToken;
  } while (PaginationToken);
  return out;
}

export async function listGroups(UserPoolId: string): Promise<GroupType[]> {
  const out: GroupType[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(new ListGroupsCommand({ UserPoolId, Limit: 60, NextToken }));
    out.push(...(res.Groups ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listUserGroups(UserPoolId: string, Username: string): Promise<GroupType[]> {
  const out: GroupType[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username, Limit: 60, NextToken }));
    out.push(...(res.Groups ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** Every app client with its settings. Cognito lists only names and IDs, so each client needs one more call. */
export async function listClients(UserPoolId: string): Promise<UserPoolClientType[]> {
  const ids: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(new ListUserPoolClientsCommand({ UserPoolId, MaxResults: 60, NextToken }));
    ids.push(...(res.UserPoolClients ?? []).map((c) => c.ClientId ?? ""));
    NextToken = res.NextToken;
  } while (NextToken);
  const clients = await Promise.all(ids.map((ClientId) => cognito.send(new DescribeUserPoolClientCommand({ UserPoolId, ClientId })).then((r) => r.UserPoolClient)));
  return clients.filter((c): c is UserPoolClientType => !!c);
}

/** Deletes a user pool. A pool with a domain can't be deleted, so the domain goes first. */
export async function deletePool(UserPoolId: string) {
  const pool = (await cognito.send(new DescribeUserPoolCommand({ UserPoolId }))).UserPool;
  const domain = pool?.CustomDomain ?? pool?.Domain;
  if (domain) await cognito.send(new DeleteUserPoolDomainCommand({ UserPoolId, Domain: domain }));
  await cognito.send(new DeleteUserPoolCommand({ UserPoolId }));
}

const STATUS: Record<string, { type: StatusIndicatorProps.Type; label: string }> = {
  CONFIRMED: { type: "success", label: "Confirmed" },
  UNCONFIRMED: { type: "pending", label: "Unconfirmed" },
  FORCE_CHANGE_PASSWORD: { type: "warning", label: "Force change password" },
  RESET_REQUIRED: { type: "warning", label: "Reset required" },
  EXTERNAL_PROVIDER: { type: "info", label: "External provider" },
  ARCHIVED: { type: "stopped", label: "Archived" },
  COMPROMISED: { type: "error", label: "Compromised" },
  UNKNOWN: { type: "info", label: "Unknown" },
};

export function UserStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  const s = STATUS[status];
  return <StatusIndicator type={s?.type ?? "info"}>{s?.label ?? status}</StatusIndicator>;
}

export function Enabled({ enabled }: { enabled?: boolean }) {
  return <StatusIndicator type={enabled ? "success" : "stopped"}>{enabled ? "Enabled" : "Disabled"}</StatusIndicator>;
}

/** The rules of a password policy, as the lines the console shows. */
export function policyLines(p?: PasswordPolicyType): string[] {
  const lines = [`Password minimum length: ${p?.MinimumLength ?? 8} characters`];
  if (p?.RequireNumbers) lines.push("Contains at least 1 number");
  if (p?.RequireSymbols) lines.push("Contains at least 1 special character");
  if (p?.RequireUppercase) lines.push("Contains at least 1 uppercase letter");
  if (p?.RequireLowercase) lines.push("Contains at least 1 lowercase letter");
  return lines;
}

/** Checks a password against the pool's policy. Gives the error to show, or an empty string. */
export function checkPassword(password: string, p?: PasswordPolicyType): string {
  if (!password) return "Enter a password.";
  const min = p?.MinimumLength ?? 6;
  if (password.length < min) return `The password must have at least ${min} characters.`;
  if (p?.RequireNumbers && !/[0-9]/.test(password)) return "The password must contain a number.";
  if (p?.RequireSymbols && !/[^A-Za-z0-9]/.test(password)) return "The password must contain a special character.";
  if (p?.RequireUppercase && !/[A-Z]/.test(password)) return "The password must contain an uppercase letter.";
  if (p?.RequireLowercase && !/[a-z]/.test(password)) return "The password must contain a lowercase letter.";
  return "";
}

export type UserAction = "confirm" | "enable" | "disable" | "reset";

export const ACTION_DONE: Record<UserAction, string> = { confirm: "confirmed", enable: "enabled", disable: "disabled", reset: "marked for a password reset" };

export async function runUserAction(UserPoolId: string, Username: string, action: UserAction) {
  if (action === "confirm") await cognito.send(new AdminConfirmSignUpCommand({ UserPoolId, Username }));
  else if (action === "enable") await cognito.send(new AdminEnableUserCommand({ UserPoolId, Username }));
  else if (action === "disable") await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username }));
  else await cognito.send(new AdminResetUserPasswordCommand({ UserPoolId, Username }));
}

export const AUTH_FLOWS = [
  { value: "ALLOW_USER_PASSWORD_AUTH", label: "ALLOW_USER_PASSWORD_AUTH", description: "Sign in with user name and password" },
  { value: "ALLOW_USER_SRP_AUTH", label: "ALLOW_USER_SRP_AUTH", description: "Sign in with secure remote password (SRP)" },
  { value: "ALLOW_REFRESH_TOKEN_AUTH", label: "ALLOW_REFRESH_TOKEN_AUTH", description: "Get new user tokens from a refresh token" },
  { value: "ALLOW_ADMIN_USER_PASSWORD_AUTH", label: "ALLOW_ADMIN_USER_PASSWORD_AUTH", description: "Sign in with server-side administrative credentials" },
  { value: "ALLOW_CUSTOM_AUTH", label: "ALLOW_CUSTOM_AUTH", description: "Sign in with custom authentication flows from Lambda triggers" },
];

/** The SECRET_HASH that Cognito wants from an app client with a secret. */
export async function secretHash(username: string, clientId: string, secret: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This app client has a secret. The browser can sign with it only on localhost or HTTPS. Use an app client without a secret.");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(username + clientId));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** The claims of a JWT as pretty JSON. Gives an empty string when the token is not a JWT. */
export function decodeJwt(token?: string): string {
  try {
    const part = (token ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
    return JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)), null, 2);
  } catch {
    return "";
  }
}
