import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateRoleCommand, type Role } from "@aws-sdk/client-iam";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Textarea from "@cloudscape-design/components/textarea";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { prettyJson } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { TRUSTED, deleteRole, jsonError, listRoles } from "./iamutil";

/** Who may assume the role, read from its trust policy. */
export function trustedEntities(doc?: string): string {
  try {
    const statements = JSON.parse(prettyJson(doc)).Statement as { Principal?: Record<string, string | string[]> | string }[];
    const out = statements.flatMap((s) => (typeof s.Principal === "string" ? [s.Principal] : Object.entries(s.Principal ?? {}).flatMap(([kind, v]) => [v].flat().map((x) => (kind === "Service" ? `AWS Service: ${x.split(".")[0]}` : x)))));
    return out.join(", ") || "-";
  } catch {
    return "-";
  }
}

export default function Roles() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listRoles, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Role[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entity, setEntity] = useState("lambda");
  const [document, setDocument] = useState(TRUSTED[0].document);

  const openCreate = () => {
    setName("");
    setDescription("");
    setEntity("lambda");
    setDocument(TRUSTED[0].document);
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[\w+=,.@-]{1,64}$/.test(name)) return form.setError("Use up to 64 letters, numbers and these characters: + = , . @ _ -");
    const bad = jsonError(document);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      await iam.send(new CreateRoleCommand({ RoleName: name, Description: description || undefined, AssumeRolePolicyDocument: document }));
      notify.success(`Role ${name} created.`);
      navigate(`/iam/roles/${encodeURIComponent(name)}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const r of selected) await deleteRole(r.RoleName ?? "");
      notify.success(`Deleted ${selected.length} role${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the role", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="iam" contentType="table" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Roles", href: "/iam/roles" }]}>
      <ResourceTable
        title="Roles"
        resourceName="roles"
        global
        filterPlaceholder="Search roles"
        emptyDescription="A role gives permissions to a service such as Lambda, or to another account."
        emptyCli="iam create-role --role-name my-lambda-role --assume-role-policy-document file://trust.json"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(r) => r.RoleName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create role</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create role
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Role name", cell: (r) => <RouterLink to={`/iam/roles/${encodeURIComponent(r.RoleName ?? "")}`}>{r.RoleName}</RouterLink>, sortingField: "RoleName", isRowHeader: true },
          { id: "trusted", header: "Trusted entities", cell: (r) => trustedEntities(r.AssumeRolePolicyDocument) },
          { id: "arn", header: "ARN", cell: (r) => r.Arn },
          { id: "created", header: "Creation time", cell: (r) => formatDate(r.CreateDate) },
        ]}
      />
      <FormModal visible={creating} size="large" header="Create role" submitLabel="Create role" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Trusted entity" description="The service or account that can use this role.">
          <Select
            selectedOption={TRUSTED.find((t) => t.value === entity) ?? null}
            onChange={(e) => {
              const next = TRUSTED.find((t) => t.value === e.detail.selectedOption.value) ?? TRUSTED[0];
              setEntity(next.value);
              setDocument(next.document);
            }}
            options={TRUSTED.map(({ value, label }) => ({ value, label }))}
          />
        </FormField>
        <FormField label="Role name">
          <Input value={name} placeholder="my-lambda-role" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Trust policy" description="Attach permissions policies on the role page after you create it." stretch>
          <Textarea value={document} rows={10} onChange={(e) => setDocument(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].RoleName}` : `Delete ${selected.length} roles`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Functions and services that use a deleted role will stop working." />
    </Shell>
  );
}
