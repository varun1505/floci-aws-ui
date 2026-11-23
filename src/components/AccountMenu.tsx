import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { listAccounts, type Account } from "../clients/organizations";
import { isAccountId, setAccount } from "../config";

// Loaded once per page load. Switching accounts reloads the page.
let accountsPromise: Promise<Account[]> | undefined;

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    accountsPromise ??= listAccounts().catch(() => []);
    void accountsPromise.then((a) => live && setAccounts(a));
    return () => {
      live = false;
    };
  }, []);
  return accounts;
}

export function OtherAccount({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    const id = value.trim();
    if (!isAccountId(id)) return setError("Enter an account ID of exactly 12 digits.");
    setAccount(id);
  };
  return (
    <Modal
      visible={visible}
      onDismiss={onClose}
      header="Switch to another account"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit}>
              Switch account
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormField
          label="Account ID"
          description="floci keeps each account's resources apart. Any 12-digit ID works. The account starts empty if nothing has used it yet."
          errorText={error}
        >
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.detail.value);
              setError("");
            }}
            placeholder="111111111111"
            inputMode="numeric"
            autoFocus
          />
        </FormField>
      </form>
    </Modal>
  );
}

const accountText = (a: Account) => a.name ?? (a.isDefault ? "Default account" : a.id);

/** Items for the account menu in the top bar. `accounts` is undefined while they load. */
export function accountMenuItems(accounts: Account[] | undefined, current: string): ButtonDropdownProps.ItemOrGroup[] {
  return [
    {
      id: "accounts",
      text: "Switch account",
      items: accounts
        ? accounts.map((a) => ({
            id: `account:${a.id}`,
            text: accountText(a),
            secondaryText: a.id,
            labelTag: a.isDefault ? "default" : undefined,
            disabled: a.id === current,
          }))
        : [{ id: "loading", text: "Loading accounts...", disabled: true }],
    },
    { id: "other", text: "Other account ID..." },
    { id: "floci", text: "Emulator dashboard", href: "/aws/_floci/ui", external: true },
  ];
}

/** Handles a click in the account menu. */
export function onAccountItem(id: string, openOther: () => void) {
  if (id === "other") openOther();
  else if (id.startsWith("account:")) setAccount(id.slice("account:".length));
}
