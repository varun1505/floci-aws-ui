import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteMessageCommand, DeleteQueueCommand, type Message, PurgeQueueCommand, ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { sqs } from "../../clients/sqs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { duration, epoch, getQueue, queueHref, queueName } from "./sqsutil";

export default function QueueDetail() {
  const [params] = useSearchParams();
  const url = params.get("url") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const queue = useLoad(() => getQueue(url), [url]);
  const send = useSubmit();
  const [body, setBody] = useState("");
  const [groupId, setGroupId] = useState("default");
  const [dedupId, setDedupId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [polling, setPolling] = useState(false);
  const [selected, setSelected] = useState<Message[]>([]);
  const [viewing, setViewing] = useState<Message | undefined>(undefined);
  const [confirm, setConfirm] = useState<"delete" | "purge" | undefined>(undefined);

  const q = queue.data;
  const name = queueName(url);
  const a = q?.attrs ?? {};

  const sendMessage = async () => {
    if (!body) return send.setError("Message body is required.");
    if (q?.fifo && !groupId) return send.setError("Message group ID is required for a FIFO queue.");
    await send.run(async () => {
      const res = await sqs.send(
        new SendMessageCommand({
          QueueUrl: url,
          MessageBody: body,
          ...(q?.fifo ? { MessageGroupId: groupId, MessageDeduplicationId: dedupId || (a.ContentBasedDeduplication === "true" ? undefined : crypto.randomUUID()) } : {}),
        }),
      );
      notify.success(`Your message has been sent and is ready to be received. Message ID: ${res.MessageId}`);
      setBody("");
      queue.reload(true);
    });
  };

  const poll = async () => {
    setPolling(true);
    try {
      // A short visibility timeout keeps the messages readable by the application right after you look at them.
      const res = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, VisibilityTimeout: 5, WaitTimeSeconds: 1, MessageSystemAttributeNames: ["All"], MessageAttributeNames: ["All"] }),
      );
      const got = res.Messages ?? [];
      setMessages((old) => [...got, ...old.filter((m) => !got.some((g) => g.MessageId === m.MessageId))]);
      if (got.length === 0) notify.info("No messages are available right now.");
    } catch (e) {
      notify.error("Could not poll for messages", e);
    }
    setPolling(false);
    queue.reload(true);
  };

  const deleteMessages = async () => {
    try {
      for (const m of selected) await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle }));
      notify.success(`Deleted ${selected.length} message${selected.length === 1 ? "" : "s"}.`);
      setMessages((old) => old.filter((m) => !selected.includes(m)));
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the message. Poll again, then delete it within a few seconds.", e);
    }
    queue.reload(true);
  };

  const act = async () => {
    try {
      if (confirm === "purge") {
        await sqs.send(new PurgeQueueCommand({ QueueUrl: url }));
        notify.success(`Purged ${name}.`);
        setMessages([]);
        queue.reload(true);
      } else {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
        notify.success(`Deleted ${name}.`);
        return navigate("/sqs/queues");
      }
    } catch (e) {
      notify.error(`Could not ${confirm} the queue`, e);
    }
    setConfirm(undefined);
  };

  return (
    <Shell service="sqs" breadcrumbs={[{ text: "Amazon SQS", href: "/sqs/queues" }, { text: "Queues", href: "/sqs/queues" }, { text: name, href: queueHref(url) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => queue.reload()} />
                <Button onClick={() => setConfirm("purge")}>Purge</Button>
                <Button onClick={() => setConfirm("delete")}>Delete</Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {queue.error ? (
          <Alert type="error" header="Could not load the queue">
            {queue.error}
          </Alert>
        ) : !q ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Name">{q.name}</Pair>
                <Pair label="Type">{q.fifo ? "FIFO" : "Standard"}</Pair>
                <Pair label="ARN">
                  <Copy text={q.arn} />
                </Pair>
                <Pair label="URL">
                  <Copy text={q.url} />
                </Pair>
                <Pair label="Created">{formatDate(epoch(a.CreatedTimestamp))}</Pair>
                <Pair label="Last updated">{formatDate(epoch(a.LastModifiedTimestamp))}</Pair>
                <Pair label="Visibility timeout">{duration(a.VisibilityTimeout)}</Pair>
                <Pair label="Message retention period">{duration(a.MessageRetentionPeriod)}</Pair>
                <Pair label="Delivery delay">{duration(a.DelaySeconds)}</Pair>
                <Pair label="Maximum message size">{formatBytes(Number(a.MaximumMessageSize ?? 0))}</Pair>
                <Pair label="Messages available">{a.ApproximateNumberOfMessages}</Pair>
                <Pair label="Messages in flight">{a.ApproximateNumberOfMessagesNotVisible}</Pair>
                {a.RedrivePolicy && <Pair label="Dead-letter queue">{a.RedrivePolicy}</Pair>}
              </ColumnLayout>
            </Container>

            <Container
              header={
                <Header variant="h2" actions={<Button variant="primary" loading={send.busy} onClick={sendMessage}>Send message</Button>}>
                  Send message
                </Header>
              }
            >
              <SpaceBetween size="l">
                <FormField label="Message body" errorText={send.error} stretch>
                  <Textarea value={body} rows={5} placeholder='{"hello": "world"}' onChange={(e) => setBody(e.detail.value)} spellcheck={false} />
                </FormField>
                {q.fifo && (
                  <ColumnLayout columns={2}>
                    <FormField label="Message group ID">
                      <Input value={groupId} onChange={(e) => setGroupId(e.detail.value)} />
                    </FormField>
                    <FormField label="Message deduplication ID - optional">
                      <Input value={dedupId} onChange={(e) => setDedupId(e.detail.value)} />
                    </FormField>
                  </ColumnLayout>
                )}
              </SpaceBetween>
            </Container>

            <Table
              header={
                <Header
                  variant="h2"
                  counter={`(${messages.length})`}
                  description="Polling reads up to 10 messages. They stay in the queue until you delete them."
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button disabled={selected.length !== 1} onClick={() => setViewing(selected[0])}>
                        View details
                      </Button>
                      <Button disabled={selected.length === 0} onClick={deleteMessages}>
                        Delete
                      </Button>
                      <Button variant="primary" loading={polling} onClick={poll}>
                        Poll for messages
                      </Button>
                    </SpaceBetween>
                  }
                >
                  Receive messages
                </Header>
              }
              items={messages}
              trackBy="MessageId"
              selectionType="multi"
              selectedItems={selected}
              onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
              columnDefinitions={[
                { id: "id", header: "ID", cell: (m) => <Button variant="inline-link" onClick={() => setViewing(m)}>{m.MessageId}</Button>, isRowHeader: true },
                { id: "sent", header: "Sent", cell: (m) => formatDate(m.Attributes?.SentTimestamp ? new Date(Number(m.Attributes.SentTimestamp)) : undefined) },
                { id: "size", header: "Size", cell: (m) => formatBytes(new Blob([m.Body ?? ""]).size) },
                { id: "count", header: "Receive count", cell: (m) => m.Attributes?.ApproximateReceiveCount ?? "-" },
                { id: "body", header: "Body", cell: (m) => (m.Body ?? "").slice(0, 80) },
              ]}
              empty={
                <Box textAlign="center" color="inherit">
                  <b>No messages</b>
                  <Box variant="p" color="inherit">
                    To see messages in the queue, poll for messages.
                  </Box>
                </Box>
              }
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <Modal visible={!!viewing} size="large" onDismiss={() => setViewing(undefined)} header={`Message: ${viewing?.MessageId ?? ""}`} footer={<Box float="right"><Button onClick={() => setViewing(undefined)}>Done</Button></Box>}>
        <SpaceBetween size="l">
          <Pair label="Body">
            <JsonBlock value={viewing?.Body} />
          </Pair>
          <Pair label="Attributes">
            <JsonBlock value={JSON.stringify({ ...viewing?.Attributes, ...(viewing?.MessageAttributes ? { MessageAttributes: viewing.MessageAttributes } : {}) })} />
          </Pair>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete
        visible={confirm !== undefined}
        title={confirm === "purge" ? `Purge ${name}` : `Delete ${name}`}
        confirmText={confirm === "purge" ? "purge" : "delete"}
        actionLabel={confirm === "purge" ? "Purge" : "Delete"}
        onCancel={() => setConfirm(undefined)}
        onConfirm={act}
        warning={confirm === "purge" ? "Purging deletes every message in the queue. You can't get them back." : "Deleting a queue also deletes every message in it."}
      />
    </Shell>
  );
}
