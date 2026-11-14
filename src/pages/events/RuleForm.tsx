import { useEffect, useState } from "react";
import { PutRuleCommand, type Rule } from "@aws-sdk/client-eventbridge";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import Toggle from "@cloudscape-design/components/toggle";
import { eventbridge } from "../../clients/eventbridge";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { prettyJson } from "../../components/Pair";
import { useSubmit } from "../../lib/useSubmit";
import { DEFAULT_BUS, SAMPLE_PATTERNS, isScheduleExpression, jsonObjectError } from "./eventsutil";

/** The dialog that creates a rule, or edits one when `rule` is given. PutRule does both. */
export function RuleForm({ visible, rule, bus, buses, onDismiss, onSaved }: { visible: boolean; rule?: Rule; bus: string; buses: string[]; onDismiss: () => void; onSaved: (name: string, bus: string) => void }) {
  const form = useSubmit();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busName, setBusName] = useState(bus);
  const [kind, setKind] = useState<"pattern" | "schedule">("pattern");
  const [pattern, setPattern] = useState(SAMPLE_PATTERNS[0].pattern);
  const [schedule, setSchedule] = useState("rate(5 minutes)");
  const [enabled, setEnabled] = useState(true);
  // A new key makes the editor start again from the sample the user picked.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(rule?.Name ?? "");
    setDescription(rule?.Description ?? "");
    setBusName(rule?.EventBusName ?? bus);
    setKind(rule?.ScheduleExpression ? "schedule" : "pattern");
    setPattern(rule?.EventPattern ? prettyJson(rule.EventPattern) : SAMPLE_PATTERNS[0].pattern);
    setSchedule(rule?.ScheduleExpression ?? "rate(5 minutes)");
    setEnabled(rule ? rule.State !== "DISABLED" : true);
    setEditorKey((k) => k + 1);
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return form.setError("Use up to 64 letters, numbers, dots, hyphens and underscores in the name.");
    if (kind === "pattern") {
      const invalid = jsonObjectError(pattern, "The event pattern");
      if (invalid) return form.setError(invalid);
    } else {
      if (busName !== DEFAULT_BUS) return form.setError("A schedule rule works only on the default event bus.");
      if (!isScheduleExpression(schedule)) return form.setError("Enter a schedule such as rate(5 minutes) or cron(0 12 * * ? *).");
    }
    const ok = await form.run(async () => {
      await eventbridge.send(
        new PutRuleCommand({
          Name: name,
          Description: description || undefined,
          EventBusName: busName,
          EventPattern: kind === "pattern" ? pattern : undefined,
          ScheduleExpression: kind === "schedule" ? schedule.trim() : undefined,
          State: enabled ? "ENABLED" : "DISABLED",
        }),
      );
    });
    if (ok) onSaved(name, busName);
  };

  return (
    <FormModal visible={visible} header={rule ? "Edit rule" : "Create rule"} submitLabel={rule ? "Save changes" : "Create rule"} size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={save}>
      <FormField label="Name" constraintText="Up to 64 letters, numbers, dots, hyphens and underscores.">
        <Input value={name} placeholder="my-rule" disabled={!!rule} onChange={(e) => setName(e.detail.value)} />
      </FormField>
      <FormField label="Description - optional">
        <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
      </FormField>
      <FormField label="Event bus">
        <Select selectedOption={{ value: busName, label: busName }} disabled={!!rule} onChange={(e) => setBusName(e.detail.selectedOption.value ?? DEFAULT_BUS)} options={buses.map((value) => ({ value, label: value }))} ariaLabel="Event bus" />
      </FormField>
      <FormField label="Rule type">
        <RadioGroup
          value={kind}
          onChange={(e) => setKind(e.detail.value as "pattern" | "schedule")}
          items={[
            { value: "pattern", label: "Rule with an event pattern", description: "Runs when an event on the bus matches the pattern." },
            { value: "schedule", label: "Schedule", description: "Runs at a fixed rate or on a cron schedule. Default event bus only.", disabled: busName !== DEFAULT_BUS },
          ]}
        />
      </FormField>
      {kind === "pattern" ? (
        <>
          <FormField label="Sample patterns" description="Pick one to start from. It replaces the pattern below.">
            <Select
              selectedOption={null}
              placeholder="Choose a sample pattern"
              onChange={(e) => {
                setPattern(SAMPLE_PATTERNS.find((s) => s.value === e.detail.selectedOption.value)?.pattern ?? pattern);
                setEditorKey((k) => k + 1);
              }}
              options={SAMPLE_PATTERNS.map(({ value, label }) => ({ value, label }))}
              ariaLabel="Sample patterns"
            />
          </FormField>
          <FormField label="Event pattern" description="A JSON object. An event matches when every field in the pattern matches." stretch>
            {visible && <Code key={editorKey} value={pattern} onChange={setPattern} language="json" height={200} ariaLabel="Event pattern" />}
          </FormField>
        </>
      ) : (
        <FormField label="Schedule expression" constraintText="rate(value unit) or cron(minutes hours day-of-month month day-of-week year). Times are in UTC.">
          <Input value={schedule} placeholder="rate(5 minutes)" onChange={(e) => setSchedule(e.detail.value)} />
        </FormField>
      )}
      <Toggle checked={enabled} onChange={(e) => setEnabled(e.detail.checked)}>
        Enable the rule
      </Toggle>
    </FormModal>
  );
}
