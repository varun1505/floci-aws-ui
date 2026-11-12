import { useEffect, useState } from "react";
import { FilterLogEventsCommand, type FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Select from "@cloudscape-design/components/select";
import Toggle from "@cloudscape-design/components/toggle";
import type { TableProps } from "@cloudscape-design/components/table";
import { logs } from "../aws";
import { formatDate } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ResourceTable } from "./ResourceTable";

const RANGES = [
  { value: "0", label: "All time" },
  { value: "300000", label: "Last 5 minutes" },
  { value: "3600000", label: "Last 1 hour" },
  { value: "43200000", label: "Last 12 hours" },
  { value: "86400000", label: "Last 1 day" },
];

const MAX_EVENTS = 2000;

/** Log events for a log group, or for one stream of it. Newest first. */
export function LogEvents({
  group,
  stream,
  title = "Log events",
  variant = "container",
  missingIsEmpty = false,
}: {
  group: string;
  stream?: string;
  title?: string;
  variant?: TableProps.Variant;
  /** Treat "log group does not exist" as an empty list. A function that never ran has no group. */
  missingIsEmpty?: boolean;
}) {
  const [range, setRange] = useState(RANGES[0]);
  const [live, setLive] = useState(false);

  const events = useLoad(async () => {
    const out: FilteredLogEvent[] = [];
    let nextToken: string | undefined;
    const startTime = range.value === "0" ? undefined : Date.now() - Number(range.value);
    try {
      do {
        const res = await logs.send(
          new FilterLogEventsCommand({
            logGroupName: group,
            logStreamNames: stream ? [stream] : undefined,
            startTime,
            nextToken,
          }),
        );
        out.push(...(res.events ?? []));
        nextToken = res.nextToken;
      } while (nextToken && out.length < MAX_EVENTS);
    } catch (e) {
      if (missingIsEmpty && (e as { name?: string }).name === "ResourceNotFoundException") return [];
      throw e;
    }
    return out.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }, [group, stream, range.value]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => events.reload(true), 3000);
    return () => clearInterval(id);
  }, [live, events.reload]);

  const columns: TableProps.ColumnDefinition<FilteredLogEvent>[] = [
    {
      id: "timestamp",
      header: "Timestamp",
      width: 230,
      cell: (e) => formatDate(e.timestamp),
      sortingField: "timestamp",
    },
    {
      id: "message",
      header: "Message",
      cell: (e) => (
        <Box fontSize="body-s">
          <span style={{ fontFamily: "Monaco, Menlo, Consolas, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {e.message?.trimEnd()}
          </span>
        </Box>
      ),
    },
  ];
  if (!stream) {
    columns.push({ id: "stream", header: "Log stream name", width: 280, cell: (e) => e.logStreamName ?? "-" });
  }

  return (
    <ResourceTable
      title={title}
      variant={variant}
      stickyHeader={false}
      wrapLines
      resourceName="log events"
      filterPlaceholder="Filter events"
      items={events.data}
      loading={events.loading}
      error={events.error}
      columns={columns}
      trackBy={(e) => e.eventId ?? `${e.logStreamName}-${e.timestamp}-${e.message}`}
      onRefresh={() => events.reload()}
      pageSize={50}
      actions={
        <Box padding={{ top: "xxs" }}>
          <Toggle checked={live} onChange={(e) => setLive(e.detail.checked)}>
            Live tail
          </Toggle>
        </Box>
      }
      extraFilter={
        <Select
          selectedOption={range}
          options={RANGES}
          onChange={(e) => setRange(e.detail.selectedOption as (typeof RANGES)[number])}
          ariaLabel="Time range"
        />
      }
    />
  );
}
