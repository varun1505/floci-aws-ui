import { useState } from "react";
import {
  AttachPolicyCommand,
  DetachPolicyCommand,
  type PolicySummary,
  type Tag,
  TagResourceCommand,
  UntagResourceCommand,
  paginateListPoliciesForTarget,
  paginateListTagsForResource,
} from "@aws-sdk/client-organizations";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { organizations } from "../../clients/organizations";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { SCP, listScps, policyHref } from "./orgutil";

/** The service control policies attached directly to an account, an OU or the root. */
export function TargetPolicies({ targetId, enabled }: { targetId: string; enabled: boolean }) {
  const notify = useNotify();
  const attached = useLoad(async () => {
    if (!enabled) return [];
    const out: PolicySummary[] = [];
    for await (const page of paginateListPoliciesForTarget({ client: organizations }, { TargetId: targetId, Filter: SCP })) out.push(...(page.Policies ?? []));
    return out.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
  }, [targetId, enabled]);
  const form = useSubmit();
  const [selected, setSelected] = useState<PolicySummary[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [choices, setChoices] = useState<PolicySummary[]>([]);
  const [choice, setChoice] = useState("");
  const picked = choices.find((p) => p.Id === choice);

  if (!enabled)
    return (
      <Alert type="info" header="Service control policies are off">
        Turn them on in <RouterLink to="/organizations/policies">Policies</RouterLink> before you attach one.
      </Alert>
    );

  const openAttach = async () => {
    form.setError("");
    setChoice("");
    setAttaching(true);
    try {
      const have = new Set((attached.data ?? []).map((p) => p.Id));
      setChoices((await listScps()).filter((p) => !have.has(p.Id)));
    } catch (e) {
      form.setError(errorMessage(e));
    }
  };

  const attach = async () => {
    if (!choice) return form.setError("Choose a policy.");
    const ok = await form.run(async () => {
      await organizations.send(new AttachPolicyCommand({ PolicyId: choice, TargetId: targetId }));
      notify.success("Policy attached.");
      attached.reload(true);
    });
    if (ok) setAttaching(false);
  };

  const detach = async () => {
    try {
      for (const p of selected) await organizations.send(new DetachPolicyCommand({ PolicyId: p.Id, TargetId: targetId }));
      notify.success(selected.length === 1 ? `Policy ${selected[0].Name} detached.` : `Detached ${selected.length} policies.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not detach the policy", e);
    }
    attached.reload(true);
  };

  return (
    <>
      <ResourceTable
        title="Service control policies"
        description="Policies attached directly here. Policies attached to a parent apply too."
        variant="container"
        stickyHeader={false}
        global
        resourceName="attached policies"
        items={attached.data}
        loading={attached.loading}
        error={attached.error}
        onRefresh={() => attached.reload()}
        trackBy={(p) => p.Id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => void detach()}>
              Detach
            </Button>
            <Button onClick={() => void openAttach()}>Attach</Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (p) => <RouterLink to={policyHref(p.Id ?? "")}>{p.Name}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "id", header: "ID", cell: (p) => p.Id },
          { id: "managed", header: "Managed by", cell: (p) => (p.AwsManaged ? "AWS" : "Customer") },
          { id: "description", header: "Description", cell: (p) => p.Description || "-" },
        ]}
      />
      <FormModal visible={attaching} header="Attach a service control policy" submitLabel="Attach" busy={form.busy} error={form.error} onDismiss={() => setAttaching(false)} onSubmit={attach}>
        <FormField label="Policy">
          <Select
            selectedOption={picked ? { value: choice, label: picked.Name } : null}
            options={choices.map((p) => ({ value: p.Id ?? "", label: p.Name, description: p.Id }))}
            onChange={(e) => setChoice(e.detail.selectedOption.value ?? "")}
            placeholder="Choose a policy"
            empty="Every policy is attached here already."
          />
        </FormField>
      </FormModal>
    </>
  );
}

/** The tags of an account, an OU, the root or a policy. */
export function TargetTags({ resourceId }: { resourceId: string }) {
  const notify = useNotify();
  const tags = useLoad(async () => {
    const out: Tag[] = [];
    for await (const page of paginateListTagsForResource({ client: organizations }, { ResourceId: resourceId })) out.push(...(page.Tags ?? []));
    return out.sort((a, b) => (a.Key ?? "").localeCompare(b.Key ?? ""));
  }, [resourceId]);
  const form = useSubmit();
  const [selected, setSelected] = useState<Tag[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const openAdd = () => {
    setKey("");
    setValue("");
    form.setError("");
    setAdding(true);
  };

  const add = async () => {
    if (!key.trim()) return form.setError("Enter a key.");
    const ok = await form.run(async () => {
      await organizations.send(new TagResourceCommand({ ResourceId: resourceId, Tags: [{ Key: key.trim(), Value: value }] }));
      notify.success(`Tag ${key.trim()} saved.`);
      tags.reload(true);
    });
    if (ok) setAdding(false);
  };

  const remove = async () => {
    try {
      await organizations.send(new UntagResourceCommand({ ResourceId: resourceId, TagKeys: selected.map((t) => t.Key ?? "") }));
      notify.success(selected.length === 1 ? `Tag ${selected[0].Key} removed.` : `Removed ${selected.length} tags.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not remove the tags", e);
    }
    tags.reload(true);
  };

  return (
    <>
      <ResourceTable
        title="Tags"
        variant="container"
        stickyHeader={false}
        global
        resourceName="tags"
        items={tags.data}
        loading={tags.loading}
        error={tags.error}
        onRefresh={() => tags.reload()}
        trackBy={(t) => t.Key ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openAdd}>Add tag</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => void remove()}>
              Remove
            </Button>
            <Button onClick={openAdd}>Add tag</Button>
          </>
        }
        columns={[
          { id: "key", header: "Key", cell: (t) => t.Key, sortingField: "Key", isRowHeader: true },
          { id: "value", header: "Value", cell: (t) => t.Value || "-" },
        ]}
      />
      <FormModal visible={adding} header="Add tag" submitLabel="Save" busy={form.busy} error={form.error} onDismiss={() => setAdding(false)} onSubmit={add}>
        <FormField label="Key" description="A tag with the same key is replaced.">
          <Input value={key} placeholder="team" onChange={(e) => setKey(e.detail.value)} />
        </FormField>
        <FormField label="Value">
          <Input value={value} placeholder="payments" onChange={(e) => setValue(e.detail.value)} />
        </FormField>
      </FormModal>
    </>
  );
}
