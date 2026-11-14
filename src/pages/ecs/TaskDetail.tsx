import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type Container as TaskContainer, DescribeTaskDefinitionCommand, DescribeTasksCommand, StopTaskCommand, type Task, type TaskDefinition } from "@aws-sdk/client-ecs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { LogEvents } from "../../components/LogEvents";
import { Copy, Pair } from "../../components/Pair";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { getRegion } from "../../config";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { groupHref } from "../cloudwatch/LogGroups";
import { EcsStatus, clusterHref, lastPart, taskDefHref, taskHref, usePoll } from "./ecsutil";

type LogTarget = { container: string; group: string; stream: string; region: string };

/** Where each container of the task writes its logs. Only containers with the awslogs driver have a place. */
export function logTargets(task: Task, def?: TaskDefinition): LogTarget[] {
  const out: LogTarget[] = [];
  for (const c of def?.containerDefinitions ?? []) {
    const options = c.logConfiguration?.options ?? {};
    if (c.logConfiguration?.logDriver !== "awslogs" || !options["awslogs-group"]) continue;
    const prefix = options["awslogs-stream-prefix"];
    // With a prefix the stream is prefix/container/task-id. Without one it is the Docker container ID.
    const stream = prefix ? `${prefix}/${c.name}/${lastPart(task.taskArn)}` : (task.containers?.find((t) => t.name === c.name)?.runtimeId ?? "");
    if (stream) out.push({ container: c.name ?? "", group: options["awslogs-group"], stream, region: options["awslogs-region"] ?? getRegion() });
  }
  return out;
}

const ports = (c: TaskContainer) => (c.networkBindings ?? []).map((b) => `${b.hostPort} → ${b.containerPort}/${b.protocol ?? "tcp"}`).join(", ");

export default function TaskDetail() {
  const [params] = useSearchParams();
  const cluster = params.get("cluster") ?? "";
  const arn = params.get("arn") ?? "";
  const id = lastPart(arn);
  const notify = useNotify();
  const task = useLoad(async () => {
    const res = await ecs.send(new DescribeTasksCommand({ cluster, tasks: [arn] }));
    const found = res.tasks?.[0];
    // floci keeps tasks in memory. They are gone after it restarts.
    if (!found) throw new Error(`Task ${id} was not found in cluster ${cluster}.`);
    return found;
  }, [cluster, arn]);
  const t = task.data;
  const def = useLoad(
    async () => (t?.taskDefinitionArn ? (await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: t.taskDefinitionArn })).catch(() => undefined))?.taskDefinition : undefined),
    [t?.taskDefinitionArn],
  );
  const [stopping, setStopping] = useState(false);
  const [logContainer, setLogContainer] = useState("");

  usePoll(!!t && t.lastStatus !== t.desiredStatus, task.reload);

  const targets = t ? logTargets(t, def.data) : [];
  const target = targets.find((x) => x.container === logContainer) ?? targets[0];
  const privateIp = (c: TaskContainer) =>
    c.networkInterfaces?.[0]?.privateIpv4Address ?? t?.attachments?.flatMap((a) => a.details ?? []).find((d) => d.name === "privateIPv4Address")?.value ?? "-";

  const stop = async () => {
    try {
      await ecs.send(new StopTaskCommand({ cluster, task: arn, reason: "Stopped from the console" }));
      notify.success(`Task ${id} was stopped.`);
    } catch (e) {
      notify.error(`Could not stop task ${id}`, e);
    }
    setStopping(false);
    task.reload(true);
  };

  return (
    <Shell
      service="ecs"
      breadcrumbs={[
        { text: "Amazon Elastic Container Service", href: "/ecs/clusters" },
        { text: "Clusters", href: "/ecs/clusters" },
        { text: cluster, href: clusterHref(cluster) },
        { text: `Task ${id}`, href: taskHref(cluster, arn) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => task.reload()} />
                <Button disabled={!t || t.lastStatus === "STOPPED"} onClick={() => setStopping(true)}>
                  Stop
                </Button>
              </SpaceBetween>
            }
          >
            {id}
          </Header>
        }
      >
        {task.error ? (
          <Alert type="error" header="Could not load the task">
            {task.error}
          </Alert>
        ) : !t ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Task overview</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={t.taskArn} />
                </Pair>
                <Pair label="Last status">
                  <EcsStatus status={t.lastStatus} />
                </Pair>
                <Pair label="Desired status">
                  <EcsStatus status={t.desiredStatus} />
                </Pair>
                <Pair label="Task definition: revision">
                  <RouterLink to={taskDefHref(t.taskDefinitionArn ?? "")}>{lastPart(t.taskDefinitionArn)}</RouterLink>
                </Pair>
                <Pair label="CPU | Memory">{`${t.cpu ?? "-"} | ${t.memory ?? "-"}`}</Pair>
                <Pair label="Launch type">{t.launchType}</Pair>
                <Pair label="Platform version">{t.platformVersion}</Pair>
                <Pair label="Group">{t.group}</Pair>
                <Pair label="Created at">{formatDate(t.createdAt)}</Pair>
                <Pair label="Started at">{formatDate(t.startedAt)}</Pair>
                <Pair label="Stopped at">{formatDate(t.stoppedAt)}</Pair>
                <Pair label="Stopped reason">{[t.stopCode, t.stoppedReason].filter(Boolean).join(": ")}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "containers",
                  label: "Containers",
                  content: (
                    <Table
                      header={
                        <Header variant="h2" counter={`(${t.containers?.length ?? 0})`}>
                          Containers
                        </Header>
                      }
                      wrapLines
                      items={t.containers ?? []}
                      trackBy={(c) => c.name ?? ""}
                      empty={<Box textAlign="center">No containers</Box>}
                      columnDefinitions={[
                        { id: "name", header: "Container name", cell: (c) => c.name, isRowHeader: true },
                        { id: "image", header: "Image URI", cell: (c) => c.image ?? "-" },
                        { id: "status", header: "Status", cell: (c) => <EcsStatus status={c.lastStatus} /> },
                        { id: "exit", header: "Exit code", cell: (c) => c.exitCode ?? "-" },
                        { id: "ports", header: "Host port → container port", cell: (c) => ports(c) || "-" },
                        { id: "ip", header: "Private IP", cell: privateIp },
                        { id: "reason", header: "Reason", cell: (c) => c.reason ?? "-" },
                      ]}
                    />
                  ),
                },
                {
                  id: "logs",
                  label: "Logs",
                  content: !target ? (
                    <Container header={<Header variant="h2">Logs</Header>}>
                      <Box color="text-body-secondary">
                        {def.loading ? "Loading" : "No container of this task uses the awslogs log driver. Add awslogs settings to a container in the task definition to see its output here."}
                      </Box>
                    </Container>
                  ) : (
                    <SpaceBetween size="m">
                      <SpaceBetween direction="horizontal" size="s" alignItems="center">
                        <Select
                          selectedOption={{ value: target.container, label: target.container }}
                          options={targets.map((x) => ({ value: x.container, label: x.container }))}
                          ariaLabel="Container"
                          onChange={(e) => setLogContainer(e.detail.selectedOption.value ?? "")}
                        />
                        <RouterLink to={groupHref(target.group, target.stream)}>Open the log stream in CloudWatch</RouterLink>
                      </SpaceBetween>
                      {target.region !== getRegion() && <Alert type="info">This container writes its logs in {target.region}. Switch the console to that Region to see them.</Alert>}
                      <LogEvents key={target.stream} group={target.group} stream={target.stream} title={`Logs of ${target.container}`} missingIsEmpty />
                    </SpaceBetween>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <ConfirmDelete visible={stopping} title="Stop task" confirmText="stop" actionLabel="Stop" onCancel={() => setStopping(false)} onConfirm={stop}>
        Stop task <b>{id}</b>? Its containers are stopped and removed.
      </ConfirmDelete>
    </Shell>
  );
}
