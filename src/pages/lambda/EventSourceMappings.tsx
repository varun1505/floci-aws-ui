import { useState } from "react";
import { DeleteEventSourceMappingCommand, ListEventSourceMappingsCommand, type EventSourceMappingConfiguration } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { lambda } from "../../clients/lambda";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

const functionName = (arn?: string) => arn?.split(":function:")[1]?.split(":")[0] ?? "";

export default function EventSourceMappings() {
  const notify = useNotify();
  const mappings = useLoad(async () => {
    const out: EventSourceMappingConfiguration[] = [];
    let Marker: string | undefined;
    do {
      const res = await lambda.send(new ListEventSourceMappingsCommand({ Marker }));
      out.push(...(res.EventSourceMappings ?? []));
      Marker = res.NextMarker;
    } while (Marker);
    return out;
  }, []);
  const [selected, setSelected] = useState<EventSourceMappingConfiguration[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const m of selected) await lambda.send(new DeleteEventSourceMappingCommand({ UUID: m.UUID }));
      notify.success(`Deleted ${selected.length} event source mapping${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the event source mapping", e);
    }
    setDeleting(false);
    mappings.reload();
  };

  return (
    <Shell
      service="lambda"
      contentType="table"
      breadcrumbs={[{ text: "Lambda", href: "/lambda/home" }, { text: "Event source mappings", href: "/lambda/event-source-mappings" }]}
    >
      <ResourceTable
        title="Event source mappings"
        description="A mapping reads from a queue or stream and invokes a function with the records."
        resourceName="event source mappings"
        items={mappings.data}
        loading={mappings.loading}
        error={mappings.error}
        onRefresh={() => mappings.reload()}
        trackBy={(m) => m.UUID ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
        columns={[
          { id: "uuid", header: "UUID", cell: (m) => m.UUID, isRowHeader: true },
          { id: "source", header: "Event source ARN", cell: (m) => m.EventSourceArn ?? "-" },
          {
            id: "function",
            header: "Function",
            cell: (m) => (functionName(m.FunctionArn) ? <RouterLink to={`/lambda/functions/${functionName(m.FunctionArn)}`}>{functionName(m.FunctionArn)}</RouterLink> : "-"),
          },
          {
            id: "state",
            header: "State",
            cell: (m) => <StatusIndicator type={m.State === "Enabled" ? "success" : m.State === "Disabled" ? "stopped" : "in-progress"}>{m.State ?? "-"}</StatusIndicator>,
          },
          { id: "batch", header: "Batch size", cell: (m) => m.BatchSize ?? "-" },
          { id: "modified", header: "Last modified", cell: (m) => formatDate(m.LastModified) },
        ]}
      />
      <ConfirmDelete visible={deleting} title="Delete event source mappings" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((m) => m.UUID).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
