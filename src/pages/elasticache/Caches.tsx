import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type CacheCluster, CreateCacheClusterCommand, DeleteCacheClusterCommand, DescribeCacheClustersCommand } from "@aws-sdk/client-elasticache";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { elasticache } from "../../clients/elasticache";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { CacheStatus, ENGINES, ENGINE_LABEL, NODE_TYPES, isSettled, validCacheId } from "./cacheutil";

export async function listCaches(): Promise<CacheCluster[]> {
  const out: CacheCluster[] = [];
  let Marker: string | undefined;
  do {
    const res = await elasticache.send(new DescribeCacheClustersCommand({ Marker, ShowCacheNodeInfo: true }));
    out.push(...(res.CacheClusters ?? []));
    Marker = res.Marker;
  } while (Marker);
  return out;
}

export const cacheEndpoint = (c: CacheCluster) => c.CacheNodes?.[0]?.Endpoint ?? c.ConfigurationEndpoint;

export default function Caches() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listCaches, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<CacheCluster[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [engine, setEngine] = useState("valkey");
  const [nodeType, setNodeType] = useState("cache.t3.micro");

  // Keep refreshing while a cache is being created or deleted.
  const busy = (list.data ?? []).some((c) => !isSettled(c.CacheClusterStatus));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => list.reload(true), 3000);
    return () => clearInterval(timer);
  }, [busy, list.reload]);

  const openCreate = () => {
    setId("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!validCacheId(id)) return form.setError("Start with a letter. Use up to 40 letters, numbers and single hyphens.");
    const ok = await form.run(async () => {
      await elasticache.send(new CreateCacheClusterCommand({ CacheClusterId: id.toLowerCase(), Engine: engine, CacheNodeType: nodeType, NumCacheNodes: 1 }));
      notify.success(`Creating cache ${id.toLowerCase()}.`);
      navigate(`/elasticache/caches/${id.toLowerCase()}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const c of selected) await elasticache.send(new DeleteCacheClusterCommand({ CacheClusterId: c.CacheClusterId }));
      notify.success(`Deleting ${selected.length} cache${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the cache", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="elasticache" contentType="table" breadcrumbs={[{ text: "ElastiCache", href: "/elasticache/caches" }, { text: "Caches", href: "/elasticache/caches" }]}>
      <ResourceTable
        title="Caches"
        resourceName="caches"
        filterPlaceholder="Find caches"
        emptyDescription="A cache is an in-memory data store for sessions, queues and fast lookups."
        emptyCli="elasticache create-cache-cluster --cache-cluster-id my-cache --engine valkey --cache-node-type cache.t3.micro --num-cache-nodes 1"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(c) => c.CacheClusterId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create cache</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create cache
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (c) => <RouterLink to={`/elasticache/caches/${c.CacheClusterId}`}>{c.CacheClusterId}</RouterLink>, sortingField: "CacheClusterId", isRowHeader: true },
          { id: "status", header: "Status", cell: (c) => <CacheStatus status={c.CacheClusterStatus} />, sortingField: "CacheClusterStatus" },
          { id: "engine", header: "Engine", cell: (c) => ENGINE_LABEL[c.Engine ?? ""] ?? c.Engine ?? "-", sortingField: "Engine" },
          { id: "version", header: "Engine version", cell: (c) => c.EngineVersion ?? "-" },
          { id: "type", header: "Node type", cell: (c) => c.CacheNodeType ?? "-" },
          { id: "nodes", header: "Nodes", cell: (c) => c.NumCacheNodes ?? "-" },
          { id: "endpoint", header: "Endpoint", cell: (c) => (cacheEndpoint(c) ? `${cacheEndpoint(c)?.Address}:${cacheEndpoint(c)?.Port}` : "-") },
        ]}
      />
      <FormModal visible={creating} header="Create cache" submitLabel="Create cache" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Engine">
          <Select selectedOption={ENGINES.find((e) => e.value === engine) ?? null} onChange={(e) => setEngine(e.detail.selectedOption.value ?? "valkey")} options={ENGINES} />
        </FormField>
        <FormField label="Name" constraintText="Up to 40 letters, numbers and hyphens. Must start with a letter.">
          <Input value={id} placeholder="my-cache" onChange={(e) => setId(e.detail.value)} />
        </FormField>
        <FormField label="Node type" description="In this environment every cache runs as one container. The node type is recorded but does not change its size.">
          <Select selectedOption={NODE_TYPES.find((n) => n.value === nodeType) ?? null} onChange={(e) => setNodeType(e.detail.selectedOption.value ?? "cache.t3.micro")} options={NODE_TYPES} />
        </FormField>
      </FormModal>
      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].CacheClusterId}` : `Delete ${selected.length} caches`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a cache deletes all the data in it." />
    </Shell>
  );
}
