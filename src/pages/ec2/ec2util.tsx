import { DescribeInstancesCommand, type Instance, type Tag } from "@aws-sdk/client-ec2";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import Box from "@cloudscape-design/components/box";
import type { ReactNode } from "react";
import { ec2 } from "../../aws";

export const tagName = (tags?: Tag[]) => tags?.find((t) => t.Key === "Name")?.Value ?? "";

export const TRANSITIONAL = ["pending", "stopping", "shutting-down"];

const STATE_TYPE: Record<string, StatusIndicatorProps.Type> = {
  running: "success",
  pending: "pending",
  stopping: "in-progress",
  "shutting-down": "in-progress",
  stopped: "stopped",
  terminated: "stopped",
};

export function InstanceState({ state }: { state?: string }) {
  const label = state ? state.charAt(0).toUpperCase() + state.slice(1) : "-";
  return <StatusIndicator type={STATE_TYPE[state ?? ""] ?? "info"}>{label}</StatusIndicator>;
}

export async function listInstances(ids?: string[]): Promise<Instance[]> {
  const out: Instance[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: ids, NextToken }));
    for (const r of res.Reservations ?? []) out.push(...(r.Instances ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out.sort((a, b) => (b.LaunchTime?.getTime() ?? 0) - (a.LaunchTime?.getTime() ?? 0));
}

export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}
