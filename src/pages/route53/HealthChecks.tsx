import { useState } from "react";
import {
  ChangeTagsForResourceCommand,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  GetHealthCheckStatusCommand,
  type HealthCheck,
  type HealthCheckConfig,
  type HealthCheckType,
  ListTagsForResourceCommand,
} from "@aws-sdk/client-route-53";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { route53 } from "../../clients/route53";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { callerReference, listHealthChecks } from "./route53util";

type Row = HealthCheck & { name?: string; healthy?: boolean };

const PORTS: Record<string, string> = { HTTP: "80", HTTPS: "443", TCP: "80" };
const INTERVALS = [
  { value: "30", label: "Standard (30 seconds)" },
  { value: "10", label: "Fast (10 seconds)" },
];
const IP = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]*:[0-9a-fA-F:]*)$/;

/** Every health check with its Name tag and its status. Each needs two more calls. */
async function loadChecks(): Promise<Row[]> {
  const checks = await listHealthChecks();
  return Promise.all(
    checks.map(async (c) => {
      const [tags, status] = await Promise.all([
        route53.send(new ListTagsForResourceCommand({ ResourceType: "healthcheck", ResourceId: c.Id })).catch(() => undefined),
        route53.send(new GetHealthCheckStatusCommand({ HealthCheckId: c.Id })).catch(() => undefined),
      ]);
      const seen = status?.HealthCheckObservations ?? [];
      return {
        ...c,
        name: tags?.ResourceTagSet?.Tags?.find((t) => t.Key === "Name")?.Value,
        healthy: seen.length ? seen.every((o) => o.StatusReport?.Status?.startsWith("Success")) : undefined,
      };
    }),
  );
}

export default function HealthChecks() {
  const notify = useNotify();
  const list = useLoad(loadChecks, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Row[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("HTTP");
  const [endpoint, setEndpoint] = useState("");
  const [port, setPort] = useState("80");
  const [path, setPath] = useState("");
  const [interval, setIntervalValue] = useState("30");
  const [threshold, setThreshold] = useState("3");
  const web = type !== "TCP";

  const openCreate = () => {
    setName("");
    setType("HTTP");
    setEndpoint("");
    setPort("80");
    setPath("");
    setIntervalValue("30");
    setThreshold("3");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const host = endpoint.trim();
    const p = Number(port);
    const t = Number(threshold);
    if (!host || /[\s/]/.test(host)) return form.setError("Enter a domain name or an IP address, without a protocol or a path.");
    if (!(Number.isInteger(p) && p >= 1 && p <= 65535)) return form.setError("Enter a port from 1 to 65535.");
    if (!(Number.isInteger(t) && t >= 1 && t <= 10)) return form.setError("Enter a failure threshold from 1 to 10.");
    const config: HealthCheckConfig = { Type: type as HealthCheckType, Port: p, RequestInterval: Number(interval), FailureThreshold: t };
    if (IP.test(host)) config.IPAddress = host;
    else config.FullyQualifiedDomainName = host;
    if (web && path.trim()) config.ResourcePath = `/${path.trim().replace(/^\//, "")}`;
    const ok = await form.run(async () => {
      const res = await route53.send(new CreateHealthCheckCommand({ CallerReference: callerReference(), HealthCheckConfig: config }));
      const id = res.HealthCheck?.Id ?? "";
      if (name.trim()) await route53.send(new ChangeTagsForResourceCommand({ ResourceType: "healthcheck", ResourceId: id, AddTags: [{ Key: "Name", Value: name.trim() }] }));
      notify.success(`Health check ${id} was successfully created.`);
      list.reload();
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const c of selected) await route53.send(new DeleteHealthCheckCommand({ HealthCheckId: c.Id }));
      notify.success(`Deleted ${selected.length} health check${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the health check", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="route53" contentType="table" breadcrumbs={[{ text: "Route 53", href: "/route53/hosted-zones" }, { text: "Health checks", href: "/route53/health-checks" }]}>
      <ResourceTable
        global
        title="Health checks"
        description="The emulator stores health checks but does not call the endpoint. Every health check reports as healthy."
        resourceName="health checks"
        filterPlaceholder="Filter health checks by name or ID"
        emptyDescription="A health check watches an endpoint, such as a web server."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(c) => c.Id ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create health check</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create health check
            </Button>
          </>
        }
        columns={[
          { id: "id", header: "ID", cell: (c) => <Copy text={c.Id} />, sortingField: "Id", isRowHeader: true },
          { id: "name", header: "Name", cell: (c) => c.name || "-", sortingField: "name" },
          { id: "type", header: "Type", cell: (c) => c.HealthCheckConfig?.Type ?? "-" },
          { id: "endpoint", header: "Endpoint", cell: (c) => c.HealthCheckConfig?.FullyQualifiedDomainName ?? c.HealthCheckConfig?.IPAddress ?? "-" },
          { id: "port", header: "Port", cell: (c) => c.HealthCheckConfig?.Port ?? "-" },
          { id: "path", header: "Path", cell: (c) => c.HealthCheckConfig?.ResourcePath ?? "-" },
          {
            id: "status",
            header: "Status",
            cell: (c) => (c.healthy === undefined ? "-" : <StatusIndicator type={c.healthy ? "success" : "error"}>{c.healthy ? "Healthy" : "Unhealthy"}</StatusIndicator>),
          },
        ]}
      />

      <FormModal visible={creating} header="Create health check" submitLabel="Create health check" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Name - optional" description="Saved as a tag with the key Name.">
          <Input value={name} placeholder="my-health-check" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Protocol">
          <Select
            selectedOption={{ value: type, label: type }}
            onChange={(e) => {
              const next = e.detail.selectedOption.value ?? "HTTP";
              setType(next);
              setPort(PORTS[next]);
            }}
            options={Object.keys(PORTS).map((value) => ({ value, label: value }))}
          />
        </FormField>
        <FormField label="Domain name or IP address">
          <Input value={endpoint} placeholder="www.example.com" onChange={(e) => setEndpoint(e.detail.value)} />
        </FormField>
        <FormField label="Port">
          <Input type="number" value={port} onChange={(e) => setPort(e.detail.value)} />
        </FormField>
        {web && (
          <FormField label="Path - optional">
            <Input value={path} placeholder="/health" onChange={(e) => setPath(e.detail.value)} />
          </FormField>
        )}
        <FormField label="Request interval">
          <Select selectedOption={INTERVALS.find((i) => i.value === interval) ?? INTERVALS[0]} onChange={(e) => setIntervalValue(e.detail.selectedOption.value ?? "30")} options={INTERVALS} />
        </FormField>
        <FormField label="Failure threshold" constraintText="From 1 to 10.">
          <Input type="number" value={threshold} onChange={(e) => setThreshold(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={`Delete ${selected.length} health check${selected.length === 1 ? "" : "s"}`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="You can't undo this."
      />
    </Shell>
  );
}
