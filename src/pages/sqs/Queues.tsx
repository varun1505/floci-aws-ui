import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateQueueCommand, DeleteQueueCommand, PurgeQueueCommand } from "@aws-sdk/client-sqs";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Tiles from "@cloudscape-design/components/tiles";
import { sqs } from "../../clients/sqs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { type Queue, epoch, listQueues, queueHref } from "./sqsutil";

export default function Queues() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listQueues, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Queue[]>([]);
  const [confirm, setConfirm] = useState<"delete" | "purge" | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState("standard");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("30");
  const [retention, setRetention] = useState("4");
  const [delay, setDelay] = useState("0");
  const [dedup, setDedup] = useState(false);

  const openCreate = () => {
    setName("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const fifo = type === "fifo";
    const full = fifo && !name.endsWith(".fifo") ? `${name}.fifo` : name;
    if (!/^[a-zA-Z0-9_-]{1,80}(\.fifo)?$/.test(full)) return form.setError("Use up to 80 letters, numbers, hyphens and underscores.");
    const ok = await form.run(async () => {
      const res = await sqs.send(
        new CreateQueueCommand({
          QueueName: full,
          Attributes: {
            VisibilityTimeout: visibility || "30",
            MessageRetentionPeriod: String(Math.round(Number(retention || "4") * 86400)),
            DelaySeconds: delay || "0",
            ...(fifo ? { FifoQueue: "true", ContentBasedDeduplication: String(dedup) } : {}),
          },
        }),
      );
      notify.success(`Queue ${full} created successfully.`);
      navigate(queueHref(res.QueueUrl ?? ""));
    });
    if (ok) setCreating(false);
  };

  const act = async () => {
    const what = confirm;
    try {
      for (const q of selected) await sqs.send(what === "purge" ? new PurgeQueueCommand({ QueueUrl: q.url }) : new DeleteQueueCommand({ QueueUrl: q.url }));
      notify.success(what === "purge" ? `Purged ${selected.map((q) => q.name).join(", ")}.` : `Deleted ${selected.length} queue${selected.length === 1 ? "" : "s"}.`);
      if (what === "delete") setSelected([]);
    } catch (e) {
      notify.error(`Could not ${what} the queue`, e);
    }
    setConfirm(undefined);
    list.reload();
  };

  return (
    <Shell service="sqs" contentType="table" breadcrumbs={[{ text: "Amazon SQS", href: "/sqs/queues" }, { text: "Queues", href: "/sqs/queues" }]}>
      <ResourceTable
        title="Queues"
        resourceName="queues"
        filterPlaceholder="Search queues by prefix"
        emptyDescription="A queue holds messages until a consumer reads them."
        emptyCli="sqs create-queue --queue-name my-queue"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(q) => q.url}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create queue</Button>}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => navigate(queueHref(selected[0].url))}>
              Send and receive messages
            </Button>
            <Button disabled={selected.length === 0} onClick={() => setConfirm("purge")}>
              Purge
            </Button>
            <Button disabled={selected.length === 0} onClick={() => setConfirm("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create queue
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (q) => <RouterLink to={queueHref(q.url)}>{q.name}</RouterLink>, sortingField: "name", isRowHeader: true },
          { id: "type", header: "Type", cell: (q) => (q.fifo ? "FIFO" : "Standard"), sortingField: "fifo" },
          { id: "created", header: "Created", cell: (q) => formatDate(epoch(q.attrs.CreatedTimestamp)) },
          { id: "available", header: "Messages available", cell: (q) => q.attrs.ApproximateNumberOfMessages ?? "-" },
          { id: "flight", header: "Messages in flight", cell: (q) => q.attrs.ApproximateNumberOfMessagesNotVisible ?? "-" },
          { id: "dedup", header: "Content-based deduplication", cell: (q) => (q.fifo ? (q.attrs.ContentBasedDeduplication === "true" ? "Enabled" : "Disabled") : "-") },
        ]}
      />

      <FormModal visible={creating} size="large" header="Create queue" submitLabel="Create queue" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Type" description="You can't change the queue type after you create a queue.">
          <Tiles
            value={type}
            onChange={(e) => setType(e.detail.value)}
            items={[
              { value: "standard", label: "Standard", description: "At-least-once delivery. Message order is not kept." },
              { value: "fifo", label: "FIFO", description: "First-in-first-out delivery. Message order is kept. Exactly-once processing." },
            ]}
          />
        </FormField>
        <FormField label="Name" constraintText={type === "fifo" ? "A FIFO queue name must end with .fifo. The console adds it for you." : "Up to 80 letters, numbers, hyphens and underscores."}>
          <Input value={name} placeholder={type === "fifo" ? "my-queue.fifo" : "my-queue"} onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <ColumnLayout columns={3}>
          <FormField label="Visibility timeout" constraintText="Seconds. 0 to 43200.">
            <Input type="number" value={visibility} onChange={(e) => setVisibility(e.detail.value)} />
          </FormField>
          <FormField label="Message retention period" constraintText="Days. Up to 14.">
            <Input type="number" value={retention} onChange={(e) => setRetention(e.detail.value)} />
          </FormField>
          <FormField label="Delivery delay" constraintText="Seconds. 0 to 900.">
            <Input type="number" value={delay} onChange={(e) => setDelay(e.detail.value)} />
          </FormField>
        </ColumnLayout>
        {type === "fifo" && (
          <Checkbox checked={dedup} onChange={(e) => setDedup(e.detail.checked)}>
            Content-based deduplication
          </Checkbox>
        )}
      </FormModal>

      <ConfirmDelete
        visible={confirm !== undefined}
        title={confirm === "purge" ? "Purge queue" : selected.length === 1 ? `Delete ${selected[0]?.name}` : `Delete ${selected.length} queues`}
        confirmText={confirm === "purge" ? "purge" : "delete"}
        actionLabel={confirm === "purge" ? "Purge" : "Delete"}
        onCancel={() => setConfirm(undefined)}
        onConfirm={act}
        warning={confirm === "purge" ? "Purging deletes every message in the queue. You can't get them back." : "Deleting a queue also deletes every message in it."}
      />
    </Shell>
  );
}
