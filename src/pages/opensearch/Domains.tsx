import { useState } from "react";
import { CreateDomainCommand, DeleteDomainCommand, type DomainStatus, type OpenSearchPartitionInstanceType } from "@aws-sdk/client-opensearch";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { opensearch } from "../../clients/opensearch";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { DEFAULT_TYPE, DEFAULT_VERSION, DomainState, NAME_ERROR, NAME_RULE, domainPhase, endpointOf, engineLabel, listDomains, listInstanceTypes, listVersions } from "./osutil";

// floci answers CreateDomain only when the container is ready. The dialog waits this long for an error, then closes.
const QUICK_MS = 2500;

export default function Domains() {
  const notify = useNotify();
  const list = useLoad(listDomains, []);
  const versions = useLoad(listVersions, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<DomainStatus[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [starting, setStarting] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [type, setType] = useState(DEFAULT_TYPE);
  const [count, setCount] = useState("1");
  const [size, setSize] = useState("10");
  const types = useLoad(() => listInstanceTypes(version), [version]);

  const openCreate = () => {
    setName("");
    setVersion(versions.data?.includes(DEFAULT_VERSION) ? DEFAULT_VERSION : (versions.data?.[0] ?? DEFAULT_VERSION));
    setType(DEFAULT_TYPE);
    setCount("1");
    setSize("10");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const instances = Number(count);
    const volume = Number(size);
    if (!NAME_RULE.test(name)) return form.setError(NAME_ERROR);
    if (list.data?.some((d) => d.DomainName === name) || starting.includes(name)) return form.setError(`A domain named ${name} already exists.`);
    if (!(Number.isInteger(instances) && instances >= 1 && instances <= 80)) return form.setError("Enter a number of nodes from 1 to 80.");
    if (!(Number.isInteger(volume) && volume >= 10 && volume <= 3584)) return form.setError("Enter an EBS volume size from 10 to 3584 GiB.");
    const domain = name;
    const ok = await form.run(async () => {
      const call = opensearch
        .send(
          new CreateDomainCommand({
            DomainName: domain,
            EngineVersion: version,
            ClusterConfig: { InstanceType: type as OpenSearchPartitionInstanceType, InstanceCount: instances },
            EBSOptions: { EBSEnabled: true, VolumeType: "gp2", VolumeSize: volume },
          }),
        )
        .then(() => "done" as const);
      // A wrong value fails fast, and the form shows it. A good request stays open until the container runs.
      const first = await Promise.race([call, new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), QUICK_MS))]);
      if (first === "done") {
        notify.success(`Domain ${domain} was created.`);
        list.reload(true);
        return;
      }
      setStarting((s) => [...s, domain]);
      notify.info(`floci is starting a container for ${domain}. The domain shows in the list when it is ready.`);
      call
        .then(() => notify.success(`Domain ${domain} is ready.`))
        .catch((e) => notify.error(`Could not confirm that ${domain} started. It can still show up. Refresh the list in a few minutes.`, e))
        .finally(() => {
          setStarting((s) => s.filter((n) => n !== domain));
          list.reload(true);
        });
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const d of selected) await opensearch.send(new DeleteDomainCommand({ DomainName: d.DomainName }));
      notify.success(selected.length === 1 ? `Domain ${selected[0].DomainName} was deleted.` : `Deleted ${selected.length} domains.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the domain", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="opensearch" contentType="table" breadcrumbs={[{ text: "Amazon OpenSearch Service", href: "/opensearch/domains" }, { text: "Domains", href: "/opensearch/domains" }]}>
      <ResourceTable
        title="Domains"
        resourceName="domains"
        filterPlaceholder="Find domains"
        description={starting.length ? <StatusIndicator type="in-progress">Starting {starting.join(", ")}. This can take a few minutes.</StatusIndicator> : undefined}
        emptyDescription="A domain is an OpenSearch cluster. floci runs each one as a real OpenSearch container."
        emptyCli="opensearch create-domain --domain-name my-domain"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(d) => d.DomainName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create domain</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create domain
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (d) => <RouterLink to={`/opensearch/domains/${d.DomainName}`}>{d.DomainName}</RouterLink>, sortingField: "DomainName", isRowHeader: true },
          { id: "status", header: "Domain processing status", cell: (d) => <DomainState domain={d} />, sortingComparator: (a, b) => domainPhase(a).localeCompare(domainPhase(b)) },
          { id: "version", header: "Version", cell: (d) => engineLabel(d.EngineVersion), sortingField: "EngineVersion" },
          { id: "type", header: "Instance type", cell: (d) => d.ClusterConfig?.InstanceType ?? "-" },
          { id: "count", header: "Data nodes", cell: (d) => d.ClusterConfig?.InstanceCount ?? "-" },
          { id: "endpoint", header: "Endpoint", cell: (d) => endpointOf(d) || "-" },
        ]}
      />

      <FormModal visible={creating} header="Create domain" submitLabel="Create domain" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <Alert type="info">floci starts a real OpenSearch container for the domain. The first domain of a version can take about five minutes, because floci downloads the image.</Alert>
        <FormField label="Domain name" constraintText="3 to 28 characters. Starts with a lowercase letter. Lowercase letters, numbers and hyphens.">
          <Input value={name} placeholder="my-domain" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Version" description="Each version uses its own container image.">
          <Select
            selectedOption={{ value: version, label: engineLabel(version) }}
            onChange={(e) => setVersion(e.detail.selectedOption.value ?? version)}
            options={(versions.data ?? [version]).map((v) => ({ value: v, label: engineLabel(v) }))}
            statusType={versions.loading ? "loading" : "finished"}
          />
        </FormField>
        <ColumnLayout columns={2}>
          <FormField label="Instance type">
            <Select
              selectedOption={{ value: type, label: type }}
              onChange={(e) => setType(e.detail.selectedOption.value ?? type)}
              options={(types.data ?? [type]).map((t) => ({ value: t, label: t }))}
              statusType={types.loading ? "loading" : "finished"}
              filteringType="auto"
            />
          </FormField>
          <FormField label="Number of nodes" description="floci still runs one container.">
            <Input type="number" value={count} onChange={(e) => setCount(e.detail.value)} />
          </FormField>
        </ColumnLayout>
        <FormField label="EBS storage size per node (GiB)" constraintText="From 10 to 3584.">
          <Input type="number" value={size} onChange={(e) => setSize(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].DomainName}?` : `Delete ${selected.length} domains?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        This deletes the domain and all of its data. floci stops the container. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
