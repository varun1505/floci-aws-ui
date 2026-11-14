import { DescribeStreamSummaryCommand, ListShardsCommand, ListStreamsCommand, type Shard, type StreamDescriptionSummary } from "@aws-sdk/client-kinesis";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { kinesis } from "../../clients/kinesis";

/** Every stream with its summary. ListStreams gives the names, so each stream needs one more call. */
export async function listStreams(): Promise<StreamDescriptionSummary[]> {
  const names: string[] = [];
  let NextToken: string | undefined;
  do {
    const res = await kinesis.send(new ListStreamsCommand({ NextToken }));
    names.push(...(res.StreamNames ?? []));
    NextToken = res.HasMoreStreams ? res.NextToken : undefined;
  } while (NextToken);
  const all = await Promise.all(names.map((StreamName) => kinesis.send(new DescribeStreamSummaryCommand({ StreamName })).then((r) => r.StreamDescriptionSummary)));
  return all.filter((s): s is StreamDescriptionSummary => !!s);
}

/** Every shard of a stream, open and closed. */
export async function listShards(StreamName: string): Promise<Shard[]> {
  const out: Shard[] = [];
  let NextToken: string | undefined;
  do {
    // Kinesis rejects a request that has both a stream name and a token.
    const res = await kinesis.send(new ListShardsCommand(NextToken ? { NextToken } : { StreamName }));
    out.push(...(res.Shards ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** A shard is closed after a split or a merge. Then it has an ending sequence number. */
export const isOpen = (s: Shard) => !s.SequenceNumberRange?.EndingSequenceNumber;

const STATE: Record<string, StatusIndicatorProps.Type> = { ACTIVE: "success", CREATING: "in-progress", UPDATING: "in-progress", DELETING: "pending" };
const LABEL: Record<string, string> = { ACTIVE: "Active", CREATING: "Creating", UPDATING: "Updating", DELETING: "Deleting" };

export function StreamState({ state }: { state?: string }) {
  if (!state) return <>-</>;
  return <StatusIndicator type={STATE[state] ?? "info"}>{LABEL[state] ?? state}</StatusIndicator>;
}

export const modeLabel = (mode?: string) => (mode === "ON_DEMAND" ? "On-demand" : mode === "PROVISIONED" ? "Provisioned" : "-");

export function retentionLabel(hours?: number): string {
  if (!hours) return "-";
  if (hours % 24 === 0) return hours === 24 ? "1 day" : `${hours / 24} days`;
  return `${hours} hours`;
}

export const encryptionLabel = (type?: string) => (type === "KMS" ? "Enabled" : "Disabled");

export const NAME_RULE = /^[a-zA-Z0-9_.-]{1,128}$/;
export const NAME_ERROR = "Use up to 128 letters, numbers, underscores, hyphens and periods.";

/** Record data is bytes. Shows it as text. */
export const decode = (data?: Uint8Array) => (data ? new TextDecoder().decode(data) : "");

/** Pretty JSON when the text parses as JSON. Otherwise the text as it is. */
export function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
