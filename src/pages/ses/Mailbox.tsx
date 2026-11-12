import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import { PROXY_BASE } from "../../config";
import { JsonBlock, Pair } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

/** One captured email, as floci stores it. Raw emails have RawData and no Subject or Body. */
type Mail = {
  Id: string;
  Source?: string;
  Destination?: { ToAddresses?: string[]; CcAddresses?: string[]; BccAddresses?: string[] };
  Subject?: string;
  Body?: { text_part?: string | null; html_part?: string | null };
  RawData?: string;
  Timestamp?: string;
};

const MAILBOX = `${PROXY_BASE}/_aws/ses`;
const recipients = (m: Mail) => [...(m.Destination?.ToAddresses ?? []), ...(m.Destination?.CcAddresses ?? []), ...(m.Destination?.BccAddresses ?? [])].join(", ") || "-";

/**
 * Every email the applications sent through SES. Nothing leaves the network, so this page is
 * where you check what a real recipient would have received.
 */
export default function Mailbox() {
  const notify = useNotify();
  const list = useLoad(async () => {
    const res = await fetch(MAILBOX);
    if (!res.ok) throw new Error(`The mailbox returned ${res.status}`);
    const mails = ((await res.json()) as { messages?: Mail[] }).messages ?? [];
    return mails.sort((a, b) => (b.Timestamp ?? "").localeCompare(a.Timestamp ?? ""));
  }, []);
  const [selected, setSelected] = useState<Mail[]>([]);
  const [viewing, setViewing] = useState<Mail | undefined>(undefined);

  const remove = async () => {
    try {
      for (const m of selected) {
        const res = await fetch(`${MAILBOX}?id=${encodeURIComponent(m.Id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`The mailbox returned ${res.status}`);
      }
      notify.success(`Deleted ${selected.length} email${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the email", e);
    }
    list.reload();
  };

  return (
    <Shell service="ses" contentType="table" breadcrumbs={[{ text: "Amazon SES", href: "/ses/identities" }, { text: "Mailbox", href: "/ses/mailbox" }]}>
      <ResourceTable
        title="Mailbox"
        description="Every email sent through SES in this environment. No email is delivered to real recipients."
        resourceName="emails"
        filterPlaceholder="Search emails"
        emptyDescription="Emails appear here when an application sends them through SES."
        emptyCli="ses send-email --from no-reply@example.com --destination ToAddresses=me@example.com --message 'Subject={Data=Hi},Body={Text={Data=Hello}}'"
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(m) => m.Id}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <>
            <Button disabled={selected.length !== 1} onClick={() => setViewing(selected[0])}>
              View
            </Button>
            <Button disabled={selected.length === 0} onClick={remove}>
              Delete
            </Button>
          </>
        }
        columns={[
          { id: "subject", header: "Subject", cell: (m) => <Button variant="inline-link" onClick={() => setViewing(m)}>{m.Subject || "(raw email)"}</Button>, sortingField: "Subject", isRowHeader: true },
          { id: "from", header: "From", cell: (m) => m.Source ?? "-", sortingField: "Source" },
          { id: "to", header: "To", cell: recipients },
          { id: "sent", header: "Sent", cell: (m) => formatDate(m.Timestamp), sortingField: "Timestamp" },
        ]}
      />

      <Modal visible={!!viewing} size="large" onDismiss={() => setViewing(undefined)} header={viewing?.Subject || "Email"} footer={<Box float="right"><Button onClick={() => setViewing(undefined)}>Close</Button></Box>}>
        {viewing && (
          <SpaceBetween size="l">
            <ColumnLayout columns={3} variant="text-grid">
              <Pair label="From">{viewing.Source}</Pair>
              <Pair label="To">{recipients(viewing)}</Pair>
              <Pair label="Sent">{formatDate(viewing.Timestamp)}</Pair>
            </ColumnLayout>
            <Tabs
              tabs={[
                ...(viewing.Body?.html_part
                  ? [{ id: "html", label: "HTML", content: <iframe title="Email body" sandbox="" srcDoc={viewing.Body.html_part} style={{ width: "100%", height: 420, border: "1px solid #ccc", background: "#fff" }} /> }]
                  : []),
                ...(viewing.Body?.text_part ? [{ id: "text", label: "Text", content: <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>{viewing.Body.text_part}</pre> }] : []),
                { id: "raw", label: "Raw", content: <JsonBlock value={JSON.stringify(viewing)} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </Modal>
    </Shell>
  );
}
