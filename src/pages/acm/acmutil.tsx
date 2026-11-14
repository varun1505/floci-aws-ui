import { type CertificateSummary, type KeyAlgorithm, ListCertificatesCommand } from "@aws-sdk/client-acm";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { acm } from "../../clients/acm";

/** The last part of a certificate ARN. The console shows it as the certificate ID. */
export const certId = (arn?: string) => (arn ?? "").split("/").pop() ?? "";

/** An ARN has slashes, so it goes in a query parameter. */
export const certHref = (arn?: string) => `/acm/certificate?arn=${encodeURIComponent(arn ?? "")}`;

/** The key algorithms a certificate request can use, with the names the AWS console shows. */
export const KEY_ALGORITHMS: { value: KeyAlgorithm; label: string }[] = [
  { value: "RSA_2048", label: "RSA 2048" },
  { value: "EC_prime256v1", label: "ECDSA P 256" },
  { value: "EC_secp384r1", label: "ECDSA P 384" },
];

// ListCertificates on AWS leaves out some key types unless they are asked for.
const ALL_KEY_TYPES: KeyAlgorithm[] = ["RSA_1024", "RSA_2048", "RSA_3072", "RSA_4096", "EC_prime256v1", "EC_secp384r1", "EC_secp521r1"];

export async function listCertificates(): Promise<CertificateSummary[]> {
  const out: CertificateSummary[] = [];
  let NextToken: string | undefined;
  do {
    const res = await acm.send(new ListCertificatesCommand({ NextToken, Includes: { keyTypes: ALL_KEY_TYPES } }));
    out.push(...(res.CertificateSummaryList ?? []));
    NextToken = res.NextToken;
  } while (NextToken);
  return out;
}

const TYPE: Record<string, string> = { AMAZON_ISSUED: "Amazon Issued", IMPORTED: "Imported", PRIVATE: "Private" };
export const typeLabel = (type?: string) => (type ? (TYPE[type] ?? type) : "-");

/** "EC-prime256v1" and "RSA-2048" as the AWS console words them. */
export function algorithmLabel(alg?: string) {
  if (!alg) return "-";
  const key = alg.replace("-", "_");
  return KEY_ALGORITHMS.find((k) => k.value === key)?.label ?? alg.replace(/[-_]/, " ");
}

export const renewalLabel = (r?: string) => (r === "ELIGIBLE" ? "Eligible" : r === "INELIGIBLE" ? "Ineligible" : "-");

const STATUS: Record<string, { type: StatusIndicatorProps.Type; label: string }> = {
  ISSUED: { type: "success", label: "Issued" },
  PENDING_VALIDATION: { type: "pending", label: "Pending validation" },
  INACTIVE: { type: "stopped", label: "Inactive" },
  EXPIRED: { type: "error", label: "Expired" },
  REVOKED: { type: "error", label: "Revoked" },
  FAILED: { type: "error", label: "Failed" },
  VALIDATION_TIMED_OUT: { type: "error", label: "Validation timed out" },
  SUCCESS: { type: "success", label: "Success" },
};

/** Status of a certificate, or of the validation of one domain. */
export function CertStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  const s = STATUS[status];
  return <StatusIndicator type={s?.type ?? "info"}>{s?.label ?? status}</StatusIndicator>;
}

export const toBytes = (text: string) => new TextEncoder().encode(text.trim() + "\n");

export const isPem = (text: string, kind: "CERTIFICATE" | "PRIVATE KEY") => new RegExp(`-----BEGIN [A-Z ]*${kind}-----[\\s\\S]+-----END [A-Z ]*${kind}-----`).test(text);
