import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DeleteStreamCommand, DescribeStreamSummaryCommand } from "@aws-sdk/client-kinesis";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { kinesis } from "../../clients/kinesis";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { Consumers } from "./Consumers";
import { DataViewer } from "./DataViewer";
import { PutRecord } from "./PutRecord";
import { StreamConfig } from "./StreamConfig";
import { StreamState, isOpen, listShards, modeLabel, retentionLabel } from "./kinesisutil";

export default function StreamDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const stream = useLoad(async () => (await kinesis.send(new DescribeStreamSummaryCommand({ StreamName: name }))).StreamDescriptionSummary, [name]);
  const shards = useLoad(() => listShards(name), [name]);
  const [deleting, setDeleting] = useState(false);
  const s = stream.data;

  const reload = () => {
    stream.reload(true);
    shards.reload(true);
  };

  const remove = async () => {
    try {
      await kinesis.send(new DeleteStreamCommand({ StreamName: name, EnforceConsumerDeletion: true }));
      notify.success(`Data stream ${name} was deleted.`);
      navigate("/kinesis/streams");
    } catch (e) {
      notify.error("Could not delete the data stream", e);
      setDeleting(false);
    }
  };

  return (
    <Shell
      service="kinesis"
      breadcrumbs={[
        { text: "Amazon Kinesis", href: "/kinesis/streams" },
        { text: "Data streams", href: "/kinesis/streams" },
        { text: name, href: `/kinesis/streams/${name}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (stream.reload(), shards.reload())} />
                <Button disabled={!s} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {stream.error ? (
          <Alert type="error" header="Could not load the data stream">
            {stream.error}
          </Alert>
        ) : !s ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Data stream summary</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Status">
                  <StreamState state={s.StreamStatus} />
                </Pair>
                <Pair label="Capacity mode">{modeLabel(s.StreamModeDetails?.StreamMode)}</Pair>
                <Pair label="Open shards">{String(s.OpenShardCount ?? "-")}</Pair>
                <Pair label="ARN">
                  <Copy text={s.StreamARN} />
                </Pair>
                <Pair label="Data retention period">{retentionLabel(s.RetentionPeriodHours)}</Pair>
                <Pair label="Creation time">{formatDate(s.StreamCreationTimestamp)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "shards",
                  label: "Shards",
                  content: (
                    <Table
                      header={
                        <Header variant="h2" counter={`(${shards.data?.length ?? 0})`} description="A shard closes after a split or a merge. Its records stay readable until they expire.">
                          Shards
                        </Header>
                      }
                      loading={shards.loading && !shards.data}
                      loadingText="Loading shards"
                      items={shards.data ?? []}
                      trackBy={(x) => x.ShardId ?? ""}
                      resizableColumns
                      columnDefinitions={[
                        { id: "id", header: "Shard ID", cell: (x) => x.ShardId, isRowHeader: true, width: 220 },
                        { id: "state", header: "Status", cell: (x) => (isOpen(x) ? <StatusIndicator type="success">Open</StatusIndicator> : <StatusIndicator type="stopped">Closed</StatusIndicator>), width: 120 },
                        { id: "start", header: "Starting hash key", cell: (x) => x.HashKeyRange?.StartingHashKey ?? "-" },
                        { id: "end", header: "Ending hash key", cell: (x) => x.HashKeyRange?.EndingHashKey ?? "-" },
                        { id: "seq", header: "Starting sequence number", cell: (x) => x.SequenceNumberRange?.StartingSequenceNumber ?? "-" },
                        { id: "parent", header: "Parent shard", cell: (x) => x.ParentShardId ?? "-" },
                      ]}
                      empty={<Box textAlign="center">{shards.error ?? "No shards"}</Box>}
                    />
                  ),
                },
                { id: "viewer", label: "Data viewer", content: <DataViewer stream={name} shards={shards.data ?? []} /> },
                { id: "put", label: "Put record", content: <PutRecord stream={name} /> },
                { id: "config", label: "Configuration", content: <StreamConfig stream={s} onChange={reload} /> },
                { id: "consumers", label: "Enhanced fan-out", content: <Consumers streamArn={s.StreamARN ?? ""} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <ConfirmDelete visible={deleting} title={`Delete ${name}?`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        This deletes the data stream, its records and its consumers. You can't undo this.
      </ConfirmDelete>
    </Shell>
  );
}
