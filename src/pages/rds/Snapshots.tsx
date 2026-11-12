import { useState } from "react";
import { DeleteDBSnapshotCommand, DescribeDBSnapshotsCommand, type DBSnapshot } from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import { rds } from "../../clients/rds";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { ENGINE_LABEL } from "./rdsutil";

export default function DbSnapshots() {
  const notify = useNotify();
  const snapshots = useLoad(async () => (await rds.send(new DescribeDBSnapshotsCommand({}))).DBSnapshots ?? [], []);
  const [selected, setSelected] = useState<DBSnapshot[]>([]);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      for (const s of selected) await rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: s.DBSnapshotIdentifier }));
      notify.success(`Deleted ${selected.length} snapshot${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (e) {
      notify.error("Could not delete the snapshot", e);
    }
    setDeleting(false);
    snapshots.reload();
  };

  return (
    <Shell service="rds" contentType="table" breadcrumbs={[{ text: "RDS", href: "/rds/databases" }, { text: "Snapshots", href: "/rds/snapshots" }]}>
      <ResourceTable
        title="Snapshots"
        description="To take a snapshot, open a database and choose Actions, Take snapshot."
        resourceName="snapshots"
        items={snapshots.data}
        loading={snapshots.loading}
        error={snapshots.error}
        onRefresh={() => snapshots.reload()}
        trackBy={(s) => s.DBSnapshotIdentifier ?? ""}
        selectionType="multi"
        selected={selected}
        onSelect={setSelected}
        actions={
          <Button disabled={selected.length === 0} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
        columns={[
          { id: "name", header: "Snapshot name", cell: (s) => s.DBSnapshotIdentifier, sortingField: "DBSnapshotIdentifier", isRowHeader: true },
          {
            id: "db",
            header: "DB instance",
            cell: (s) => (s.DBInstanceIdentifier ? <RouterLink to={`/rds/databases/${s.DBInstanceIdentifier}`}>{s.DBInstanceIdentifier}</RouterLink> : "-"),
          },
          { id: "created", header: "Snapshot creation time", cell: (s) => formatDate(s.SnapshotCreateTime) },
          { id: "status", header: "Status", cell: (s) => s.Status ?? "-" },
          { id: "engine", header: "Engine", cell: (s) => ENGINE_LABEL[s.Engine ?? ""] ?? s.Engine ?? "-" },
          { id: "type", header: "Snapshot type", cell: (s) => s.SnapshotType ?? "-" },
          { id: "storage", header: "Storage", cell: (s) => (s.AllocatedStorage ? `${s.AllocatedStorage} GiB` : "-") },
        ]}
      />
      <ConfirmDelete visible={deleting} title="Delete snapshots" onCancel={() => setDeleting(false)} onConfirm={remove}>
        <Box>{selected.map((s) => s.DBSnapshotIdentifier).join(", ")}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
