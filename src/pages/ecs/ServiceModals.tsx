import { useState } from "react";
import { CreateServiceCommand, type Service, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { ecs } from "../../clients/ecs";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { NAME_HINT, NAME_RULE, lastPart } from "./ecsutil";
import { ClusterPicker, LaunchFields, TaskDefPicker, useLaunch } from "./launch";

const countProblem = (text: string) => (Number.isInteger(Number(text)) && text.trim() !== "" && Number(text) >= 0 ? "" : "Enter a number of tasks, 0 or more.");

/** The "Create service" dialog. Mount it only while it is open. Without `cluster` it asks for one. */
export function CreateServiceModal({ cluster, taskDef = "", onDismiss, onDone }: { cluster?: string; taskDef?: string; onDismiss: () => void; onDone: (cluster: string) => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [clusterName, setClusterName] = useState(cluster ?? "");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(taskDef);
  const [count, setCount] = useState("1");
  const launch = useLaunch(definition);

  const create = async () => {
    if (!clusterName) return form.setError("Choose a cluster.");
    if (!NAME_RULE.test(name)) return form.setError(`Service name: ${NAME_HINT}`);
    if (!definition) return form.setError("Choose a task definition.");
    if (countProblem(count)) return form.setError(countProblem(count));
    if (launch.problem()) return form.setError(launch.problem());
    const ok = await form.run(async () => {
      await ecs.send(
        new CreateServiceCommand({
          cluster: clusterName,
          serviceName: name,
          taskDefinition: definition,
          desiredCount: Number(count),
          launchType: launch.launchType,
          networkConfiguration: launch.networkConfiguration(),
        }),
      );
      notify.success(`Service ${name} was created. Its tasks start in a few seconds.`);
      onDone(clusterName);
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible header="Create service" submitLabel="Create" size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={create}>
      {!cluster && <ClusterPicker value={clusterName} onChange={setClusterName} />}
      <FormField label="Service name" constraintText={NAME_HINT}>
        <Input value={name} placeholder="my-service" onChange={(e) => setName(e.detail.value)} />
      </FormField>
      <TaskDefPicker value={definition} onChange={setDefinition} />
      <FormField label="Desired tasks" description="The service keeps this many tasks running. It starts a new task when one stops.">
        <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
      </FormField>
      <LaunchFields launch={launch} />
    </FormModal>
  );
}

/** The "Update service" dialog. Mount it only while it is open. */
export function UpdateServiceModal({ cluster, service, onDismiss, onDone }: { cluster: string; service: Service; onDismiss: () => void; onDone: () => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [definition, setDefinition] = useState(lastPart(service.taskDefinition));
  const [count, setCount] = useState(String(service.desiredCount ?? 0));
  const [force, setForce] = useState(false);

  const update = async () => {
    if (!definition) return form.setError("Choose a task definition.");
    if (countProblem(count)) return form.setError(countProblem(count));
    const ok = await form.run(async () => {
      await ecs.send(new UpdateServiceCommand({ cluster, service: service.serviceName, taskDefinition: definition, desiredCount: Number(count), forceNewDeployment: force || undefined }));
      notify.success(`Service ${service.serviceName} was updated.`);
      onDone();
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible header={`Update ${service.serviceName}`} submitLabel="Update" size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={update}>
      <TaskDefPicker value={definition} onChange={setDefinition} />
      <FormField label="Desired tasks" description="Set 0 to stop every task of the service.">
        <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
      </FormField>
      <Checkbox checked={force} onChange={(e) => setForce(e.detail.checked)} description="Replaces the running tasks with new ones, even when nothing else changed.">
        Force new deployment
      </Checkbox>
    </FormModal>
  );
}
