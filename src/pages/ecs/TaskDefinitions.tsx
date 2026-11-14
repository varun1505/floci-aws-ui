import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeregisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import Button from "@cloudscape-design/components/button";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { EcsStatus, listTaskDefArns, splitTaskDef, taskDefHref } from "./ecsutil";
import { TaskDefinitionEditor } from "./TaskDefinitionEditor";

type FamilyRow = { family: string; latest: number; active: number[]; inactive: number[]; status: "ACTIVE" | "INACTIVE" };

/** One row per family, built from the lists of active and inactive revisions. */
async function listFamilies(): Promise<FamilyRow[]> {
  const [active, inactive] = await Promise.all([listTaskDefArns("ACTIVE"), listTaskDefArns("INACTIVE")]);
  const rows = new Map<string, FamilyRow>();
  const add = (arn: string, isActive: boolean) => {
    const { family, revision } = splitTaskDef(arn);
    const row = rows.get(family) ?? { family, latest: 0, active: [], inactive: [], status: "INACTIVE" as const };
    (isActive ? row.active : row.inactive).push(revision);
    rows.set(family, row);
  };
  active.forEach((arn) => add(arn, true));
  inactive.forEach((arn) => add(arn, false));
  return [...rows.values()]
    .map((r): FamilyRow => ({ ...r, status: r.active.length ? "ACTIVE" : "INACTIVE", latest: Math.max(...(r.active.length ? r.active : r.inactive)) }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

export default function TaskDefinitions() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listFamilies, []);
  const [selected, setSelected] = useState<FamilyRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [deregistering, setDeregistering] = useState(false);
  const targets = selected.flatMap((r) => r.active.map((revision) => `${r.family}:${revision}`));

  const deregister = async () => {
    try {
      for (const taskDefinition of targets) await ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition }));
      notify.success(`Deregistered ${targets.length} revision${targets.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not deregister the task definition", e);
    }
    setDeregistering(false);
    list.reload();
  };

  return (
    <Shell service="ecs" contentType="table" breadcrumbs={[{ text: "Amazon Elastic Container Service", href: "/ecs/clusters" }, { text: "Task definitions", href: "/ecs/task-definitions" }]}>
      <ResourceTable
        title="Task definitions"
        resourceName="task definitions"
        filterPlaceholder="Search task definitions"
        emptyDescription="A task definition says which containers a task runs, and with which image, ports and settings."
        emptyCli="ecs register-task-definition --cli-input-json file://task-definition.json"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(r) => r.family}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        isItemDisabled={(r) => !r.active.length}
        emptyAction={<Button onClick={() => setCreating(true)}>Create new task definition</Button>}
        actions={
          <>
            <Button disabled={!targets.length} onClick={() => setDeregistering(true)}>
              Deregister
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create new task definition
            </Button>
          </>
        }
        columns={[
          { id: "family", header: "Task definition", cell: (r) => <RouterLink to={taskDefHref(`${r.family}:${r.latest}`)}>{r.family}</RouterLink>, sortingField: "family", isRowHeader: true },
          { id: "status", header: "Status of last revision", cell: (r) => <EcsStatus status={r.status} />, sortingField: "status" },
          { id: "latest", header: "Latest revision", cell: (r) => r.latest, sortingField: "latest" },
          { id: "active", header: "Active revisions", cell: (r) => r.active.length },
          { id: "inactive", header: "Inactive revisions", cell: (r) => r.inactive.length },
        ]}
      />

      {creating && <TaskDefinitionEditor onDismiss={() => setCreating(false)} onDone={(name) => navigate(taskDefHref(name))} />}

      <ConfirmDelete
        visible={deregistering}
        title="Deregister task definitions"
        confirmText="deregister"
        actionLabel="Deregister"
        warning="Running tasks and services keep working. New tasks and services can't use a deregistered revision."
        onCancel={() => setDeregistering(false)}
        onConfirm={deregister}
      >
        Deregister every active revision of {selected.length === 1 ? <b>{selected[0].family}</b> : `${selected.length} families`}? That is {targets.length} revision{targets.length === 1 ? "" : "s"}.
      </ConfirmDelete>
    </Shell>
  );
}
