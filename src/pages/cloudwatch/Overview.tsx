import { useNavigate } from "react-router-dom";
import { DescribeAlarmsCommand, ListMetricsCommand } from "@aws-sdk/client-cloudwatch";
import { DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { cloudwatch } from "../../clients/cloudwatch";
import { logs } from "../../clients/logs";
import { getRegion } from "../../config";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { Stat } from "../../components/Stat";
import { formatBytes, formatDate } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { groupHref } from "./LogGroups";

export default function CloudWatchOverview() {
  const navigate = useNavigate();
  const data = useLoad(async () => {
    const [alarms, groups, metrics] = await Promise.all([
      cloudwatch.send(new DescribeAlarmsCommand({})).then((r) => r.MetricAlarms ?? []),
      logs.send(new DescribeLogGroupsCommand({})).then((r) => r.logGroups ?? []),
      cloudwatch.send(new ListMetricsCommand({})).then((r) => r.Metrics ?? []).catch(() => []),
    ]);
    return { alarms, groups, metrics };
  }, []);

  const alarms = data.data?.alarms ?? [];
  const groups = data.data?.groups ?? [];
  const by = (state: string) => alarms.filter((a) => a.StateValue === state).length;
  const namespaces = new Set((data.data?.metrics ?? []).map((m) => m.Namespace)).size;
  const recentGroups = [...groups].sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0)).slice(0, 5);

  return (
    <Shell service="cloudwatch" breadcrumbs={[{ text: "CloudWatch", href: "/cloudwatch/home" }, { text: "Overview", href: "/cloudwatch/home" }]}>
      <ContentLayout
        header={
          <Header variant="h1" description={`Resources for ${getRegion()}`} actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => data.reload()} />}>
            CloudWatch: Overview
          </Header>
        }
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2" actions={<Button onClick={() => navigate("/cloudwatch/alarms")}>View alarms</Button>}>Alarms by state</Header>}>
            <ColumnLayout columns={3} variant="text-grid">
              <Stat label="In alarm" value={by("ALARM")} to="/cloudwatch/alarms" loading={data.loading} />
              <Stat label="Insufficient data" value={by("INSUFFICIENT_DATA")} to="/cloudwatch/alarms" loading={data.loading} />
              <Stat label="OK" value={by("OK")} to="/cloudwatch/alarms" loading={data.loading} />
            </ColumnLayout>
          </Container>

          <Container header={<Header variant="h2">Resources</Header>}>
            <ColumnLayout columns={4} variant="text-grid">
              <Stat label="Log groups" value={groups.length} to="/cloudwatch/log-groups" loading={data.loading} />
              <Stat label="Stored log data" value={formatBytes(groups.reduce((s, g) => s + (g.storedBytes ?? 0), 0))} loading={data.loading} />
              <Stat label="Metrics" value={data.data?.metrics.length} to="/cloudwatch/metrics" loading={data.loading} />
              <Stat label="Metric namespaces" value={namespaces} to="/cloudwatch/metrics" loading={data.loading} />
            </ColumnLayout>
          </Container>

          <ColumnLayout columns={2}>
            <Table
              header={<Header variant="h2" counter={`(${alarms.length})`}>Recent alarms</Header>}
              loading={data.loading}
              loadingText="Loading alarms"
              items={alarms.slice(0, 5)}
              columnDefinitions={[
                { id: "name", header: "Name", cell: (a) => a.AlarmName, isRowHeader: true },
                {
                  id: "state",
                  header: "State",
                  cell: (a) =>
                    a.StateValue === "OK" ? (
                      <StatusIndicator type="success">OK</StatusIndicator>
                    ) : a.StateValue === "ALARM" ? (
                      <StatusIndicator type="error">In alarm</StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Insufficient data</StatusIndicator>
                    ),
                },
                { id: "metric", header: "Metric", cell: (a) => `${a.Namespace} / ${a.MetricName}` },
              ]}
              empty={
                <Box textAlign="center" color="inherit" margin={{ vertical: "s" }}>
                  <b>No alarms</b>
                  <Box variant="p" color="inherit">
                    Create an alarm to watch a metric.
                  </Box>
                </Box>
              }
            />
            <Table
              header={
                <Header variant="h2" counter={`(${groups.length})`} actions={<Button onClick={() => navigate("/cloudwatch/log-groups")}>View all</Button>}>
                  Newest log groups
                </Header>
              }
              loading={data.loading}
              loadingText="Loading log groups"
              items={recentGroups}
              columnDefinitions={[
                { id: "name", header: "Log group", cell: (g) => <RouterLink to={groupHref(g.logGroupName ?? "")}>{g.logGroupName}</RouterLink>, isRowHeader: true },
                { id: "created", header: "Creation time", cell: (g) => formatDate(g.creationTime) },
              ]}
              empty={
                <Box textAlign="center" color="inherit" margin={{ vertical: "s" }}>
                  <b>No log groups</b>
                  <Box variant="p" color="inherit">
                    Log groups appear when your applications write logs.
                  </Box>
                </Box>
              }
            />
          </ColumnLayout>
        </SpaceBetween>
      </ContentLayout>
    </Shell>
  );
}
