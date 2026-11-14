import { useState } from "react";
import { PutRecordCommand, PutRecordsCommand } from "@aws-sdk/client-kinesis";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { kinesis } from "../../clients/kinesis";
import { errorMessage } from "../../lib/format";

type Result = { shard?: string; sequence?: string; error?: string };

/** Writes one record, or several copies of it, to the stream. */
export function PutRecord({ stream }: { stream: string }) {
  const [key, setKey] = useState("");
  const [data, setData] = useState("");
  const [copies, setCopies] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | undefined>(undefined);

  const put = async () => {
    const n = Number(copies);
    if (!key) return setError("Enter a partition key.");
    if (!(Number.isInteger(n) && n >= 1 && n <= 500)) return setError("Enter a number of copies from 1 to 500.");
    setBusy(true);
    setError("");
    try {
      const bytes = new TextEncoder().encode(data);
      if (n === 1) {
        const res = await kinesis.send(new PutRecordCommand({ StreamName: stream, PartitionKey: key, Data: bytes }));
        setResults([{ shard: res.ShardId, sequence: res.SequenceNumber }]);
      } else {
        const res = await kinesis.send(new PutRecordsCommand({ StreamName: stream, Records: Array.from({ length: n }, () => ({ PartitionKey: key, Data: bytes })) }));
        setResults((res.Records ?? []).map((r) => ({ shard: r.ShardId, sequence: r.SequenceNumber, error: r.ErrorCode ? `${r.ErrorCode}: ${r.ErrorMessage ?? ""}` : undefined })));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="Kinesis uses the partition key to pick the shard. Records with the same key go to the same shard.">Put record</Header>}>
        <SpaceBetween size="l">
          <FormField label="Partition key">
            <Input value={key} placeholder="user-123" onChange={(e) => setKey(e.detail.value)} />
          </FormField>
          <FormField label="Data" description="Text or JSON. It is stored as UTF-8 bytes." stretch>
            <Textarea value={data} rows={6} placeholder='{"event":"page_view","page":"/home"}' onChange={(e) => setData(e.detail.value)} spellcheck={false} />
          </FormField>
          <FormField label="Number of copies" constraintText="From 1 to 500. Use more than 1 to fill the stream with test data.">
            <Input type="number" value={copies} onChange={(e) => setCopies(e.detail.value)} />
          </FormField>
          <Button variant="primary" loading={busy} onClick={put}>
            Put record
          </Button>
          {error && <Alert type="error">{error}</Alert>}
        </SpaceBetween>
      </Container>

      {results && (
        <Table
          header={
            <Header variant="h2" counter={`(${results.length})`}>
              Result
            </Header>
          }
          items={results}
          columnDefinitions={[
            { id: "shard", header: "Shard ID", cell: (r) => r.shard ?? "-", isRowHeader: true },
            { id: "seq", header: "Sequence number", cell: (r) => r.sequence ?? "-" },
            { id: "error", header: "Error", cell: (r) => r.error ?? "-" },
          ]}
          empty={<Box textAlign="center">No records</Box>}
        />
      )}
    </SpaceBetween>
  );
}
