import { useEffect, useState } from "react";
import { ChangeResourceRecordSetsCommand, type ResourceRecordSet, type RRType } from "@aws-sdk/client-route-53";
import Box from "@cloudscape-design/components/box";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { route53 } from "../../clients/route53";
import { FormModal } from "../../components/FormModal";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { RECORD_TYPES, recordName, trimDot } from "./route53util";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:.]*:[0-9a-fA-F:.]*$/;

/** Checks the values of a record before the call. floci stores any text, so the form has to check. */
export function valueError(type: string, values: string[]): string {
  if (!values.length) return "Enter at least one value.";
  if (type === "A" && values.some((v) => !IPV4.test(v))) return "Each value of an A record must be an IPv4 address, such as 192.0.2.235.";
  if (type === "AAAA" && values.some((v) => !IPV6.test(v))) return "Each value of an AAAA record must be an IPv6 address.";
  if (type === "CNAME" && values.length > 1) return "A CNAME record takes one value.";
  if (type === "MX" && values.some((v) => !/^\d+\s+\S+$/.test(v))) return "Each value of an MX record is a priority and a mail server, such as 10 mail.example.com.";
  if (type === "SRV" && values.some((v) => !/^\d+\s+\d+\s+\d+\s+\S+$/.test(v))) return "Each value of an SRV record is priority, weight, port and target, such as 1 10 5269 xmpp.example.com.";
  return "";
}

/** The dialog that creates a record, or edits one when `record` is given. */
export function RecordForm({
  visible,
  zoneId,
  zoneName,
  record,
  onDismiss,
  onSaved,
}: {
  visible: boolean;
  zoneId: string;
  zoneName: string;
  record?: ResourceRecordSet;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const form = useSubmit();
  const [sub, setSub] = useState("");
  const [type, setType] = useState("A");
  const [alias, setAlias] = useState(false);
  const [ttl, setTtl] = useState("300");
  const [values, setValues] = useState("");
  const [target, setTarget] = useState("");
  const [targetZone, setTargetZone] = useState("");
  const zone = trimDot(zoneName);

  // Fill the form each time the dialog opens.
  useEffect(() => {
    if (!visible) return;
    const full = recordName(record?.Name);
    setSub(full === zone ? "" : full.slice(0, Math.max(full.length - zone.length - 1, 0)));
    setType(record?.Type ?? "A");
    setAlias(!!record?.AliasTarget);
    setTtl(String(record?.TTL ?? 300));
    setValues((record?.ResourceRecords ?? []).map((v) => v.Value).join("\n"));
    setTarget(trimDot(record?.AliasTarget?.DNSName));
    setTargetZone(record?.AliasTarget?.HostedZoneId ?? zoneId);
    form.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, record]);

  const save = async () => {
    const label = sub.trim().replace(/\.$/, "");
    if (label && !/^[a-zA-Z0-9_*-]+(\.[a-zA-Z0-9_*-]+)*$/.test(label)) return form.setError("Use letters, numbers, hyphens, underscores and dots in the record name.");
    const name = label ? `${label}.${zone}` : zone;
    // Keep the other settings of an edited record, such as a weight.
    const set: ResourceRecordSet = { ...record, Name: name, Type: type as RRType };
    if (alias) {
      if (type === "NS") return form.setError("An NS record can't be an alias.");
      if (!target.trim()) return form.setError("Enter the DNS name that the alias routes traffic to.");
      if (!targetZone.trim()) return form.setError("Enter the hosted zone ID of the alias target.");
      set.AliasTarget = { DNSName: target.trim(), HostedZoneId: targetZone.trim(), EvaluateTargetHealth: record?.AliasTarget?.EvaluateTargetHealth ?? false };
      delete set.TTL;
      delete set.ResourceRecords;
    } else {
      const n = Number(ttl);
      if (!/^\d+$/.test(ttl.trim()) || n > 2147483647) return form.setError("Enter a TTL from 0 to 2147483647 seconds.");
      // Route 53 wants TXT values in quotes. Add them when the user left them out.
      const list = values
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (type === "TXT" && !v.startsWith('"') ? `"${v.replace(/"/g, '\\"')}"` : v));
      const problem = valueError(type, list);
      if (problem) return form.setError(problem);
      set.TTL = n;
      set.ResourceRecords = list.map((Value) => ({ Value }));
      delete set.AliasTarget;
    }
    const ok = await form.run(async () => {
      await route53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: zoneId, ChangeBatch: { Changes: [{ Action: record ? "UPSERT" : "CREATE", ResourceRecordSet: set }] } }));
      notify.success(record ? `Record ${name} was successfully updated.` : `Record ${name} was successfully created.`);
      onSaved();
    });
    if (ok) onDismiss();
  };

  return (
    <FormModal visible={visible} size="medium" header={record ? "Edit record" : "Create record"} submitLabel={record ? "Save" : "Create records"} busy={form.busy} error={form.error} onDismiss={onDismiss} onSubmit={save}>
      <FormField label="Record name" description={record ? "The name and type of a record can't be changed." : "Keep blank to create a record for the root domain."}>
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Input value={sub} placeholder="subdomain" disabled={!!record} onChange={(e) => setSub(e.detail.value)} />
          <Box color="text-body-secondary">.{zone}</Box>
        </SpaceBetween>
      </FormField>
      <FormField label="Record type">
        <Select
          disabled={!!record}
          selectedOption={{ value: type, label: RECORD_TYPES[type]?.label ?? type }}
          onChange={(e) => setType(e.detail.selectedOption.value ?? "A")}
          options={Object.entries(RECORD_TYPES).map(([value, t]) => ({ value, label: t.label }))}
        />
      </FormField>
      <Toggle checked={alias} onChange={(e) => setAlias(e.detail.checked)}>
        Alias
      </Toggle>
      {alias ? (
        <>
          <FormField label="Route traffic to" description="The DNS name of the alias target.">
            <Input value={target} placeholder="d111111abcdef8.cloudfront.net" onChange={(e) => setTarget(e.detail.value)} />
          </FormField>
          <FormField label="Target hosted zone ID" description="The hosted zone of the target. Keep this zone's ID to point at another record in this zone.">
            <Input value={targetZone} onChange={(e) => setTargetZone(e.detail.value)} />
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Value" description="Enter multiple values on separate lines." stretch>
            <Textarea value={values} rows={4} placeholder={RECORD_TYPES[type]?.placeholder} onChange={(e) => setValues(e.detail.value)} spellcheck={false} />
          </FormField>
          <FormField label="TTL (seconds)">
            <Input type="number" value={ttl} onChange={(e) => setTtl(e.detail.value)} />
          </FormField>
        </>
      )}
    </FormModal>
  );
}
