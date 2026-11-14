import {
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  type Filter,
  type InternetGateway,
  type NatGateway,
  type ResourceType,
  type Route,
  type RouteTable,
  type Subnet,
  type Tag,
  type Vpc,
} from "@aws-sdk/client-ec2";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { SelectProps } from "@cloudscape-design/components/select";
import { ec2 } from "../../clients/ec2";
import { tagName } from "../ec2/ec2util";

export { tagName };

export const VPC_CRUMB = { text: "VPC", href: "/vpc/vpcs" };

const vpcFilter = (vpcId?: string): Filter[] | undefined => (vpcId ? [{ Name: "vpc-id", Values: [vpcId] }] : undefined);

export async function listVpcs(): Promise<Vpc[]> {
  const out: Vpc[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeVpcsCommand({ NextToken }));
    out.push(...(res.Vpcs ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listSubnets(vpcId?: string): Promise<Subnet[]> {
  const out: Subnet[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeSubnetsCommand({ Filters: vpcFilter(vpcId), NextToken }));
    out.push(...(res.Subnets ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listRouteTables(vpcId?: string): Promise<RouteTable[]> {
  const out: RouteTable[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeRouteTablesCommand({ Filters: vpcFilter(vpcId), NextToken }));
    out.push(...(res.RouteTables ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listInternetGateways(): Promise<InternetGateway[]> {
  const out: InternetGateway[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeInternetGatewaysCommand({ NextToken }));
    out.push(...(res.InternetGateways ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

export async function listNatGateways(): Promise<NatGateway[]> {
  const out: NatGateway[] = [];
  let NextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeNatGatewaysCommand({ NextToken }));
    out.push(...(res.NatGateways ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

/** The Name tag for a create call. Gives nothing when the name is empty. */
export function nameTagSpec(type: ResourceType, name: string) {
  const value = name.trim();
  return value ? [{ ResourceType: type, Tags: [{ Key: "Name", Value: value }] }] : undefined;
}

export const nameOrDash = (tags?: Tag[]) => tagName(tags) || "-";

/** "vpc-123 (my-vpc)" when the resource has a Name tag, the bare ID otherwise. */
export const idWithName = (id?: string, tags?: Tag[]) => (tagName(tags) ? `${id} (${tagName(tags)})` : (id ?? ""));

export const vpcOptions = (vpcs: Vpc[] = []): SelectProps.Option[] =>
  vpcs.map((v) => ({ value: v.VpcId, label: idWithName(v.VpcId, v.Tags), description: `${v.CidrBlock}${v.IsDefault ? " (default)" : ""}` }));

/** The main route table of a VPC. */
export const mainRouteTable = (tables: RouteTable[] = [], vpcId?: string) => tables.find((t) => t.VpcId === vpcId && t.Associations?.some((a) => a.Main));

/** The route table a subnet uses: its own association, or the main route table of its VPC. */
export const routeTableOf = (tables: RouteTable[] = [], subnet: Subnet) =>
  tables.find((t) => t.Associations?.some((a) => a.SubnetId === subnet.SubnetId)) ?? mainRouteTable(tables, subnet.VpcId);

/** The subnets a route table is tied to by name, not through the main route table. */
export const explicitSubnets = (table: RouteTable) => (table.Associations ?? []).filter((a) => a.SubnetId);

export const isMain = (table: RouteTable) => !!table.Associations?.some((a) => a.Main);

/** Where a route sends traffic. */
export const routeTarget = (r: Route) =>
  r.GatewayId ?? r.NatGatewayId ?? r.InstanceId ?? r.NetworkInterfaceId ?? r.VpcPeeringConnectionId ?? r.TransitGatewayId ?? r.EgressOnlyInternetGatewayId ?? "-";

export const routeDestination = (r: Route) => r.DestinationCidrBlock ?? r.DestinationIpv6CidrBlock ?? r.DestinationPrefixListId ?? "-";

const STATE: Record<string, StatusIndicatorProps.Type> = {
  available: "success",
  active: "success",
  associated: "success",
  attached: "success",
  pending: "pending",
  deleting: "in-progress",
  detached: "stopped",
  deleted: "stopped",
  failed: "error",
  blackhole: "error",
};

/** A state such as "available" shown the way the AWS console shows it: "Available" with a green tick. */
export function State({ state }: { state?: string }) {
  if (!state) return <>-</>;
  return <StatusIndicator type={STATE[state] ?? "info"}>{state.charAt(0).toUpperCase() + state.slice(1)}</StatusIndicator>;
}

type Cidr = { start: number; bits: number; size: number };

/** Reads an IPv4 CIDR block such as 10.0.0.0/16. Gives nothing when the text is not one. */
export function parseCidr(text: string): Cidr | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text.trim());
  if (!m) return undefined;
  const parts = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (parts.some((p) => p > 255) || bits > 32) return undefined;
  const start = parts[0] * 2 ** 24 + parts[1] * 2 ** 16 + parts[2] * 2 ** 8 + parts[3];
  const size = 2 ** (32 - bits);
  // The address must be the first one of the block. 10.0.0.5/16 is not a block.
  if (start % size !== 0) return undefined;
  return { start, bits, size };
}

/** Checks a CIDR block for a VPC or a subnet. Gives the error text, or "" when it is fine. */
export function cidrError(text: string): string {
  const cidr = parseCidr(text);
  if (!cidr) return "Enter a valid IPv4 CIDR block, such as 10.0.0.0/16.";
  if (cidr.bits < 16 || cidr.bits > 28) return "The block size must be between /16 and /28.";
  return "";
}

/** True when the block `inner` lies fully inside the block `outer`. */
export function cidrInside(inner: string, outer: string): boolean {
  const a = parseCidr(inner);
  const b = parseCidr(outer);
  return !!a && !!b && a.start >= b.start && a.start + a.size <= b.start + b.size;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
