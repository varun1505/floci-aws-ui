import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CreateDBSnapshotCommand,
  DeleteDBInstanceCommand,
  RebootDBInstanceCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  type DBInstance,
} from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { rds } from "../../clients/rds";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { ResourceTable } from "../../components/ResourceTable";
import { RouterLink } from "../../components/RouterLink";
import { Shell } from "../../components/Shell";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { DbStatus, ENGINE_LABEL, isSettled, listDatabases } from "./rdsutil";

/** Runs an action on one database. Shared with the detail page. */
export async function dbAction(action: string, id: string): Promise<string> {
  if (action === "stop") {
    await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: id }));
    return `Stopping DB instance ${id}.`;
  }
  if (action === "start") {
    await rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: id }));
    return `Starting DB instance ${id}.`;
  }
  if (action === "reboot") {
    await rds.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: id }));
    return `Rebooting DB instance ${id}.`;
  }
  if (action === "snapshot") {
    const name = `${id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    await rds.send(new CreateDBSnapshotCommand({ DBInstanceIdentifier: id, DBSnapshotIdentifier: name }));
    return `Creating snapshot ${name}.`;
  }
  if (action === "delete") {
    await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }));
    return `Deleting DB instance ${id}.`;
  }
  return "";
}

export const dbActionItems = (status?: string) => [
  { id: "stop", text: "Stop temporarily", disabled: status !== "available" },
  { id: "start", text: "Start", disabled: status !== "stopped" },
  { id: "reboot", text: "Reboot", disabled: status !== "available" },
  { id: "snapshot", text: "Take snapshot", disabled: status !== "available" },
  { id: "delete", text: "Delete", disabled: status === "deleting" },
];

export default function Databases() {
  const navigate = useNavigate();
  const notify = useNotify();
  const dbs = useLoad(() => listDatabases(), []);
  const [selected, setSelected] = useState<DBInstance[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Keep refreshing while a database is being created, stopped, started or deleted.
  const moving = (dbs.data ?? []).some((d) => !isSettled(d.DBInstanceStatus));
  useEffect(() => {
    if (!moving) return;
    const id = setInterval(() => dbs.reload(true), 3000);
    return () => clearInterval(id);
  }, [moving, dbs.reload]);

  const live = selected.map((s) => dbs.data?.find((d) => d.DBInstanceIdentifier === s.DBInstanceIdentifier)).filter(Boolean) as DBInstance[];
  const one = live[0];
  const id = one?.DBInstanceIdentifier ?? "";

  const run = async (action: string) => {
    try {
      notify.success(await dbAction(action, id));
      if (action === "delete") setSelected([]);
    } catch (e) {
      notify.error(`Could not ${action} the database`, e);
    }
    setDeleting(false);
    dbs.reload(true);
    setTimeout(() => dbs.reload(true), 2500);
  };

  return (
    <Shell service="rds" contentType="table" breadcrumbs={[{ text: "RDS", href: "/rds/databases" }, { text: "Databases", href: "/rds/databases" }]}>
      <ResourceTable
        title="Databases"
        resourceName="databases"
        filterPlaceholder="Filter by databases"
        emptyDescription="Each database runs as a real database container on the host."
        emptyCli="rds create-db-instance --db-instance-identifier my-db --engine postgres --db-instance-class db.t3.micro --allocated-storage 20 --master-username admin --master-user-password change-me-now"
        items={dbs.data}
        loading={dbs.loading}
        error={dbs.error}
        onRefresh={() => dbs.reload()}
        trackBy={(d) => d.DBInstanceIdentifier ?? ""}
        selectionType="single"
        selected={live}
        onSelect={setSelected}
        emptyAction={<Button onClick={() => navigate("/rds/databases/create")}>Create database</Button>}
        actions={
          <>
            <ButtonDropdown disabled={!one} items={dbActionItems(one?.DBInstanceStatus)} onItemClick={(e) => (e.detail.id === "delete" ? setDeleting(true) : run(e.detail.id))}>
              Actions
            </ButtonDropdown>
            <Button variant="primary" onClick={() => navigate("/rds/databases/create")}>
              Create database
            </Button>
          </>
        }
        columns={[
          {
            id: "id",
            header: "DB identifier",
            cell: (d) => <RouterLink to={`/rds/databases/${d.DBInstanceIdentifier}`}>{d.DBInstanceIdentifier}</RouterLink>,
            sortingField: "DBInstanceIdentifier",
            isRowHeader: true,
          },
          { id: "status", header: "Status", cell: (d) => <DbStatus status={d.DBInstanceStatus} /> },
          { id: "role", header: "Role", cell: (d) => (d.DBClusterIdentifier ? "Cluster instance" : "Instance") },
          { id: "engine", header: "Engine", cell: (d) => ENGINE_LABEL[d.Engine ?? ""] ?? d.Engine ?? "-", sortingField: "Engine" },
          { id: "version", header: "Engine version", cell: (d) => d.EngineVersion ?? "-" },
          { id: "az", header: "Region & AZ", cell: (d) => d.AvailabilityZone ?? "-" },
          { id: "size", header: "Size", cell: (d) => d.DBInstanceClass ?? "-" },
          { id: "port", header: "Port", cell: (d) => d.Endpoint?.Port ?? "-" },
        ]}
      />
      <ConfirmDelete
        visible={deleting}
        title={`Delete ${id} instance?`}
        confirmText="delete me"
        onCancel={() => setDeleting(false)}
        onConfirm={() => run("delete")}
        warning="No final snapshot is taken. All data in this database is lost."
      >
        <Box>{id}</Box>
      </ConfirmDelete>
    </Shell>
  );
}
