import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../clients/organizations";

const setAccount = vi.fn();
vi.mock("../config", async (orig) => ({ ...(await orig<typeof import("../config")>()), setAccount: (id: string) => setAccount(id) }));

const { OtherAccount, accountMenuItems, onAccountItem } = await import("./AccountMenu");

const ACCOUNTS: Account[] = [
  { id: "000000000000", isDefault: true, source: "default" },
  { id: "132032265019", name: "dev", source: "organization" },
  { id: "444444444444", source: "preset" },
];

beforeEach(() => setAccount.mockReset());

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
  it("switches to the account clicked, or opens the dialog for another one", () => {
    const openOther = vi.fn();
    onAccountItem("account:444444444444", openOther);
    expect(setAccount).toHaveBeenCalledWith("444444444444");
    onAccountItem("other", openOther);
    expect(openOther).toHaveBeenCalled();
    onAccountItem("floci", openOther);
    expect(setAccount).toHaveBeenCalledTimes(1);
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
});
