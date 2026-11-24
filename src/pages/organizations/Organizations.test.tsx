import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Organizations client answers from this fake.
// The SDK paginators need a real client object, so only its send is replaced.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/organizations", async () => {
  const { OrganizationsClient } = await import("@aws-sdk/client-organizations");
  const client = new OrganizationsClient({ region: "us-east-1" });
  client.send = send as never;
  return { organizations: client };
});

import Accounts from "./Accounts";
import { checkPolicyJson, destinations, type OrgNode } from "./orgutil";
import Policies from "./Policies";

type Command = { constructor: { name: string }; input: Record<string, unknown> };

// 000000000000 is the account in use. By default it manages an organization with one OU.
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
      case "CreateOrganizationCommand":
      case "MoveAccountCommand":
      case "EnablePolicyTypeCommand":
        return {};
      case "CreateAccountCommand":
        return { CreateAccountStatus: { Id: "car-1", State: "SUCCEEDED", AccountId: "222222222222" } };
      case "ListPoliciesCommand":
        return { Policies: [] };
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c as Command).filter((c) => c.constructor.name === name);
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open(page: React.ReactNode) {
  render(
    <MemoryRouter>
      <NotifyProvider>{page}</NotifyProvider>
    </MemoryRouter>,
  );
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
    await userEvent.type(screen.getByPlaceholderText("dev"), "tools");
    await userEvent.type(screen.getByPlaceholderText("dev@example.com"), "tools@example.com");
    await userEvent.click(dialogButton("Create account"));
    await waitFor(() => expect(sent("MoveAccountCommand")).toHaveLength(1));
    expect(sent("CreateAccountCommand")[0].input).toEqual({ AccountName: "tools", Email: "tools@example.com" });
    expect(sent("MoveAccountCommand")[0].input).toEqual({ AccountId: "222222222222", SourceParentId: "r-1", DestinationParentId: "ou-1" });
  });

  it("checks the email address before it creates an account", async () => {
    open(<Accounts />);
    await screen.findByRole("link", { name: "Workloads" });
    await userEvent.click(screen.getByRole("button", { name: "Add an AWS account" }));
    await userEvent.type(screen.getByPlaceholderText("dev"), "tools");
    await userEvent.type(screen.getByPlaceholderText("dev@example.com"), "not-an-email");
    await userEvent.click(dialogButton("Create account"));
    expect((await screen.findAllByText(/^Enter the email address of the account owner/)).length).toBeGreaterThan(0);
    expect(sent("CreateAccountCommand")).toHaveLength(0);
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
    expect(await screen.findByText("No policies")).toBeInTheDocument();
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
