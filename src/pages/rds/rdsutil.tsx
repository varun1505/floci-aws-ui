import { DescribeDBInstancesCommand, type DBInstance } from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";
import { rds } from "../../clients/rds";

export const ENGINE_LABEL: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  "aurora-postgresql": "Aurora PostgreSQL",
  "aurora-mysql": "Aurora MySQL",
  "sqlserver-se": "SQL Server Standard",
};

export const DEFAULT_PORT: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3306 };

/** A database is settled when it is available or stopped. Any other status is still changing. */
export const isSettled = (status?: string) => status === "available" || status === "stopped";

export function DbStatus({ status }: { status?: string }) {
  const type: StatusIndicatorProps.Type =
    status === "available" ? "success" : status === "stopped" ? "stopped" : status === "failed" ? "error" : "in-progress";
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "-";
  return <StatusIndicator type={type}>{label}</StatusIndicator>;
}

export async function listDatabases(id?: string): Promise<DBInstance[]> {
  const out: DBInstance[] = [];
  let Marker: string | undefined;
  do {
    const res = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id, Marker }));
    out.push(...(res.DBInstances ?? []));
    Marker = res.Marker;
  } while (Marker);
  return out;
}

/** The command a developer runs to connect from their own machine. */
export function connectCommand(db: DBInstance, host: string): string {
  const h = host || "<floci-host>";
  const port = db.Endpoint?.Port ?? DEFAULT_PORT[db.Engine ?? ""] ?? "";
  const user = db.MasterUsername ?? "admin";
  if (db.Engine?.includes("postgres")) return `psql -h ${h} -p ${port} -U ${user} ${db.DBName ?? "postgres"}`;
  if (db.Engine?.includes("mysql") || db.Engine === "mariadb") return `mysql -h ${h} -P ${port} -u ${user} -p`;
  return `${h}:${port}`;
}

export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}
