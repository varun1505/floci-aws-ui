import { useState } from "react";
import { CreateEventBusCommand, DeleteEventBusCommand, type EventBus, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import { eventbridge } from "../../clients/eventbridge";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy } from "../../components/Pair";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { DEFAULT_BUS, jsonObjectError, listBuses, listRules } from "./eventsutil";

type BusRow = EventBus & { rules?: number };

export default function Buses() {
  const notify = useNotify();
  const list = useLoad(async (): Promise<BusRow[]> => {
    const buses = await listBuses();
    // One more call per bus for the rule count. A count that fails to load shows as "-".
    return Promise.all(buses.map(async (b) => ({ ...b, rules: await listRules(b.Name ?? "").then((r) => r.length, () => undefined) })));
  }, []);
  const form = useSubmit();
  const [selected, setSelected] = useState<BusRow[]>([]);
  const [modal, setModal] = useState<"create" | "send" | "delete" | undefined>(undefined);
  const [name, setName] = useState("");
  const [bus, setBus] = useState(DEFAULT_BUS);
  const [source, setSource] = useState("my.app");
  const [detailType, setDetailType] = useState("OrderPlaced");
  const [detail, setDetail] = useState('{\n  "orderId": "123"\n}');
  const [sent, setSent] = useState("");

  const open = (which: "create" | "send") => {
    setName("");
    setSent("");
    setBus(selected[0]?.Name ?? DEFAULT_BUS);
    form.setError("");
    setModal(which);
  };

  const create = async () => {
    if (!/^[A-Za-z0-9._-]{1,256}$/.test(name)) return form.setError("Use up to 256 letters, numbers, dots, hyphens and underscores.");
    if (name === DEFAULT_BUS) return form.setError("The default event bus already exists.");
    const ok = await form.run(async () => {
      await eventbridge.send(new CreateEventBusCommand({ Name: name }));
      notify.success(`Event bus ${name} was created.`);
      list.reload();
    });
    if (ok) setModal(undefined);
  };

  const send = async () => {
    setSent("");
    if (!source.trim()) return form.setError("Event source is required.");
    if (!detailType.trim()) return form.setError("Detail type is required.");
    const invalid = jsonObjectError(detail, "Event detail");
    if (invalid) return form.setError(invalid);
    await form.run(async () => {
      const res = await eventbridge.send(new PutEventsCommand({ Entries: [{ EventBusName: bus, Source: source.trim(), DetailType: detailType.trim(), Detail: detail }] }));
      const entry = res.Entries?.[0];
      // PutEvents answers 200 even when the event is refused. The entry holds the error.
      if (res.FailedEntryCount || !entry?.EventId) throw new Error(`${entry?.ErrorCode ?? "The event was not sent"}: ${entry?.ErrorMessage ?? "EventBridge gave no reason."}`);
      setSent(entry.EventId);
    });
  };

  const remove = async () => {
    try {
      for (const b of selected) await eventbridge.send(new DeleteEventBusCommand({ Name: b.Name }));
      notify.success(`Deleted ${selected.length} event bus${selected.length === 1 ? "" : "es"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the event bus", e);
    }
    setModal(undefined);
    list.reload();
  };

  return (
    <Shell service="events" contentType="table" breadcrumbs={[{ text: "Amazon EventBridge", href: "/events/rules" }, { text: "Event buses", href: "/events/buses" }]}>
      <ResourceTable
        title="Event buses"
        resourceName="event buses"
        filterPlaceholder="Find event buses"
        emptyDescription="An event bus receives events. Rules on the bus send matching events to targets."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => list.reload()}
        trackBy={(b) => b.Name ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        isItemDisabled={(b) => b.Name === DEFAULT_BUS}
        actions={
          <>
            <Button onClick={() => open("send")}>Send events</Button>
            <Button disabled={!selected.length} onClick={() => setModal("delete")}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => open("create")}>
              Create event bus
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (b) => b.Name, sortingField: "Name", isRowHeader: true },
          { id: "arn", header: "ARN", cell: (b) => <Copy text={b.Arn} /> },
          { id: "rules", header: "Rules", cell: (b) => (b.rules === undefined ? "-" : <RouterLink to={`/events/rules?bus=${encodeURIComponent(b.Name ?? "")}`}>{b.rules}</RouterLink>) },
          { id: "type", header: "Type", cell: (b) => (b.Name === DEFAULT_BUS ? "Default" : "Custom") },
        ]}
      />

      <FormModal visible={modal === "create"} header="Create event bus" submitLabel="Create" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={create}>
        <FormField label="Name" constraintText="Up to 256 letters, numbers, dots, hyphens and underscores.">
          <Input value={name} placeholder="my-event-bus" onChange={(e) => setName(e.detail.value)} />
        </FormField>
      </FormModal>

      <FormModal visible={modal === "send"} header="Send events" submitLabel="Send" size="large" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={send}>
        <FormField label="Event bus">
          <Select selectedOption={{ value: bus, label: bus }} onChange={(e) => setBus(e.detail.selectedOption.value ?? DEFAULT_BUS)} options={(list.data ?? []).map((b) => ({ value: b.Name ?? "", label: b.Name ?? "" }))} ariaLabel="Event bus" />
        </FormField>
        <FormField label="Event source" description="The name of the application that sends the event.">
          <Input value={source} placeholder="my.app" onChange={(e) => setSource(e.detail.value)} />
        </FormField>
        <FormField label="Detail type">
          <Input value={detailType} placeholder="OrderPlaced" onChange={(e) => setDetailType(e.detail.value)} />
        </FormField>
        <FormField label="Event detail" description="A JSON object." stretch>
          {/* The editor is heavy. Only build it while the dialog is open. */}
          {modal === "send" && <Code value={detail} onChange={setDetail} language="json" height={180} ariaLabel="Event detail" />}
        </FormField>
        {sent && (
          <Alert type="success" header="Event sent">
            Event ID: <Copy text={sent} />
          </Alert>
        )}
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title={`Delete ${selected.length === 1 ? "event bus" : "event buses"}`} onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete {selected.length === 1 ? <b>{selected[0].Name}</b> : `${selected.length} event buses`} permanently? An event bus that still has rules can't be deleted. Delete its rules first.
      </ConfirmDelete>
    </Shell>
  );
}
