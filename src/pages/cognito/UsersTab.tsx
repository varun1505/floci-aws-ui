import { useState } from "react";
import { AdminCreateUserCommand, AdminDeleteUserCommand, AdminSetUserPasswordCommand, type AttributeType, type UserPoolType, type UserType } from "@aws-sdk/client-cognito-identity-provider";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { ACTION_DONE, Enabled, type Load, type UserAction, UserStatus, attr, checkPassword, policyLines, runUserAction, userHref } from "./cognitoutil";
import { SetPassword } from "./SetPassword";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The Users tab of a user pool: list, create, and the actions on the selected users. */
export function UsersTab({ pool, users }: { pool: UserPoolType; users: Load<UserType[]> }) {
  const poolId = pool.Id ?? "";
  const policy = pool.Policies?.PasswordPolicy;
  // In a pool that signs in by email, the email address is what the user types. Cognito generates the user name.
  const byEmail = !!pool.UsernameAttributes?.includes("email");
  const notify = useNotify();
  const form = useSubmit();
  const [selected, setSelected] = useState<UserType[]>([]);
  const [modal, setModal] = useState<"create" | "password" | "delete" | undefined>(undefined);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [permanent, setPermanent] = useState(false);

  const names = selected.map((u) => u.Username ?? "");
  const count = (n: number) => `${n} user${n === 1 ? "" : "s"}`;

  const openCreate = () => {
    setUsername("");
    setEmail("");
    setVerified(false);
    setPassword("");
    setPermanent(false);
    form.setError("");
    setModal("create");
  };

  const create = async () => {
    if (!byEmail && !/^[\p{L}\p{M}\p{S}\p{N}\p{P}]{1,128}$/u.test(username)) return form.setError("Enter a user name without spaces, up to 128 characters.");
    if (byEmail && !email) return form.setError("Enter an email address.");
    if (email && !EMAIL.test(email)) return form.setError("Enter a valid email address.");
    const problem = checkPassword(password, policy);
    if (problem) return form.setError(problem);
    const attributes: AttributeType[] = [];
    if (email) attributes.push({ Name: "email", Value: email }, { Name: "email_verified", Value: String(verified) });
    const ok = await form.run(async () => {
      // No invitation is sent. The password typed here is the one to sign in with.
      const res = await cognito.send(new AdminCreateUserCommand({ UserPoolId: poolId, Username: byEmail ? email : username, TemporaryPassword: password, UserAttributes: attributes, MessageAction: "SUPPRESS" }));
      if (permanent) await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: res.User?.Username, Password: password, Permanent: true }));
      notify.success(`User ${byEmail ? email : username} was created.`);
      users.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const act = async (action: UserAction) => {
    // Only unconfirmed users can be confirmed. The other actions fit every user.
    const targets = selected.filter((u) => action !== "confirm" || u.UserStatus === "UNCONFIRMED");
    try {
      for (const u of targets) await runUserAction(poolId, u.Username ?? "", action);
      notify.success(`${count(targets.length)} ${ACTION_DONE[action]}.`);
    } catch (e) {
      notify.error("Could not update the user", e);
    }
    setSelected([]);
    users.reload(true);
  };

  const remove = async () => {
    try {
      for (const Username of names) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username }));
      notify.success(`Deleted ${count(names.length)}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the user", e);
    }
    setModal(undefined);
    users.reload();
  };

  return (
    <>
      <ResourceTable
        title="Users"
        resourceName="users"
        variant="container"
        stickyHeader={false}
        filterPlaceholder="Search users by attribute"
        emptyDescription="Create a user here, or let users sign up through an app client."
        items={users.data}
        loading={users.loading}
        error={users.error}
        onRefresh={() => users.reload()}
        trackBy={(u) => u.Username ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create user</Button>}
        actions={
          <>
            <ButtonDropdown
              disabled={!selected.length}
              onItemClick={(e) => (e.detail.id === "password" ? setModal("password") : act(e.detail.id as UserAction))}
              items={[
                { id: "confirm", text: "Confirm account", disabled: !selected.some((u) => u.UserStatus === "UNCONFIRMED") },
                { id: "enable", text: "Enable user access", disabled: !selected.some((u) => !u.Enabled) },
                { id: "disable", text: "Disable user access", disabled: !selected.some((u) => u.Enabled) },
                { id: "password", text: "Set password" },
                { id: "reset", text: "Reset password" },
              ]}
            >
              Actions
            </ButtonDropdown>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete user
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create user
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "User name", cell: (u) => <RouterLink to={userHref(poolId, u.Username ?? "")}>{u.Username}</RouterLink>, sortingField: "Username", isRowHeader: true },
          { id: "email", header: "Email address", cell: (u) => attr(u.Attributes, "email") ?? "-", sortingComparator: (a, b) => (attr(a.Attributes, "email") ?? "").localeCompare(attr(b.Attributes, "email") ?? "") },
          { id: "verified", header: "Email verified", cell: (u) => (attr(u.Attributes, "email") ? (attr(u.Attributes, "email_verified") === "true" ? "Yes" : "No") : "-") },
          { id: "status", header: "Confirmation status", cell: (u) => <UserStatus status={u.UserStatus} />, sortingField: "UserStatus" },
          { id: "enabled", header: "Status", cell: (u) => <Enabled enabled={u.Enabled} /> },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create user" submitLabel="Create user" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        {!byEmail && (
          <FormField label="User name">
            <Input value={username} placeholder="jane" onChange={(e) => setUsername(e.detail.value)} />
          </FormField>
        )}
        <FormField label={byEmail ? "Email address" : "Email address - optional"} description={byEmail ? "The user signs in with this address." : undefined}>
          <Input type="email" value={email} placeholder="jane@example.com" onChange={(e) => setEmail(e.detail.value)} />
        </FormField>
        <Checkbox checked={verified} disabled={!email} onChange={(e) => setVerified(e.detail.checked)}>
          Mark email address as verified
        </Checkbox>
        <FormField label="Password" description="No invitation is sent. Give this password to the user." constraintText={policyLines(policy).join(". ") + "."}>
          <Input type="password" value={password} placeholder="Enter a password" onChange={(e) => setPassword(e.detail.value)} />
        </FormField>
        <Checkbox checked={permanent} onChange={(e) => setPermanent(e.detail.checked)} description="Without this, the password is temporary. The user must change it at the first sign-in.">
          Make this password permanent
        </Checkbox>
      </FormModal>

      <SetPassword visible={modal === "password"} poolId={poolId} usernames={names} policy={policy} onDismiss={() => setModal(undefined)} onDone={() => (setSelected([]), users.reload(true))} />

      <ConfirmDelete visible={modal === "delete"} title={names.length === 1 ? `Delete user ${names[0]}` : `Delete ${names.length} users`} onCancel={() => setModal(undefined)} onConfirm={remove} warning="A deleted user can no longer sign in. You can't undo this." />
    </>
  );
}
