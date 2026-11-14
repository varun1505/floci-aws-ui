import { useState } from "react";
import { DeleteServiceCommand, type Service } from "@aws-sdk/client-ecs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { EcsStatus, lastPart, listServices, taskDefHref, usePoll } from "./ecsutil";
import { CreateServiceModal, UpdateServiceModal } from "./ServiceModals";

/** The Services tab of a cluster: the list, and the deployments and events of the selected service. */
export function ServicesTab({ cluster, onChange }: { cluster: string; onChange: () => void }) {
  const notify = useNotify();
  const list = useLoad(() => listServices(cluster), [cluster]);
  const [selectedArn, setSelectedArn] = useState("");
  const [dialog, setDialog] = useState<"create" | "update" | "delete" | undefined>(undefined);
  // Keep the selection by ARN, so the panel shows fresh numbers after each reload.
  const selected = list.data?.find((s) => s.serviceArn === selectedArn);

  // Keep reading while a service still starts or stops tasks.
  usePoll(!!list.data?.some((s) => s.status === "DRAINING" || (s.runningCount ?? 0) !== (s.desiredCount ?? 0)), list.reload);

  const reload = () => {
    list.reload(true);
    onChange();
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await ecs.send(new DeleteServiceCommand({ cluster, service: selected.serviceName, force: true }));
      notify.success(`Service ${selected.serviceName} was deleted.`);
      setSelectedArn("");
    } catch (e) {
      notify.error(`Could not delete service ${selected.serviceName}`, e);
    }
    setDialog(undefined);
    reload();
  };

  return (
    <SpaceBetween size="l">
      <ResourceTable
        title="Services"
        variant="container"
        stickyHeader={false}
        resourceName="services"
        filterPlaceholder="Search services"
        emptyDescription="A service keeps a set number of tasks running and replaces a task when it stops."
        items={list.data}
        loading={list.loading}
        error={list.error}
        onRefresh={() => (list.reload(), onChange())}
        trackBy={(s) => s.serviceArn ?? ""}
        selectionType="single"
        selected={selected ? [selected] : []}
        onSelect={(items) => setSelectedArn(items[0]?.serviceArn ?? "")}
        emptyAction={<Button onClick={() => setDialog("create")}>Create</Button>}
        actions={
          <>
            <Button disabled={!selected} onClick={() => setDialog("update")}>
              Update
            </Button>
            <Button disabled={!selected} onClick={() => setDialog("delete")}>
              Delete service
            </Button>
            <Button variant="primary" onClick={() => setDialog("create")}>
              Create
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Service name", cell: (s) => s.serviceName, sortingField: "serviceName", isRowHeader: true },
          { id: "status", header: "Status", cell: (s) => <EcsStatus status={s.status} />, sortingField: "status" },
          { id: "taskdef", header: "Task definition", cell: (s) => <RouterLink to={taskDefHref(s.taskDefinition ?? "")}>{lastPart(s.taskDefinition)}</RouterLink> },
          { id: "tasks", header: "Tasks (desired / running / pending)", cell: (s) => `${s.desiredCount ?? 0} / ${s.runningCount ?? 0} / ${s.pendingCount ?? 0}` },
          { id: "launch", header: "Launch type", cell: (s) => s.launchType ?? s.capacityProviderStrategy?.[0]?.capacityProvider ?? "-" },
          { id: "created", header: "Created at", cell: (s) => formatDate(s.createdAt), sortingComparator: (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) },
        ]}
      />

      {selected && <ServicePanel service={selected} />}

      {dialog === "create" && <CreateServiceModal cluster={cluster} onDismiss={() => setDialog(undefined)} onDone={reload} />}
      {dialog === "update" && selected && <UpdateServiceModal cluster={cluster} service={selected} onDismiss={() => setDialog(undefined)} onDone={reload} />}
      <ConfirmDelete
        visible={dialog === "delete"}
        title="Delete service"
        warning={(selected?.desiredCount ?? 0) > 0 ? "The service still wants running tasks. Deleting it forces them to stop." : undefined}
        onCancel={() => setDialog(undefined)}
        onConfirm={remove}
      >
        Delete service <b>{selected?.serviceName}</b>? This can't be undone.
      </ConfirmDelete>
    </SpaceBetween>
  );
}

function ServicePanel({ service }: { service: Service }) {
  const deployments = service.deployments ?? [];
  const events = service.events ?? [];
  return (
    <Container header={<Header variant="h2">{service.serviceName}</Header>}>
      <Tabs
        tabs={[
          {
            id: "deployments",
            label: `Deployments (${deployments.length})`,
            content: (
              <Table
                variant="embedded"
                items={deployments}
                trackBy={(d) => d.id ?? ""}
                empty={<Box textAlign="center">No deployments</Box>}
                columnDefinitions={[
                  { id: "id", header: "Deployment ID", cell: (d) => d.id, isRowHeader: true },
                  { id: "status", header: "Status", cell: (d) => <EcsStatus status={d.status} /> },
                  { id: "rollout", header: "Rollout state", cell: (d) => <EcsStatus status={d.rolloutState} /> },
                  { id: "taskdef", header: "Task definition", cell: (d) => <RouterLink to={taskDefHref(d.taskDefinition ?? "")}>{lastPart(d.taskDefinition)}</RouterLink> },
                  { id: "tasks", header: "Desired / running / pending / failed", cell: (d) => `${d.desiredCount ?? 0} / ${d.runningCount ?? 0} / ${d.pendingCount ?? 0} / ${d.failedTasks ?? 0}` },
                  { id: "created", header: "Created at", cell: (d) => formatDate(d.createdAt) },
                  { id: "updated", header: "Updated at", cell: (d) => formatDate(d.updatedAt) },
                ]}
              />
            ),
          },
          {
            id: "events",
            label: `Events (${events.length})`,
            content: (
              <Table
                variant="embedded"
                wrapLines
                items={events}
                trackBy={(e) => e.id ?? ""}
                empty={<Box textAlign="center">No events</Box>}
                columnDefinitions={[
                  { id: "time", header: "Started at", width: 230, cell: (e) => formatDate(e.createdAt) },
                  { id: "message", header: "Message", cell: (e) => e.message, isRowHeader: true },
                  { id: "id", header: "Event ID", cell: (e) => e.id },
                ]}
              />
            ),
          },
        ]}
      />
    </Container>
  );
}
