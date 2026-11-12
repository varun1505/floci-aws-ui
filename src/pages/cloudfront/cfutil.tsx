import { GetDistributionConfigCommand, UpdateDistributionCommand } from "@aws-sdk/client-cloudfront";
import Box from "@cloudscape-design/components/box";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";
import { cloudfront } from "../../clients/cloudfront";

export const POLICY_LABEL: Record<string, string> = {
  "allow-all": "HTTP and HTTPS",
  "redirect-to-https": "Redirect HTTP to HTTPS",
  "https-only": "HTTPS only",
};

/** CloudFront has no "enable" call. Read the config, flip the flag, write it back with the ETag. */
export async function setEnabled(id: string, enabled: boolean): Promise<string | undefined> {
  const current = await cloudfront.send(new GetDistributionConfigCommand({ Id: id }));
  const res = await cloudfront.send(
    new UpdateDistributionCommand({ Id: id, IfMatch: current.ETag, DistributionConfig: { ...current.DistributionConfig!, Enabled: enabled } }),
  );
  return res.ETag;
}

export function EnabledStatus({ enabled }: { enabled?: boolean }) {
  return <StatusIndicator type={enabled ? "success" : "stopped"}>{enabled ? "Enabled" : "Disabled"}</StatusIndicator>;
}

export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}
