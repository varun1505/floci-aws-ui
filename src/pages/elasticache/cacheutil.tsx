import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";

export const ENGINES = [
  { value: "valkey", label: "Valkey" },
  { value: "redis", label: "Redis OSS" },
  { value: "memcached", label: "Memcached" },
];

export const ENGINE_LABEL: Record<string, string> = Object.fromEntries(ENGINES.map((e) => [e.value, e.label]));

export const NODE_TYPES = ["cache.t3.micro", "cache.t3.small", "cache.t3.medium", "cache.m5.large", "cache.r5.large"].map((value) => ({ value, label: value }));

const TYPE: Record<string, StatusIndicatorProps.Type> = { available: "success", creating: "in-progress", modifying: "in-progress", deleting: "in-progress", snapshotting: "in-progress", "create-failed": "error" };

export function CacheStatus({ status }: { status?: string }) {
  if (!status) return <>-</>;
  return <StatusIndicator type={TYPE[status] ?? "info"}>{status.charAt(0).toUpperCase() + status.slice(1)}</StatusIndicator>;
}

export const isSettled = (status?: string) => !status || !["creating", "modifying", "deleting", "snapshotting"].includes(status);

/** The command a developer runs to reach the cache from their machine. */
export function connectCommand(engine: string | undefined, host?: string, port?: number): string {
  if (!host || !port) return "";
  return engine === "memcached" ? `telnet ${host} ${port}` : `${engine === "valkey" ? "valkey-cli" : "redis-cli"} -h ${host} -p ${port}`;
}

export const validCacheId = (id: string) => /^[a-zA-Z](?!.*--)[a-zA-Z0-9-]{0,38}[a-zA-Z0-9]$|^[a-zA-Z]$/.test(id);
