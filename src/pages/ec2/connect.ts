/** What the console server says about the browser terminal. See terminal.mjs. */
export type TerminalInfo = {
  enabled: boolean;
  reason: string | null;
  /** State of the instance's container, when the server could look. */
  state?: string | null;
  /** Host port that floci published for the instance's SSH server, when the server could look. */
  sshPort?: number | null;
};

const NO_SERVER = "This console server has no browser terminal. It needs the production server (server.mjs) or the dev server, started with EC2_TERMINAL=1.";

/** Asks the console server whether the browser terminal is on, and about one instance if given. */
export async function terminalInfo(id?: string): Promise<TerminalInfo> {
  try {
    const res = await fetch(id ? `/api/terminal/${encodeURIComponent(id)}` : "/api/terminal");
    // A static host answers every path with the app's HTML. That means there is no terminal.
    if (!(res.headers.get("content-type") ?? "").includes("json")) return { enabled: false, reason: NO_SERVER };
    const body = (await res.json()) as Partial<TerminalInfo> & { message?: string };
    if (!res.ok) return { enabled: false, reason: body.message ?? `HTTP ${res.status}` };
    return { enabled: Boolean(body.enabled), reason: body.reason ?? null, state: body.state ?? null, sshPort: body.sshPort ?? null };
  } catch {
    return { enabled: false, reason: NO_SERVER };
  }
}

/** The WebSocket address of an instance's terminal, on the same origin as the page. */
export function terminalSocketUrl(id: string, cols: number, rows: number, location: Pick<Location, "protocol" | "host"> = window.location): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/terminal/${encodeURIComponent(id)}/ws?cols=${cols}&rows=${rows}`;
}

/**
 * The SSH command for an instance, as the AWS console's "SSH client" tab shows it.
 * floci puts the launch key pair in root's authorized_keys and publishes port 22 on a host port.
 */
export function sshCommand(keyName: string | undefined, host: string | undefined, port: number | null | undefined): string {
  const key = keyName ? `${keyName}.pem` : "<your-key>.pem";
  return `ssh -i "${key}" -p ${port ?? "<ssh-port>"} root@${host || "<floci-host>"}`;
}
