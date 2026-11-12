import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteTopicCommand, GetTopicAttributesCommand, ListSubscriptionsByTopicCommand, PublishCommand, SubscribeCommand, type Subscription, UnsubscribeCommand } from "@aws-sdk/client-sns";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import { sns } from "../../clients/sns";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { PROTOCOLS, subscriptionId, topicHref, topicName } from "./snsutil";

const HINT: Record<string, string> = { http: "http://my-service:8080/hook", https: "https://example.com/hook", email: "name@example.com", sms: "+911234567890" };

export default function TopicDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const name = topicName(arn);
  const fifo = arn.endsWith(".fifo");
  const navigate = useNavigate();
  const notify = useNotify();
  const topic = useLoad(async () => (await sns.send(new GetTopicAttributesCommand({ TopicArn: arn }))).Attributes ?? {}, [arn]);
  const subs = useLoad(async () => (await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn }))).Subscriptions ?? [], [arn]);
  // Queues and functions are the usual subscribers. Offer them by name instead of asking for an ARN.
  const targets = useLoad(async () => {
    const [queues, functions] = await Promise.all([
      import("../sqs/sqsutil").then((m) => m.listQueues()).catch(() => []),
      import("../lambda/Functions").then((m) => m.listAllFunctions()).catch(() => []),
    ]);
    return {
      sqs: queues.map((q) => ({ label: q.name, value: q.arn })),
      lambda: functions.map((f) => ({ label: f.FunctionName ?? "", value: f.FunctionArn ?? "" })),
    } as Record<string, { label: string; value: string }[]>;
  }, []);
  const form = useSubmit();
  const [modal, setModal] = useState<"subscribe" | "publish" | undefined>(undefined);
  const [protocol, setProtocol] = useState("sqs");
  const [endpoint, setEndpoint] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [groupId, setGroupId] = useState("default");
  const [selected, setSelected] = useState<Subscription[]>([]);
  const [deleting, setDeleting] = useState<"topic" | "subscription" | undefined>(undefined);

  const open = (which: "subscribe" | "publish") => {
    form.setError("");
    setEndpoint("");
    setModal(which);
  };

  const subscribe = async () => {
    if (!endpoint) return form.setError("Endpoint is required.");
    const ok = await form.run(async () => {
      await sns.send(new SubscribeCommand({ TopicArn: arn, Protocol: protocol, Endpoint: endpoint, ReturnSubscriptionArn: true }));
      notify.success("Subscription created successfully.");
      subs.reload(true);
      topic.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const publish = async () => {
    if (!message) return form.setError("Message body is required.");
    const ok = await form.run(async () => {
      const res = await sns.send(
        new PublishCommand({ TopicArn: arn, Message: message, Subject: subject || undefined, ...(fifo ? { MessageGroupId: groupId, MessageDeduplicationId: crypto.randomUUID() } : {}) }),
      );
      notify.success(`Message published to topic ${name}. Message ID: ${res.MessageId}`);
    });
    if (ok) setModal(undefined);
  };

  const remove = async () => {
    try {
      if (deleting === "topic") {
        await sns.send(new DeleteTopicCommand({ TopicArn: arn }));
        notify.success(`Deleted ${name}.`);
        return navigate("/sns/topics");
      }
      for (const s of selected) await sns.send(new UnsubscribeCommand({ SubscriptionArn: s.SubscriptionArn }));
      notify.success("Subscription deleted.");
      setSelected([]);
    } catch (e) {
      notify.error(`Could not delete the ${deleting}`, e);
    }
    setDeleting(undefined);
    subs.reload(true);
  };

  const a = topic.data;
  const options = targets.data?.[protocol];

  return (
    <Shell service="sns" breadcrumbs={[{ text: "Amazon SNS", href: "/sns/topics" }, { text: "Topics", href: "/sns/topics" }, { text: name, href: topicHref(arn) }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (topic.reload(), subs.reload())} />
                <Button onClick={() => setDeleting("topic")}>Delete</Button>
                <Button variant="primary" onClick={() => open("publish")}>
                  Publish message
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {topic.error ? (
          <Alert type="error" header="Could not load the topic">
            {topic.error}
          </Alert>
        ) : !a ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Name">{name}</Pair>
                <Pair label="ARN">
                  <Copy text={arn} />
                </Pair>
                <Pair label="Type">{fifo ? "FIFO" : "Standard"}</Pair>
                <Pair label="Display name">{a.DisplayName}</Pair>
                <Pair label="Topic owner">{a.Owner}</Pair>
                <Pair label="Confirmed subscriptions">{a.SubscriptionsConfirmed}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "subscriptions",
                  label: "Subscriptions",
                  content: (
                    <Table
                      header={
                        <Header
                          variant="h2"
                          counter={`(${subs.data?.length ?? 0})`}
                          actions={
                            <SpaceBetween direction="horizontal" size="xs">
                              <Button disabled={selected.length === 0} onClick={() => setDeleting("subscription")}>
                                Delete
                              </Button>
                              <Button onClick={() => open("subscribe")}>Create subscription</Button>
                            </SpaceBetween>
                          }
                        >
                          Subscriptions
                        </Header>
                      }
                      loading={subs.loading}
                      loadingText="Loading subscriptions"
                      items={subs.data ?? []}
                      trackBy="SubscriptionArn"
                      selectionType="multi"
                      selectedItems={selected}
                      onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
                      columnDefinitions={[
                        { id: "id", header: "ID", cell: (s) => subscriptionId(s.SubscriptionArn), isRowHeader: true },
                        { id: "endpoint", header: "Endpoint", cell: (s) => s.Endpoint ?? "-" },
                        { id: "status", header: "Status", cell: (s) => (s.SubscriptionArn?.startsWith("arn:") ? "Confirmed" : "Pending confirmation") },
                        { id: "protocol", header: "Protocol", cell: (s) => s.Protocol?.toUpperCase() ?? "-" },
                      ]}
                      empty={
                        <Box textAlign="center" color="inherit">
                          <b>No subscriptions</b>
                          <Box variant="p" color="inherit">
                            A message published to this topic goes nowhere until you add a subscription.
                          </Box>
                          <Button onClick={() => open("subscribe")}>Create subscription</Button>
                        </Box>
                      }
                    />
                  ),
                },
                {
                  id: "policy",
                  label: "Access policy",
                  content: (
                    <Container header={<Header variant="h2">Access policy</Header>}>
                      <JsonBlock value={a.Policy} />
                    </Container>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <FormModal visible={modal === "subscribe"} header="Create subscription" submitLabel="Create subscription" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={subscribe}>
        <FormField label="Topic ARN">
          <Input value={arn} readOnly />
        </FormField>
        <FormField label="Protocol" description="The type of endpoint to subscribe.">
          <Select
            selectedOption={PROTOCOLS.find((p) => p.value === protocol) ?? null}
            onChange={(e) => {
              setProtocol(e.detail.selectedOption.value ?? "sqs");
              setEndpoint("");
            }}
            options={PROTOCOLS}
          />
        </FormField>
        <FormField label="Endpoint" description={options ? "Choose a resource in this Region." : undefined}>
          {options ? (
            <Select
              selectedOption={options.find((o) => o.value === endpoint) ?? null}
              onChange={(e) => setEndpoint(e.detail.selectedOption.value ?? "")}
              options={options}
              placeholder={protocol === "sqs" ? "Choose a queue" : "Choose a function"}
              filteringType="auto"
              statusType={targets.loading ? "loading" : "finished"}
              empty={protocol === "sqs" ? "No queues in this Region" : "No functions in this Region"}
            />
          ) : (
            <Input value={endpoint} placeholder={HINT[protocol]} onChange={(e) => setEndpoint(e.detail.value)} />
          )}
        </FormField>
      </FormModal>

      <FormModal visible={modal === "publish"} size="large" header="Publish message to topic" submitLabel="Publish message" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={publish}>
        <FormField label="Subject - optional">
          <Input value={subject} onChange={(e) => setSubject(e.detail.value)} />
        </FormField>
        {fifo && (
          <FormField label="Message group ID">
            <Input value={groupId} onChange={(e) => setGroupId(e.detail.value)} />
          </FormField>
        )}
        <FormField label="Message body to send to the endpoint" stretch>
          <Textarea value={message} rows={8} onChange={(e) => setMessage(e.detail.value)} spellcheck={false} />
        </FormField>
      </FormModal>

      <ConfirmDelete
        visible={deleting !== undefined}
        title={deleting === "topic" ? `Delete ${name}` : "Delete subscription"}
        onCancel={() => setDeleting(undefined)}
        onConfirm={remove}
        warning={deleting === "topic" ? "Deleting a topic also deletes its subscriptions." : undefined}
      />
    </Shell>
  );
}
