import { useEffect, useState } from "react";
import { GetRecordsCommand, GetShardIteratorCommand, type Shard, type ShardIteratorType, type _Record } from "@aws-sdk/client-kinesis";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { kinesis } from "../../clients/kinesis";
import { Copy } from "../../components/Pair";
import { errorMessage, formatDate } from "../../lib/format";
import { decode, isOpen, pretty } from "./kinesisutil";

const POSITIONS: { value: ShardIteratorType; label: string }[] = [
  { value: "TRIM_HORIZON", label: "Trim horizon" },
  { value: "LATEST", label: "Latest" },
  { value: "AT_TIMESTAMP", label: "At timestamp" },
  { value: "AT_SEQUENCE_NUMBER", label: "At sequence number" },
];

const BATCH = 100;

/** Reads records from one shard, a batch at a time. */
export function DataViewer({ stream, shards }: { stream: string; shards: Shard[] }) {
  const [shard, setShard] = useState("");
  const [position, setPosition] = useState<ShardIteratorType>("TRIM_HORIZON");
  const [timestamp, setTimestamp] = useState("");
  const [sequence, setSequence] = useState("");
  const [records, setRecords] = useState<_Record[] | undefined>(undefined);
  const [next, setNext] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<_Record | undefined>(undefined);

  // Pick the first shard once the list has loaded.
  useEffect(() => {
    if (!shard && shards.length) setShard(shards[0].ShardId ?? "");
  }, [shard, shards]);

  const read = async (iterator: string, keep: _Record[]) => {
    const res = await kinesis.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: BATCH }));
    const batch = res.Records ?? [];
    setRecords([...keep, ...batch]);
    setNext(res.NextShardIterator ?? undefined);
    if (!res.NextShardIterator) setNote("This shard is closed. You have read all of its records.");
    else if (!batch.length) setNote(keep.length ? "No new records yet." : "No records at this position yet. Put a record, then choose Next records.");
    else setNote("");
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const getRecords = () => {
    if (position === "AT_TIMESTAMP" && isNaN(new Date(timestamp).getTime())) return setError("Enter a date and time, for example 2026-01-31T12:00:00Z.");
    if (position === "AT_SEQUENCE_NUMBER" && !/^\d+$/.test(sequence)) return setError("Enter a sequence number. It has digits only.");
    return run(async () => {
      const res = await kinesis.send(
        new GetShardIteratorCommand({
          StreamName: stream,
          ShardId: shard,
          ShardIteratorType: position,
          Timestamp: position === "AT_TIMESTAMP" ? new Date(timestamp) : undefined,
          StartingSequenceNumber: position === "AT_SEQUENCE_NUMBER" ? sequence : undefined,
        }),
      );
      await read(res.ShardIterator ?? "", []);
    });
  };

  const text = viewing ? decode(viewing.Data) : "";

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="Read records from one shard. Reading does not remove them.">Data viewer</Header>}>
        <SpaceBetween size="l">
          <ColumnLayout columns={3}>
            <FormField label="Shard">
              <Select
                selectedOption={shard ? { value: shard, label: shard } : null}
                onChange={(e) => setShard(e.detail.selectedOption.value ?? "")}
                options={shards.map((s) => ({ value: s.ShardId ?? "", label: s.ShardId ?? "", description: isOpen(s) ? "Open" : "Closed" }))}
                placeholder="Choose a shard"
                empty="No shards"
              />
            </FormField>
            <FormField label="Starting position" description={position === "LATEST" ? "Shows only records that arrive after you choose Get records." : undefined}>
              <Select selectedOption={POSITIONS.find((p) => p.value === position) ?? POSITIONS[0]} onChange={(e) => setPosition(e.detail.selectedOption.value as ShardIteratorType)} options={POSITIONS} />
            </FormField>
            {position === "AT_TIMESTAMP" && (
              <FormField label="Timestamp" constraintText="A date and time in ISO format.">
                <Input value={timestamp} placeholder="2026-01-31T12:00:00Z" onChange={(e) => setTimestamp(e.detail.value)} />
              </FormField>
            )}
            {position === "AT_SEQUENCE_NUMBER" && (
              <FormField label="Sequence number">
                <Input value={sequence} placeholder="49590338271490256608559692538361571095921575989136588898" onChange={(e) => setSequence(e.detail.value)} />
              </FormField>
            )}
          </ColumnLayout>
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="primary" loading={busy} disabled={!shard} onClick={getRecords}>
              Get records
            </Button>
            <Button disabled={!next || busy} onClick={() => run(() => read(next ?? "", records ?? []))}>
              Next records
            </Button>
          </SpaceBetween>
          {error && <Alert type="error">{error}</Alert>}
          {note && !error && <Alert type="info">{note}</Alert>}
        </SpaceBetween>
      </Container>

      {records && (
        <Table
          header={
            <Header variant="h2" counter={`(${records.length})`}>
              Records
            </Header>
          }
          items={records}
          trackBy={(r) => r.SequenceNumber ?? ""}
          resizableColumns
          columnDefinitions={[
            { id: "key", header: "Partition key", cell: (r) => r.PartitionKey, isRowHeader: true, width: 180 },
            { id: "seq", header: "Sequence number", cell: (r) => r.SequenceNumber, width: 200 },
            { id: "time", header: "Approximate arrival timestamp", cell: (r) => formatDate(r.ApproximateArrivalTimestamp), width: 230 },
            {
              id: "data",
              header: "Data",
              cell: (r) => (
                <Button variant="inline-link" ariaLabel={`View record ${r.SequenceNumber}`} onClick={() => setViewing(r)}>
                  {decode(r.Data).slice(0, 200) || "(empty)"}
                </Button>
              ),
            },
          ]}
          empty={<Box textAlign="center">No records</Box>}
        />
      )}

      <Modal visible={!!viewing} size="large" header={`Record ${viewing?.SequenceNumber ?? ""}`} onDismiss={() => setViewing(undefined)} footer={<Box float="right"><Button onClick={() => setViewing(undefined)}>Close</Button></Box>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Partition key</Box>
              {viewing?.PartitionKey}
            </div>
            <div>
              <Box variant="awsui-key-label">Approximate arrival timestamp</Box>
              {formatDate(viewing?.ApproximateArrivalTimestamp)}
            </div>
          </ColumnLayout>
          <div>
            <Box variant="awsui-key-label">Data</Box>
            <pre style={{ margin: 0, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13 }}>{pretty(text)}</pre>
          </div>
          <Copy text={text} />
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
