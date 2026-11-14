import { useEffect, useState } from "react";
import { CreateScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Toggle from "@cloudscape-design/components/toggle";
import { scheduler } from "../../clients/scheduler";
import { Code } from "../../components/Code";
import { FormModal } from "../../components/FormModal";
import { useSubmit } from "../../lib/useSubmit";
import { RolePicker, isRoleArn } from "./RolePicker";
import { type TargetKind, TargetPicker, kindOfArn } from "./TargetPicker";
import { jsonError } from "./eventsutil";
import { KINDS, type Schedule, type ScheduleKind, WINDOWS, parseExpression, timezones, windowLabel } from "./schedulerutil";

const TARGETS: TargetKind[] = ["lambda", "sqs", "sns", "states"];

/** The dialog that creates a schedule, or edits one when `schedule` is given. */
export function ScheduleForm({ visible, schedule, groups, onDismiss, onSaved }: { visible: boolean; schedule?: Schedule; groups: string[]; onDismiss: () => void; onSaved: (name: string) => void }) {
  const form = useSubmit();
  const [name, setName] = useState("");
  const [group, setGroup] = useState("default");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("rate");
  const [value, setValue] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [flexible, setFlexible] = useState(0);
  const [targetKind, setTargetKind] = useState<TargetKind>("lambda");
  const [arn, setArn] = useState("");
  const [role, setRole] = useState("");
  const [input, setInput] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const parsed = parseExpression(schedule?.ScheduleExpression);
    setName(schedule?.Name ?? "");
    setGroup(schedule?.GroupName ?? "default");
    setDescription(schedule?.Description ?? "");
    setKind(parsed.kind);
    setValue(parsed.value);
    setTimezone(schedule?.ScheduleExpressionTimezone ?? "UTC");
    setFlexible(schedule?.FlexibleTimeWindow?.Mode === "FLEXIBLE" ? (schedule.FlexibleTimeWindow.MaximumWindowInMinutes ?? 0) : 0);
    setTargetKind(kindOfArn(schedule?.Target?.Arn ?? "", TARGETS));
    setArn(schedule?.Target?.Arn ?? "");
    setRole(schedule?.Target?.RoleArn ?? "");
    setInput(schedule?.Target?.Input ?? "");
    setEnabled(schedule ? schedule.State !== "DISABLED" : true);
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    if (!/^[0-9A-Za-z._-]{1,64}$/.test(name)) return form.setError("Use up to 64 letters, numbers, dots, hyphens and underscores in the name.");
    if (!KINDS[kind].test.test(value.trim())) return form.setError(KINDS[kind].error);
    if (!arn) return form.setError("Choose a target.");
    if (!isRoleArn(role)) return form.setError("Choose an execution role, or type a role ARN such as arn:aws:iam::000000000000:role/my-role.");
    // Lambda and Step Functions take JSON only. SQS and SNS take any text.
    if (input.trim() && (targetKind === "lambda" || targetKind === "states")) {
      const invalid = jsonError(input, "The input");
      if (invalid) return form.setError(invalid);
    }
    const fields = {
      Name: name,
      GroupName: group,
      Description: description || undefined,
      ScheduleExpression: `${kind}(${value.trim()})`,
      ScheduleExpressionTimezone: timezone,
      FlexibleTimeWindow: flexible ? { Mode: "FLEXIBLE" as const, MaximumWindowInMinutes: flexible } : { Mode: "OFF" as const },
      // Keep the settings this form does not show, such as the retry policy.
      Target: { ...schedule?.Target, Arn: arn, RoleArn: role, Input: input.trim() ? input : undefined },
      State: enabled ? ("ENABLED" as const) : ("DISABLED" as const),
      StartDate: schedule?.StartDate,
      EndDate: schedule?.EndDate,
      KmsKeyArn: schedule?.KmsKeyArn,
      ActionAfterCompletion: schedule?.ActionAfterCompletion,
    };
    const ok = await form.run(async () => {
      if (schedule) await scheduler.send(new UpdateScheduleCommand(fields));
      else await scheduler.send(new CreateScheduleCommand(fields));
    });
    if (ok) onSaved(name);
  };

  const windows = WINDOWS.includes(flexible) ? WINDOWS : [...WINDOWS, flexible].sort((a, b) => a - b);

  return (
    <FormModal visible={visible} header={schedule ? "Edit schedule" : "Create schedule"} submitLabel={schedule ? "Save schedule" : "Create schedule"} size="large" busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={save}>
      <FormField label="Schedule name" constraintText="Up to 64 letters, numbers, dots, hyphens and underscores.">
        <Input value={name} placeholder="my-schedule" disabled={!!schedule} onChange={(e) => setName(e.detail.value)} />
      </FormField>
      <FormField label="Description - optional">
        <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
      </FormField>
      <FormField label="Schedule group">
        <Select selectedOption={{ value: group, label: group }} disabled={!!schedule} onChange={(e) => setGroup(e.detail.selectedOption.value ?? "default")} options={groups.map((g) => ({ value: g, label: g }))} ariaLabel="Schedule group" />
      </FormField>
      <FormField label="Schedule pattern">
        <Select
          selectedOption={{ value: kind, label: KINDS[kind].label }}
          onChange={(e) => {
            setKind(e.detail.selectedOption.value as ScheduleKind);
            setValue("");
          }}
          options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: v.label }))}
          ariaLabel="Schedule pattern"
        />
      </FormField>
      <FormField label={KINDS[kind].field} constraintText={KINDS[kind].hint}>
        <Input value={value} placeholder={KINDS[kind].placeholder} onChange={(e) => setValue(e.detail.value)} />
      </FormField>
      <FormField label="Time zone">
        <Select selectedOption={{ value: timezone, label: timezone }} onChange={(e) => setTimezone(e.detail.selectedOption.value ?? "UTC")} options={timezones().map((z) => ({ value: z, label: z }))} filteringType="auto" ariaLabel="Time zone" />
      </FormField>
      <FormField label="Flexible time window" description="The schedule starts its target at some point inside this window.">
        <Select selectedOption={{ value: String(flexible), label: windowLabel(flexible) }} onChange={(e) => setFlexible(Number(e.detail.selectedOption.value ?? 0))} options={windows.map((w) => ({ value: String(w), label: windowLabel(w) }))} ariaLabel="Flexible time window" />
      </FormField>
      {visible && (
        <TargetPicker
          kinds={TARGETS}
          kind={targetKind}
          arn={arn}
          onChange={(k, a) => {
            setTargetKind(k);
            setArn(a);
          }}
        />
      )}
      <FormField label="Input - optional" description="The text the target receives. Use JSON for a Lambda function or a state machine." stretch>
        {visible && <Code key={schedule?.Arn ?? "new"} value={input} onChange={setInput} language="json" height={120} ariaLabel="Input" />}
      </FormField>
      <FormField label="Execution role" description="The role EventBridge Scheduler uses to call the target.">
        {visible && <RolePicker value={role} onChange={setRole} />}
      </FormField>
      <Toggle checked={enabled} onChange={(e) => setEnabled(e.detail.checked)}>
        Enable the schedule
      </Toggle>
    </FormModal>
  );
}
