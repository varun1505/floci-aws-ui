import { useState } from "react";
import {
  DecreaseStreamRetentionPeriodCommand,
  IncreaseStreamRetentionPeriodCommand,
  type StreamDescriptionSummary,
  UpdateShardCountCommand,
  UpdateStreamModeCommand,
} from "@aws-sdk/client-kinesis";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { kinesis } from "../../clients/kinesis";
import { FormModal } from "../../components/FormModal";
import { Pair } from "../../components/Pair";
import { useNotify } from "../../lib/notify";
import { useSubmit } from "../../lib/useSubmit";
import { encryptionLabel, modeLabel, retentionLabel } from "./kinesisutil";

/** The settings of a stream that can change: capacity mode, shard count and retention period. */
export function StreamConfig({ stream, onChange }: { stream: StreamDescriptionSummary; onChange: () => void }) {
  const notify = useNotify();
  const form = useSubmit();
  const [modal, setModal] = useState<"capacity" | "retention" | undefined>(undefined);
  const [mode, setMode] = useState("ON_DEMAND");
  const [shards, setShards] = useState("1");
  const [hours, setHours] = useState("24");
  const name = stream.StreamName ?? "";
  const currentMode = stream.StreamModeDetails?.StreamMode ?? "PROVISIONED";
  const open = stream.OpenShardCount ?? 1;

  const openModal = (which: "capacity" | "retention") => {
    setMode(currentMode);
    setShards(String(open));
    setHours(String(stream.RetentionPeriodHours ?? 24));
    form.setError("");
    setModal(which);
  };

  const saveCapacity = async () => {
    const target = Number(shards);
    const provisioned = mode === "PROVISIONED";
    if (provisioned && !(Number.isInteger(target) && target >= 1)) return form.setError("Enter a number of shards, 1 or more.");
    const ok = await form.run(async () => {
      if (mode !== currentMode) {
        if (provisioned) await kinesis.send(new UpdateStreamModeCommand({ StreamARN: stream.StreamARN, StreamModeDetails: { StreamMode: "PROVISIONED" } }));
        else await kinesis.send(new UpdateStreamModeCommand({ StreamARN: stream.StreamARN, StreamModeDetails: { StreamMode: "ON_DEMAND" } }));
      }
      if (provisioned && target !== open) await kinesis.send(new UpdateShardCountCommand({ StreamName: name, TargetShardCount: target, ScalingType: "UNIFORM_SCALING" }));
      notify.success(`The capacity of ${name} was updated.`);
      onChange();
    });
    if (ok) setModal(undefined);
  };

  const saveRetention = async () => {
    const target = Number(hours);
    const current = stream.RetentionPeriodHours ?? 24;
    if (!(Number.isInteger(target) && target >= 24 && target <= 8760)) return form.setError("Enter a number of hours from 24 to 8760.");
    const ok = await form.run(async () => {
      if (target > current) {
        await kinesis.send(new IncreaseStreamRetentionPeriodCommand({ StreamName: name, RetentionPeriodHours: target }));
      } else if (target < current) {
        await kinesis.send(new DecreaseStreamRetentionPeriodCommand({ StreamName: name, RetentionPeriodHours: target }));
      }
      notify.success(`The data retention period of ${name} is now ${retentionLabel(target)}.`);
      onChange();
    });
    if (ok) setModal(undefined);
  };

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header variant="h2" actions={<Button onClick={() => openModal("capacity")}>Edit capacity mode</Button>}>
            Capacity mode
          </Header>
        }
      >
        <ColumnLayout columns={2} variant="text-grid">
          <Pair label="Capacity mode">{modeLabel(currentMode)}</Pair>
          <Pair label="Open shards">{String(open)}</Pair>
        </ColumnLayout>
      </Container>
      <Container
        header={
          <Header variant="h2" actions={<Button onClick={() => openModal("retention")}>Edit data retention period</Button>}>
            Data retention
          </Header>
        }
      >
        <Pair label="Data retention period">{retentionLabel(stream.RetentionPeriodHours)}</Pair>
      </Container>
      <Container header={<Header variant="h2">Encryption</Header>}>
        <Pair label="Server-side encryption">{encryptionLabel(stream.EncryptionType)}</Pair>
      </Container>

      <FormModal visible={modal === "capacity"} header="Edit capacity mode" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveCapacity}>
        <FormField label="Capacity mode">
          <RadioGroup
            value={mode}
            onChange={(e) => setMode(e.detail.value)}
            items={[
              { value: "ON_DEMAND", label: "On-demand" },
              { value: "PROVISIONED", label: "Provisioned" },
            ]}
          />
        </FormField>
        {mode === "PROVISIONED" && (
          <FormField label="Provisioned shards" description={`The stream has ${open} open shard${open === 1 ? "" : "s"}.`} constraintText={`From ${Math.ceil(open / 2)} to ${open * 2} in one change.`}>
            <Input type="number" value={shards} onChange={(e) => setShards(e.detail.value)} />
          </FormField>
        )}
      </FormModal>

      <FormModal visible={modal === "retention"} header="Edit data retention period" submitLabel="Save changes" busy={form.busy} error={form.error} onDismiss={() => setModal(undefined)} onSubmit={saveRetention}>
        <FormField label="Data retention period (in hours)" constraintText="From 24 hours (1 day) to 8760 hours (365 days).">
          <Input type="number" value={hours} onChange={(e) => setHours(e.detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}
