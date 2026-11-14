import { useEffect } from "react";
import {
  type Cluster,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListClustersCommand,
  ListServicesCommand,
  ListTaskDefinitionsCommand,
  ListTasksCommand,
  type Service,
  type Task,
} from "@aws-sdk/client-ecs";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { ecs } from "../../clients/ecs";

/** The last part of an ARN: a cluster name, a task ID or family:revision. */
export const lastPart = (arn?: string) => arn?.split("/").pop() ?? "";

export const clusterHref = (name: string) => `/ecs/clusters/${encodeURIComponent(name)}`;
export const taskHref = (cluster: string, arn: string) => `/ecs/task?cluster=${encodeURIComponent(cluster)}&arn=${encodeURIComponent(arn)}`;
/** Takes a full ARN or family:revision. */
export const taskDefHref = (arn: string) => `/ecs/task-definition?arn=${encodeURIComponent(lastPart(arn))}`;

/** Splits family:revision. The family itself never has a colon. */
export function splitTaskDef(arn?: string): { family: string; revision: number } {
  const [family, revision] = lastPart(arn).split(":");
  return { family, revision: Number(revision) || 0 };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every cluster with its counts. ECS lists only ARNs, so the details need a second call. */
export async function listClusters(): Promise<Cluster[]> {
  const arns: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await ecs.send(new ListClustersCommand({ nextToken }));
    arns.push(...(res.clusterArns ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  const out: Cluster[] = [];
  for (const clusters of chunks(arns, 100)) out.push(...((await ecs.send(new DescribeClustersCommand({ clusters }))).clusters ?? []));
  return out.sort((a, b) => (a.clusterName ?? "").localeCompare(b.clusterName ?? ""));
}

export async function listServices(cluster: string): Promise<Service[]> {
  const arns: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await ecs.send(new ListServicesCommand({ cluster, nextToken, maxResults: 100 }));
    arns.push(...(res.serviceArns ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  const out: Service[] = [];
  // DescribeServices takes 10 services at most.
  for (const services of chunks(arns, 10)) out.push(...((await ecs.send(new DescribeServicesCommand({ cluster, services }))).services ?? []));
  return out.sort((a, b) => (a.serviceName ?? "").localeCompare(b.serviceName ?? ""));
}

export type DesiredStatus = "RUNNING" | "STOPPED";

export async function listTasks(cluster: string, statuses: DesiredStatus[]): Promise<Task[]> {
  const arns: string[] = [];
  for (const desiredStatus of statuses) {
    let nextToken: string | undefined;
    do {
      const res = await ecs.send(new ListTasksCommand({ cluster, desiredStatus, nextToken }));
      arns.push(...(res.taskArns ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
  }
  const out: Task[] = [];
  for (const tasks of chunks(arns, 100)) out.push(...((await ecs.send(new DescribeTasksCommand({ cluster, tasks }))).tasks ?? []));
  return out.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** ARNs of task definition revisions. `family` matches as a prefix on the API, so the result is filtered to the exact family. */
export async function listTaskDefArns(status: "ACTIVE" | "INACTIVE", family?: string): Promise<string[]> {
  const out: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await ecs.send(new ListTaskDefinitionsCommand({ status, familyPrefix: family, nextToken }));
    out.push(...(res.taskDefinitionArns ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return family ? out.filter((arn) => splitTaskDef(arn).family === family) : out;
}

const STATE: Record<string, StatusIndicatorProps.Type> = {
  ACTIVE: "success",
  RUNNING: "success",
  COMPLETED: "success",
  PRIMARY: "success",
  PROVISIONING: "pending",
  PENDING: "pending",
  ACTIVATING: "in-progress",
  IN_PROGRESS: "in-progress",
  DRAINING: "in-progress",
  DEACTIVATING: "in-progress",
  STOPPING: "in-progress",
  DEPROVISIONING: "in-progress",
  DELETE_IN_PROGRESS: "in-progress",
  STOPPED: "stopped",
  INACTIVE: "stopped",
  FAILED: "error",
};

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function EcsStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  return <StatusIndicator type={STATE[status] ?? "info"}>{pretty(status)}</StatusIndicator>;
}

/** Reloads quietly every few seconds while `active` is true. Used while tasks start or stop. */
export function usePoll(active: boolean, reload: (silent?: boolean) => unknown, ms = 4000) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => reload(true), ms);
    return () => clearInterval(id);
  }, [active, reload, ms]);
}

export const NAME_RULE = /^[A-Za-z0-9_-]{1,255}$/;
export const NAME_HINT = "Use up to 255 letters, numbers, hyphens and underscores.";
