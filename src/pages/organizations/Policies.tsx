import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreatePolicyCommand, DeletePolicyCommand, DisablePolicyTypeCommand, EnablePolicyTypeCommand, type PolicySummary, type Root } from "@aws-sdk/client-organizations";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { organizations } from "../../clients/organizations";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { OrgGate } from "./OrgGate";
import { SCP, SCP_SAMPLE, checkPolicyJson, listScps, loadOrgState, policyHref, scpsEnabled } from "./orgutil";

/** Shown while service control policies are off. A new root starts with them off. */
function TurnOn({ root, onDone }: { root: Root; onDone: () => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      await organizations.send(new EnablePolicyTypeCommand({ RootId: root.Id, PolicyType: SCP }));
      notify.success("Service control policies are on.");
      onDone();
    } catch (e) {
      notify.error("Could not turn on service control policies", e);
    }
    setBusy(false);
  };
  return (
    <Container>
      <Box textAlign="center" margin={{ vertical: "l" }}>
        <SpaceBetween size="m">
          <div>
            <b>Service control policies are off</b>
            <Box variant="p" color="text-body-secondary">
              A service control policy sets the most an account can do. Turn them on to create policies and attach them to accounts and organizational
              units. floci attaches FullAWSAccess to everything when you do.
            </Box>
          </div>
          <Button variant="primary" loading={busy} onClick={() => void enable()}>
            Turn on service control policies
          </Button>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

function PolicyList({ root, onTypeChanged }: { root: Root; onTypeChanged: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listScps, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<PolicySummary[]>([]);
  const [dialog, setDialog] = useState<"create" | "delete" | "off" | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState(SCP_SAMPLE);

  const openCreate = () => {
    setName("");
    setDescription("");
    setContent(SCP_SAMPLE);
    form.setError("");
    setDialog("create");
  };

  const create = async () => {
    if (!name.trim()) return form.setError("Enter a policy name.");
    const bad = checkPolicyJson(content);
    if (bad) return form.setError(bad);
    const ok = await form.run(async () => {
      const id = (await organizations.send(new CreatePolicyCommand({ Name: name.trim(), Description: description, Content: content, Type: SCP }))).Policy?.PolicySummary?.Id;
      notify.success(`Policy ${name.trim()} was created.`);
      if (id) navigate(policyHref(id));
    });
    if (ok) setDialog(undefined);
  };

  const remove = async () => {
    try {
      for (const p of selected) await organizations.send(new DeletePolicyCommand({ PolicyId: p.Id }));
      notify.success(selected.length === 1 ? `Policy ${selected[0].Name} was deleted.` : `Deleted ${selected.length} policies.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the policy. Detach it from every target first", e);
    }
    setDialog(undefined);
    list.reload();
  };

  const turnOff = async () => {
    try {
      await organizations.send(new DisablePolicyTypeCommand({ RootId: root.Id, PolicyType: SCP }));
      notify.success("Service control policies are off.");
      onTypeChanged();
    } catch (e) {
      notify.error("Could not turn off service control policies", e);
      setDialog(undefined);
    }
  };

  return (
    <>
      <ResourceTable
        title="Service control policies"
        description="The most an account can do. A policy applies to the accounts under the target it is attached to."
        global
        resourceName="policies"
        filterPlaceholder="Find policies"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(p) => p.Id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        isItemDisabled={(p) => !!p.AwsManaged}
        emptyAction={<Button onClick={openCreate}>Create policy</Button>}
        actions={
          <>
            <Button onClick={() => setDialog("off")}>Turn off</Button>
            <Button disabled={!selected.length} onClick={() => setDialog("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create policy
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (p) => <RouterLink to={policyHref(p.Id ?? "")}>{p.Name}</RouterLink>, sortingField: "Name", isRowHeader: true },
          { id: "id", header: "ID", cell: (p) => p.Id },
          { id: "managed", header: "Managed by", cell: (p) => (p.AwsManaged ? "AWS" : "Customer") },
          { id: "description", header: "Description", cell: (p) => p.Description || "-" },
        ]}
      />

      {dialog === "create" && (
        <FormModal visible size="large" header="Create service control policy" submitLabel="Create policy" busy={form.busy} error={form.error} onDismiss={() => setDialog(undefined)} onSubmit={create}>
          <FormField label="Name">
            <Input value={name} placeholder="deny-leaving-organization" onChange={(e) => setName(e.detail.value)} />
          </FormField>
          <FormField label="Description" description="Optional.">
            <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
          </FormField>
          <FormField label="Policy JSON" stretch>
            <Code value={content} onChange={setContent} language="json" height={300} ariaLabel="Policy JSON" />
          </FormField>
        </FormModal>
      )}

      <ConfirmDelete visible={dialog === "delete"} title="Delete policies" warning="floci refuses to delete a policy that is still attached." onCancel={() => setDialog(undefined)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].Name}</b> : `${selected.length} policies`}? This can't be undone.
      </ConfirmDelete>

      <ConfirmDelete
        visible={dialog === "off"}
        title="Turn off service control policies"
        confirmText="turn off"
        actionLabel="Turn off"
        warning="Every service control policy is detached from every account and organizational unit."
        onCancel={() => setDialog(undefined)}
        onConfirm={turnOff}
      >
        Turn off service control policies for the whole organization?
      </ConfirmDelete>
    </>
  );
}

export default function Policies() {
  const state = useLoad(loadOrgState, []);
  return (
    <Shell service="organizations" contentType="table" breadcrumbs={[{ text: "AWS Organizations", href: "/organizations/accounts" }, { text: "Policies", href: "/organizations/policies" }]}>
      <OrgGate state={state}>
        {(_org, root) =>
          scpsEnabled(root) ? (
            <PolicyList root={root} onTypeChanged={() => state.reload()} />
          ) : (
            <SpaceBetween size="l">
              <Header variant="h1">Service control policies</Header>
              <TurnOn root={root} onDone={() => state.reload()} />
            </SpaceBetween>
          )
        }
      </OrgGate>
    </Shell>
  );
}
