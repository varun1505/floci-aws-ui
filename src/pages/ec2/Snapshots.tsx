import { useState } from "react";
import { DeleteSnapshotCommand, DescribeSnapshotsCommand, type Snapshot } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { ec2 } from "../../clients/ec2";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { tagName } from "./ec2util";

export default function Snapshots() {
  const notify = useNotify();
  const snapshots = useLoad(async () => (await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"] }))).Snapshots ?? [], []);
  const [selected, setSelected] = useState<Snapshot[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const s of selected) await ec2.send(new DeleteSnapshotCommand({ SnapshotId: s.SnapshotId }));
      notify.success(`Deleted ${selected.length} snapshot${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the snapshot", e);
    }
    setDeleting(false);
    snapshots.reload();
  };

  return (
    <Shell service="ec2" contentType="table" breadcrumbs={[{ text: "EC2", href: "/ec2/home" }, { text: "Snapshots", href: "/ec2/snapshots" }]}>
      <ResourceTable
        title="Snapshots"
        description="Snapshots owned by this account."
        resourceName="snapshots"
        items={snapshots.data}
        loading={snapshots.loading}
        error={snapshots.error}
        onRefresh={() => snapshots.reload()}
        trackBy={(s) => s.SnapshotId ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
        columns={[
          { id: "name", header: "Name", cell: (s) => tagName(s.Tags) || "-" },
          { id: "id", header: "Snapshot ID", cell: (s) => s.SnapshotId, sortingField: "SnapshotId", isRowHeader: true },
          { id: "size", header: "Volume size", cell: (s) => `${s.VolumeSize} GiB` },
          { id: "description", header: "Description", cell: (s) => s.Description || "-" },
          { id: "state", header: "Snapshot status", cell: (s) => <StatusIndicator type={s.State === "completed" ? "success" : "in-progress"}>{s.State}</StatusIndicator> },
          { id: "volume", header: "Volume ID", cell: (s) => s.VolumeId ?? "-" },
          { id: "started", header: "Started", cell: (s) => formatDate(s.StartTime) },
        ]}
      />
      <ConfirmDelete visible={deleting} title="Delete snapshots" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((s) => s.SnapshotId).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
