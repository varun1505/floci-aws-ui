import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../clients/organizations";

const setAccount = vi.fn();
const accountRejected = vi.fn<(id: string) => Promise<string | undefined>>();
vi.mock("../config", async (orig) => ({ ...(await orig<typeof import("../config")>()), setAccount: (id: string) => setAccount(id) }));
vi.mock("../clients/organizations", () => ({ accountRejected: (id: string) => accountRejected(id), listAccounts: async () => [] }));

const { OtherAccount, accountMenuItems, dropRejectedAccount, onAccountItem, takeAccountResetReason } = await import("./AccountMenu");

const ACCOUNTS: Account[] = [
  { id: "000000000000", isDefault: true, source: "default" },
  { id: "132032265019", name: "dev", source: "organization" },
  { id: "444444444444", source: "preset" },
];
const REFUSED = "floci does not accept account ID 444444444444 as an access key.";

beforeEach(() => {
  setAccount.mockReset();
  accountRejected.mockReset();
  accountRejected.mockResolvedValue(undefined);
});

describe("account menu", () => {
  it("lists every account and disables the one in use", () => {
    const [group] = accountMenuItems(ACCOUNTS, "132032265019");
    expect("items" in group && group.items).toEqual([
      { id: "account:000000000000", text: "Default account", secondaryText: "000000000000", labelTag: "default", disabled: false },
      { id: "account:132032265019", text: "dev", secondaryText: "132032265019", labelTag: undefined, disabled: true },
      { id: "account:444444444444", text: "444444444444", secondaryText: "444444444444", labelTag: undefined, disabled: false },
    ]);
  });
  it("says so while the accounts load", () => {
    const [group] = accountMenuItems(undefined, "000000000000");
    expect("items" in group && group.items).toEqual([{ id: "loading", text: "Loading accounts...", disabled: true }]);
  });
  it("switches to the account clicked, or opens the dialog for another one", async () => {
    const openOther = vi.fn();
    const onRejected = vi.fn();
    await onAccountItem("account:444444444444", openOther, onRejected);
    expect(setAccount).toHaveBeenCalledWith("444444444444");
    await onAccountItem("other", openOther, onRejected);
    expect(openOther).toHaveBeenCalled();
    await onAccountItem("floci", openOther, onRejected);
    expect(setAccount).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
  });
  it("stays in the account and says why when floci refuses the new one", async () => {
    accountRejected.mockResolvedValue(REFUSED);
    const onRejected = vi.fn();
    await onAccountItem("account:444444444444", vi.fn(), onRejected);
    expect(setAccount).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(REFUSED);
  });
  it("goes to the default account without asking floci", async () => {
    await onAccountItem("account:000000000000", vi.fn(), vi.fn());
    expect(accountRejected).not.toHaveBeenCalled();
    expect(setAccount).toHaveBeenCalledWith("000000000000");
  });
});

describe("start-up check", () => {
  it("keeps a saved account that floci accepts", async () => {
    expect(await dropRejectedAccount("444444444444")).toBe(false);
    expect(setAccount).not.toHaveBeenCalled();
  });
  it("goes back to the default account, once, with the reason", async () => {
    accountRejected.mockResolvedValue(REFUSED);
    expect(await dropRejectedAccount("444444444444")).toBe(true);
    expect(setAccount).toHaveBeenCalledWith("");
    expect(takeAccountResetReason()).toBe(REFUSED);
    expect(takeAccountResetReason()).toBeUndefined();
  });
});

describe("OtherAccount", () => {
  it("checks a typed account ID before it switches", async () => {
    const user = userEvent.setup();
    render(<OtherAccount visible onClose={() => {}} />);
    const input = screen.getByPlaceholderText("111111111111");
    await user.type(input, "123");
    await user.click(screen.getByRole("button", { name: "Switch account" }));
    expect(screen.getByText("Enter an account ID of exactly 12 digits.")).toBeInTheDocument();
    expect(setAccount).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "555555555555{Enter}");
    expect(setAccount).toHaveBeenCalledWith("555555555555");
  });
  it("shows floci's refusal in the dialog", async () => {
    accountRejected.mockResolvedValue(REFUSED);
    const user = userEvent.setup();
    render(<OtherAccount visible onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText("111111111111"), "444444444444{Enter}");
    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(setAccount).not.toHaveBeenCalled();
  });
});
