import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { accountRejected, listAccounts, type Account } from "../lib/accounts";
import { isAccountId, isDefaultAccount, setAccount } from "../config";

/**
 * Switches to an account after checking that floci accepts its ID as an access key.
 * Gives back the reason when floci refuses it. floci's default account needs no check.
 */
export async function switchAccount(id: string): Promise<string | undefined> {
  const reason = isDefaultAccount(id) ? undefined : await accountRejected(id);
  if (!reason) setAccount(id);
  return reason;
}

const RESET_KEY = "accountReset";

/** Called at start-up. Goes back to the default account if floci no longer accepts the saved one. */
export async function dropRejectedAccount(saved: string): Promise<boolean> {
  const reason = await accountRejected(saved);
  if (!reason) return false;
  try {
    sessionStorage.setItem(RESET_KEY, reason);
  } catch {
    /* the notice is only a courtesy */
  }
  setAccount("");
  return true;
}

/** The reason the console last went back to the default account, once. */
export function takeAccountResetReason(): string | undefined {
  try {
    const reason = sessionStorage.getItem(RESET_KEY) ?? undefined;
    sessionStorage.removeItem(RESET_KEY);
    return reason;
  } catch {
    return undefined;
  }
}

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
  const [checking, setChecking] = useState(false);
  const submit = async () => {
    const id = value.trim();
    if (!isAccountId(id)) return setError("Enter an account ID of exactly 12 digits.");
    setChecking(true);
    const reason = await switchAccount(id);
    setChecking(false);
    if (reason) setError(reason);
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
            <Button variant="primary" loading={checking} onClick={() => void submit()}>
              Switch account
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
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
    // Where AWS puts it: the account menu, not the list of services.
    { id: "organization", text: "Organization", href: "/organizations/accounts" },
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

/** Handles a click in the account menu. `onRejected` gets the reason when floci refuses the account. */
export async function onAccountItem(id: string, openOther: () => void, onRejected: (reason: string) => void) {
  if (id === "other") return openOther();
  if (!id.startsWith("account:")) return;
  const reason = await switchAccount(id.slice("account:".length));
  if (reason) onRejected(reason);
}
