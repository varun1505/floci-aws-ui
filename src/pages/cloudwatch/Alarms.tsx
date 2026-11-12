import { useState } from "react";
import {
  DeleteAlarmsCommand,
  DescribeAlarmsCommand,
  ListMetricsCommand,
  PutMetricAlarmCommand,
  type ComparisonOperator,
  type MetricAlarm,
  type Statistic,
} from "@aws-sdk/client-cloudwatch";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { cloudwatch } from "../../clients/cloudwatch";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";

const OPERATORS = [
  { value: "GreaterThanThreshold", label: "Greater (> threshold)", sign: ">" },
  { value: "GreaterThanOrEqualToThreshold", label: "Greater/Equal (>= threshold)", sign: ">=" },
  { value: "LessThanOrEqualToThreshold", label: "Lower/Equal (<= threshold)", sign: "<=" },
  { value: "LessThanThreshold", label: "Lower (< threshold)", sign: "<" },
];
const STATS = ["Average", "Sum", "Minimum", "Maximum", "SampleCount"].map((s) => ({ value: s, label: s }));
const PERIODS = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "3600", label: "1 hour" },
];

function State({ value }: { value?: string }) {
  if (value === "OK") return <StatusIndicator type="success">OK</StatusIndicator>;
  if (value === "ALARM") return <StatusIndicator type="error">In alarm</StatusIndicator>;
  return <StatusIndicator type="pending">Insufficient data</StatusIndicator>;
}

export default function Alarms() {
  const notify = useNotify();
  const alarms = useLoad(async () => {
    const out: MetricAlarm[] = [];
    let NextToken: string | undefined;
    do {
      const res = await cloudwatch.send(new DescribeAlarmsCommand({ NextToken }));
      out.push(...(res.MetricAlarms ?? []));
      NextToken = res.NextToken;
    } while (NextToken);
    return out;
  }, []);
  const [selected, setSelected] = useState<MetricAlarm[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("");
  const [metric, setMetric] = useState("");
  const [stat, setStat] = useState(STATS[0]);
  const [period, setPeriod] = useState(PERIODS[1]);
  const [operator, setOperator] = useState(OPERATORS[0]);
  const [threshold, setThreshold] = useState("0");
  const [known, setKnown] = useState<{ value: string; label: string; namespace: string; metric: string }[]>([]);

  const openCreate = async () => {
    setError("");
    setCreating(true);
    try {
      const res = await cloudwatch.send(new ListMetricsCommand({}));
      const seen = new Set<string>();
      setKnown(
        (res.Metrics ?? [])
          .map((m) => ({ value: `${m.Namespace}|${m.MetricName}`, label: `${m.Namespace} > ${m.MetricName}`, namespace: m.Namespace ?? "", metric: m.MetricName ?? "" }))
          .filter((m) => !seen.has(m.value) && seen.add(m.value)),
      );
    } catch {
      setKnown([]);
    }
  };

  const create = async () => {
    if (!name || !namespace || !metric) return setError("Alarm name, namespace and metric name are required.");
    if (isNaN(Number(threshold))) return setError("Threshold must be a number.");
    setBusy(true);
    try {
      await cloudwatch.send(
        new PutMetricAlarmCommand({
          AlarmName: name,
          Namespace: namespace,
          MetricName: metric,
          Statistic: stat.value as Statistic,
          Period: Number(period.value),
          EvaluationPeriods: 1,
          Threshold: Number(threshold),
          ComparisonOperator: operator.value as ComparisonOperator,
        }),
      );
      notify.success(`Successfully created alarm ${name}.`);
      setCreating(false);
      setName("");
      alarms.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      await cloudwatch.send(new DeleteAlarmsCommand({ AlarmNames: selected.map((a) => a.AlarmName ?? "") }));
      notify.success(`Deleted ${selected.length} alarm${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the alarm", e);
    }
    setDeleting(false);
    alarms.reload();
  };

  const sign = (op?: string) => OPERATORS.find((o) => o.value === op)?.sign ?? op ?? "";

  return (
    <Shell service="cloudwatch" contentType="table" breadcrumbs={[{ text: "CloudWatch", href: "/cloudwatch/home" }, { text: "Alarms", href: "/cloudwatch/alarms" }]}>
      <ResourceTable
        title="Alarms"
        resourceName="alarms"
        filterPlaceholder="Search alarms"
        items={alarms.data}
        loading={alarms.loading}
        error={alarms.error}
        onRefresh={() => alarms.reload()}
        trackBy={(a) => a.AlarmName ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create alarm</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create alarm
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (a) => a.AlarmName, sortingField: "AlarmName", isRowHeader: true },
          { id: "state", header: "State", cell: (a) => <State value={a.StateValue} />, sortingField: "StateValue" },
          { id: "updated", header: "Last state update", cell: (a) => formatDate(a.StateUpdatedTimestamp) },
          {
            id: "conditions",
            header: "Conditions",
            cell: (a) => `${a.MetricName} ${sign(a.ComparisonOperator)} ${a.Threshold} for ${a.EvaluationPeriods} datapoints within ${((a.Period ?? 0) * (a.EvaluationPeriods ?? 1)) / 60} minutes`,
          },
          { id: "namespace", header: "Namespace", cell: (a) => a.Namespace ?? "-" },
          { id: "actions", header: "Actions", cell: (a) => (a.ActionsEnabled ? "Actions enabled" : "No actions") },
        ]}
      />

      <Modal
        size="large"
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create alarm"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create alarm
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Alarm name" errorText={error}>
            <Input value={name} onChange={(e) => setName(e.detail.value)} autoFocus />
          </FormField>
          {known.length > 0 && (
            <FormField label="Select metric" description="Choose an existing metric, or type the namespace and name below.">
              <Select
                selectedOption={known.find((k) => k.namespace === namespace && k.metric === metric) ?? null}
                options={known}
                placeholder="Choose a metric"
                filteringType="auto"
                onChange={(e) => {
                  const k = known.find((x) => x.value === e.detail.selectedOption.value);
                  if (k) {
                    setNamespace(k.namespace);
                    setMetric(k.metric);
                  }
                }}
              />
            </FormField>
          )}
          <ColumnLayout columns={2}>
            <FormField label="Namespace">
              <Input value={namespace} placeholder="AWS/Lambda" onChange={(e) => setNamespace(e.detail.value)} />
            </FormField>
            <FormField label="Metric name">
              <Input value={metric} placeholder="Errors" onChange={(e) => setMetric(e.detail.value)} />
            </FormField>
            <FormField label="Statistic">
              <Select selectedOption={stat} options={STATS} onChange={(e) => setStat(e.detail.selectedOption as (typeof STATS)[number])} />
            </FormField>
            <FormField label="Period">
              <Select selectedOption={period} options={PERIODS} onChange={(e) => setPeriod(e.detail.selectedOption as (typeof PERIODS)[number])} />
            </FormField>
            <FormField label="Whenever the metric is...">
              <Select selectedOption={operator} options={OPERATORS} onChange={(e) => setOperator(OPERATORS.find((o) => o.value === e.detail.selectedOption.value)!)} />
            </FormField>
            <FormField label="than... (threshold)">
              <Input type="number" value={threshold} onChange={(e) => setThreshold(e.detail.value)} />
            </FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Modal>

      <ConfirmDelete visible={deleting} title={`Delete alarm${selected.length === 1 ? "" : "s"}`} onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((a) => a.AlarmName).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
