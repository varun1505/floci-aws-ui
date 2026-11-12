import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, type LoadBalancer, type TargetGroup } from "@aws-sdk/client-elastic-load-balancing-v2";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { elb } from "../../clients/elb";

export const lbHref = (arn: string) => `/ec2/load-balancer?arn=${encodeURIComponent(arn)}`;
export const tgHref = (arn: string) => `/ec2/target-group?arn=${encodeURIComponent(arn)}`;
export const tgName = (arn?: string) => arn?.split("/")[1] ?? arn ?? "-";

export async function listLoadBalancers(): Promise<LoadBalancer[]> {
  const out: LoadBalancer[] = [];
  let Marker: string | undefined;
  do {
    const res = await elb.send(new DescribeLoadBalancersCommand({ Marker }));
    out.push(...(res.LoadBalancers ?? []));
    Marker = res.NextMarker;
  } while (Marker);
  return out;
}

export async function listTargetGroups(): Promise<TargetGroup[]> {
  const out: TargetGroup[] = [];
  let Marker: string | undefined;
  do {
    const res = await elb.send(new DescribeTargetGroupsCommand({ Marker }));
    out.push(...(res.TargetGroups ?? []));
    Marker = res.NextMarker;
  } while (Marker);
  return out;
}

const STATE: Record<string, StatusIndicatorProps.Type> = {
  active: "success",
  healthy: "success",
  provisioning: "in-progress",
  initial: "in-progress",
  draining: "in-progress",
  failed: "error",
  unhealthy: "error",
  unavailable: "warning",
  unused: "stopped",
  active_impaired: "warning",
};

export function ElbState({ state }: { state?: string }) {
  if (!state) return <>-</>;
  return <StatusIndicator type={STATE[state] ?? "info"}>{state.charAt(0).toUpperCase() + state.slice(1).replace("_", " ")}</StatusIndicator>;
}

export const LB_TYPES = [
  { value: "application", label: "Application Load Balancer", description: "HTTP and HTTPS traffic." },
  { value: "network", label: "Network Load Balancer", description: "TCP, UDP and TLS traffic." },
];

export const TYPE_LABEL: Record<string, string> = { application: "application", network: "network", gateway: "gateway" };
export const validName = (name: string) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$/.test(name) && !name.startsWith("internal-");
