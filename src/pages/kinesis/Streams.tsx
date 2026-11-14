import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateStreamCommand, DeleteStreamCommand, type StreamDescriptionSummary } from "@aws-sdk/client-kinesis";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import { kinesis } from "../../clients/kinesis";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { NAME_ERROR, NAME_RULE, StreamState, encryptionLabel, listStreams, modeLabel, retentionLabel } from "./kinesisutil";

export default function Streams() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listStreams, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<StreamDescriptionSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("ON_DEMAND");
  const [shards, setShards] = useState("1");

  const openCreate = () => {
    setName("");
    setMode("ON_DEMAND");
    setShards("1");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    if (!NAME_RULE.test(name)) return form.setError(NAME_ERROR);
    const count = Number(shards);
    if (mode === "PROVISIONED" && !(Number.isInteger(count) && count >= 1 && count <= 10000)) return form.setError("Enter a number of shards from 1 to 10000.");
    const ok = await form.run(async () => {
      if (mode === "PROVISIONED") {
        await kinesis.send(new CreateStreamCommand({ StreamName: name, StreamModeDetails: { StreamMode: "PROVISIONED" }, ShardCount: count }));
      } else {
        await kinesis.send(new CreateStreamCommand({ StreamName: name, StreamModeDetails: { StreamMode: "ON_DEMAND" } }));
      }
      notify.success(`Data stream ${name} was created.`);
      navigate(`/kinesis/streams/${name}`);
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const s of selected) await kinesis.send(new DeleteStreamCommand({ StreamName: s.StreamName, EnforceConsumerDeletion: true }));
      notify.success(selected.length === 1 ? `Data stream ${selected[0].StreamName} was deleted.` : `Deleted ${selected.length} data streams.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the data stream", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="kinesis" contentType="table" breadcrumbs={[{ text: "Amazon Kinesis", href: "/kinesis/streams" }, { text: "Data streams", href: "/kinesis/streams" }]}>
      <ResourceTable
        title="Data streams"
        resourceName="data streams"
        filterPlaceholder="Find data streams"
        emptyDescription="A data stream collects records in order, so applications can read them in real time."
        emptyCli="kinesis create-stream --stream-name my-stream --shard-count 1"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(s) => s.StreamName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create data stream</Button>}
        actions={
          <>
            <Button disabled={!selected.length} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create data stream
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (s) => <RouterLink to={`/kinesis/streams/${s.StreamName}`}>{s.StreamName}</RouterLink>, sortingField: "StreamName", isRowHeader: true },
          { id: "status", header: "Status", cell: (s) => <StreamState state={s.StreamStatus} />, sortingField: "StreamStatus" },
          { id: "mode", header: "Capacity mode", cell: (s) => modeLabel(s.StreamModeDetails?.StreamMode) },
          { id: "shards", header: "Open shards", cell: (s) => s.OpenShardCount ?? "-", sortingField: "OpenShardCount" },
          { id: "retention", header: "Data retention period", cell: (s) => retentionLabel(s.RetentionPeriodHours), sortingField: "RetentionPeriodHours" },
          { id: "encryption", header: "Encryption", cell: (s) => encryptionLabel(s.EncryptionType) },
          { id: "created", header: "Creation time", cell: (s) => formatDate(s.StreamCreationTimestamp), sortingComparator: (a, b) => (a.StreamCreationTimestamp?.getTime() ?? 0) - (b.StreamCreationTimestamp?.getTime() ?? 0) },
        ]}
      />

      <FormModal visible={creating} header="Create data stream" submitLabel="Create data stream" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Data stream name" constraintText="Letters, numbers, underscores, hyphens and periods.">
          <Input value={name} placeholder="my-stream" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Capacity mode">
          <RadioGroup
            value={mode}
            onChange={(e) => setMode(e.detail.value)}
            items={[
              { value: "ON_DEMAND", label: "On-demand", description: "The stream scales by itself. Use this when you do not know the throughput." },
              { value: "PROVISIONED", label: "Provisioned", description: "You set the number of shards." },
            ]}
          />
        </FormField>
        {mode === "PROVISIONED" && (
          <FormField label="Provisioned shards" constraintText="From 1 to 10000.">
            <Input type="number" value={shards} onChange={(e) => setShards(e.detail.value)} />
          </FormField>
        )}
      </FormModal>

      <ConfirmDelete visible={deleting} title={selected.length === 1 ? `Delete ${selected[0].StreamName}?` : `Delete ${selected.length} data streams?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        This deletes the data stream, its records and its consumers. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
