import { useState } from "react";
import { CreateReplicationGroupCommand, DeleteReplicationGroupCommand, DescribeReplicationGroupsCommand, type ReplicationGroup } from "@aws-sdk/client-elasticache";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { elasticache } from "../../clients/elasticache";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { CacheStatus, ENGINES, ENGINE_LABEL, NODE_TYPES, connectCommand, validCacheId } from "./cacheutil";

const endpointOf = (g: ReplicationGroup) => g.ConfigurationEndpoint ?? g.NodeGroups?.[0]?.PrimaryEndpoint;
const REPLICATED = ENGINES.filter((e) => e.value !== "memcached");

export default function ReplicationGroups() {
  const notify = useNotify();
  const list = useLoad(async () => (await elasticache.send(new DescribeReplicationGroupsCommand({}))).ReplicationGroups ?? [], []);
  const form = useSubmit();
  const [selected, setSelected] = useState<ReplicationGroup[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [engine, setEngine] = useState("valkey");
  const [nodeType, setNodeType] = useState("cache.t3.micro");

  const openCreate = () => {
    setId("");
    setDescription("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!validCacheId(id)) return form.setError("Start with a letter. Use up to 40 letters, numbers and single hyphens.");
    const ok = await form.run(async () => {
      await elasticache.send(new CreateReplicationGroupCommand({ ReplicationGroupId: id.toLowerCase(), ReplicationGroupDescription: description || id, Engine: engine, CacheNodeType: nodeType }));
      notify.success(`Creating replication group ${id.toLowerCase()}.`);
      list.reload();
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const g of selected) await elasticache.send(new DeleteReplicationGroupCommand({ ReplicationGroupId: g.ReplicationGroupId }));
      notify.success(`Deleting ${selected.length} replication group${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the replication group", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="elasticache" contentType="table" breadcrumbs={[{ text: "ElastiCache", href: "/elasticache/caches" }, { text: "Replication groups", href: "/elasticache/replication-groups" }]}>
      <ResourceTable
        title="Replication groups"
        resourceName="replication groups"
        filterPlaceholder="Find replication groups"
        emptyDescription="Terraform and CloudFormation usually create Redis OSS and Valkey caches as replication groups."
        emptyCli="elasticache create-replication-group --replication-group-id my-cache --replication-group-description my-cache --engine valkey --cache-node-type cache.t3.micro"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(g) => g.ReplicationGroupId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create replication group</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create replication group
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (g) => g.ReplicationGroupId, sortingField: "ReplicationGroupId", isRowHeader: true },
          { id: "description", header: "Description", cell: (g) => g.Description || "-" },
          { id: "status", header: "Status", cell: (g) => <CacheStatus status={g.Status} /> },
          { id: "engine", header: "Engine", cell: (g) => ENGINE_LABEL[g.Engine ?? ""] ?? g.Engine ?? "-" },
          { id: "mode", header: "Cluster mode", cell: (g) => (g.ClusterEnabled ? "Enabled" : "Disabled") },
          { id: "connect", header: "Connect", cell: (g) => <Copy text={connectCommand(g.Engine ?? "redis", endpointOf(g)?.Address, endpointOf(g)?.Port) || undefined} /> },
        ]}
      />
      <FormModal visible={creating} header="Create replication group" submitLabel="Create replication group" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Engine">
          <Select selectedOption={REPLICATED.find((e) => e.value === engine) ?? null} onChange={(e) => setEngine(e.detail.selectedOption.value ?? "valkey")} options={REPLICATED} />
        </FormField>
        <FormField label="Name" constraintText="Up to 40 letters, numbers and hyphens. Must start with a letter.">
          <Input value={id} placeholder="my-cache" onChange={(e) => setId(e.detail.value)} />
        </FormField>
        <FormField label="Description - optional">
          <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
        </FormField>
        <FormField label="Node type">
          <Select selectedOption={NODE_TYPES.find((n) => n.value === nodeType) ?? null} onChange={(e) => setNodeType(e.detail.selectedOption.value ?? "cache.t3.micro")} options={NODE_TYPES} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].ReplicationGroupId}` : `Delete ${selected.length} replication groups`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a replication group deletes all the data in it." />
    </Shell>
  );
}
