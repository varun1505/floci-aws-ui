import { beforeEach, describe, expect, it, vi } from "vitest";

// Two organizations in floci: 000000000000 manages dev, 333333333333 manages qa.
// 555555555555 is in none. Each fake client answers as the account its access key names.
const ORGS: Record<string, { master: string; accounts: { Id: string; Name: string }[] }> = {
  "000000000000": { master: "000000000000", accounts: [{ Id: "000000000000", Name: "management-account" }, { Id: "111111111111", Name: "dev" }] },
  "333333333333": { master: "333333333333", accounts: [{ Id: "333333333333", Name: "management-account" }, { Id: "444444444444", Name: "qa" }] },
};
const memberOf = (account: string) => Object.values(ORGS).find((o) => o.accounts.some((a) => a.Id === account));
const asAccount = (key: string) => (key === "test" ? "000000000000" : key);

vi.mock("@aws-sdk/client-organizations", async (orig) => {
  const real = await orig<typeof import("@aws-sdk/client-organizations")>();
  class OrganizationsClient {
    account: string;
    constructor(config: { credentials: { accessKeyId: string } }) {
      this.account = asAccount(config.credentials.accessKeyId);
    }
    async send() {
      const org = memberOf(this.account);
      if (!org) throw Object.assign(new Error("not in an organization"), { name: "AWSOrganizationsNotInUseException" });
      return { Organization: { MasterAccountId: org.master } };
    }
  }
  async function* paginateListAccounts({ client }: { client: OrganizationsClient }) {
    yield { Accounts: ORGS[client.account]?.accounts ?? [] };
  }
  return { ...real, OrganizationsClient, paginateListAccounts };
});

const settings = vi.hoisted(() => ({ accounts: [] as { id: string; name?: string }[] }));
vi.mock("../config", async (orig) => ({
  ...(await orig<typeof import("../config")>()),
  accountSettings: async () => ({ defaultAccountId: "000000000000", accounts: settings.accounts }),
}));

const { accountName, listAccounts } = await import("./accounts");

beforeEach(() => {
  settings.accounts = [];
  localStorage.removeItem("account");
});

const summary = (list: Awaited<ReturnType<typeof listAccounts>>) => list.map((a) => `${a.name ?? "-"}:${a.id}`);

describe("listAccounts", () => {
  it("lists the default account's organization, with floci's management name shown as management", async () => {
    expect(summary(await listAccounts())).toEqual(["management:000000000000", "dev:111111111111"]);
  });

  it("finds every organization the known accounts belong to, whichever account is in use", async () => {
    settings.accounts = [{ id: "333333333333" }];
    const fromDefault = summary(await listAccounts());
    localStorage.setItem("account", "444444444444");
    const fromQa = summary(await listAccounts());
    expect(fromDefault).toEqual(["management:000000000000", "dev:111111111111", "management:333333333333", "qa:444444444444"]);
    expect(fromQa).toEqual(fromDefault);
  });

  it("keeps a preset name over floci's", async () => {
    settings.accounts = [{ id: "333333333333", name: "sandbox" }];
    expect(summary(await listAccounts())).toContain("sandbox:333333333333");
  });

  it("still lists an account in no organization", async () => {
    localStorage.setItem("account", "555555555555");
    expect(summary(await listAccounts())).toEqual(["management:000000000000", "-:555555555555", "dev:111111111111"]);
  });
});

describe("accountName", () => {
  it("renames only floci's built-in name for the management account", () => {
    expect(accountName("management-account", true)).toBe("management");
    expect(accountName("management-account", false)).toBe("management-account");
    expect(accountName("payments", true)).toBe("payments");
  });
});
