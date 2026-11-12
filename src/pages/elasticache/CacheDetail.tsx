import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DeleteCacheClusterCommand, DescribeCacheClustersCommand } from "@aws-sdk/client-elasticache";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import { elasticache } from "../../clients/elasticache";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Copy, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { cacheEndpoint } from "./Caches";
import { CacheStatus, ENGINE_LABEL, connectCommand, isSettled } from "./cacheutil";

export default function CacheDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const cache = useLoad(async () => (await elasticache.send(new DescribeCacheClustersCommand({ CacheClusterId: id, ShowCacheNodeInfo: true }))).CacheClusters?.[0], [id]);
  const [deleting, setDeleting] = useState(false);
  const c = cache.data;

  const settled = isSettled(c?.CacheClusterStatus);
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(() => cache.reload(true), 3000);
    return () => clearInterval(timer);
  }, [settled, cache.reload]);

  const remove = async () => {
    try {
      await elasticache.send(new DeleteCacheClusterCommand({ CacheClusterId: id }));
      notify.success(`Deleting ${id}.`);
      navigate("/elasticache/caches");
    } catch (e) {
      notify.error("Could not delete the cache", e);
      setDeleting(false);
    }
  };

  const endpoint = c ? cacheEndpoint(c) : undefined;
  const command = connectCommand(c?.Engine, endpoint?.Address, endpoint?.Port);

  return (
    <Shell service="elasticache" breadcrumbs={[{ text: "ElastiCache", href: "/elasticache/caches" }, { text: "Caches", href: "/elasticache/caches" }, { text: id, href: `/elasticache/caches/${id}` }]}>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => cache.reload()} />
                <Button onClick={() => setDeleting(true)}>Delete</Button>
              </SpaceBetween>
            }
          >
            {id}
          </Header>
        }
      >
        {cache.error ? (
          <Alert type="error" header="Could not load the cache">
            {cache.error}
          </Alert>
        ) : !c ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Cache details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Name">{c.CacheClusterId}</Pair>
                <Pair label="Status">
                  <CacheStatus status={c.CacheClusterStatus} />
                </Pair>
                <Pair label="ARN">
                  <Copy text={c.ARN} />
                </Pair>
                <Pair label="Engine">{ENGINE_LABEL[c.Engine ?? ""] ?? c.Engine}</Pair>
                <Pair label="Engine version">{c.EngineVersion}</Pair>
                <Pair label="Node type">{c.CacheNodeType}</Pair>
                <Pair label="Primary endpoint">
                  <Copy text={endpoint ? `${endpoint.Address}:${endpoint.Port}` : undefined} />
                </Pair>
                <Pair label="Created">{formatDate(c.CacheClusterCreateTime)}</Pair>
                <Pair label="Encryption in transit">{c.TransitEncryptionEnabled ? "Enabled" : "Disabled"}</Pair>
              </ColumnLayout>
            </Container>
            <Container header={<Header variant="h2" description="Run this from a machine that can reach the environment.">Connect to the cache</Header>}>
              {command ? <Copy text={command} /> : <Box color="text-status-inactive">The endpoint is not ready yet.</Box>}
            </Container>
            <Table
              header={<Header variant="h2" counter={`(${c.CacheNodes?.length ?? 0})`}>Nodes</Header>}
              items={c.CacheNodes ?? []}
              columnDefinitions={[
                { id: "id", header: "Node ID", cell: (n) => n.CacheNodeId, isRowHeader: true },
                { id: "status", header: "Status", cell: (n) => <CacheStatus status={n.CacheNodeStatus} /> },
                { id: "endpoint", header: "Endpoint", cell: (n) => (n.Endpoint ? `${n.Endpoint.Address}:${n.Endpoint.Port}` : "-") },
                { id: "zone", header: "Zone", cell: (n) => n.CustomerAvailabilityZone ?? "-" },
                { id: "created", header: "Created", cell: (n) => formatDate(n.CacheNodeCreateTime) },
              ]}
              empty={<Box textAlign="center">No nodes</Box>}
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      <ConfirmDelete visible={deleting} title={`Delete ${id}`} onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a cache deletes all the data in it." />
    </Shell>
  );
}
