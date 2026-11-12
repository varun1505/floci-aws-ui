import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DeleteLogGroupCommand,
  DeleteLogStreamCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  type LogStream,
} from "@aws-sdk/client-cloudwatch-logs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import { logs } from "../../aws";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { LogEvents } from "../../components/LogEvents";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatBytes, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { groupHref, retentionLabel } from "./LogGroups";

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children}</div>
    </div>
  );
}

export default function LogGroupDetail() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const name = params.get("name") ?? "";
  const stream = params.get("stream") ?? "";
  const tab = params.get("tab") ?? "streams";
  const [selected, setSelected] = useState<LogStream[]>([]);
  const [dialog, setDialog] = useState<"group" | "streams" | null>(null);

  const group = useLoad(async () => {
    const res = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: name }));
    const found = (res.logGroups ?? []).find((g) => g.logGroupName === name);
    if (!found) throw new Error(`The log group "${name}" does not exist.`);
    return found;
  }, [name]);

  const streams = useLoad(async () => {
    const out: LogStream[] = [];
    let nextToken: string | undefined;
    do {
      const res = await logs.send(new DescribeLogStreamsCommand({ logGroupName: name, nextToken }));
      out.push(...(res.logStreams ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
    const time = (s: LogStream) => s.lastEventTimestamp || s.lastIngestionTime || s.creationTime || 0;
    return out.sort((a, b) => time(b) - time(a));
  }, [name]);

  const crumbs = [
    { text: "CloudWatch", href: "/cloudwatch/log-groups" },
    { text: "Log groups", href: "/cloudwatch/log-groups" },
    { text: name, href: groupHref(name) },
  ];

  // One log stream: show only its events.
  if (stream) {
    return (
      <Shell service="cloudwatch" contentType="table" breadcrumbs={[...crumbs, { text: stream, href: groupHref(name, stream) }]}>
        <LogEvents group={name} stream={stream} variant="full-page" />
      </Shell>
    );
  }

  const removeGroup = async () => {
    try {
      await logs.send(new DeleteLogGroupCommand({ logGroupName: name }));
      notify.success(`Deleted log group "${name}".`);
      navigate("/cloudwatch/log-groups");
    } catch (e) {
      notify.error("Could not delete the log group", e);
      setDialog(null);
    }
  };

  const removeStreams = async () => {
    try {
      for (const s of selected) await logs.send(new DeleteLogStreamCommand({ logGroupName: name, logStreamName: s.logStreamName }));
      notify.success(`Deleted ${selected.length} log stream${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the log stream", e);
    }
    setDialog(null);
    streams.reload();
  };

  return (
    <Shell service="cloudwatch" breadcrumbs={crumbs}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setDialog("group")}>Delete log group</Button>
                <Button variant="primary" onClick={() => setParams({ name, tab: "events" })}>
                  Search log group
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        <SpaceBetween size="l">
          {group.error && (
            <Alert type="error" header="Could not load the log group">
              {group.error}
            </Alert>
          )}
          <Container header={<Header variant="h2">Log group details</Header>}>
            <ColumnLayout columns={3} variant="text-grid">
              <Pair label="Log class">{group.data?.logGroupClass === "INFREQUENT_ACCESS" ? "Infrequent Access" : "Standard"}</Pair>
              <Pair label="Retention">{retentionLabel(group.data?.retentionInDays)}</Pair>
              <Pair label="Stored bytes">{formatBytes(group.data?.storedBytes)}</Pair>
              <Pair label="Creation time">{formatDate(group.data?.creationTime)}</Pair>
              <Pair label="ARN">
                {group.data?.arn ? (
                  <CopyToClipboard variant="inline" textToCopy={group.data.arn} copyButtonAriaLabel="Copy ARN" copySuccessText="ARN copied" copyErrorText="Failed to copy" />
                ) : (
                  "-"
                )}
              </Pair>
            </ColumnLayout>
          </Container>
          <Tabs
            activeTabId={tab}
            onChange={(e) => setParams({ name, tab: e.detail.activeTabId }, { replace: true })}
            tabs={[
              {
                id: "streams",
                label: "Log streams",
                content: (
                  <ResourceTable
                    title="Log streams"
                    variant="container"
                    stickyHeader={false}
                    resourceName="log streams"
                    filterPlaceholder="Filter log streams"
                    items={streams.data}
                    loading={streams.loading}
                    error={streams.error}
                    onRefresh={() => streams.reload()}
                    trackBy={(s) => s.logStreamName ?? ""}
                    selectionType="multi"
                    selected={selected}
                    onSelect={setSelected}
                    actions={
                      <Button disabled={selected.length === 0} onClick={() => setDialog("streams")}>
                        Delete
                      </Button>
                    }
                    columns={[
                      {
                        id: "name",
                        header: "Log stream",
                        cell: (s) => <RouterLink to={groupHref(name, s.logStreamName)}>{s.logStreamName}</RouterLink>,
                        sortingField: "logStreamName",
                        isRowHeader: true,
                      },
                      {
                        id: "last",
                        header: "Last event time",
                        cell: (s) => formatDate(s.lastEventTimestamp || s.lastIngestionTime || undefined),
                      },
                      { id: "created", header: "Creation time", cell: (s) => formatDate(s.creationTime), sortingField: "creationTime" },
                    ]}
                  />
                ),
              },
              { id: "events", label: "All events", content: <LogEvents group={name} title="Log events from all streams" /> },
            ]}
          />
        </SpaceBetween>
      </ContentLayout>
      <ConfirmDelete
        visible={dialog === "group"}
        title="Delete log group"
        onCancel={() => setDialog(null)}
        onConfirm={removeGroup}
        warning="Deleting a log group permanently deletes all of its log streams and log events."
      />
      <ConfirmDelete
        visible={dialog === "streams"}
        title={`Delete log stream${selected.length === 1 ? "" : "s"}`}
        onCancel={() => setDialog(null)}
        onConfirm={removeStreams}
        warning="Deleting a log stream permanently deletes all of its log events."
      />
    </Shell>
  );
}
