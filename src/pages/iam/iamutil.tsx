import { useState } from "react";
import {
  AttachRolePolicyCommand,
  AttachUserPolicyCommand,
  DeleteAccessKeyCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  DetachRolePolicyCommand,
  DetachUserPolicyCommand,
  type Group,
  ListAccessKeysCommand,
  ListAttachedRolePoliciesCommand,
  ListAttachedUserPoliciesCommand,
  ListGroupsCommand,
  ListGroupsForUserCommand,
  ListPoliciesCommand,
  ListRolePoliciesCommand,
  ListRolesCommand,
  ListUserPoliciesCommand,
  ListUsersCommand,
  type Policy,
  RemoveUserFromGroupCommand,
  type Role,
  type User,
} from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { iam } from "../../clients/iam";
import { FormModal } from "../../components/FormModal";
import { RouterLink } from "../../components/RouterLink";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";

export const policyHref = (arn: string) => `/iam/policy?arn=${encodeURIComponent(arn)}`;
export const isAwsManaged = (arn?: string) => !!arn?.startsWith("arn:aws:iam::aws:");

async function pages<T>(fetch: (Marker?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
  const out: T[] = [];
  let marker: string | undefined;
  do {
    const res = await fetch(marker);
    out.push(...res.items);
    marker = res.next;
  } while (marker);
  return out;
}

const next = (r: { IsTruncated?: boolean; Marker?: string }) => (r.IsTruncated ? r.Marker : undefined);

export const listUsers = () => pages<User>(async (Marker) => iam.send(new ListUsersCommand({ Marker })).then((r) => ({ items: r.Users ?? [], next: next(r) })));
export const listRoles = () => pages<Role>(async (Marker) => iam.send(new ListRolesCommand({ Marker })).then((r) => ({ items: r.Roles ?? [], next: next(r) })));
export const listGroups = () => pages<Group>(async (Marker) => iam.send(new ListGroupsCommand({ Marker })).then((r) => ({ items: r.Groups ?? [], next: next(r) })));
export const listPolicies = (Scope: "Local" | "AWS" | "All") =>
  pages<Policy>(async (Marker) => iam.send(new ListPoliciesCommand({ Marker, Scope, MaxItems: 1000 })).then((r) => ({ items: r.Policies ?? [], next: next(r) })));

/** IAM refuses to delete a user that still has keys, policies or groups. Remove those first. */
export async function deleteUser(UserName: string) {
  const [keys, attached, inline, groups] = await Promise.all([
    iam.send(new ListAccessKeysCommand({ UserName })),
    iam.send(new ListAttachedUserPoliciesCommand({ UserName })),
    iam.send(new ListUserPoliciesCommand({ UserName })),
    iam.send(new ListGroupsForUserCommand({ UserName })),
  ]);
  for (const k of keys.AccessKeyMetadata ?? []) await iam.send(new DeleteAccessKeyCommand({ UserName, AccessKeyId: k.AccessKeyId }));
  for (const p of attached.AttachedPolicies ?? []) await iam.send(new DetachUserPolicyCommand({ UserName, PolicyArn: p.PolicyArn }));
  for (const PolicyName of inline.PolicyNames ?? []) await iam.send(new DeleteUserPolicyCommand({ UserName, PolicyName }));
  for (const g of groups.Groups ?? []) await iam.send(new RemoveUserFromGroupCommand({ UserName, GroupName: g.GroupName }));
  await iam.send(new DeleteUserCommand({ UserName }));
}

/** Same for roles: detach managed policies and delete inline ones before the role. */
export async function deleteRole(RoleName: string) {
  const [attached, inline] = await Promise.all([iam.send(new ListAttachedRolePoliciesCommand({ RoleName })), iam.send(new ListRolePoliciesCommand({ RoleName }))]);
  for (const p of attached.AttachedPolicies ?? []) await iam.send(new DetachRolePolicyCommand({ RoleName, PolicyArn: p.PolicyArn }));
  for (const PolicyName of inline.PolicyNames ?? []) await iam.send(new DeleteRolePolicyCommand({ RoleName, PolicyName }));
  await iam.send(new DeleteRoleCommand({ RoleName }));
}

const trust = (principal: Record<string, string>) => JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: principal, Action: "sts:AssumeRole" }] }, null, 2);

export const TRUSTED: { value: string; label: string; document: string }[] = [
  { value: "lambda", label: "Lambda", document: trust({ Service: "lambda.amazonaws.com" }) },
  { value: "ec2", label: "EC2", document: trust({ Service: "ec2.amazonaws.com" }) },
  { value: "ecs", label: "Elastic Container Service task", document: trust({ Service: "ecs-tasks.amazonaws.com" }) },
  { value: "apigateway", label: "API Gateway", document: trust({ Service: "apigateway.amazonaws.com" }) },
  { value: "account", label: "This account", document: trust({ AWS: "arn:aws:iam::000000000000:root" }) },
  { value: "custom", label: "Custom trust policy", document: trust({ Service: "lambda.amazonaws.com" }) },
];

export const EMPTY_POLICY = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }] }, null, 2);

export function jsonError(text: string): string {
  try {
    JSON.parse(text);
    return "";
  } catch (e) {
    return `The policy is not valid JSON. ${(e as Error).message}`;
  }
}

type Row = { name: string; arn?: string; type: string };

/** The Permissions tab of a user or a role: managed policies you can attach and detach, plus inline policy names. */
export function Permissions({ kind, name }: { kind: "user" | "role"; name: string }) {
  const notify = useNotify();
  const form = useSubmit();
  const [attaching, setAttaching] = useState(false);
  const [choice, setChoice] = useState("");
  const [selected, setSelected] = useState<Row[]>([]);

  const list = useLoad(async (): Promise<Row[]> => {
    const [attached, inline] =
      kind === "user"
        ? await Promise.all([iam.send(new ListAttachedUserPoliciesCommand({ UserName: name })), iam.send(new ListUserPoliciesCommand({ UserName: name }))])
        : await Promise.all([iam.send(new ListAttachedRolePoliciesCommand({ RoleName: name })), iam.send(new ListRolePoliciesCommand({ RoleName: name }))]);
    return [
      ...(attached.AttachedPolicies ?? []).map((p) => ({ name: p.PolicyName ?? "", arn: p.PolicyArn, type: isAwsManaged(p.PolicyArn) ? "AWS managed" : "Customer managed" })),
      ...(inline.PolicyNames ?? []).map((n) => ({ name: n, type: "Customer inline" })),
    ];
  }, [kind, name]);
  // The full policy list is long. Load it only when the dialog opens.
  const available = useLoad(async () => (attaching ? (await listPolicies("All")).map((p) => ({ value: p.Arn ?? "", label: p.PolicyName ?? "", description: isAwsManaged(p.Arn) ? "AWS managed" : "Customer managed" })) : []), [attaching]);

  const attach = async () => {
    if (!choice) return form.setError("Choose a policy.");
    const ok = await form.run(async () => {
      if (kind === "user") await iam.send(new AttachUserPolicyCommand({ UserName: name, PolicyArn: choice }));
      else await iam.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: choice }));
      notify.success(`Policy was successfully attached to ${kind} ${name}.`);
      list.reload(true);
    });
    if (ok) setAttaching(false);
  };

  const detach = async () => {
    try {
      for (const p of selected) {
        if (kind === "user") {
          if (p.arn) await iam.send(new DetachUserPolicyCommand({ UserName: name, PolicyArn: p.arn }));
          else await iam.send(new DeleteUserPolicyCommand({ UserName: name, PolicyName: p.name }));
        } else if (p.arn) await iam.send(new DetachRolePolicyCommand({ RoleName: name, PolicyArn: p.arn }));
        else await iam.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName: p.name }));
      }
      notify.success(`Removed ${selected.length} polic${selected.length === 1 ? "y" : "ies"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not remove the policy", e);
    }
    list.reload(true);
  };

  return (
    <>
      <Table
        header={
          <Header
            variant="h2"
            counter={`(${list.data?.length ?? 0})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={selected.length === 0} onClick={detach}>
                  Remove
                </Button>
                <Button
                  onClick={() => {
                    setChoice("");
                    form.setError("");
                    setAttaching(true);
                  }}
                >
                  Attach policies
                </Button>
              </SpaceBetween>
            }
          >
            Permissions policies
          </Header>
        }
        loading={list.loading}
        loadingText="Loading policies"
        items={list.data ?? []}
        trackBy="name"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
        columnDefinitions={[
          { id: "name", header: "Policy name", cell: (p) => (p.arn ? <RouterLink to={policyHref(p.arn)}>{p.name}</RouterLink> : p.name), isRowHeader: true },
          { id: "type", header: "Type", cell: (p) => p.type },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <b>No policies</b>
            <Box variant="p" color="inherit">
              This {kind} has no permissions policies attached.
            </Box>
          </Box>
        }
      />
      <FormModal visible={attaching} header="Attach policy" submitLabel="Attach policy" busy={form.busy} error={form.error} onDismiss={() => setAttaching(false)} onSubmit={attach}>
        <FormField label="Permissions policy">
          <Select
            selectedOption={available.data?.find((o) => o.value === choice) ?? null}
            onChange={(e) => setChoice(e.detail.selectedOption.value ?? "")}
            options={available.data ?? []}
            placeholder="Choose a policy"
            filteringType="auto"
            virtualScroll
            statusType={available.loading ? "loading" : "finished"}
            empty="No policies"
          />
        </FormField>
      </FormModal>
    </>
  );
}
