import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Organizations client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/organizations", () => ({ organizations: { send } }));

import AccountDetail from "./AccountDetail";
import Accounts from "./Accounts";
import { checkPolicyJson, destinations, type OrgNode } from "./orgutil";
import Policies from "./Policies";

type Command = { constructor: { name: string }; input: Record<string, unknown> };

// 000000000000 is the account in use. By default it manages an organization with one OU, Workloads,
// which holds the account dev.
let org: "none" | "member" | "management";
let scps: boolean;

beforeEach(() => {
  org = "management";
  scps = false;
  send.mockReset();
  send.mockImplementation(async (command: Command) => {
    switch (command.constructor.name) {
      case "DescribeOrganizationCommand":
        if (org === "none") throw Object.assign(new Error("not in use"), { name: "AWSOrganizationsNotInUseException" });
        return { Organization: { Id: "o-1", MasterAccountId: org === "member" ? "999999999999" : "000000000000", FeatureSet: "ALL" } };
      case "ListRootsCommand":
        return { Roots: [{ Id: "r-1", Name: "Root", PolicyTypes: scps ? [{ Type: "SERVICE_CONTROL_POLICY", Status: "ENABLED" }] : [] }] };
      case "ListOrganizationalUnitsForParentCommand":
        return { OrganizationalUnits: command.input.ParentId === "r-1" ? [{ Id: "ou-1", Name: "Workloads" }] : [] };
      case "ListAccountsForParentCommand":
        return {
          Accounts:
            command.input.ParentId === "r-1"
              ? [{ Id: "000000000000", Name: "management-account", Email: "m@example.com", Status: "ACTIVE", JoinedMethod: "INVITED" }]
              : [{ Id: "111111111111", Name: "dev", Email: "dev@example.com", Status: "ACTIVE", JoinedMethod: "CREATED" }],
        };
      case "DescribeAccountCommand":
        return { Account: { Id: "111111111111", Name: "dev", Email: "dev@example.com", Status: "ACTIVE", JoinedMethod: "CREATED", Arn: "arn:aws:organizations::000000000000:account/o-1/111111111111" } };
      case "ListParentsCommand":
        return { Parents: [{ Id: "ou-1", Type: "ORGANIZATIONAL_UNIT" }] };
      case "DescribeOrganizationalUnitCommand":
        return { OrganizationalUnit: { Id: "ou-1", Name: "Workloads" } };
      case "ListPoliciesForTargetCommand":
        return { Policies: [{ Id: "p-full", Name: "FullAWSAccess", AwsManaged: true }] };
      case "ListPoliciesCommand":
        return { Policies: [{ Id: "p-full", Name: "FullAWSAccess", AwsManaged: true }, { Id: "p-deny", Name: "deny-leave-organization" }] };
      case "ListTagsForResourceCommand":
        return { Tags: [{ Key: "team", Value: "checkout" }] };
      case "CreateAccountCommand":
        return { CreateAccountStatus: { Id: "car-1", State: "SUCCEEDED", AccountId: "222222222222" } };
      case "CreateOrganizationCommand":
      case "CreateOrganizationalUnitCommand":
      case "UpdateOrganizationalUnitCommand":
      case "DeleteOrganizationalUnitCommand":
      case "MoveAccountCommand":
      case "RemoveAccountFromOrganizationCommand":
      case "EnablePolicyTypeCommand":
      case "AttachPolicyCommand":
      case "DetachPolicyCommand":
      case "TagResourceCommand":
      case "UntagResourceCommand":
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c as Command).filter((c) => c.constructor.name === name);

// The dialogs are in the page even when closed, so a button name can match twice.
// The page's own button comes first. The dialog's button comes last.
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open(page: React.ReactNode, path = "/") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NotifyProvider>{page}</NotifyProvider>
    </MemoryRouter>,
  );
}

/** Selects a row of the AWS accounts tree, then picks an item of the Actions menu. */
async function action(row: string, item: string) {
  const link = await screen.findByRole("link", { name: row });
  await userEvent.click(within(link.closest("tr")!).getByRole("radio"));
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("AWS accounts page", () => {
  it("offers to create an organization when the account is in none", async () => {
    org = "none";
    open(<Accounts />);
    await userEvent.click(await screen.findByRole("button", { name: "Create an organization" }));
    await waitFor(() => expect(sent("CreateOrganizationCommand")).toHaveLength(1));
    expect(sent("CreateOrganizationCommand")[0].input).toEqual({ FeatureSet: "ALL" });
  });

  it("tells a member account who manages its organization", async () => {
    org = "member";
    open(<Accounts />);
    expect(await screen.findByText(/Only its management account, 999999999999, can see and manage the organization/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to the management account" })).toBeInTheDocument();
    expect(sent("ListRootsCommand")).toHaveLength(0);
  });

  it("shows the root, the OUs and the accounts, with floci's management name shown as management", async () => {
    open(<Accounts />);
    const management = await screen.findByRole("link", { name: "management" });
    expect(within(management.closest("tr")!).getByText("Management account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workloads" })).toHaveAttribute("href", "/organizations/ou?id=ou-1");
    expect(await screen.findByRole("link", { name: "dev" })).toHaveAttribute("href", "/organizations/account?id=111111111111");
  });

  it("creates an account in the selected OU", async () => {
    open(<Accounts />);
    const workloads = await screen.findByRole("link", { name: "Workloads" });
    await userEvent.click(within(workloads.closest("tr")!).getByRole("radio"));
    await userEvent.click(screen.getByRole("button", { name: "Add an AWS account" }));
    await userEvent.type(screen.getByPlaceholderText("storefront"), "tools");
    await userEvent.type(screen.getByPlaceholderText("storefront@example.com"), "tools@example.com");
    await userEvent.click(dialogButton("Create account"));
    await waitFor(() => expect(sent("MoveAccountCommand")).toHaveLength(1));
    expect(sent("CreateAccountCommand")[0].input).toEqual({ AccountName: "tools", Email: "tools@example.com" });
    expect(sent("MoveAccountCommand")[0].input).toEqual({ AccountId: "222222222222", SourceParentId: "r-1", DestinationParentId: "ou-1" });
  });

  it("checks the email address before it creates an account", async () => {
    open(<Accounts />);
    await screen.findByRole("link", { name: "Workloads" });
    await userEvent.click(screen.getByRole("button", { name: "Add an AWS account" }));
    await userEvent.type(screen.getByPlaceholderText("storefront"), "tools");
    await userEvent.type(screen.getByPlaceholderText("storefront@example.com"), "not-an-email");
    await userEvent.click(dialogButton("Create account"));
    expect((await screen.findAllByText(/^Enter the email address of the account owner/)).length).toBeGreaterThan(0);
    expect(sent("CreateAccountCommand")).toHaveLength(0);
  });

  it("creates an organizational unit in the selected OU", async () => {
    open(<Accounts />);
    const workloads = await screen.findByRole("link", { name: "Workloads" });
    await userEvent.click(within(workloads.closest("tr")!).getByRole("radio"));
    await userEvent.click(screen.getByRole("button", { name: "Create organizational unit" }));
    await userEvent.type(screen.getByPlaceholderText("Applications"), "Production");
    await userEvent.click(dialogButton("Create"));
    await waitFor(() => expect(sent("CreateOrganizationalUnitCommand")).toHaveLength(1));
    expect(sent("CreateOrganizationalUnitCommand")[0].input).toEqual({ ParentId: "ou-1", Name: "Production" });
  });

  it("moves an account to another place", async () => {
    open(<Accounts />);
    await action("dev", "Move account");
    await userEvent.click(screen.getByText("Choose the root or an organizational unit"));
    await userEvent.click(await screen.findByRole("option", { name: "Root" }));
    await userEvent.click(dialogButton("Move"));
    await waitFor(() => expect(sent("MoveAccountCommand")).toHaveLength(1));
    expect(sent("MoveAccountCommand")[0].input).toEqual({ AccountId: "111111111111", SourceParentId: "ou-1", DestinationParentId: "r-1" });
  });

  it("renames an organizational unit", async () => {
    open(<Accounts />);
    await action("Workloads", "Rename organizational unit");
    const dialog = within(await screen.findByRole("dialog", { name: "Rename organizational unit" }));
    const name = dialog.getByDisplayValue("Workloads");
    await userEvent.clear(name);
    await userEvent.type(name, "Applications");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("UpdateOrganizationalUnitCommand")).toHaveLength(1));
    expect(sent("UpdateOrganizationalUnitCommand")[0].input).toEqual({ OrganizationalUnitId: "ou-1", Name: "Applications" });
  });

  it("deletes an organizational unit only after the user confirms", async () => {
    open(<Accounts />);
    await action("Workloads", "Delete organizational unit");
    expect(sent("DeleteOrganizationalUnitCommand")).toHaveLength(0);
    const dialog = within(await screen.findByRole("dialog", { name: "Delete organizational unit" }));
    await userEvent.type(dialog.getByPlaceholderText("delete"), "delete");
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent("DeleteOrganizationalUnitCommand")).toHaveLength(1));
    expect(sent("DeleteOrganizationalUnitCommand")[0].input).toEqual({ OrganizationalUnitId: "ou-1" });
  });

  it("removes an account from the organization only after the user confirms", async () => {
    open(<Accounts />);
    await action("dev", "Remove account from organization");
    expect(sent("RemoveAccountFromOrganizationCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("remove"), "remove");
    await userEvent.click(dialogButton("Remove"));
    await waitFor(() => expect(sent("RemoveAccountFromOrganizationCommand")).toHaveLength(1));
    expect(sent("RemoveAccountFromOrganizationCommand")[0].input).toEqual({ AccountId: "111111111111" });
  });

  it("does not offer to remove the management account", async () => {
    open(<Accounts />);
    const management = await screen.findByRole("link", { name: "management" });
    await userEvent.click(within(management.closest("tr")!).getByRole("radio"));
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Remove account from organization" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("account page", () => {
  beforeEach(() => {
    scps = true;
  });
  const openDev = () => open(<AccountDetail />, "/organizations/account?id=111111111111");

  it("shows the account and where it sits", async () => {
    openDev();
    expect(await screen.findByRole("heading", { name: "dev" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Workloads" })).toHaveAttribute("href", "/organizations/ou?id=ou-1");
    expect(screen.getByRole("button", { name: "Switch to this account" })).toBeEnabled();
  });

  it("attaches a service control policy", async () => {
    openDev();
    await screen.findByRole("link", { name: "FullAWSAccess" });
    await userEvent.click(screen.getAllByRole("button", { name: "Attach" })[0]);
    await userEvent.click(await screen.findByText("Choose a policy"));
    await userEvent.click(await screen.findByRole("option", { name: /deny-leave-organization/ }));
    await userEvent.click(dialogButton("Attach"));
    await waitFor(() => expect(sent("AttachPolicyCommand")).toHaveLength(1));
    expect(sent("AttachPolicyCommand")[0].input).toEqual({ PolicyId: "p-deny", TargetId: "111111111111" });
  });

  it("detaches the selected policy", async () => {
    openDev();
    const policy = await screen.findByRole("link", { name: "FullAWSAccess" });
    await userEvent.click(within(policy.closest("tr")!).getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(sent("DetachPolicyCommand")).toHaveLength(1));
    expect(sent("DetachPolicyCommand")[0].input).toEqual({ PolicyId: "p-full", TargetId: "111111111111" });
  });

  it("adds a tag and removes one", async () => {
    openDev();
    await userEvent.click(await screen.findByRole("tab", { name: "Tags" }));
    const team = await screen.findByText("team");
    await userEvent.click(screen.getAllByRole("button", { name: "Add tag" })[0]);
    await userEvent.type(screen.getByPlaceholderText("team"), "cost-center");
    await userEvent.type(screen.getByPlaceholderText("checkout"), "web");
    await userEvent.click(dialogButton("Save"));
    await waitFor(() => expect(sent("TagResourceCommand")).toHaveLength(1));
    expect(sent("TagResourceCommand")[0].input).toEqual({ ResourceId: "111111111111", Tags: [{ Key: "cost-center", Value: "web" }] });

    await userEvent.click(within(team.closest("tr")!).getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent("UntagResourceCommand")).toHaveLength(1));
    expect(sent("UntagResourceCommand")[0].input).toEqual({ ResourceId: "111111111111", TagKeys: ["team"] });
  });
});

describe("Policies page", () => {
  it("turns on service control policies for the root", async () => {
    open(<Policies />);
    await userEvent.click(await screen.findByRole("button", { name: "Turn on service control policies" }));
    await waitFor(() => expect(sent("EnablePolicyTypeCommand")).toHaveLength(1));
    expect(sent("EnablePolicyTypeCommand")[0].input).toEqual({ RootId: "r-1", PolicyType: "SERVICE_CONTROL_POLICY" });
  });

  it("lists the policies once they are on", async () => {
    scps = true;
    open(<Policies />);
    expect(await screen.findByRole("link", { name: "deny-leave-organization" })).toHaveAttribute("href", "/organizations/policy?id=p-deny");
  });
});

describe("Organizations helpers", () => {
  it("lists the root and every OU as places, with their paths", () => {
    const nodes: OrgNode[] = [
      { id: "r-1", parentId: null, kind: "root", name: "Root" },
      { id: "ou-1", parentId: "r-1", kind: "ou", name: "Workloads" },
      { id: "ou-2", parentId: "ou-1", kind: "ou", name: "Prod" },
      { id: "111111111111", parentId: "ou-1", kind: "account", name: "dev" },
    ];
    expect(destinations(nodes)).toEqual([
      { value: "r-1", label: "Root" },
      { value: "ou-1", label: "Root / Workloads" },
      { value: "ou-2", label: "Root / Workloads / Prod" },
    ]);
  });

  it("accepts only one JSON object as a policy", () => {
    expect(checkPolicyJson('{"Version":"2012-10-17"}')).toBe("");
    expect(checkPolicyJson("[]")).toBe("The policy must be one JSON object.");
    expect(checkPolicyJson("{")).toMatch(/^The JSON is not valid/);
  });
});
