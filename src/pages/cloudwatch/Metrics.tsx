import { useState } from "react";
import { GetMetricStatisticsCommand, ListMetricsCommand, type Metric, type Statistic } from "@aws-sdk/client-cloudwatch";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import LineChart from "@cloudscape-design/components/line-chart";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { cloudwatch } from "../../clients/cloudwatch";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { useLoad } from "../../lib/useLoad";

const STATS = ["Average", "Sum", "Minimum", "Maximum", "SampleCount"].map((s) => ({ value: s, label: s }));
const RANGES = [
  { value: "3600000", label: "1h", period: 60 },
  { value: "10800000", label: "3h", period: 60 },
  { value: "43200000", label: "12h", period: 300 },
  { value: "86400000", label: "1d", period: 300 },
  { value: "604800000", label: "1w", period: 3600 },
];

const dims = (m: Metric) => (m.Dimensions ?? []).map((d) => `${d.Name}=${d.Value}`).join(", ");
const idOf = (m: Metric) => `${m.Namespace}|${m.MetricName}|${dims(m)}`;

function Graph({ metric }: { metric: Metric }) {
  const [stat, setStat] = useState(STATS[0]);
  const [range, setRange] = useState(RANGES[1]);
  const now = Date.now();
  const points = useLoad(async () => {
    const res = await cloudwatch.send(
      new GetMetricStatisticsCommand({
        Namespace: metric.Namespace,
        MetricName: metric.MetricName,
        Dimensions: metric.Dimensions,
        StartTime: new Date(Date.now() - Number(range.value)),
        EndTime: new Date(Date.now() + 60000),
        Period: range.period,
        Statistics: [stat.value as Statistic],
      }),
    );
    return (res.Datapoints ?? [])
      .map((d) => ({ x: d.Timestamp!, y: (d as Record<string, unknown>)[stat.value] as number }))
      .filter((p) => p.x && typeof p.y === "number")
      .sort((a, b) => a.x.getTime() - b.x.getTime());
  }, [idOf(metric), stat.value, range.value]);

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={`${metric.Namespace}${dims(metric) ? ` • ${dims(metric)}` : ""}`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Select selectedOption={stat} options={STATS} onChange={(e) => setStat(e.detail.selectedOption as (typeof STATS)[number])} ariaLabel="Statistic" />
              <Select selectedOption={range} options={RANGES} onChange={(e) => setRange(RANGES.find((r) => r.value === e.detail.selectedOption.value)!)} ariaLabel="Time range" />
            </SpaceBetween>
          }
        >
          {metric.MetricName}
        </Header>
      }
    >
      <LineChart
        series={[{ title: `${metric.MetricName} (${stat.value})`, type: "line", data: points.data ?? [] }]}
        xDomain={[new Date(now - Number(range.value)), new Date(now)]}
        xScaleType="time"
        xTitle="Time"
        yTitle={stat.value}
        height={260}
        hideFilter
        statusType={points.loading ? "loading" : points.error ? "error" : "finished"}
        errorText={points.error}
        loadingText="Loading chart"
        i18nStrings={{
          xTickFormatter: (d) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        }}
        empty={
          <Box textAlign="center" color="inherit">
            <b>No data available</b>
            <Box variant="p" color="inherit">
              There is no data for this time range.
            </Box>
          </Box>
        }
      />
    </Container>
  );
}

export default function Metrics() {
  const metrics = useLoad(async () => {
    const out: Metric[] = [];
    let NextToken: string | undefined;
    do {
      const res = await cloudwatch.send(new ListMetricsCommand({ NextToken }));
      out.push(...(res.Metrics ?? []));
      NextToken = res.NextToken;
    } while (NextToken);
    return out;
  }, []);
  const [selected, setSelected] = useState<Metric[]>([]);

  return (
    <Shell service="cloudwatch" breadcrumbs={[{ text: "CloudWatch", href: "/cloudwatch/log-groups" }, { text: "Metrics", href: "/cloudwatch/metrics" }]}>
      <SpaceBetween size="l">
        {selected[0] && <Graph metric={selected[0]} />}
        <ResourceTable
          title="Metrics"
          description="Select a metric to graph it."
          variant="container"
          stickyHeader={false}
          resourceName="metrics"
          filterPlaceholder="Search for any metric, dimension or namespace"
          items={metrics.data}
          loading={metrics.loading}
          error={metrics.error}
          onRefresh={() => metrics.reload()}
          trackBy={idOf}
          selectionType="single"
          selected={selected}
          onSelect={setSelected}
          columns={[
            { id: "namespace", header: "Namespace", cell: (m) => m.Namespace, sortingField: "Namespace" },
            { id: "name", header: "Metric name", cell: (m) => m.MetricName, sortingField: "MetricName", isRowHeader: true },
            { id: "dimensions", header: "Dimensions", cell: (m) => dims(m) || "-" },
          ]}
        />
      </SpaceBetween>
    </Shell>
  );
}
