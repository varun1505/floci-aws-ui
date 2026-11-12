import { useNavigate } from "react-router-dom";
import {
  DescribeAddressesCommand,
  DescribeAvailabilityZonesCommand,
  DescribeImagesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { ec2 } from "../../clients/ec2";
import { ACCOUNT_ID, REGIONS, getRegion } from "../../config";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { Stat } from "../../components/Stat";
import { formatDate } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { InstanceState, Pair, listInstances, tagName } from "./ec2util";

/** A count that shows "-" if this one call fails, so one unsupported API does not break the page. */
const count = async <T,>(p: Promise<T>, pick: (r: T) => unknown[] | undefined) => {
  try {
    return (pick(await p) ?? []).length;
  } catch {
    return undefined;
  }
};

export default function Ec2Dashboard() {
  const navigate = useNavigate();
  const region = getRegion();
  const regionLabel = REGIONS.find((r) => r.id === region)?.label ?? region;

  const data = useLoad(async () => {
    const [instances, keys, groups, volumes, snapshots, addresses, images, zones, vpcs] = await Promise.all([
      listInstances(),
      count(ec2.send(new DescribeKeyPairsCommand({})), (r) => r.KeyPairs),
      count(ec2.send(new DescribeSecurityGroupsCommand({})), (r) => r.SecurityGroups),
      count(ec2.send(new DescribeVolumesCommand({})), (r) => r.Volumes),
      count(ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"] })), (r) => r.Snapshots),
      count(ec2.send(new DescribeAddressesCommand({})), (r) => r.Addresses),
      count(ec2.send(new DescribeImagesCommand({})), (r) => r.Images),
      ec2.send(new DescribeAvailabilityZonesCommand({})).then((r) => r.AvailabilityZones ?? []).catch(() => []),
      ec2.send(new DescribeVpcsCommand({})).then((r) => r.Vpcs ?? []).catch(() => []),
    ]);
    return { instances, keys, groups, volumes, snapshots, addresses, images, zones, vpcs };
  }, []);

  const d = data.data;
  const live = (d?.instances ?? []).filter((i) => i.State?.Name !== "terminated");
  const running = live.filter((i) => i.State?.Name === "running").length;
  const defaultVpc = d?.vpcs.find((v) => v.IsDefault);

  return (
    <Shell service="ec2" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Dashboard", href: "/ec2/home" }]}>
      <ContentLayout
        header={
          <Header variant="h1" actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => data.reload()} />}>
            EC2 Dashboard
          </Header>
        }
      >
        <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
          <SpaceBetween size="l">
            <Container
              header={
                <Header variant="h2" description={`You are using the following Amazon EC2 resources in the ${regionLabel} Region:`}>
                  Resources
                </Header>
              }
            >
              <ColumnLayout columns={4} variant="text-grid">
                <Stat label="Instances (running)" value={running} to="/ec2/instances" loading={data.loading} />
                <Stat label="Instances" value={live.length} to="/ec2/instances" loading={data.loading} />
                <Stat label="Elastic IPs" value={d?.addresses} to="/ec2/elastic-ips" loading={data.loading} />
                <Stat label="Key pairs" value={d?.keys} to="/ec2/key-pairs" loading={data.loading} />
                <Stat label="Security groups" value={d?.groups} to="/ec2/security-groups" loading={data.loading} />
                <Stat label="Snapshots" value={d?.snapshots} to="/ec2/snapshots" loading={data.loading} />
                <Stat label="Volumes" value={d?.volumes} to="/ec2/volumes" loading={data.loading} />
                <Stat label="AMIs" value={d?.images} to="/ec2/images" loading={data.loading} />
              </ColumnLayout>
            </Container>

            <Container
              header={
                <Header variant="h2" description="To get started, launch an Amazon EC2 instance, which is a virtual server in the cloud.">
                  Launch instance
                </Header>
              }
            >
              <SpaceBetween size="s">
                <Button variant="primary" onClick={() => navigate("/ec2/instances/launch")}>
                  Launch instance
                </Button>
                <Box variant="small" color="text-body-secondary">
                  Note: Your instances will launch in the {regionLabel} Region.
                </Box>
              </SpaceBetween>
            </Container>

            <Table
              header={
                <Header variant="h2" counter={`(${live.length})`} actions={<Button onClick={() => navigate("/ec2/instances")}>View all instances</Button>}>
                  Instances
                </Header>
              }
              loading={data.loading}
              loadingText="Loading instances"
              items={live.slice(0, 5)}
              columnDefinitions={[
                { id: "name", header: "Name", cell: (i) => tagName(i.Tags) || "-" },
                { id: "id", header: "Instance ID", cell: (i) => <RouterLink to={`/ec2/instances/${i.InstanceId}`}>{i.InstanceId}</RouterLink>, isRowHeader: true },
                { id: "state", header: "Instance state", cell: (i) => <InstanceState state={i.State?.Name} /> },
                { id: "type", header: "Instance type", cell: (i) => i.InstanceType },
                { id: "launch", header: "Launch time", cell: (i) => formatDate(i.LaunchTime) },
              ]}
              empty={
                <Box textAlign="center" color="inherit" margin={{ vertical: "s" }}>
                  <b>No instances</b>
                  <Box variant="p" color="inherit">
                    You do not have any instances in this Region.
                  </Box>
                </Box>
              }
            />
          </SpaceBetween>

          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Service health</Header>}>
              <SpaceBetween size="m">
                <Pair label="Region">{regionLabel}</Pair>
                <Pair label="Status">
                  {data.error ? <StatusIndicator type="error">Unreachable</StatusIndicator> : <StatusIndicator type="success">This service is operating normally</StatusIndicator>}
                </Pair>
              </SpaceBetween>
            </Container>
            <Table
              variant="container"
              header={<Header variant="h2">Zones</Header>}
              loading={data.loading}
              loadingText="Loading zones"
              items={d?.zones ?? []}
              columnDefinitions={[
                { id: "name", header: "Zone name", cell: (z) => z.ZoneName, isRowHeader: true },
                { id: "id", header: "Zone ID", cell: (z) => z.ZoneId ?? "-" },
                {
                  id: "state",
                  header: "Status",
                  cell: (z) => <StatusIndicator type={z.State === "available" ? "success" : "warning"}>{z.State}</StatusIndicator>,
                },
              ]}
              empty={<Box textAlign="center">No zones</Box>}
            />
            <Container header={<Header variant="h2">Account attributes</Header>}>
              <SpaceBetween size="m">
                <Pair label="Account ID">{ACCOUNT_ID}</Pair>
                <Pair label="Default VPC">{defaultVpc?.VpcId}</Pair>
                <Pair label="Default VPC CIDR">{defaultVpc?.CidrBlock}</Pair>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Grid>
      </ContentLayout>
    </Shell>
  );
}
