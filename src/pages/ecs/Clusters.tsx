import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Cluster, CreateClusterCommand, DeleteClusterCommand } from "@aws-sdk/client-ecs";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { EcsStatus, NAME_HINT, NAME_RULE, clusterHref, listClusters } from "./ecsutil";

/** ECS refuses to delete a cluster that still has services or tasks. This says what to do about it. */
export function deleteClusterHint(e: unknown): string {
  const name = (e as { name?: string }).name ?? "";
  if (name === "ClusterContainsServicesException") return "The cluster still has services. Delete them first.";
  if (name === "ClusterContainsTasksException") return "The cluster still has running tasks. Stop them first.";
  if (name === "ClusterContainsContainerInstancesException") return "The cluster still has container instances. Deregister them first.";
  return "";
}

export default function Clusters() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listClusters, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Cluster[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");

  const openCreate = () => {
    setName("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!NAME_RULE.test(name)) return form.setError(NAME_HINT);
    // CreateCluster answers with the existing cluster when the name is taken, so check first.
    if (list.data?.some((c) => c.clusterName === name)) return form.setError(`A cluster named ${name} already exists.`);
    const ok = await form.run(async () => {
      await ecs.send(new CreateClusterCommand({ clusterName: name }));
      notify.success(`Cluster ${name} was created.`);
      navigate(clusterHref(name));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    const target = selected[0];
    try {
      await ecs.send(new DeleteClusterCommand({ cluster: target.clusterName }));
      notify.success(`Cluster ${target.clusterName} was deleted.`);
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete cluster ${target.clusterName}. ${deleteClusterHint(e)}`.trim(), e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="ecs" contentType="table" breadcrumbs={[{ text: "Amazon Elastic Container Service", href: "/ecs/clusters" }, { text: "Clusters", href: "/ecs/clusters" }]}>
      <ResourceTable
        title="Clusters"
        resourceName="clusters"
        filterPlaceholder="Search clusters"
        emptyDescription="A cluster groups the services and tasks of an application. On floci, each task runs as real Docker containers."
        emptyCli="ecs create-cluster --cluster-name my-cluster"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(c) => c.clusterArn ?? ""}
        selectionType="single"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create cluster</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create cluster
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Cluster", cell: (c) => <RouterLink to={clusterHref(c.clusterName ?? "")}>{c.clusterName}</RouterLink>, sortingField: "clusterName", isRowHeader: true },
          { id: "status", header: "Status", cell: (c) => <EcsStatus status={c.status} />, sortingField: "status" },
          { id: "services", header: "Services", cell: (c) => c.activeServicesCount ?? 0, sortingField: "activeServicesCount" },
          { id: "running", header: "Running tasks", cell: (c) => c.runningTasksCount ?? 0, sortingField: "runningTasksCount" },
          { id: "pending", header: "Pending tasks", cell: (c) => c.pendingTasksCount ?? 0, sortingField: "pendingTasksCount" },
          { id: "instances", header: "Container instances", cell: (c) => c.registeredContainerInstancesCount ?? 0 },
        ]}
      />

      <FormModal visible={creating} header="Create cluster" submitLabel="Create" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Cluster name" constraintText={NAME_HINT}>
          <Input value={name} placeholder="my-cluster" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title="Delete cluster"
        warning="A cluster can be deleted only when it has no services and no running tasks."
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
      >
        Delete cluster <b>{selected[0]?.clusterName}</b>? This can't be undone.
      </ConfirmDelete>
    </Shell>
  );
}
