import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DescribeExecutionCommand, GetExecutionHistoryCommand, type HistoryEvent, StopExecutionCommand } from "@aws-sdk/client-sfn";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import { sfn } from "../../clients/sfn";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { StartExecution } from "./StartExecution";
import { Status, duration, executionHref, machineHref } from "./sfnutil";

const POLL_MS = 3000;

async function history(executionArn: string): Promise<HistoryEvent[]> {
  const out: HistoryEvent[] = [];
  let nextToken: string | undefined;
  do {
    const res = await sfn.send(new GetExecutionHistoryCommand({ executionArn, nextToken }));
    out.push(...(res.events ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

/** Each event keeps its data in one field named after its type, such as `stateEnteredEventDetails`. */
function details(event: HistoryEvent): Record<string, unknown> | undefined {
  const entry = Object.entries(event).find(([key, value]) => key.endsWith("EventDetails") && value);
  if (!entry) return undefined;
  // Input and output are JSON inside a string. Parse them so they read as JSON, not as escaped text.
  return Object.fromEntries(
    Object.entries(entry[1] as Record<string, unknown>).map(([key, value]) => {
      if (typeof value !== "string" || !/^[[{]/.test(value)) return [key, value];
      try {
        return [key, JSON.parse(value) as unknown];
      } catch {
        return [key, value];
      }
    }),
  );
}

const stepName = (event: HistoryEvent) => event.stateEnteredEventDetails?.name ?? event.stateExitedEventDetails?.name ?? "-";

export default function ExecutionDetail() {
  const [params] = useSearchParams();
  const arn = params.get("arn") ?? "";
  const notify = useNotify();
  const execution = useLoad(() => sfn.send(new DescribeExecutionCommand({ executionArn: arn })), [arn]);
  const events = useLoad(() => history(arn), [arn]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const e = execution.data;
  const running = e?.status === "RUNNING";
  const machineArn = e?.stateMachineArn ?? "";
  const machineName = machineArn.split(":").pop() ?? "";
  const name = e?.name ?? arn.split(":").pop() ?? arn;
  const reloadExecution = execution.reload;
  const reloadEvents = events.reload;

  // While the execution runs, load it again every few seconds. The timer stops when it ends or the page closes.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      reloadExecution(true);
      reloadEvents(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reloadExecution, reloadEvents]);

  // The last poll can see the new status before the last events are written. Load the events once more at the end.
  useEffect(() => {
    if (e && !running) reloadEvents(true);
  }, [e?.status, running, reloadEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = async () => {
    setStopping(true);
    try {
      await sfn.send(new StopExecutionCommand({ executionArn: arn }));
      notify.success(`Execution ${name} was stopped.`);
    } catch (err) {
      notify.error("Could not stop the execution", err);
    }
    setStopping(false);
    execution.reload(true);
    events.reload(true);
  };

  return (
    <Shell
      service="states"
      breadcrumbs={[
        { text: "Step Functions", href: "/states/state-machines" },
        { text: "State machines", href: "/states/state-machines" },
        ...(machineArn ? [{ text: machineName, href: machineHref(machineArn) }] : []),
        { text: name, href: executionHref(arn) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (execution.reload(), events.reload())} />
                <Button disabled={!running} loading={stopping} onClick={stop}>
                  Stop execution
                </Button>
                <Button variant="primary" disabled={!e} onClick={() => setStarting(true)}>
                  New execution
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {execution.error ? (
          <Alert type="error" header="Could not load the execution">
            {execution.error}
          </Alert>
        ) : !e ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            {(e.error || e.cause) && (
              <Alert type={e.status === "ABORTED" ? "warning" : "error"} header={e.status === "ABORTED" ? "Execution aborted" : "Execution failed"}>
                <SpaceBetween size="xxs">
                  {e.error && (
                    <div>
                      <b>Error:</b> {e.error}
                    </div>
                  )}
                  {e.cause && (
                    <div>
                      <b>Cause:</b> {e.cause}
                    </div>
                  )}
                </SpaceBetween>
              </Alert>
            )}
            <Container header={<Header variant="h2">Execution summary</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Execution status">
                  <Status status={e.status} />
                </Pair>
                <Pair label="State machine">{machineArn && <RouterLink to={machineHref(machineArn)}>{machineName}</RouterLink>}</Pair>
                <Pair label="Execution ARN">
                  <Copy text={e.executionArn} />
                </Pair>
                <Pair label="Start time">{formatDate(e.startDate)}</Pair>
                <Pair label="End time">{formatDate(e.stopDate)}</Pair>
                <Pair label="Duration">{duration(e.startDate, e.stopDate)}</Pair>
              </ColumnLayout>
            </Container>
            <ColumnLayout columns={2}>
              <Container header={<Header variant="h2">Input</Header>}>
                <JsonBlock value={e.input} />
              </Container>
              <Container header={<Header variant="h2">Output</Header>}>{e.output ? <JsonBlock value={e.output} /> : <Box color="text-body-secondary">{running ? "The execution is still running." : "No output."}</Box>}</Container>
            </ColumnLayout>
            <Table
              header={
                <Header variant="h2" counter={`(${events.data?.length ?? 0})`} description={running ? "The list updates every few seconds while the execution runs." : undefined}>
                  Events
                </Header>
              }
              loading={events.loading && !events.data}
              loadingText="Loading events"
              items={events.data ?? []}
              trackBy={(ev) => String(ev.id)}
              wrapLines
              columnDefinitions={[
                { id: "id", header: "ID", cell: (ev) => ev.id, width: 70, isRowHeader: true },
                { id: "type", header: "Type", cell: (ev) => ev.type },
                { id: "step", header: "Step", cell: stepName },
                { id: "time", header: "Timestamp", cell: (ev) => formatDate(ev.timestamp) },
                {
                  id: "details",
                  header: "Details",
                  cell: (ev) => {
                    const d = details(ev);
                    if (!d) return "-";
                    return (
                      <ExpandableSection variant="footer" headerText="Show details">
                        <JsonBlock value={JSON.stringify(d)} />
                      </ExpandableSection>
                    );
                  },
                },
              ]}
              empty={<Box textAlign="center">{events.error ?? "No events"}</Box>}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <StartExecution visible={starting} machineArn={machineArn} input={e?.input} onDismiss={() => setStarting(false)} />
    </Shell>
  );
}
