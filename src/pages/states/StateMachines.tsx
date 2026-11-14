import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateStateMachineCommand, DeleteStateMachineCommand, type StateMachineType } from "@aws-sdk/client-sfn";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { sfn } from "../../clients/sfn";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { RolePicker, isRoleArn } from "../events/RolePicker";
import { type MachineRow, Status, TEMPLATES, jsonObjectError, listMachines, machineHref, typeLabel } from "./sfnutil";

const TYPES = [
  { value: "STANDARD", label: "Standard", description: "Long-running workflows. Every execution keeps its history." },
  { value: "EXPRESS", label: "Express", description: "Short workflows with a high volume, up to five minutes." },
];

export default function StateMachines() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listMachines, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<MachineRow[]>([]);
  const [modal, setModal] = useState<"create" | "delete" | undefined>(undefined);
  const [name, setName] = useState("");
  const [type, setType] = useState("STANDARD");
  const [template, setTemplate] = useState(TEMPLATES[0].value);
  const [definition, setDefinition] = useState(TEMPLATES[0].definition);
  const [role, setRole] = useState("");
  const plural = selected.length === 1 ? "" : "s";

  const openCreate = () => {
    setName("");
    setType("STANDARD");
    setTemplate(TEMPLATES[0].value);
    setDefinition(TEMPLATES[0].definition);
    form.setError("");
    setModal("create");
  };

  const create = async () => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) return form.setError("Use up to 80 letters, numbers, hyphens and underscores in the name.");
    const invalid = jsonObjectError(definition, "The definition");
    if (invalid) return form.setError(invalid);
    if (!isRoleArn(role)) return form.setError("Choose an execution role, or type a role ARN such as arn:aws:iam::000000000000:role/my-role.");
    const ok = await form.run(async () => {
      const res = await sfn.send(new CreateStateMachineCommand({ name, type: type as StateMachineType, definition, roleArn: role }));
      notify.success(`State machine ${name} was created.`);
      navigate(machineHref(res.stateMachineArn ?? ""));
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      for (const m of selected) await sfn.send(new DeleteStateMachineCommand({ stateMachineArn: m.stateMachineArn }));
      notify.success(`Deleted ${selected.length} state machine${plural}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the state machine", e);
    }
    setModal(undefined);
    list.reload();
  };

  return (
    <Shell service="states" contentType="table" breadcrumbs={[{ text: "Step Functions", href: "/states/state-machines" }, { text: "State machines", href: "/states/state-machines" }]}>
      <ResourceTable
        title="State machines"
        resourceName="state machines"
        filterPlaceholder="Search for state machines"
        emptyDescription="A state machine is a workflow. Each step is a state that passes its output to the next one."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(m) => m.stateMachineArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create state machine</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create state machine
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (m) => <RouterLink to={machineHref(m.stateMachineArn ?? "")}>{m.name}</RouterLink>, sortingField: "name", isRowHeader: true },
          { id: "type", header: "Type", cell: (m) => typeLabel(m.type), sortingField: "type" },
          { id: "created", header: "Creation date", cell: (m) => formatDate(m.creationDate), sortingComparator: (a, b) => (a.creationDate?.getTime() ?? 0) - (b.creationDate?.getTime() ?? 0) },
          { id: "status", header: "Status", cell: (m) => <Status status={m.status} />, sortingField: "status" },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create state machine" submitLabel="Create state machine" size="large" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        <FormField label="State machine name" constraintText="Up to 80 letters, numbers, hyphens and underscores.">
          <Input value={name} placeholder="MyStateMachine" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Type" description="You can't change the type after you create the state machine.">
          <Select selectedOption={TYPES.find((t) => t.value === type) ?? TYPES[0]} onChange={(e) => setType(e.detail.selectedOption.value ?? "STANDARD")} options={TYPES} ariaLabel="Type" />
        </FormField>
        <FormField label="Template" description="A starting point. It replaces the definition below.">
          <Select
            selectedOption={{ value: template, label: TEMPLATES.find((t) => t.value === template)?.label }}
            onChange={(e) => {
              const next = TEMPLATES.find((t) => t.value === e.detail.selectedOption.value) ?? TEMPLATES[0];
              setTemplate(next.value);
              setDefinition(next.definition);
            }}
            options={TEMPLATES.map(({ value, label }) => ({ value, label }))}
            ariaLabel="Template"
          />
        </FormField>
        <FormField label="Definition" description="The workflow in Amazon States Language (JSON)." stretch>
          {/* The editor is heavy. Only build it while the dialog is open. A new key shows the template the user picked. */}
          {modal === "create" && <Code key={template} value={definition} onChange={setDefinition} language="json" height={260} ariaLabel="Definition" />}
        </FormField>
        <FormField label="Execution role" description="The role the state machine uses to call other services. Pick one, or type a role ARN.">
          {modal === "create" && <RolePicker value={role} onChange={setRole} />}
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title={`Delete state machine${plural}`} onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].name}</b> : `${selected.length} state machines`} permanently?
      </ConfirmDelete>
    </Shell>
  );
}
