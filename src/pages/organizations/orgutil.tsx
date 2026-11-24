import {
  type Account,
  DescribeCreateAccountStatusCommand,
  DescribeOrganizationCommand,
  DescribeOrganizationalUnitCommand,
  ListParentsCommand,
  type Organization,
  type PolicySummary,
  type Root,
  paginateListAccountsForParent,
  paginateListOrganizationalUnitsForParent,
  paginateListPolicies,
  paginateListRoots,
} from "@aws-sdk/client-organizations";
import { organizations } from "../../clients/organizations";
import { accountId } from "../../config";
import { accountName } from "../../lib/accounts";

export const SCP = "SERVICE_CONTROL_POLICY";

export const accountHref = (id: string) => `/organizations/account?id=${encodeURIComponent(id)}`;
export const unitHref = (id: string) => `/organizations/ou?id=${encodeURIComponent(id)}`;
export const policyHref = (id: string) => `/organizations/policy?id=${encodeURIComponent(id)}`;
/** The page of an account, an OU or the root, from its ID. */
export const targetHref = (id: string) => (/^\d{12}$/.test(id) ? accountHref(id) : unitHref(id));

/**
 * The organization as the account in use sees it. Only the management account can see the whole
 * organization and change it. A member sees which organization it is in and who manages it.
 */
export type OrgState = { kind: "none" } | { kind: "member"; org: Organization } | { kind: "management"; org: Organization; root: Root };

export async function loadOrgState(): Promise<OrgState> {
  let org: Organization | undefined;
  try {
    org = (await organizations.send(new DescribeOrganizationCommand({}))).Organization;
  } catch (e) {
    if ((e as Error).name === "AWSOrganizationsNotInUseException") return { kind: "none" };
    throw e;
  }
  if (!org || org.MasterAccountId !== accountId()) return { kind: "member", org: org ?? {} };
  const roots: Root[] = [];
  for await (const page of paginateListRoots({ client: organizations }, {})) roots.push(...(page.Roots ?? []));
  return { kind: "management", org, root: roots[0] ?? {} };
}

/** One row of the AWS accounts tree: the root, an organizational unit or an account. */
export type OrgNode = {
  id: string;
  parentId: string | null;
  kind: "root" | "ou" | "account";
  name: string;
  arn?: string;
  account?: Account;
};

/** The whole organization as a flat list, each row pointing at its parent. */
export async function loadTree(root: Root, masterId?: string): Promise<OrgNode[]> {
  const nodes: OrgNode[] = [{ id: root.Id ?? "", parentId: null, kind: "root", name: "Root", arn: root.Arn }];
  const walk = async (parentId: string): Promise<void> => {
    const units: OrgNode[] = [];
    for await (const page of paginateListOrganizationalUnitsForParent({ client: organizations }, { ParentId: parentId })) {
      for (const ou of page.OrganizationalUnits ?? []) units.push({ id: ou.Id ?? "", parentId, kind: "ou", name: ou.Name ?? ou.Id ?? "", arn: ou.Arn });
    }
    for await (const page of paginateListAccountsForParent({ client: organizations }, { ParentId: parentId })) {
      for (const a of page.Accounts ?? []) nodes.push({ id: a.Id ?? "", parentId, kind: "account", name: accountName(a.Name, a.Id === masterId) ?? a.Id ?? "", arn: a.Arn, account: a });
    }
    nodes.push(...units);
    await Promise.all(units.map((u) => walk(u.id)));
  };
  await walk(root.Id ?? "");
  // The tree keeps this order inside each level.
  return [nodes[0], ...nodes.slice(1).sort(byKindThenName)];
}

/** OUs first, then accounts, each by name. */
export const byKindThenName = (a: OrgNode, b: OrgNode) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "account" ? 1 : -1);

/** Where an account or an OU can go: the root and every OU, with the path as the label. */
export function destinations(nodes: OrgNode[]): { value: string; label: string }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path = (n: OrgNode): string => (n.parentId && byId.get(n.parentId) ? `${path(byId.get(n.parentId)!)} / ${n.name}` : n.name);
  return nodes
    .filter((n) => n.kind !== "account")
    .map((n) => ({ value: n.id, label: path(n) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listScps(): Promise<PolicySummary[]> {
  const out: PolicySummary[] = [];
  for await (const page of paginateListPolicies({ client: organizations }, { Filter: SCP })) out.push(...(page.Policies ?? []));
  return out.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

/** True when service control policies are on for the root. A new root starts with them off. */
export const scpsEnabled = (root?: Root) => !!root?.PolicyTypes?.some((t) => t.Type === SCP && t.Status === "ENABLED");

/** CreateAccount can finish later. Wait for it, a few seconds at most, and give the new account ID. */
export async function waitForAccount(requestId: string, state: string | undefined, accountIdNow: string | undefined): Promise<string> {
  for (let i = 0; state === "IN_PROGRESS" && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = (await organizations.send(new DescribeCreateAccountStatusCommand({ CreateAccountRequestId: requestId }))).CreateAccountStatus;
    state = s?.State;
    accountIdNow = s?.AccountId;
    if (state === "FAILED") throw new Error(`floci could not create the account: ${s?.FailureReason ?? "unknown reason"}`);
  }
  if (!accountIdNow) throw new Error("floci is still creating the account. Refresh the page in a moment.");
  return accountIdNow;
}

export const JOINED: Record<string, string> = { CREATED: "Created", INVITED: "Invited" };

export const SCP_SAMPLE = JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "DenyLeavingOrganization", Effect: "Deny", Action: "organizations:LeaveOrganization", Resource: "*" }] }, null, 2);

export const EMAIL_RULE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Why a policy document is not one JSON object, or "" when it is. floci does not check policy content. */
export function checkPolicyJson(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "The policy must be one JSON object.";
  } catch (e) {
    return `The JSON is not valid: ${(e as Error).message}`;
  }
  return "";
}

/** The root or OU that holds an account or an OU. */
export async function parentOf(id: string): Promise<{ id: string; name: string } | undefined> {
  const parent = (await organizations.send(new ListParentsCommand({ ChildId: id }))).Parents?.[0];
  if (!parent?.Id) return undefined;
  if (parent.Type === "ROOT") return { id: parent.Id, name: "Root" };
  const ou = (await organizations.send(new DescribeOrganizationalUnitCommand({ OrganizationalUnitId: parent.Id }))).OrganizationalUnit;
  return { id: parent.Id, name: ou?.Name ?? parent.Id };
}
