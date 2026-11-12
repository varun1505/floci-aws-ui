import { DescribeKeyCommand, type KeyMetadata, ListAliasesCommand, ListKeysCommand } from "@aws-sdk/client-kms";
import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import { kms } from "../../clients/kms";

export type KeyRow = KeyMetadata & { aliases: string[] };

export async function listAliases() {
  const out: { AliasName?: string; TargetKeyId?: string }[] = [];
  let Marker: string | undefined;
  do {
    const res = await kms.send(new ListAliasesCommand({ Marker, Limit: 100 }));
    out.push(...(res.Aliases ?? []));
    Marker = res.Truncated ? res.NextMarker : undefined;
  } while (Marker);
  return out;
}

/** Every key with its details and aliases. KMS lists only IDs, so each key needs one more call. */
export async function listKeys(): Promise<KeyRow[]> {
  const ids: string[] = [];
  let Marker: string | undefined;
  do {
    const res = await kms.send(new ListKeysCommand({ Marker, Limit: 100 }));
    ids.push(...(res.Keys ?? []).map((k) => k.KeyId ?? ""));
    Marker = res.Truncated ? res.NextMarker : undefined;
  } while (Marker);
  const [aliases, keys] = await Promise.all([listAliases(), Promise.all(ids.map((KeyId) => kms.send(new DescribeKeyCommand({ KeyId })).then((r) => r.KeyMetadata)))]);
  return keys
    .filter((k): k is KeyMetadata => !!k)
    .map((k) => ({ ...k, aliases: aliases.filter((a) => a.TargetKeyId === k.KeyId).map((a) => a.AliasName ?? "") }));
}

const STATE: Record<string, StatusIndicatorProps.Type> = { Enabled: "success", Disabled: "stopped", PendingDeletion: "warning", PendingImport: "pending", Unavailable: "error" };
const LABEL: Record<string, string> = { PendingDeletion: "Pending deletion", PendingImport: "Pending import" };

export function KeyState({ state }: { state?: string }) {
  if (!state) return <>-</>;
  return <StatusIndicator type={STATE[state] ?? "info"}>{LABEL[state] ?? state}</StatusIndicator>;
}

export const KEY_SPECS: Record<string, { label: string; usages: string[] }> = {
  SYMMETRIC_DEFAULT: { label: "Symmetric (SYMMETRIC_DEFAULT)", usages: ["ENCRYPT_DECRYPT"] },
  RSA_2048: { label: "RSA_2048", usages: ["ENCRYPT_DECRYPT", "SIGN_VERIFY"] },
  RSA_4096: { label: "RSA_4096", usages: ["ENCRYPT_DECRYPT", "SIGN_VERIFY"] },
  ECC_NIST_P256: { label: "ECC_NIST_P256", usages: ["SIGN_VERIFY"] },
  HMAC_256: { label: "HMAC_256", usages: ["GENERATE_VERIFY_MAC"] },
};

export const USAGE_LABEL: Record<string, string> = { ENCRYPT_DECRYPT: "Encrypt and decrypt", SIGN_VERIFY: "Sign and verify", GENERATE_VERIFY_MAC: "Generate and verify MAC" };
