import { DescribeOrganizationCommand, OrganizationsClient, paginateListAccounts } from "@aws-sdk/client-organizations";
import { accessKeyFor, accountSettings, clientBase, getSelectedAccount, isAccountId } from "../config";

/** An Organizations client that calls floci as the given account. */
function clientAs(account: string) {
  return new OrganizationsClient({ ...clientBase, credentials: { accessKeyId: accessKeyFor(account), secretAccessKey: "test" } });
}

export type Account = {
  id: string;
  name?: string;
  /** floci's default account. */
  isDefault?: boolean;
  /** Where the console learned about this account. */
  source: "default" | "preset" | "organization" | "selected";
};

/**
 * Accounts in the organization, if there is one. Any account in an organization can read its
 * management account ID. The management account can then list every account.
 */
async function organizationAccounts(callers: string[]): Promise<{ id: string; name?: string }[]> {
  for (const caller of callers) {
    try {
      const { Organization } = await clientAs(caller).send(new DescribeOrganizationCommand({}));
      const master = Organization?.MasterAccountId;
      if (!master) continue;
      const found: { id: string; name?: string }[] = [];
      for await (const page of paginateListAccounts({ client: clientAs(master) }, {})) {
        for (const a of page.Accounts ?? []) if (a.Id && a.Status !== "SUSPENDED") found.push({ id: a.Id, name: a.Name });
      }
      return found;
    } catch {
      /* not in an organization, or floci has no Organizations. Try the next caller. */
    }
  }
  return [];
}

/**
 * Every account the console knows about: floci's default account, the accounts preset on the
 * console server, the accounts of the organization, and the account in use now.
 * floci has no list of all accounts. Any 12-digit account ID works, and an account exists once it is used.
 */
export async function listAccounts(): Promise<Account[]> {
  const settings = await accountSettings();
  const selected = getSelectedAccount();
  // Ask as the account in use first, then as floci's default account ("" sends the "test" key).
  const org = await organizationAccounts([...new Set([selected, ""])]);

  const byId = new Map<string, Account>();
  const add = (id: string, name: string | undefined, source: Account["source"]) => {
    if (!isAccountId(id)) return;
    const had = byId.get(id);
    if (had) {
      had.name ??= name;
      return;
    }
    byId.set(id, { id, name, source, isDefault: id === settings.defaultAccountId });
  };
  add(settings.defaultAccountId, undefined, "default");
  for (const a of settings.accounts) add(a.id, a.name, "preset");
  for (const a of org) add(a.id, a.name, "organization");
  if (selected) add(selected, undefined, "selected");

  const [first, ...rest] = [...byId.values()];
  return [first, ...rest.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))];
}
