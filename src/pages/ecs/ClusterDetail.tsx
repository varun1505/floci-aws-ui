import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DeleteClusterCommand, DescribeClustersCommand } from "@aws-sdk/client-ecs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { ecs } from "../../clients/ecs";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { deleteClusterHint } from "./Clusters";
import { EcsStatus, clusterHref } from "./ecsutil";
import { ServicesTab } from "./ServicesTab";
import { TasksTab } from "./TasksTab";

export default function ClusterDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const cluster = useLoad(async () => {
    const res = await ecs.send(new DescribeClustersCommand({ clusters: [name] }));
    const found = res.clusters?.[0];
    if (!found) throw new Error(`Cluster ${name} was not found.`);
    return found;
  }, [name]);
  const [deleting, setDeleting] = useState(false);
  const c = cluster.data;
  const refresh = () => cluster.reload(true);

  const remove = async () => {
    try {
      await ecs.send(new DeleteClusterCommand({ cluster: name }));
      notify.success(`Cluster ${name} was deleted.`);
      navigate("/ecs/clusters");
    } catch (e) {
      notify.error(`Could not delete cluster ${name}. ${deleteClusterHint(e)}`.trim(), e);
      setDeleting(false);
    }
  };

  return (
    <Shell
      service="ecs"
      breadcrumbs={[
        { text: "Amazon Elastic Container Service", href: "/ecs/clusters" },
        { text: "Clusters", href: "/ecs/clusters" },
        { text: name, href: clusterHref(name) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => cluster.reload()} />
                <Button disabled={!c} onClick={() => setDeleting(true)}>
                  Delete cluster
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {cluster.error ? (
          <Alert type="error" header="Could not load the cluster">
            {cluster.error}
          </Alert>
        ) : !c ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Cluster overview</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="ARN">
                  <Copy text={c.clusterArn} />
                </Pair>
                <Pair label="Status">
                  <EcsStatus status={c.status} />
                </Pair>
                <Pair label="Active services">{String(c.activeServicesCount ?? 0)}</Pair>
                <Pair label="Container instances">{String(c.registeredContainerInstancesCount ?? 0)}</Pair>
                <Pair label="Running tasks">{String(c.runningTasksCount ?? 0)}</Pair>
                <Pair label="Pending tasks">{String(c.pendingTasksCount ?? 0)}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                { id: "services", label: "Services", content: <ServicesTab cluster={name} onChange={refresh} /> },
                { id: "tasks", label: "Tasks", content: <TasksTab cluster={name} onChange={refresh} /> },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>

      <ConfirmDelete
        visible={deleting}
        title="Delete cluster"
        warning="A cluster can be deleted only when it has no services and no running tasks."
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
      >
        Delete cluster <b>{name}</b>? This can't be undone.
      </ConfirmDelete>
    </Shell>
  );
}
