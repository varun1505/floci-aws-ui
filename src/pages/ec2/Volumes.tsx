import { useState } from "react";
import {
  CreateVolumeCommand,
  DeleteVolumeCommand,
  DescribeAvailabilityZonesCommand,
  DescribeVolumesCommand,
  type Volume,
  type VolumeType,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { errorMessage, formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { tagName } from "./ec2util";

const TYPES = ["gp3", "gp2", "io1", "io2", "st1", "sc1", "standard"].map((t) => ({ value: t, label: t }));

export default function Volumes() {
  const notify = useNotify();
  const volumes = useLoad(async () => (await ec2.send(new DescribeVolumesCommand({}))).Volumes ?? [], []);
  const [selected, setSelected] = useState<Volume[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [size, setSize] = useState("8");
  const [type, setType] = useState<SelectProps.Option>(TYPES[0]);
  const [zone, setZone] = useState<SelectProps.Option | null>(null);
  const [zones, setZones] = useState<SelectProps.Option[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const openCreate = async () => {
    setError("");
    setCreating(true);
    try {
      const res = await ec2.send(new DescribeAvailabilityZonesCommand({}));
      const opts = (res.AvailabilityZones ?? []).map((z) => ({ value: z.ZoneName, label: z.ZoneName }));
      setZones(opts);
      setZone((cur) => cur ?? opts[0] ?? null);
    } catch {
      setZones([]);
    }
  };

  const create = async () => {
    const gib = Number(size);
    if (!Number.isInteger(gib) || gib < 1) return setError("Size must be a whole number of GiB, 1 or more.");
    if (!zone) return setError("Choose an Availability Zone.");
    setBusy(true);
    try {
      const res = await ec2.send(new CreateVolumeCommand({ Size: gib, VolumeType: type.value as VolumeType, AvailabilityZone: zone.value }));
      notify.success(`Successfully created volume ${res.VolumeId}.`);
      setCreating(false);
      volumes.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const remove = async () => {
    try {
      for (const v of selected) await ec2.send(new DeleteVolumeCommand({ VolumeId: v.VolumeId }));
      notify.success(`Deleted ${selected.length} volume${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the volume", e);
    }
    setDeleting(false);
    volumes.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Volumes", href: "/ec2/volumes" }]}>
      <ResourceTable
        title="Volumes"
        resourceName="volumes"
        filterPlaceholder="Find volumes by attribute or tag"
        items={volumes.data}
        loading={volumes.loading}
        error={volumes.error}
        onRefresh={() => volumes.reload()}
        trackBy={(v) => v.VolumeId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        emptyAction={<Button onClick={openCreate}>Create volume</Button>}
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create volume
            </Button>
          </>
        }
        columns={[
          { id: "name", header: "Name", cell: (v) => tagName(v.Tags) || "-" },
          { id: "id", header: "Volume ID", cell: (v) => v.VolumeId, sortingField: "VolumeId", isRowHeader: true },
          { id: "type", header: "Type", cell: (v) => v.VolumeType ?? "-" },
          { id: "size", header: "Size", cell: (v) => `${v.Size} GiB`, sortingField: "Size" },
          { id: "state", header: "Volume state", cell: (v) => <StatusIndicator type={v.State === "available" ? "success" : v.State === "in-use" ? "info" : "pending"}>{v.State}</StatusIndicator> },
          { id: "az", header: "Availability Zone", cell: (v) => v.AvailabilityZone ?? "-" },
          { id: "attached", header: "Attached resources", cell: (v) => v.Attachments?.map((a) => a.InstanceId).join(", ") || "-" },
          { id: "created", header: "Created", cell: (v) => formatDate(v.CreateTime) },
        ]}
      />
      <Modal
        visible={creating}
        onDismiss={() => setCreating(false)}
        header="Create volume"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Create volume
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Volume type">
            <Select selectedOption={type} options={TYPES} onChange={(e) => setType(e.detail.selectedOption)} />
          </FormField>
          <FormField label="Size (GiB)" errorText={error}>
            <Input type="number" value={size} onChange={(e) => setSize(e.detail.value)} />
          </FormField>
          <FormField label="Availability Zone">
            <Select selectedOption={zone} options={zones} onChange={(e) => setZone(e.detail.selectedOption)} placeholder="Choose a zone" />
          </FormField>
        </SpaceBetween>
      </Modal>
      <ConfirmDelete visible={deleting} title="Delete volumes" onCancel={() => setDeleting(false)} onConfirm={remove} warning="Deleting a volume permanently deletes its data.">
        <Box>{selected.map((v) => v.VolumeId).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
