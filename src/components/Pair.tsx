import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";

/** A label with its value under it, for detail pages. */
export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{children || "-"}</div>
    </div>
  );
}

/** A value with a copy button in front of it. */
export function Copy({ text }: { text?: string }) {
  if (!text) return <>-</>;
  return <CopyToClipboard variant="inline" textToCopy={text} copyButtonAriaLabel="Copy" copySuccessText="Copied" copyErrorText="Failed to copy" />;
}

/** Pretty-prints a policy document. IAM returns them URL-encoded, other services as plain JSON. */
export function prettyJson(doc?: string): string {
  if (!doc) return "";
  let text = doc;
  try {
    if (/^%7B/i.test(text)) text = decodeURIComponent(text);
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function JsonBlock({ value }: { value?: string }) {
  return <pre style={{ margin: 0, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13 }}>{prettyJson(value) || "-"}</pre>;
}
