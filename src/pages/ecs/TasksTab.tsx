import { useState } from "react";
import { StopTaskCommand, type Task } from "@aws-sdk/client-ecs";
import Button from "@cloudscape-design/components/button";
import Select from "@cloudscape-design/components/select";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { type DesiredStatus, EcsStatus, lastPart, listTasks, taskDefHref, taskHref, usePoll } from "./ecsutil";
import { RunTaskModal } from "./RunTaskModal";

const FILTERS: { value: string; label: string; statuses: DesiredStatus[] }[] = [
  { value: "RUNNING", label: "Running", statuses: ["RUNNING"] },
  { value: "STOPPED", label: "Stopped", statuses: ["STOPPED"] },
  { value: "ANY", label: "Any desired status", statuses: ["RUNNING", "STOPPED"] },
];

/** The Tasks tab of a cluster. */
export function TasksTab({ cluster, onChange }: { cluster: string; onChange: () => void }) {
  const notify = useNotify();
  const [filter, setFilter] = useState(FILTERS[0]);
  const list = useLoad(() => listTasks(cluster, filter.statuses), [cluster, filter.value]);
  const [selected, setSelected] = useState<Task[]>([]);
  const [dialog, setDialog] = useState<"run" | "stop" | undefined>(undefined);
  const stoppable = selected.filter((t) => t.lastStatus !== "STOPPED");

  // Keep reading while a task is still on its way to the status it should have.
  usePoll(!!list.data?.some((t) => t.lastStatus !== t.desiredStatus), list.reload);

  const reload = () => {
    list.reload(true);
    onChange();
  };

  const stop = async () => {
    try {
      for (const t of stoppable) await ecs.send(new StopTaskCommand({ cluster, task: t.taskArn, reason: "Stopped from the console" }));
      notify.success(`Stopped ${stoppable.length} task${stoppable.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not stop the task", e);
    }
    setDialog(undefined);
    reload();
  };

  return (
    <>
      <ResourceTable
        title="Tasks"
        variant="container"
        stickyHeader={false}
        resourceName="tasks"
        filterPlaceholder="Search tasks"
        emptyDescription={filter.value === "RUNNING" ? "No task is running. Choose Stopped to see the tasks that ended." : "A task is one running copy of a task definition."}
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => (list.reload(), onChange())}
        trackBy={(t) => t.taskArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => setDialog("run")}>Run new task</Button>}
        extraFilter={
          <Select
            selectedOption={filter}
            options={FILTERS}
            ariaLabel="Desired status"
            onChange={(e) => {
              setFilter(FILTERS.find((f) => f.value === e.detail.selectedOption.value) ?? FILTERS[0]);
              setSelected([]);
            }}
          />
        }
        actions={
          <>
            <Button disabled={!stoppable.length} onClick={() => setDialog("stop")}>
              Stop
            </Button>
            <Button variant="primary" onClick={() => setDialog("run")}>
              Run new task
            </Button>
          </>
        }
        columns={[
          { id: "id", header: "Task", cell: (t) => <RouterLink to={taskHref(cluster, t.taskArn ?? "")}>{lastPart(t.taskArn)}</RouterLink>, isRowHeader: true },
          { id: "last", header: "Last status", cell: (t) => <EcsStatus status={t.lastStatus} />, sortingField: "lastStatus" },
          { id: "desired", header: "Desired status", cell: (t) => <EcsStatus status={t.desiredStatus} />, sortingField: "desiredStatus" },
          { id: "taskdef", header: "Task definition", cell: (t) => <RouterLink to={taskDefHref(t.taskDefinitionArn ?? "")}>{lastPart(t.taskDefinitionArn)}</RouterLink> },
          { id: "launch", header: "Launch type", cell: (t) => t.launchType ?? "-" },
          { id: "started", header: "Started at", cell: (t) => formatDate(t.startedAt), sortingComparator: (a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0) },
          { id: "group", header: "Group", cell: (t) => t.group ?? "-", sortingField: "group" },
        ]}
      />

      {dialog === "run" && <RunTaskModal cluster={cluster} onDismiss={() => setDialog(undefined)} onDone={reload} />}
      <ConfirmDelete visible={dialog === "stop"} title="Stop tasks" confirmText="stop" actionLabel="Stop" onCancel={() => setDialog(undefined)} onConfirm={stop}>
        Stop {stoppable.length === 1 ? <b>{lastPart(stoppable[0].taskArn)}</b> : `${stoppable.length} tasks`}? Their containers are stopped and removed. A task that belongs to a service is replaced by a new one.
      </ConfirmDelete>
    </>
  );
}
