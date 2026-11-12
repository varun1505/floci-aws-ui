import { useState } from "react";
import { UnsubscribeCommand, type Subscription } from "@aws-sdk/client-sns";
import Button from "@cloudscape-design/components/button";
import { sns } from "../../clients/sns";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { listSubscriptions, subscriptionId, topicHref, topicName } from "./snsutil";

export default function Subscriptions() {
  const notify = useNotify();
  const list = useLoad(listSubscriptions, []);
  const [selected, setSelected] = useState<Subscription[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const s of selected) await sns.send(new UnsubscribeCommand({ SubscriptionArn: s.SubscriptionArn }));
      notify.success(`Deleted ${selected.length} subscription${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the subscription", e);
    }
    setDeleting(false);
    list.reload();
  };

  return (
    <Shell service="sns" contentType="table" breadcrumbs={[{ text: "Amazon SNS", href: "/sns/topics" }, { text: "Subscriptions", href: "/sns/subscriptions" }]}>
      <ResourceTable
        title="Subscriptions"
        resourceName="subscriptions"
        filterPlaceholder="Search subscriptions"
        emptyDescription="To add a subscription, open a topic and choose Create subscription."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(s) => s.SubscriptionArn ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
        columns={[
          { id: "id", header: "ID", cell: (s) => subscriptionId(s.SubscriptionArn), isRowHeader: true },
          { id: "endpoint", header: "Endpoint", cell: (s) => s.Endpoint ?? "-", sortingField: "Endpoint" },
          { id: "status", header: "Status", cell: (s) => (s.SubscriptionArn?.startsWith("arn:") ? "Confirmed" : "Pending confirmation") },
          { id: "protocol", header: "Protocol", cell: (s) => s.Protocol?.toUpperCase() ?? "-", sortingField: "Protocol" },
          { id: "topic", header: "Topic", cell: (s) => (s.TopicArn ? <RouterLink to={topicHref(s.TopicArn)}>{topicName(s.TopicArn)}</RouterLink> : "-") },
        ]}
      />
      <ConfirmDelete visible={deleting} title={`Delete ${selected.length} subscription${selected.length === 1 ? "" : "s"}`} onCancel={() => setDeleting(false)} onConfirm={remove} />
    </Shell>
  );
}
