import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyProvider } from "../../lib/notify";

// No network in this test. The Cognito client answers from this fake.
const send = vi.hoisted(() => vi.fn());
vi.mock("../../clients/cognito", () => ({ cognito: { send } }));

import UserPools from "./UserPools";

const CUSTOMERS = "us-east-1_abc123";
let pools: { Id: string; Name: string; CreationDate: Date; LastModifiedDate: Date }[];
// The domain that the fake pool reports. A pool with a domain can't be deleted before the domain is.
let domain: string | undefined;

beforeEach(() => {
  pools = [{ Id: CUSTOMERS, Name: "customers", CreationDate: new Date(1700000000000), LastModifiedDate: new Date(1700000000000) }];
  domain = undefined;
  send.mockReset();
  send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case "ListUserPoolsCommand":
        return { UserPools: pools };
      case "CreateUserPoolCommand":
        return { UserPool: { Id: "us-east-1_new456", Name: command.input.PoolName } };
      case "SetUserPoolMfaConfigCommand":
        return {};
      case "DescribeUserPoolCommand":
        return { UserPool: { Id: command.input.UserPoolId, Domain: domain } };
      case "DeleteUserPoolDomainCommand":
        domain = undefined;
        return {};
      case "DeleteUserPoolCommand":
        if (domain) throw new Error("The pool still has a domain");
        pools = pools.filter((p) => p.Id !== command.input.UserPoolId);
        return {};
      default:
        throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  });
});

const sent = (name: string) => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);

// The dialogs are in the page even when closed, so a button name can match twice.
// The page's own button comes first. The dialog's button comes last.
const pageButton = (name: string) => screen.getAllByRole("button", { name })[0];
const dialogButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

function open() {
  render(
    <MemoryRouter initialEntries={["/cognito/user-pools"]}>
      <NotifyProvider>
        <UserPools />
      </NotifyProvider>
    </MemoryRouter>,
  );
}

describe("Cognito user pools page", () => {
  it("lists the user pools with their IDs", async () => {
    open();
    expect(await screen.findByRole("link", { name: "customers" })).toHaveAttribute("href", `/cognito/user-pools/${CUSTOMERS}`);
    const row = within(screen.getByRole("link", { name: "customers" }).closest("tr")!);
    expect(row.getByText(CUSTOMERS)).toBeInTheDocument();
  });

  it("creates a user pool with the values of the form", async () => {
    open();
    await screen.findByRole("link", { name: "customers" });
    await userEvent.click(pageButton("Create user pool"));
    await userEvent.type(await screen.findByPlaceholderText("my-user-pool"), "staff");
    await userEvent.click(screen.getByRole("radio", { name: /^Email/ }));
    await userEvent.click(screen.getByLabelText("Contains at least 1 special character"));
    await userEvent.click(screen.getByLabelText("Verify email addresses automatically"));
    await userEvent.click(dialogButton("Create user pool"));
    await waitFor(() => expect(sent("CreateUserPoolCommand")).toHaveLength(1));
    expect(sent("CreateUserPoolCommand")[0].input).toEqual({
      PoolName: "staff",
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      Policies: { PasswordPolicy: { MinimumLength: 8, RequireNumbers: true, RequireSymbols: false, RequireUppercase: true, RequireLowercase: true } },
    });
    // MFA stays off, so no second call.
    expect(sent("SetUserPoolMfaConfigCommand")).toHaveLength(0);
  });

  it("turns on optional MFA with a second call", async () => {
    open();
    await screen.findByRole("link", { name: "customers" });
    await userEvent.click(pageButton("Create user pool"));
    await userEvent.type(await screen.findByPlaceholderText("my-user-pool"), "staff");
    await userEvent.click(screen.getByRole("radio", { name: /^Optional MFA/ }));
    await userEvent.click(dialogButton("Create user pool"));
    await waitFor(() => expect(sent("SetUserPoolMfaConfigCommand")).toHaveLength(1));
    expect(sent("SetUserPoolMfaConfigCommand")[0].input).toEqual({ UserPoolId: "us-east-1_new456", MfaConfiguration: "OPTIONAL", SoftwareTokenMfaConfiguration: { Enabled: true } });
  });

  it("rejects a user pool name with invalid characters", async () => {
    open();
    await screen.findByRole("link", { name: "customers" });
    await userEvent.click(pageButton("Create user pool"));
    await userEvent.type(await screen.findByPlaceholderText("my-user-pool"), "bad/name!");
    await userEvent.click(dialogButton("Create user pool"));
    expect(await screen.findByText(/Use up to 128 letters/)).toBeInTheDocument();
    expect(sent("CreateUserPoolCommand")).toHaveLength(0);
  });

  it("deletes the selected user pool only after the user confirms, and its domain first", async () => {
    domain = "customers-login";
    open();
    await screen.findByRole("link", { name: "customers" });
    const del = pageButton("Delete");
    expect(del).toBeDisabled();
    // The closed create dialog has checkboxes too, so take the one in the row.
    await userEvent.click(within(screen.getByRole("link", { name: "customers" }).closest("tr")!).getByRole("checkbox"));
    await userEvent.click(del);
    expect(sent("DeleteUserPoolCommand")).toHaveLength(0);
    await userEvent.type(await screen.findByPlaceholderText("delete"), "delete");
    await userEvent.click(dialogButton("Delete"));
    await waitFor(() => expect(sent("DeleteUserPoolCommand")).toHaveLength(1));
    expect(sent("DeleteUserPoolDomainCommand")[0].input).toEqual({ UserPoolId: CUSTOMERS, Domain: "customers-login" });
    expect(sent("DeleteUserPoolCommand")[0].input).toEqual({ UserPoolId: CUSTOMERS });
    await waitFor(() => expect(screen.queryByRole("link", { name: "customers" })).not.toBeInTheDocument());
  });
});
