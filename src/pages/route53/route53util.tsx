import {
  ChangeResourceRecordSetsCommand,
  DeleteHostedZoneCommand,
  type HealthCheck,
  type HostedZone,
  ListHealthChecksCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  type ResourceRecordSet,
  type RRType,
} from "@aws-sdk/client-route-53";
import { DescribeVpcsCommand, type Vpc } from "@aws-sdk/client-ec2";
import { ec2 } from "../../clients/ec2";
import { route53 } from "../../clients/route53";

/** floci returns zone IDs as "/hostedzone/Z123". The pages and links use the bare "Z123". */
export const zoneId = (id?: string) => (id ?? "").replace(/^\/hostedzone\//, "");

/** Record and zone names end with a dot in the API. The console shows them without it. */
export const trimDot = (name?: string) => (name ?? "").replace(/\.$/, "");

export const zoneHref = (id?: string) => `/route53/hosted-zones/${zoneId(id)}`;

/** A caller reference must be new for each create call. */
export const callerReference = () => `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function listZones(): Promise<HostedZone[]> {
  const out: HostedZone[] = [];
  let Marker: string | undefined;
  do {
    const res = await route53.send(new ListHostedZonesCommand({ Marker }));
    out.push(...(res.HostedZones ?? []));
    Marker = res.IsTruncated ? res.NextMarker : undefined;
  } while (Marker);
  return out;
}

export async function listRecords(id: string): Promise<ResourceRecordSet[]> {
  const out: ResourceRecordSet[] = [];
  let next: { StartRecordName?: string; StartRecordType?: RRType; StartRecordIdentifier?: string } = {};
  let more = true;
  while (more) {
    const res = await route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: id, ...next }));
    out.push(...(res.ResourceRecordSets ?? []));
    more = !!res.IsTruncated && !!res.NextRecordName;
    next = { StartRecordName: res.NextRecordName, StartRecordType: res.NextRecordType, StartRecordIdentifier: res.NextRecordIdentifier };
  }
  return out;
}

export async function listHealthChecks(): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  let Marker: string | undefined;
  do {
    const res = await route53.send(new ListHealthChecksCommand({ Marker }));
    out.push(...(res.HealthChecks ?? []));
    Marker = res.IsTruncated ? res.NextMarker : undefined;
  } while (Marker);
  return out;
}

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

export const vpcLabel = (v: Vpc) => {
  const name = v.Tags?.find((t) => t.Key === "Name")?.Value;
  return name ? `${v.VpcId} (${name})` : (v.VpcId ?? "");
};

/** Every zone has one NS and one SOA record at its own name. They can't be deleted. */
export const isApex = (r: ResourceRecordSet, zoneName?: string) => (r.Type === "NS" || r.Type === "SOA") && trimDot(r.Name).toLowerCase() === trimDot(zoneName).toLowerCase();

/** A key that is different for every record of a zone. */
export const recordKey = (r: ResourceRecordSet) => `${r.Name}|${r.Type}|${r.SetIdentifier ?? ""}`;

export function routingPolicy(r: ResourceRecordSet): string {
  if (r.Weight !== undefined) return "Weighted";
  if (r.Failover) return "Failover";
  if (r.Region) return "Latency";
  if (r.GeoLocation) return "Geolocation";
  if (r.MultiValueAnswer) return "Multivalue answer";
  return "Simple";
}

export const recordValues = (r: ResourceRecordSet): string[] => (r.AliasTarget ? [trimDot(r.AliasTarget.DNSName)] : (r.ResourceRecords ?? []).map((v) => v.Value ?? ""));

/**
 * Deletes a zone. floci refuses while the zone holds records other than its own NS and SOA,
 * so those records are deleted first.
 */
export async function deleteZone(id: string, zoneName?: string) {
  const extra = (await listRecords(id)).filter((r) => !isApex(r, zoneName));
  if (extra.length) {
    await route53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: id, ChangeBatch: { Changes: extra.map((r) => ({ Action: "DELETE", ResourceRecordSet: r })) } }));
  }
  await route53.send(new DeleteHostedZoneCommand({ Id: id }));
}

export const RECORD_TYPES: Record<string, { label: string; placeholder: string }> = {
  A: { label: "A - Routes traffic to an IPv4 address", placeholder: "192.0.2.235" },
  AAAA: { label: "AAAA - Routes traffic to an IPv6 address", placeholder: "2001:0db8:85a3:0:0:8a2e:0370:7334" },
  CNAME: { label: "CNAME - Routes traffic to another domain name", placeholder: "www.example.com" },
  TXT: { label: "TXT - Used to verify email senders and for application-specific values", placeholder: '"sample text entry"' },
  MX: { label: "MX - Specifies mail servers", placeholder: "10 mailserver.example.com" },
  NS: { label: "NS - Name servers for a hosted zone", placeholder: "ns1.example.com" },
  SRV: { label: "SRV - Application-specific values that identify servers", placeholder: "1 10 5269 xmpp-server.example.com" },
  CAA: { label: "CAA - Restricts CAs that can create SSL/TLS certificates for the domain", placeholder: '0 issue "amazon.com"' },
  PTR: { label: "PTR - Maps an IP address to a domain name", placeholder: "www.example.com" },
};

/** A record name as the console shows it: no last dot, and "*" in place of its escape code. */
export const recordName = (name?: string) => trimDot(name).replace(/\\052/g, "*");
