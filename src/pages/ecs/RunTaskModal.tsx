import { useState } from "react";
import { RunTaskCommand, type Task } from "@aws-sdk/client-ecs";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { ecs } from "../../clients/ecs";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { ClusterPicker, LaunchFields, TaskDefPicker, useLaunch } from "./launch";

/** Turns "sh,-c,echo hi" into ["sh", "-c", "echo hi"], the way the AWS console reads a command. */
export const splitCommand = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * The "Run task" dialog. Mount it only while it is open, so it starts clean each time.
 * Without `cluster` it asks for one.
 */
export function RunTaskModal({ cluster, taskDef = "", onDismiss, onDone }: { cluster?: string; taskDef?: string; onDismiss: () => void; onDone: (cluster: string, tasks: Task[]) => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [clusterName, setClusterName] = useState(cluster ?? "");
  const [definition, setDefinition] = useState(taskDef);
  const [count, setCount] = useState("1");
  const [container, setContainer] = useState("");
  const [command, setCommand] = useState("");
  const launch = useLaunch(definition);
  const containers = (launch.def?.containerDefinitions ?? []).map((c) => c.name ?? "");
  const target = containers.includes(container) ? container : (containers[0] ?? "");

  const run = async () => {
    const n = Number(count);
    if (!clusterName) return form.setError("Choose a cluster.");
    if (!definition) return form.setError("Choose a task definition.");
    if (!Number.isInteger(n) || n < 1 || n > 10) return form.setError("Enter a number of tasks from 1 to 10.");
    if (launch.problem()) return form.setError(launch.problem());
    const ok = await form.run(async () => {
      const args = splitCommand(command);
      const res = await ecs.send(
        new RunTaskCommand({
          cluster: clusterName,
          taskDefinition: definition,
          count: n,
          launchType: launch.launchType,
          networkConfiguration: launch.networkConfiguration(),
          overrides: args.length ? { containerOverrides: [{ name: target, command: args }] } : undefined,
        }),
      );
      if (res.failures?.length) throw new Error(res.failures.map((f) => f.reason ?? f.detail ?? "Unknown failure").join(", "));
      const tasks = res.tasks ?? [];
      notify.success(`Started ${tasks.length} task${tasks.length === 1 ? "" : "s"} from ${definition}.`);
      onDone(clusterName, tasks);
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible header="Run task" submitLabel="Create" size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={run}>
      {!cluster && <ClusterPicker value={clusterName} onChange={setClusterName} />}
      <TaskDefPicker value={definition} onChange={setDefinition} />
      <FormField label="Desired tasks" description="How many copies of the task to start. Each one starts real containers on the floci host." constraintText="From 1 to 10.">
        <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
      </FormField>
      <LaunchFields launch={launch} />
      <ColumnLayout columns={2}>
        <FormField label="Container to override - optional">
          <Select
            selectedOption={target ? { value: target, label: target } : null}
            options={containers.map((c) => ({ value: c, label: c }))}
            placeholder="Choose a task definition first"
            disabled={!containers.length}
            onChange={(e) => setContainer(e.detail.selectedOption.value ?? "")}
          />
        </FormField>
        <FormField label="Command override - optional" description="Comma separated. Leave empty to run the command of the task definition.">
          <Input value={command} placeholder="sh,-c,echo hello" disabled={!containers.length} onChange={(e) => setCommand(e.detail.value)} />
        </FormField>
      </ColumnLayout>
    </FormModal>
  );
}
