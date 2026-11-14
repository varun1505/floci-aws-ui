import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DescribeRuleCommand, DisableRuleCommand, EnableRuleCommand, PutTargetsCommand, RemoveTargetsCommand, type Target, TestEventPatternCommand } from "@aws-sdk/client-eventbridge";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { eventbridge } from "../../clients/eventbridge";
import { Code } from "../../components/Code";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { FormModal } from "../../components/FormModal";
import { Copy, JsonBlock, Pair } from "../../components/Pair";
import { Shell } from "../../components/Shell";
import { errorMessage } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { useSubmit } from "../../lib/useSubmit";
import { RolePicker, isRoleArn } from "./RolePicker";
import { RuleForm } from "./RuleForm";
import { TARGET_KINDS, type TargetKind, TargetPicker, targetKind } from "./TargetPicker";
import { DEFAULT_BUS, RuleState, SAMPLE_EVENT, deleteRule, jsonError, jsonObjectError, listTargets, ruleHref, ruleType } from "./eventsutil";

const KINDS: TargetKind[] = ["lambda", "sqs", "sns", "states", "logs", "events", "kinesis"];

/** What the target receives: the whole event, a constant, one part of the event, or a transformed event. */
function inputSummary(t: Target): string {
  if (t.Input) return `Constant: ${t.Input}`;
  if (t.InputPath) return `Part of the event: ${t.InputPath}`;
  if (t.InputTransformer) return `Input transformer: ${t.InputTransformer.InputTemplate}`;
  return "Matched event";
}

export default function RuleDetail() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const bus = params.get("bus") || DEFAULT_BUS;
  const navigate = useNavigate();
  const notify = useNotify();
  const rule = useLoad(() => eventbridge.send(new DescribeRuleCommand({ Name: name, EventBusName: bus })), [name, bus]);
  const targets = useLoad(() => listTargets(name, bus), [name, bus]);
  const form = useSubmit();
  const [modal, setModal] = useState<"edit" | "target" | "delete" | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Target[]>([]);
  const [kind, setKind] = useState<TargetKind>("lambda");
  const [arn, setArn] = useState("");
  const [targetId, setTargetId] = useState("");
  const [input, setInput] = useState("");
  const [role, setRole] = useState("");
  const [sample, setSample] = useState(SAMPLE_EVENT);
  const [test, setTest] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  const r = rule.data;
  const enabled = r?.State !== "DISABLED";

  const setState = async (enable: boolean) => {
    setBusy(true);
    try {
      if (enable) await eventbridge.send(new EnableRuleCommand({ Name: name, EventBusName: bus }));
      else await eventbridge.send(new DisableRuleCommand({ Name: name, EventBusName: bus }));
      notify.success(`Rule ${name} was ${enable ? "enabled" : "disabled"}.`);
    } catch (e) {
      notify.error("Could not update the rule", e);
    }
    setBusy(false);
    rule.reload(true);
  };

  const openTarget = () => {
    setArn("");
    setInput("");
    setRole("");
    setTargetId(`target-${Date.now().toString(36)}`);
    form.setError("");
    setModal("target");
  };

  const addTarget = async () => {
    if (!arn) return form.setError(`Choose a ${TARGET_KINDS[kind].noun}.`);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetId)) return form.setError("Use up to 64 letters, numbers, dots, hyphens and underscores in the target ID.");
    if (input.trim()) {
      const invalid = jsonError(input, "The constant input");
      if (invalid) return form.setError(invalid);
    }
    if (role && !isRoleArn(role)) return form.setError("Enter a role ARN such as arn:aws:iam::000000000000:role/my-role.");
    const ok = await form.run(async () => {
      const res = await eventbridge.send(new PutTargetsCommand({ Rule: name, EventBusName: bus, Targets: [{ Id: targetId, Arn: arn, Input: input.trim() || undefined, RoleArn: role || undefined }] }));
      const failed = res.FailedEntries?.[0];
      if (failed) throw new Error(`${failed.ErrorCode}: ${failed.ErrorMessage}`);
      notify.success(`Target ${targetId} was added.`);
      targets.reload(true);
    });
    if (ok) setModal(undefined);
  };

  const removeTargets = async () => {
    try {
      await eventbridge.send(new RemoveTargetsCommand({ Rule: name, EventBusName: bus, Ids: selected.map((t) => t.Id ?? "") }));
      notify.success(`Removed ${selected.length} target${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not remove the target", e);
    }
    targets.reload(true);
  };

  const remove = async () => {
    try {
      await deleteRule(name, bus);
      notify.success(`Rule ${name} and its targets were deleted.`);
      navigate(bus === DEFAULT_BUS ? "/events/rules" : `/events/rules?bus=${encodeURIComponent(bus)}`);
    } catch (e) {
      notify.error("Could not delete the rule", e);
      setModal(undefined);
    }
  };

  const testPattern = async () => {
    setTest(undefined);
    const invalid = jsonObjectError(sample, "The sample event");
    if (invalid) return setTest({ ok: false, text: invalid });
    try {
      const res = await eventbridge.send(new TestEventPatternCommand({ EventPattern: r?.EventPattern ?? "", Event: sample }));
      setTest(res.Result ? { ok: true, text: "The sample event matches the event pattern." } : { ok: false, text: "The sample event does not match the event pattern." });
    } catch (e) {
      setTest({ ok: false, text: errorMessage(e) });
    }
  };

  const targetsTab = (
    <Table
      header={
        <Header
          variant="h2"
          counter={`(${targets.data?.length ?? 0})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={!selected.length} onClick={removeTargets}>
                Remove
              </Button>
              <Button onClick={openTarget}>Add target</Button>
            </SpaceBetween>
          }
        >
          Targets
        </Header>
      }
      loading={targets.loading && !targets.data}
      loadingText="Loading targets"
      items={targets.data ?? []}
      trackBy={(t) => t.Id ?? ""}
      selectionType="multi"
      selectedItems={selected}
      onSelectionChange={(e) => setSelected(e.detail.selectedItems)}
      wrapLines
      columnDefinitions={[
        { id: "id", header: "Target ID", cell: (t) => t.Id, isRowHeader: true },
        { id: "type", header: "Type", cell: (t) => targetKind(t.Arn) },
        { id: "arn", header: "ARN", cell: (t) => <Copy text={t.Arn} /> },
        { id: "input", header: "Input", cell: (t) => inputSummary(t) },
        { id: "role", header: "Role", cell: (t) => t.RoleArn?.split("/").pop() ?? "-" },
      ]}
      empty={
        <Box textAlign="center" margin={{ vertical: "m" }}>
          <SpaceBetween size="s">
            <div>
              <b>No targets</b>
              <Box variant="p">This rule does nothing until it has a target.</Box>
            </div>
            <Button onClick={openTarget}>Add target</Button>
          </SpaceBetween>
        </Box>
      }
    />
  );

  const testTab = (
    <Container header={<Header variant="h2" description="Check a sample event against the event pattern of this rule. No target runs.">Test event pattern</Header>}>
      <SpaceBetween size="m">
        <FormField label="Sample event" stretch>
          <Code value={sample} onChange={setSample} language="json" height={240} ariaLabel="Sample event" />
        </FormField>
        <Button onClick={testPattern}>Test pattern</Button>
        {test && <Alert type={test.ok ? "success" : "warning"}>{test.text}</Alert>}
      </SpaceBetween>
    </Container>
  );

  return (
    <Shell
      service="events"
      breadcrumbs={[
        { text: "Amazon EventBridge", href: "/events/rules" },
        { text: "Rules", href: "/events/rules" },
        { text: name, href: ruleHref(name, bus) },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => (rule.reload(), targets.reload())} />
                <Button disabled={!r} onClick={() => setModal("edit")}>
                  Edit
                </Button>
                <Button disabled={!r} loading={busy} onClick={() => setState(!enabled)}>
                  {enabled ? "Disable" : "Enable"}
                </Button>
                <Button disabled={!r} onClick={() => setModal("delete")}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {name}
          </Header>
        }
      >
        {rule.error ? (
          <Alert type="error" header="Could not load the rule">
            {rule.error}
          </Alert>
        ) : !r ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Rule details</Header>}>
              <ColumnLayout columns={3} variant="text-grid">
                <Pair label="Rule name">{r.Name}</Pair>
                <Pair label="Status">
                  <RuleState state={r.State} />
                </Pair>
                <Pair label="Type">{ruleType(r)}</Pair>
                <Pair label="Rule ARN">
                  <Copy text={r.Arn} />
                </Pair>
                <Pair label="Event bus name">{r.EventBusName ?? bus}</Pair>
                <Pair label="Description">{r.Description}</Pair>
              </ColumnLayout>
            </Container>
            {r.ScheduleExpression ? (
              <Container header={<Header variant="h2">Schedule</Header>}>
                <Pair label="Schedule expression">
                  <Box variant="code">{r.ScheduleExpression}</Box>
                </Pair>
              </Container>
            ) : (
              <Container header={<Header variant="h2">Event pattern</Header>}>
                <JsonBlock value={r.EventPattern} />
              </Container>
            )}
            <Tabs tabs={[{ id: "targets", label: "Targets", content: targetsTab }, ...(r.EventPattern ? [{ id: "test", label: "Test event pattern", content: testTab }] : [])]} />
          </SpaceBetween>
        )}
      </ContentLayout>

      <RuleForm
        visible={modal === "edit"}
        rule={r}
        bus={bus}
        buses={[bus]}
        onDismiss={() => setModal(undefined)}
        onSaved={() => {
          setModal(undefined);
          notify.success(`Rule ${name} was updated.`);
          rule.reload(true);
        }}
      />

      <FormModal visible={modal === "target"} header="Add target" submitLabel="Add target" size="large" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={addTarget}>
        {modal === "target" && (
          <TargetPicker
            kinds={KINDS}
            kind={kind}
            arn={arn}
            onChange={(k, a) => {
              setKind(k);
              setArn(a);
            }}
          />
        )}
        <FormField label="Target ID" description="A name for this target inside the rule.">
          <Input value={targetId} onChange={(e) => setTargetId(e.detail.value)} />
        </FormField>
        <FormField label="Constant (JSON text) - optional" description="Send this JSON to the target in place of the matched event. Leave empty to send the matched event." stretch>
          {modal === "target" && <Code value={input} onChange={setInput} language="json" height={120} ariaLabel="Constant input" />}
        </FormField>
        <FormField label={`Execution role${TARGET_KINDS[kind].needsRole ? "" : " - optional"}`} description={TARGET_KINDS[kind].needsRole ? "AWS needs a role for this target type. The emulator delivers without one." : "Most targets of this type don't need a role."}>
          {modal === "target" && <RolePicker value={role} onChange={setRole} />}
        </FormField>
      </FormModal>

      <ConfirmDelete visible={modal === "delete"} title="Delete rule" onCancel={() => setModal(undefined)} onConfirm={remove}>
        Delete <b>{name}</b> permanently? EventBridge can't delete a rule that has targets. So the console removes the {targets.data?.length ?? 0} target{targets.data?.length === 1 ? "" : "s"} of the rule first. The target resources themselves are not deleted.
      </ConfirmDelete>
    </Shell>
  );
}
