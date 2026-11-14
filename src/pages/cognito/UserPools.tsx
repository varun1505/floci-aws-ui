import { useState } from "react";
import { CreateUserPoolCommand, SetUserPoolMfaConfigCommand, type UserPoolDescriptionType } from "@aws-sdk/client-cognito-identity-provider";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cognito } from "../../clients/cognito";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { deletePool, listPools, poolHref } from "./cognitoutil";

const RULES = [
  { key: "RequireNumbers", label: "Contains at least 1 number" },
  { key: "RequireSymbols", label: "Contains at least 1 special character" },
  { key: "RequireUppercase", label: "Contains at least 1 uppercase letter" },
  { key: "RequireLowercase", label: "Contains at least 1 lowercase letter" },
] as const;
type Rule = (typeof RULES)[number]["key"];
const ALL_RULES: Record<Rule, boolean> = { RequireNumbers: true, RequireSymbols: true, RequireUppercase: true, RequireLowercase: true };

export default function UserPools() {
  const notify = useNotify();
  const list = useLoad(listPools, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<UserPoolDescriptionType[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [signIn, setSignIn] = useState("username");
  const [minLength, setMinLength] = useState("8");
  const [rules, setRules] = useState(ALL_RULES);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [mfa, setMfa] = useState("OFF");

  const openCreate = () => {
    setName("");
    setSignIn("username");
    setMinLength("8");
    setRules(ALL_RULES);
    setVerifyEmail(false);
    setMfa("OFF");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[\w\s+=,.@-]{1,128}$/.test(name)) return form.setError("Use up to 128 letters, numbers, spaces and these characters in the name: + = , . @ - _");
    const min = Number(minLength);
    if (!Number.isInteger(min) || min < 6 || min > 99) return form.setError("Enter a password minimum length from 6 to 99.");
    const ok = await form.run(async () => {
      const res = await cognito.send(
        new CreateUserPoolCommand({
          PoolName: name,
          UsernameAttributes: signIn === "email" ? ["email"] : undefined,
          AutoVerifiedAttributes: verifyEmail ? ["email"] : undefined,
          Policies: { PasswordPolicy: { MinimumLength: min, ...rules } },
        }),
      );
      // Optional MFA needs a second call that turns on authenticator apps.
      if (mfa === "OPTIONAL") await cognito.send(new SetUserPoolMfaConfigCommand({ UserPoolId: res.UserPool?.Id, MfaConfiguration: "OPTIONAL", SoftwareTokenMfaConfiguration: { Enabled: true } }));
      notify.success(`User pool ${name} was created.`);
      list.reload(true);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const p of selected) await deletePool(p.Id ?? "");
      notify.success(selected.length === 1 ? `User pool ${selected[0].Name} was deleted.` : `Deleted ${selected.length} user pools.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the user pool", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="cognito" contentType="table" breadcrumbs={[{ text: "Amazon Cognito", href: "/cognito/user-pools" }, { text: "User pools", href: "/cognito/user-pools" }]}>
      <ResourceTable
        title="User pools"
        resourceName="user pools"
        filterPlaceholder="Search user pools by name or ID"
        emptyDescription="A user pool is a user directory. Your application signs users in through it."
        emptyCli="cognito-idp create-user-pool --pool-name my-user-pool"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(p) => p.Id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create user pool</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create user pool
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "User pool name", cell: (p) => <RouterLink to={poolHref(p.Id ?? "")}>{p.Name}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "id", header: "User pool ID", cell: (p) => <Copy text={p.Id} />, sortingField: "Id" },
          { id: "created", header: "Created time", cell: (p) => formatDate(p.CreationDate), sortingComparator: (a, b) => (a.CreationDate?.getTime() ?? 0) - (b.CreationDate?.getTime() ?? 0) },
          { id: "updated", header: "Last updated time", cell: (p) => formatDate(p.LastModifiedDate), sortingComparator: (a, b) => (a.LastModifiedDate?.getTime() ?? 0) - (b.LastModifiedDate?.getTime() ?? 0) },
        ]}
      />

      <FormModal visible={creating} header="Create user pool" submitLabel="Create user pool" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="User pool name">
          <Input value={name} placeholder="my-user-pool" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Sign-in option" description="What a user types to sign in. You can't change this later.">
          <RadioGroup
            value={signIn}
            onChange={(e) => setSignIn(e.detail.value)}
            items={[
              { value: "username", label: "User name" },
              { value: "email", label: "Email", description: "The pool gives each user a generated ID as the user name." },
            ]}
          />
        </FormField>
        <FormField label="Password minimum length" constraintText="From 6 to 99 characters.">
          <Input type="number" value={minLength} onChange={(e) => setMinLength(e.detail.value)} />
        </FormField>
        <FormField label="Password requirements">
          <SpaceBetween size="xxs">
            {RULES.map((r) => (
              <Checkbox key={r.key} checked={rules[r.key]} onChange={(e) => setRules({ ...rules, [r.key]: e.detail.checked })}>
                {r.label}
              </Checkbox>
            ))}
          </SpaceBetween>
        </FormField>
        <FormField label="Attribute verification">
          <Checkbox checked={verifyEmail} onChange={(e) => setVerifyEmail(e.detail.checked)}>
            Verify email addresses automatically
          </Checkbox>
        </FormField>
        <FormField label="Multi-factor authentication">
          <RadioGroup
            value={mfa}
            onChange={(e) => setMfa(e.detail.value)}
            items={[
              { value: "OFF", label: "No MFA" },
              { value: "OPTIONAL", label: "Optional MFA", description: "Users can add an authenticator app." },
            ]}
          />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete user pool ${selected[0].Name}` : `Delete ${selected.length} user pools`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="This deletes the users, groups, app clients and the domain of the user pool. You can't undo it."
      />
    </Shell>
  );
}
