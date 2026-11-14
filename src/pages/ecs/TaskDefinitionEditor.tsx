import { useState } from "react";
import { type NetworkMode, RegisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import { ecs } from "../../clients/ecs";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listRoles } from "../iam/iamutil";
import { ContainerForm } from "./ContainerForm";
import { NAME_HINT, lastPart } from "./ecsutil";
import { type Def, clean, defProblem, emptyContainer, emptyDef, parseDef } from "./taskdef";

const NETWORK_MODES = ["awsvpc", "bridge", "host", "none"].map((value) => ({ value, label: value }));
const NO_ROLE = { value: "", label: "None" };

/**
 * The dialog that registers a task definition. It has a form and a JSON tab over the same definition.
 * Mount it only while it is open. `initial` fills it for a new revision.
 */
export function TaskDefinitionEditor({ initial, onDismiss, onDone }: { initial?: Def; onDismiss: () => void; onDone: (arn: string) => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const roles = useLoad(listRoles, []);
  const [def, setDef] = useState<Def>(initial ?? emptyDef());
  const [tab, setTab] = useState("form");
  const [text, setText] = useState("");
  const set = (patch: Partial<Def>) => setDef((d) => ({ ...d, ...patch }));
  const compat = def.requiresCompatibilities ?? [];
  const fargate = compat.includes("FARGATE");
  const containers = def.containerDefinitions ?? [];
  const roleOptions = [NO_ROLE, ...(roles.data ?? []).map((r) => ({ value: r.Arn ?? "", label: r.RoleName ?? "" }))];
  const roleOption = (arn?: string) => (arn ? (roleOptions.find((o) => o.value === arn) ?? { value: arn, label: lastPart(arn) }) : NO_ROLE);

  const toggleCompat = (type: "FARGATE" | "EC2", on: boolean) => {
    const next = on ? [...compat, type] : compat.filter((c) => c !== type);
    // Fargate works only with the awsvpc network mode.
    set({ requiresCompatibilities: next, networkMode: next.includes("FARGATE") ? "awsvpc" : def.networkMode });
  };

  // The two tabs edit one definition. Moving between them carries the changes over.
  const switchTab = (next: string) => {
    if (next === "json") {
      setText(JSON.stringify(clean(def), null, 2));
    } else {
      const parsed = parseDef(text);
      if (typeof parsed === "string") return form.setError(parsed);
      setDef(parsed);
    }
    form.setError("");
    setTab(next);
  };

  const register = async () => {
    const parsed = tab === "json" ? parseDef(text) : def;
    if (typeof parsed === "string") return form.setError(parsed);
    const input = clean(parsed);
    if (defProblem(input)) return form.setError(defProblem(input));
    const ok = await form.run(async () => {
      const res = await ecs.send(new RegisterTaskDefinitionCommand(input));
      const name = lastPart(res.taskDefinition?.taskDefinitionArn);
      notify.success(`Task definition ${name} was registered.`);
      onDone(name);
    });
    if (ok) onDismiss();
  };

  const formTab = (
    <SpaceBetween size="l">
      <FormField label="Task definition family" description="A new revision is added when the family already exists." constraintText={NAME_HINT}>
        <Input value={def.family ?? ""} placeholder="my-task" onChange={(e) => set({ family: e.detail.value })} />
      </FormField>
      <ColumnLayout columns={2}>
        <FormField label="Launch type" description="Where the task definition is allowed to run.">
          <SpaceBetween direction="horizontal" size="l">
            <Checkbox checked={fargate} onChange={(e) => toggleCompat("FARGATE", e.detail.checked)}>
              AWS Fargate
            </Checkbox>
            <Checkbox checked={compat.includes("EC2")} onChange={(e) => toggleCompat("EC2", e.detail.checked)}>
              Amazon EC2 instances
            </Checkbox>
          </SpaceBetween>
        </FormField>
        <FormField label="Network mode" description={fargate ? "Fargate always uses awsvpc." : "awsvpc gives each task its own network interface."}>
          <Select
            selectedOption={{ value: def.networkMode ?? "bridge", label: def.networkMode ?? "bridge" }}
            options={NETWORK_MODES}
            disabled={fargate}
            onChange={(e) => set({ networkMode: e.detail.selectedOption.value as NetworkMode })}
          />
        </FormField>
        <FormField label="Task CPU" description="In CPU units. 1024 is one vCPU." constraintText={fargate ? "Fargate takes fixed pairs, such as 256 with 512." : "Optional."}>
          <Input value={def.cpu ?? ""} placeholder="256" onChange={(e) => set({ cpu: e.detail.value })} />
        </FormField>
        <FormField label="Task memory" description="In MiB.">
          <Input value={def.memory ?? ""} placeholder="512" onChange={(e) => set({ memory: e.detail.value })} />
        </FormField>
        <FormField label="Task role - optional" description="The role the code in the containers uses to call AWS.">
          <Select selectedOption={roleOption(def.taskRoleArn)} options={roleOptions} filteringType="auto" statusType={roles.loading ? "loading" : "finished"} onChange={(e) => set({ taskRoleArn: e.detail.selectedOption.value })} />
        </FormField>
        <FormField label="Task execution role - optional" description="The role ECS uses to pull images and write logs.">
          <Select
            selectedOption={roleOption(def.executionRoleArn)}
            options={roleOptions}
            filteringType="auto"
            statusType={roles.loading ? "loading" : "finished"}
            onChange={(e) => set({ executionRoleArn: e.detail.selectedOption.value })}
          />
        </FormField>
      </ColumnLayout>
      {containers.map((c, i) => (
        <ContainerForm
          key={i}
          index={i}
          value={c}
          family={def.family ?? ""}
          onChange={(next) => set({ containerDefinitions: containers.map((old, n) => (n === i ? next : old)) })}
          onRemove={containers.length > 1 ? () => set({ containerDefinitions: containers.filter((_, n) => n !== i) }) : undefined}
        />
      ))}
      <Button onClick={() => set({ containerDefinitions: [...containers, emptyContainer()] })}>Add container</Button>
    </SpaceBetween>
  );

  return (
    <FormModal
      visible
      size="max"
      header={initial ? `Create new revision of ${initial.family}` : "Create new task definition"}
      submitLabel="Create"
      busy={form.busy}
      error={form.error}
      onDismiss={onDismiss}
      onSubmit={register}
    >
      <Tabs
        activeTabId={tab}
        onChange={(e) => switchTab(e.detail.activeTabId)}
        tabs={[
          { id: "form", label: "Form", content: formTab },
          {
            id: "json",
            label: "JSON",
            content: (
              <FormField label="Task definition JSON" description="The same JSON as aws ecs register-task-definition --cli-input-json. Fields the form does not show are kept." stretch>
                <Code value={text} onChange={setText} language="json" height={480} ariaLabel="Task definition JSON" />
              </FormField>
            ),
          },
        ]}
      />
    </FormModal>
  );
}
