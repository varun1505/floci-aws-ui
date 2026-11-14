import { DescribeDomainsCommand, type DomainStatus, ListDomainNamesCommand, ListInstanceTypeDetailsCommand, ListVersionsCommand } from "@aws-sdk/client-opensearch";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { opensearch } from "../../clients/opensearch";

/** Every domain with its details. DescribeDomains takes five names in one call. */
export async function listDomains(): Promise<DomainStatus[]> {
  const names = ((await opensearch.send(new ListDomainNamesCommand({}))).DomainNames ?? []).map((d) => d.DomainName ?? "");
  const out: DomainStatus[] = [];
  for (let i = 0; i < names.length; i += 5) {
    const res = await opensearch.send(new DescribeDomainsCommand({ DomainNames: names.slice(i, i + 5) }));
    out.push(...(res.DomainStatusList ?? []));
  }
  return out;
}

export const FALLBACK_VERSIONS = ["OpenSearch_2.19", "OpenSearch_2.17", "OpenSearch_2.11", "OpenSearch_1.3", "Elasticsearch_7.10"];
export const FALLBACK_TYPES = ["t3.small.search", "t3.medium.search", "m5.large.search", "m5.xlarge.search", "r5.large.search", "c5.large.search"];
export const DEFAULT_VERSION = "OpenSearch_2.19";
export const DEFAULT_TYPE = "m5.large.search";

/** The engine versions floci can start. Falls back to a short list when the call fails. */
export async function listVersions(): Promise<string[]> {
  try {
    const out: string[] = [];
    let NextToken: string | undefined;
    do {
      const res = await opensearch.send(new ListVersionsCommand({ NextToken }));
      out.push(...(res.Versions ?? []));
      NextToken = res.NextToken;
    } while (NextToken);
    return out.length ? out : FALLBACK_VERSIONS;
  } catch {
    return FALLBACK_VERSIONS;
  }
}

/** The instance types of one engine version. Falls back to a short list when the call fails. */
export async function listInstanceTypes(EngineVersion: string): Promise<string[]> {
  try {
    const out: string[] = [];
    let NextToken: string | undefined;
    do {
      const res = await opensearch.send(new ListInstanceTypeDetailsCommand({ EngineVersion, NextToken }));
      out.push(...(res.InstanceTypeDetails ?? []).map((t) => t.InstanceType ?? "").filter(Boolean));
      NextToken = res.NextToken;
    } while (NextToken);
    return out.length ? out : FALLBACK_TYPES;
  } catch {
    return FALLBACK_TYPES;
  }
}

/** "OpenSearch_2.19" reads better as "OpenSearch 2.19". */
export const engineLabel = (version?: string) => (version ? version.replace("_", " ") : "-");

export type DomainPhase = "Active" | "Loading" | "Processing" | "Being deleted";

export function domainPhase(d: DomainStatus): DomainPhase {
  if (d.Deleted) return "Being deleted";
  if (!d.Created) return "Loading";
  if (d.Processing) return "Processing";
  return "Active";
}

export function DomainState({ domain }: { domain?: DomainStatus }) {
  if (!domain) return <>-</>;
  const phase = domainPhase(domain);
  if (phase === "Active") return <StatusIndicator type="success">Active</StatusIndicator>;
  if (phase === "Being deleted") return <StatusIndicator type="pending">Being deleted</StatusIndicator>;
  return <StatusIndicator type="in-progress">{phase}</StatusIndicator>;
}

/** The domain endpoint. A domain in a VPC reports it under Endpoints.vpc. */
export const endpointOf = (d: DomainStatus) => d.Endpoint ?? d.Endpoints?.vpc ?? "";

export const NAME_RULE = /^[a-z][a-z0-9-]{2,27}$/;
export const NAME_ERROR = "Use 3 to 28 characters. Start with a lowercase letter. Use lowercase letters, numbers and hyphens.";

/** floci publishes each domain on a port of its host, starting here. The API does not say which one. */
export const FIRST_PORT = 9400;
export const LAST_PORT = 9499;

export const curlCommand = (host: string) => `curl "http://${host || "localhost"}:${FIRST_PORT}/_cluster/health?pretty"`;
