import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DeleteStackCommand, DescribeStacksCommand, GetTemplateCommand } from "@aws-sdk/client-cloudformation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { cloudformation } from "../../clients/cloudformation";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { CFN_CRUMBS, StackStatus, inProgress, isDeleted, listEvents, listResources, resourceHref } from "./cfnutil";

const POLL_MS = 3000;

/** A plain table inside a tab: a header with a count, rows, and an empty line. */
function TabTable<T>({ title, items, loading, error, columns, empty, description }: { title: string; items?: T[]; loading?: boolean; error?: string; columns: TableProps.ColumnDefinition<T>[]; empty: string; description?: ReactNode }) {
  return (
    <SpaceBetween size="s">
      {error && <Alert type="error">{error}</Alert>}
      <Table
        header={
          <Header variant="h2" counter={`(${items?.length ?? 0})`} description={description}>
            {title}
          </Header>
        }
        wrapLines
        loading={!!loading && !items}
        loadingText={`Loading ${title.toLowerCase()}`}
        items={items ?? []}
        columnDefinitions={columns}
        empty={<Box textAlign="center">{empty}</Box>}
      />
    </SpaceBetween>
  );
}

export default function StackDetail() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const navigate = useNavigate();
  const notify = useNotify();
  const stack = useLoad(async () => {
    const found = (await cloudformation.send(new DescribeStacksCommand({ StackName: name }))).Stacks?.[0];
    if (!found) throw new Error(`The stack ${name} does not exist.`);
    return found;
  }, [name]);
  const events = useLoad(() => listEvents(name), [name]);
  const resources = useLoad(() => listResources(name), [name]);
  const template = useLoad(async () => (await cloudformation.send(new GetTemplateCommand({ StackName: name, TemplateStage: "Original" }))).TemplateBody ?? "", [name]);
  const [deleting, setDeleting] = useState(false);

  const s = stack.data;
  const status = s?.StackStatus;
  const busy = inProgress(status);
  const gone = isDeleted(status);
  const title = s?.StackName ?? name;
  const reloadAll = (silent = false) => (stack.reload(silent), events.reload(silent), resources.reload(silent), template.reload(silent));

  // While the stack is changing, ask again every few seconds. The timer stops when the page closes.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => (stack.reload(true), events.reload(true), resources.reload(true)), POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, name]);

  // When the status changes, the events and resources changed with it. Fetch them once more.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastStatus.current && status && lastStatus.current !== status) {
      events.reload(true);
      resources.reload(true);
      template.reload(true);
    }
    lastStatus.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const remove = async () => {
    try {
      await cloudformation.send(new DeleteStackCommand({ StackName: s?.StackName ?? name }));
      notify.success(`Delete initiated for ${title}.`);
      setDeleting(false);
      // A deleted stack answers only to its ID. Follow it there to watch the delete.
      if (s?.StackId && s.StackId !== name) navigate(`/cloudformation/stack?name=${encodeURIComponent(s.StackId)}`, { replace: true });
      else reloadAll(true);
    } catch (e) {
      notify.error(`Could not delete ${title}`, e);
      setDeleting(false);
    }
  };

  return (
    <Shell service="cloudformation" breadcrumbs={[...CFN_CRUMBS, { text: title, href: `/cloudformation/stack?name=${encodeURIComponent(name)}` }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => reloadAll()} />
                <Button disabled={!s || gone || busy} onClick={() => setDeleting(true)}>
                  Delete
                </Button>
                <Button disabled={!s || gone || busy} onClick={() => navigate(`/cloudformation/stacks/create?update=${encodeURIComponent(s?.StackName ?? name)}`)}>
                  Update
                </Button>
              </SpaceBetween>
            }
          >
            {title}
          </Header>
        }
      >
        {stack.error && !s ? (
          <Alert type="error" header="Could not load the stack">
            {stack.error}
          </Alert>
        ) : !s ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <Tabs
            tabs={[
              {
                id: "info",
                label: "Stack info",
                content: (
                  <SpaceBetween size="l">
                    <Container header={<Header variant="h2">Overview</Header>}>
                      <ColumnLayout columns={2} variant="text-grid">
                        <Pair label="Stack ID">
                          <Copy text={s.StackId} />
                        </Pair>
                        <Pair label="Description">{s.Description}</Pair>
                        <Pair label="Status">
                          <StackStatus status={status} />
                        </Pair>
                        <Pair label="Status reason">{s.StackStatusReason}</Pair>
                        <Pair label="Created time">{formatDate(s.CreationTime)}</Pair>
                        <Pair label="Updated time">{formatDate(s.LastUpdatedTime)}</Pair>
                        {s.DeletionTime && <Pair label="Deleted time">{formatDate(s.DeletionTime)}</Pair>}
                        <Pair label="Rollback on failure">{s.DisableRollback === undefined ? undefined : s.DisableRollback ? "Disabled" : "Enabled"}</Pair>
                        <Pair label="Termination protection">{s.EnableTerminationProtection ? "Activated" : "Deactivated"}</Pair>
                        <Pair label="Capabilities">{s.Capabilities?.join(", ")}</Pair>
                      </ColumnLayout>
                    </Container>
                    <TabTable
                      title="Tags"
                      items={s.Tags ?? []}
                      empty="No tags"
                      columns={[
                        { id: "key", header: "Key", cell: (t) => t.Key, isRowHeader: true },
                        { id: "value", header: "Value", cell: (t) => t.Value || "-" },
                      ]}
                    />
                  </SpaceBetween>
                ),
              },
              {
                id: "events",
                label: "Events",
                content: (
                  <TabTable
                    title="Events"
                    description={busy ? `The stack is changing. This list refreshes every ${POLL_MS / 1000} seconds.` : undefined}
                    items={events.data}
                    loading={events.loading}
                    error={events.error}
                    empty="No events"
                    columns={[
                      { id: "time", header: "Timestamp", cell: (e) => formatDate(e.Timestamp), isRowHeader: true },
                      { id: "logical", header: "Logical ID", cell: (e) => e.LogicalResourceId ?? "-" },
                      { id: "status", header: "Status", cell: (e) => <StackStatus status={e.ResourceStatus} /> },
                      { id: "reason", header: "Status reason", cell: (e) => e.ResourceStatusReason ?? "-" },
                    ]}
                  />
                ),
              },
              {
                id: "resources",
                label: "Resources",
                content: (
                  <TabTable
                    title="Resources"
                    items={resources.data}
                    loading={resources.loading}
                    error={resources.error}
                    empty="No resources"
                    columns={[
                      { id: "logical", header: "Logical ID", cell: (r) => r.LogicalResourceId, isRowHeader: true },
                      {
                        id: "physical",
                        header: "Physical ID",
                        cell: (r) => {
                          const href = r.ResourceStatus?.startsWith("DELETE_") ? undefined : resourceHref(r.ResourceType, r.PhysicalResourceId);
                          return href ? <RouterLink to={href}>{r.PhysicalResourceId}</RouterLink> : (r.PhysicalResourceId ?? "-");
                        },
                      },
                      { id: "type", header: "Type", cell: (r) => r.ResourceType ?? "-" },
                      { id: "status", header: "Status", cell: (r) => <StackStatus status={r.ResourceStatus} /> },
                      { id: "reason", header: "Status reason", cell: (r) => r.ResourceStatusReason ?? "-" },
                    ]}
                  />
                ),
              },
              {
                id: "outputs",
                label: "Outputs",
                content: (
                  <TabTable
                    title="Outputs"
                    items={s.Outputs ?? []}
                    empty="No outputs. There are no outputs defined in the template of this stack."
                    columns={[
                      { id: "key", header: "Key", cell: (o) => o.OutputKey, isRowHeader: true },
                      { id: "value", header: "Value", cell: (o) => <Copy text={o.OutputValue} /> },
                      { id: "description", header: "Description", cell: (o) => o.Description || "-" },
                      { id: "export", header: "Export name", cell: (o) => o.ExportName || "-" },
                    ]}
                  />
                ),
              },
              {
                id: "parameters",
                label: "Parameters",
                content: (
                  <TabTable
                    title="Parameters"
                    items={s.Parameters ?? []}
                    empty="No parameters. There are no parameters defined in the template of this stack."
                    columns={[
                      { id: "key", header: "Key", cell: (p) => p.ParameterKey, isRowHeader: true },
                      { id: "value", header: "Value", cell: (p) => p.ParameterValue || "-" },
                      { id: "resolved", header: "Resolved value", cell: (p) => p.ResolvedValue || "-" },
                    ]}
                  />
                ),
              },
              {
                id: "template",
                label: "Template",
                content: (
                  <Container
                    header={
                      <Header variant="h2" actions={template.data ? <CopyToClipboard copyButtonText="Copy" textToCopy={template.data} copySuccessText="Template copied" copyErrorText="Failed to copy" /> : undefined}>
                        Template
                      </Header>
                    }
                  >
                    {template.error ? (
                      <Alert type="error">{template.error}</Alert>
                    ) : template.data === undefined ? (
                      <Spinner />
                    ) : (
                      <pre style={{ margin: 0, maxHeight: 600, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 }}>{template.data || "-"}</pre>
                    )}
                  </Container>
                ),
              },
            ]}
          />
        )}
      </ContentLayout>

      <ConfirmDelete visible={deleting} title="Delete stack?" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>
          Deleting <b>{title}</b> deletes all the resources of the stack. You can't undo this.
        </Box>
      </ConfirmDelete>
    </Shell>
  );
}
