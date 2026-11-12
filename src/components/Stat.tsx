import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import { RouterLink } from "./RouterLink";

/** A resource counter for dashboards: a label, and a big number that links to the list page. */
export function Stat({ label, value, to, loading, hint }: { label: string; value: ReactNode; to?: string; loading?: boolean; hint?: ReactNode }) {
  const shown = loading ? <Spinner /> : (value ?? "-");
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>
        <Box variant="awsui-value-large">{to && !loading ? <RouterLink to={to} fontSize="display-l">{shown}</RouterLink> : shown}</Box>
      </div>
      {hint && !loading && (
        <div>
          <Box variant="small" color="text-body-secondary">
            {hint}
          </Box>
        </div>
      )}
    </div>
  );
}
