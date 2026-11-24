import { DescribeOrganizationCommand, OrganizationsClient, paginateListAccounts } from "@aws-sdk/client-organizations";
import { ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { accessKeyFor, accountSettings, clientBase, getSelectedAccount, isAccountId } from "../config";

// The errors floci gives for an access key it does not accept.
const KEY_REJECTED = new Set(["UnrecognizedClientException", "InvalidClientTokenId", "InvalidAccessKeyId"]);

/**
 * Why floci will not work as this account, or undefined when it will.
 * floci refuses 12-digit account ID keys when it checks signatures (FLOCI_AUTH_VALIDATE_SIGNATURES).
 * Any other failure, such as floci being down, is not a reason to refuse the account.
 */
export async function accountRejected(id: string): Promise<string | undefined> {
  if (!isAccountId(id)) return undefined;
  try {
    const sqs = new SQSClient({ ...clientBase, credentials: { accessKeyId: id, secretAccessKey: "test" }, useQueueUrlAsEndpoint: false });
    await sqs.send(new ListQueuesCommand({}));
  } catch (e) {
    if (KEY_REJECTED.has((e as Error).name)) {
      return `floci does not accept account ID ${id} as an access key. floci refuses account ID keys when it checks signatures (FLOCI_AUTH_VALIDATE_SIGNATURES).`;
    }
  }
  return undefined;
}

/** An Organizations client that calls floci as the given account. */
function clientAs(account: string) {
  return new OrganizationsClient({ ...clientBase, credentials: { accessKeyId: accessKeyFor(account), secretAccessKey: "test" } });
}

// floci names the management account this when it creates an organization.
const FLOCI_MANAGEMENT_NAME = "management-account";

/** The name to show for an account. floci's built-in name for the management account shows as "management". */
export function accountName(name: string | undefined, isManagement: boolean): string | undefined {
  return isManagement && name === FLOCI_MANAGEMENT_NAME ? "management" : name;
}

export type Account = {
  id: string;
  name?: string;
  /** floci's default account. */
  isDefault?: boolean;
  /** The management account of an organization. */
  isManagement?: boolean;
  /** Where the console learned about this account. */
  source: "default" | "preset" | "organization" | "selected";
};

type OrgAccount = { id: string; name?: string; isManagement: boolean };

/**
 * The accounts of every organization the callers belong to. floci can hold several organizations and
 * has no list of them, so each caller is asked which organization it is in. Any member can read its
 * organization's management account ID, and the management account can list every account.
 */
async function organizationAccounts(callers: string[]): Promise<OrgAccount[]> {
  const masters = await Promise.all(
    callers.map(async (caller) => {
      try {
        return (await clientAs(caller).send(new DescribeOrganizationCommand({}))).Organization?.MasterAccountId;
      } catch {
        return undefined; // not in an organization, or floci has no Organizations
      }
    }),
  );
  const lists = await Promise.all(
    [...new Set(masters.filter((m): m is string => !!m))].map(async (master) => {
      const found: OrgAccount[] = [];
      try {
        for await (const page of paginateListAccounts({ client: clientAs(master) }, {})) {
          for (const a of page.Accounts ?? []) if (a.Id && a.Status !== "SUSPENDED") found.push({ id: a.Id, name: accountName(a.Name, a.Id === master), isManagement: a.Id === master });
        }
      } catch {
        /* keep what the other organizations gave */
      }
      return found;
    }),
  );
  return lists.flat();
}

/**
 * Every account the console knows about: floci's default account, the accounts preset on the
 * console server, the accounts of their organizations, and the account in use now.
 * floci has no list of all accounts. Any 12-digit account ID works, and an account exists once it is used.
 */
export async function listAccounts(): Promise<Account[]> {
  const settings = await accountSettings();
  const selected = getSelectedAccount();
  // "" sends the "test" key, which is floci's default account.
  const callers = [...new Set([selected, "", ...settings.accounts.map((a) => a.id)].filter((c) => c !== settings.defaultAccountId))];
  const org = await organizationAccounts(callers);

  const byId = new Map<string, Account>();
  const add = (id: string, name: string | undefined, source: Account["source"], isManagement = false) => {
    if (!isAccountId(id)) return;
    const had = byId.get(id);
    if (had) {
      had.name ??= name;
      had.isManagement ||= isManagement;
      return;
    }
    byId.set(id, { id, name, source, isDefault: id === settings.defaultAccountId, isManagement });
  };
  add(settings.defaultAccountId, undefined, "default");
  for (const a of settings.accounts) add(a.id, a.name, "preset");
  for (const a of org) add(a.id, a.name, "organization", a.isManagement);
  if (selected) add(selected, undefined, "selected");

  const [first, ...rest] = [...byId.values()];
  return [first, ...rest.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))];
}
