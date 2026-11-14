import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type ContainerDefinition, DeleteTaskDefinitionsCommand, DeregisterTaskDefinitionCommand, DescribeTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
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
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { EcsStatus, clusterHref, lastPart, listTaskDefArns, splitTaskDef, taskDefHref, taskHref } from "./ecsutil";
import { RunTaskModal } from "./RunTaskModal";
import { CreateServiceModal } from "./ServiceModals";
import { TaskDefinitionEditor } from "./TaskDefinitionEditor";
import { toInput } from "./taskdef";

const portText = (c: ContainerDefinition) => (c.portMappings ?? []).map((p) => `${p.hostPort && p.hostPort !== p.containerPort ? `${p.hostPort}:` : ""}${p.containerPort}/${p.protocol ?? "tcp"}`).join(", ");

export default function TaskDefinitionDetail() {
  const [params] = useSearchParams();
  // A full ARN works too. The page only needs family:revision.
  const name = lastPart(params.get("arn") ?? "");
  const navigate = useNavigate();
  const notify = useNotify();
  const def = useLoad(async () => (await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: name }))).taskDefinition, [name]);
  const td = def.data;
  const family = td?.family ?? splitTaskDef(name).family;
  const revisions = useLoad(async () => {
    const [active, inactive] = await Promise.all([listTaskDefArns("ACTIVE", family), listTaskDefArns("INACTIVE", family)]);
    return [...active.map((arn) => ({ revision: splitTaskDef(arn).revision, active: true })), ...inactive.map((arn) => ({ revision: splitTaskDef(arn).revision, active: false }))].sort(
      (a, b) => b.revision - a.revision,
    );
  }, [family]);
  const [dialog, setDialog] = useState<"revise" | "run" | "service" | "deregister" | "delete" | undefined>(undefined);
  const current = `${family}:${td?.revision ?? ""}`;
  const active = td?.status === "ACTIVE";
  const revisionOptions = (revisions.data ?? []).map((r) => ({ value: String(r.revision), label: `${family}:${r.revision}`, description: r.active ? undefined : "Inactive" }));

  const deregister = async () => {
    try {
      await ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition: current }));
      notify.success(`Task definition ${current} was deregistered.`);
    } catch (e) {
      notify.error(`Could not deregister ${current}`, e);
    }
    setDialog(undefined);
    def.reload(true);
    revisions.reload(true);
  };

  const remove = async () => {
    try {
      const res = await ecs.send(new DeleteTaskDefinitionsCommand({ taskDefinitions: [current] }));
      if (res.failures?.length) throw new Error(res.failures.map((f) => f.reason ?? f.detail ?? "Unknown failure").join(", "));
      notify.success(`Task definition ${current} was deleted.`);
      navigate("/ecs/task-definitions");
    } catch (e) {
      notify.error(`Could not delete ${current}`, e);
      setDialog(undefined);
    }
  };

  return (
    <Shell
      service="ecs"
      breadcrumbs={[
        { text: "Amazon Elastic Container Service", href: "/ecs/clusters" },
        { text: "Task definitions", href: "/ecs/task-definitions" },
        { text: td ? current : name, href: taskDefHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Select
                  selectedOption={td ? { value: String(td.revision), label: current } : null}
                  options={revisionOptions}
                  ariaLabel="Revision"
                  placeholder="Revision"
                  onChange={(e) => navigate(taskDefHref(`${family}:${e.detail.selectedOption.value}`))}
                />
                <ButtonDropdown
                  disabled={!active}
                  items={[
                    { id: "run", text: "Run task" },
                    { id: "service", text: "Create service" },
                  ]}
                  onItemClick={(e) => setDialog(e.detail.id as "run" | "service")}
                >
                  Deploy
                </ButtonDropdown>
                {active && (
                  <Button disabled={!td} onClick={() => setDialog("deregister")}>
                    Deregister
                  </Button>
                )}
                {td?.status === "INACTIVE" && <Button onClick={() => setDialog("delete")}>Delete</Button>}
                <Button variant="primary" disabled={!td} onClick={() => setDialog("revise")}>
                  Create new revision
                </Button>
              </SpaceBetween>
            }
          >
            {td ? current : name}
          </Header>
        }
      >
        {def.error ? (
          <Alert type="error" header="Could not load the task definition">
            {def.error}
          </Alert>
        ) : !td ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Overview</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={td.taskDefinitionArn} />
                </Pair>
                <Pair label="Status">
                  <EcsStatus status={td.status} />
                </Pair>
                <Pair label="Registered at">{formatDate(td.registeredAt)}</Pair>
                <Pair label="Deregistered at">{formatDate(td.deregisteredAt)}</Pair>
                <Pair label="App environment">{(td.requiresCompatibilities ?? []).join(", ")}</Pair>
                <Pair label="Works on">{(td.compatibilities ?? []).join(", ")}</Pair>
                <Pair label="Network mode">{td.networkMode}</Pair>
                <Pair label="Task CPU | Task memory">{`${td.cpu ?? "-"} | ${td.memory ?? "-"}`}</Pair>
                <Pair label="Task role">{lastPart(td.taskRoleArn)}</Pair>
                <Pair label="Task execution role">{lastPart(td.executionRoleArn)}</Pair>
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
                        <Header variant="h2" counter={`(${td.containerDefinitions?.length ?? 0})`}>
                          Containers
                        </Header>
                      }
                      wrapLines
                      items={td.containerDefinitions ?? []}
                      trackBy={(c) => c.name ?? ""}
                      empty={<Box textAlign="center">No containers</Box>}
                      columnDefinitions={[
                        { id: "name", header: "Container name", cell: (c) => c.name, isRowHeader: true },
                        { id: "image", header: "Image", cell: (c) => c.image ?? "-" },
                        { id: "essential", header: "Essential", cell: (c) => (c.essential === false ? "No" : "Yes") },
                        { id: "cpu", header: "CPU", cell: (c) => c.cpu ?? "-" },
                        { id: "memory", header: "Memory hard / soft limit", cell: (c) => `${c.memory ?? "-"} / ${c.memoryReservation ?? "-"}` },
                        { id: "ports", header: "Port mappings", cell: (c) => portText(c) || "-" },
                        { id: "command", header: "Command", cell: (c) => c.command?.join(",") || "-" },
                        { id: "env", header: "Environment variables", cell: (c) => c.environment?.length ?? 0 },
                        { id: "logs", header: "Log driver", cell: (c) => c.logConfiguration?.logDriver ?? "-" },
                      ]}
                    />
                  ),
                },
                {
                  id: "json",
                  label: "JSON",
                  content: (
                    <Container header={<Header variant="h2">JSON</Header>}>
                      <JsonBlock value={JSON.stringify(td)} />
                    </Container>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      {dialog === "revise" && td && <TaskDefinitionEditor initial={toInput(td)} onDismiss={() => setDialog(undefined)} onDone={(next) => navigate(taskDefHref(next))} />}
      {dialog === "run" && (
        <RunTaskModal
          taskDef={current}
          onDismiss={() => setDialog(undefined)}
          onDone={(cluster, tasks) => navigate(tasks.length === 1 ? taskHref(cluster, tasks[0].taskArn ?? "") : clusterHref(cluster))}
        />
      )}
      {dialog === "service" && <CreateServiceModal taskDef={current} onDismiss={() => setDialog(undefined)} onDone={(cluster) => navigate(clusterHref(cluster))} />}

      <ConfirmDelete
        visible={dialog === "deregister"}
        title="Deregister task definition"
        confirmText="deregister"
        actionLabel="Deregister"
        warning="Running tasks and services keep working. New tasks and services can't use a deregistered revision."
        onCancel={() => setDialog(undefined)}
        onConfirm={deregister}
      >
        Deregister <b>{current}</b>?
      </ConfirmDelete>
      <ConfirmDelete visible={dialog === "delete"} title="Delete task definition" onCancel={() => setDialog(undefined)} onConfirm={remove}>
        Delete <b>{current}</b>? This can't be undone.
      </ConfirmDelete>
    </Shell>
  );
}
