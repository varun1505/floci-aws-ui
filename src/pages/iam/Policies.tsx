import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreatePolicyCommand, DeletePolicyCommand, type Policy } from "@aws-sdk/client-iam";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Textarea from "@cloudscape-design/components/textarea";
import { iam } from "../../clients/iam";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { EMPTY_POLICY, isAwsManaged, jsonError, listPolicies, policyHref } from "./iamutil";

const SCOPES = [
  { value: "Local", label: "Customer managed" },
  { value: "AWS", label: "AWS managed" },
];

export default function Policies() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [scope, setScope] = useState("Local");
  const list = useLoad(() => listPolicies(scope as "Local" | "AWS"), [scope]);
  const form = useSubmit();
  const [selected, setSelected] = useState<Policy[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState(EMPTY_POLICY);

  const openCreate = () => {
    setName("");
    setDescription("");
    setDocument(EMPTY_POLICY);
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!/^[\w+=,.@-]{1,128}$/.test(name)) return form.setError("Use letters, numbers and these characters in the name: + = , . @ _ -");
    const bad = jsonError(document);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      const res = await iam.send(new CreatePolicyCommand({ PolicyName: name, Description: description || undefined, PolicyDocument: document }));
      notify.success(`Policy ${name} created.`);
      navigate(policyHref(res.Policy?.Arn ?? ""));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const p of selected) await iam.send(new DeletePolicyCommand({ PolicyArn: p.Arn }));
      notify.success(`Deleted ${selected.length} polic${selected.length === 1 ? "y" : "ies"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the policy. Detach it from every user and role first.", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="iam" contentType="table" breadcrumbs={[{ text: "IAM", href: "/iam/roles" }, { text: "Policies", href: "/iam/policies" }]}>
      <ResourceTable
        title="Policies"
        resourceName="policies"
        global
        filterPlaceholder="Search policies"
        emptyDescription="A policy is a JSON document that lists allowed and denied actions."
        emptyCli="iam create-policy --policy-name my-policy --policy-document file://policy.json"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(p) => p.Arn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        isItemDisabled={(p) => isAwsManaged(p.Arn)}
        extraFilter={
          <Select
            selectedOption={SCOPES.find((s) => s.value === scope) ?? null}
            onChange={(e) => {
              setScope(e.detail.selectedOption.value ?? "Local");
              setSelected([]);
            }}
            options={SCOPES}
            ariaLabel="Policy type"
          />
        }
        emptyAction={<Button onClick={openCreate}>Create policy</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create policy
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Policy name", cell: (p) => <RouterLink to={policyHref(p.Arn ?? "")}>{p.PolicyName}</RouterLink>, sortingField: "PolicyName", isRowHeader: true },
          { id: "type", header: "Type", cell: (p) => (isAwsManaged(p.Arn) ? "AWS managed" : "Customer managed") },
          { id: "used", header: "Attached entities", cell: (p) => p.AttachmentCount ?? 0, sortingField: "AttachmentCount" },
          { id: "updated", header: "Edited time", cell: (p) => formatDate(p.UpdateDate) },
          { id: "description", header: "Description", cell: (p) => p.Description || "-" },
        ]}
      />
      <FormModal visible={creating} size="large" header="Create policy" submitLabel="Create policy" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Policy name">
          <Input value={name} placeholder="my-policy" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Policy document (JSON)" stretch>
          <Textarea value={document} rows={14} onChange={(e) => setDocument(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].PolicyName}` : `Delete ${selected.length} policies`} onCancel={() => setDeleting(false)} onConfirm={remove} />
    </Shell>
  );
}
