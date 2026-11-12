import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateTopicCommand, DeleteTopicCommand } from "@aws-sdk/client-sns";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Tiles from "@cloudscape-design/components/tiles";
import { sns } from "../../clients/sns";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { listTopics, topicHref } from "./snsutil";

type Topic = Awaited<ReturnType<typeof listTopics>>[number];

export default function Topics() {
  const navigate = useNavigate();
  const notify = useNotify();
  const list = useLoad(listTopics, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<Topic[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState("standard");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");

  const openCreate = () => {
    setName("");
    setDisplayName("");
    form.setError("");
    setCreating(true);
  };

  const create = async () => {
    const fifo = type === "fifo";
    const full = fifo && !name.endsWith(".fifo") ? `${name}.fifo` : name;
    if (!/^[a-zA-Z0-9_-]{1,256}(\.fifo)?$/.test(full)) return form.setError("Use letters, numbers, hyphens and underscores.");
    const ok = await form.run(async () => {
      const res = await sns.send(
        new CreateTopicCommand({ Name: full, Attributes: { ...(displayName ? { DisplayName: displayName } : {}), ...(fifo ? { FifoTopic: "true" } : {}) } }),
      );
      notify.success(`Topic ${full} created successfully.`);
      navigate(topicHref(res.TopicArn ?? ""));
    });
    if (ok) setCreating(false);
  };

  const remove = async () => {
    try {
      for (const t of selected) await sns.send(new DeleteTopicCommand({ TopicArn: t.arn }));
      notify.success(`Deleted ${selected.length} topic${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the topic", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="sns" contentType="table" breadcrumbs={[{ text: "Amazon SNS", href: "/sns/topics" }, { text: "Topics", href: "/sns/topics" }]}>
      <ResourceTable
        title="Topics"
        resourceName="topics"
        filterPlaceholder="Search topics"
        emptyDescription="A topic sends each message to every subscriber."
        emptyCli="sns create-topic --name my-topic"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(t) => t.arn}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create topic</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create topic
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (t) => <RouterLink to={topicHref(t.arn)}>{t.name}</RouterLink>, sortingField: "name", isRowHeader: true },
          { id: "type", header: "Type", cell: (t) => (t.fifo ? "FIFO" : "Standard"), sortingField: "fifo" },
          { id: "arn", header: "ARN", cell: (t) => <Copy text={t.arn} /> },
        ]}
      />

      <FormModal visible={creating} size="large" header="Create topic" submitLabel="Create topic" busy={form.busy} error={form.error} onDismiss={() => setCreating(false)} onSubmit={create}>
        <FormField label="Type" description="You can't change the topic type after you create a topic.">
          <Tiles
            value={type}
            onChange={(e) => setType(e.detail.value)}
            items={[
              { value: "standard", label: "Standard", description: "Best-effort message order. Supports SQS, Lambda, HTTP, email and SMS subscribers." },
              { value: "fifo", label: "FIFO (first-in, first-out)", description: "Strict message order. Supports SQS subscribers." },
            ]}
          />
        </FormField>
        <FormField label="Name" constraintText={type === "fifo" ? "A FIFO topic name must end with .fifo. The console adds it for you." : "Letters, numbers, hyphens and underscores."}>
          <Input value={name} placeholder="my-topic" onChange={(e) => setName(e.detail.value)} />
        </FormField>
        <FormField label="Display name - optional">
          <Input value={displayName} onChange={(e) => setDisplayName(e.detail.value)} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting}
        title={selected.length === 1 ? `Delete ${selected[0].name}` : `Delete ${selected.length} topics`}
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
        warning="Deleting a topic also deletes its subscriptions."
      />
    </Shell>
  );
}
