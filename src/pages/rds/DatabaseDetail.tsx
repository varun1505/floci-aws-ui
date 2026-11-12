import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DescribeDBSnapshotsCommand } from "@aws-sdk/client-rds";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { rds } from "../../clients/rds";
import { flociHost } from "../../config";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Shell } from "../../components/Shell";
import { formatDate } from "../../lib/format";
import { useNotify } from "../../lib/notify";
import { useLoad } from "../../lib/useLoad";
import { dbAction, dbActionItems } from "./Databases";
import { DbStatus, ENGINE_LABEL, Pair, connectCommand, isSettled, listDatabases } from "./rdsutil";

const copy = (text: string) => <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;

export default function DatabaseDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const [deleting, setDeleting] = useState(false);

  const db = useLoad(async () => {
    const found = (await listDatabases(id))[0];
    if (!found) throw new Error(`DBInstance ${id} not found.`);
    return found;
  }, [id]);
  const host = useLoad(flociHost, []);
  const snapshots = useLoad(async () => (await rds.send(new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: id }))).DBSnapshots ?? [], [id]);
  const d = db.data;
  const status = d?.DBInstanceStatus;

  useEffect(() => {
    if (!d || isSettled(status)) return;
    const timer = setInterval(() => db.reload(true), 3000);
    return () => clearInterval(timer);
  }, [status, d, db.reload]);

  const run = async (action: string) => {
    try {
      notify.success(await dbAction(action, id));
      if (action === "delete") return navigate("/rds/databases");
      if (action === "snapshot") setTimeout(() => snapshots.reload(true), 1500);
    } catch (e) {
      notify.error(`Could not ${action} the database`, e);
    }
    setDeleting(false);
    db.reload(true);
    setTimeout(() => db.reload(true), 2500);
  };

  return (
    <Shell
      service="rds"
      breadcrumbs={[
        { text: "RDS", href: "/rds/databases" },
        { text: "Databases", href: "/rds/databases" },
        { text: id, href: `/rds/databases/${id}` },
      ]}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => db.reload()} />
                <ButtonDropdown disabled={!d} items={dbActionItems(status)} onItemClick={(e) => (e.detail.id === "delete" ? setDeleting(true) : run(e.detail.id))}>
                  Actions
                </ButtonDropdown>
              </SpaceBetween>
            }
          >
            {id}
          </Header>
        }
      >
        {db.error ? (
          <Alert type="error" header="Could not load the database">
            {db.error}
          </Alert>
        ) : !d ? (
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
          </Box>
        ) : (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Summary</Header>}>
              <ColumnLayout columns={4} variant="text-grid">
                <Pair label="DB identifier">{d.DBInstanceIdentifier}</Pair>
                <Pair label="Status">
                  <DbStatus status={status} />
                </Pair>
                <Pair label="Role">{d.DBClusterIdentifier ? "Cluster instance" : "Instance"}</Pair>
                <Pair label="Engine">{ENGINE_LABEL[d.Engine ?? ""] ?? d.Engine}</Pair>
                <Pair label="Class">{d.DBInstanceClass}</Pair>
                <Pair label="Region & AZ">{d.AvailabilityZone}</Pair>
                <Pair label="Engine version">{d.EngineVersion}</Pair>
                <Pair label="Storage">{d.AllocatedStorage ? `${d.AllocatedStorage} GiB` : undefined}</Pair>
              </ColumnLayout>
            </Container>
            <Tabs
              tabs={[
                {
                  id: "connectivity",
                  label: "Connectivity & security",
                  content: (
                    <SpaceBetween size="l">
                      <Container header={<Header variant="h2" description="Run this from your own machine.">Connect</Header>}>
                        <SpaceBetween size="s">
                          <Box variant="code">{copy(connectCommand(d, host.data ?? ""))}</Box>
                          <Box variant="small" color="text-body-secondary">
                            The endpoint address below is internal to the host. From outside, use the host name and the port.
                          </Box>
                        </SpaceBetween>
                      </Container>
                      <Container header={<Header variant="h2">Connectivity & security</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                          <SpaceBetween size="l">
                            <Pair label="Endpoint">{d.Endpoint?.Address && copy(d.Endpoint.Address)}</Pair>
                            <Pair label="Port">{d.Endpoint?.Port}</Pair>
                            <Pair label="Host for external clients">{host.data && copy(host.data)}</Pair>
                          </SpaceBetween>
                          <SpaceBetween size="l">
                            <Pair label="Availability Zone">{d.AvailabilityZone}</Pair>
                            <Pair label="VPC">{d.DBSubnetGroup?.VpcId}</Pair>
                            <Pair label="Subnet group">{d.DBSubnetGroup?.DBSubnetGroupName}</Pair>
                          </SpaceBetween>
                          <SpaceBetween size="l">
                            <Pair label="VPC security groups">{d.VpcSecurityGroups?.map((g) => `${g.VpcSecurityGroupId} (${g.Status})`).join(", ")}</Pair>
                            <Pair label="Publicly accessible">{d.PubliclyAccessible === undefined ? undefined : d.PubliclyAccessible ? "Yes" : "No"}</Pair>
                          </SpaceBetween>
                        </ColumnLayout>
                      </Container>
                    </SpaceBetween>
                  ),
                },
                {
                  id: "configuration",
                  label: "Configuration",
                  content: (
                    <Container header={<Header variant="h2">Instance</Header>}>
                      <ColumnLayout columns={3} variant="text-grid">
                        <Pair label="DB instance ID">{d.DBInstanceIdentifier}</Pair>
                        <Pair label="Engine version">{d.EngineVersion}</Pair>
                        <Pair label="DB name">{d.DBName}</Pair>
                        <Pair label="Master username">{d.MasterUsername}</Pair>
                        <Pair label="Instance class">{d.DBInstanceClass}</Pair>
                        <Pair label="Allocated storage">{d.AllocatedStorage ? `${d.AllocatedStorage} GiB` : undefined}</Pair>
                        <Pair label="Storage type">{d.StorageType}</Pair>
                        <Pair label="DB instance parameter group">{d.DBParameterGroups?.map((g) => g.DBParameterGroupName).join(", ")}</Pair>
                        <Pair label="Created time">{formatDate(d.InstanceCreateTime)}</Pair>
                        <Pair label="Amazon Resource Name (ARN)">{d.DBInstanceArn && copy(d.DBInstanceArn)}</Pair>
                        <Pair label="Multi-AZ">{d.MultiAZ === undefined ? undefined : d.MultiAZ ? "Yes" : "No"}</Pair>
                        <Pair label="Deletion protection">{d.DeletionProtection === undefined ? undefined : d.DeletionProtection ? "Enabled" : "Disabled"}</Pair>
                      </ColumnLayout>
                    </Container>
                  ),
                },
                {
                  id: "backups",
                  label: "Maintenance & backups",
                  content: (
                    <SpaceBetween size="l">
                      <Container header={<Header variant="h2">Maintenance and backup windows</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                          <Pair label="Maintenance window">{d.PreferredMaintenanceWindow}</Pair>
                          <Pair label="Backup window">{d.PreferredBackupWindow}</Pair>
                          <Pair label="Backup retention period">{d.BackupRetentionPeriod === undefined ? undefined : `${d.BackupRetentionPeriod} day${d.BackupRetentionPeriod === 1 ? "" : "s"}`}</Pair>
                        </ColumnLayout>
                      </Container>
                      <Table
                        header={
                          <Header
                            variant="h2"
                            counter={`(${snapshots.data?.length ?? 0})`}
                            actions={
                              <Button disabled={status !== "available"} onClick={() => run("snapshot")}>
                                Take snapshot
                              </Button>
                            }
                          >
                            Snapshots
                          </Header>
                        }
                        loading={snapshots.loading}
                        loadingText="Loading snapshots"
                        items={snapshots.data ?? []}
                        columnDefinitions={[
                          { id: "name", header: "Snapshot name", cell: (s) => s.DBSnapshotIdentifier, isRowHeader: true },
                          { id: "status", header: "Status", cell: (s) => s.Status ?? "-" },
                          { id: "type", header: "Snapshot type", cell: (s) => s.SnapshotType ?? "-" },
                          { id: "created", header: "Snapshot creation time", cell: (s) => formatDate(s.SnapshotCreateTime) },
                        ]}
                        empty={
                          <Box textAlign="center" color="inherit">
                            <b>No snapshots</b>
                            <Box variant="p" color="inherit">
                              This database has no snapshots.
                            </Box>
                          </Box>
                        }
                      />
                    </SpaceBetween>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      <ConfirmDelete
        visible={deleting}
        title={`Delete ${id} instance?`}
        confirmText="delete me"
        onCancel={() => setDeleting(false)}
        onConfirm={() => run("delete")}
        warning="No final snapshot is taken. All data in this database is lost."
      />
    </Shell>
  );
}
