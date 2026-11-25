import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalSocketUrl } from "./connect";

const BACKGROUND = "#0f141a";

type Status = "connecting" | "connected" | "closed";

const STATUS_TEXT: Record<Status, string> = { connecting: "Connecting...", connected: "Connected", closed: "Disconnected" };
const STATUS_COLOR: Record<Status, string> = { connecting: "#f2a900", connected: "#29ad32", closed: "#d13212" };

/** A full-window shell on one instance. The Connect page opens it in a new tab, as the AWS console does. */
export default function InstanceTerminal() {
  const { id = "" } = useParams();
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = `${id} | EC2 terminal`;
  }, [id]);

  useEffect(() => {
    if (!box.current) return;
    setStatus("connecting");
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: { background: BACKGROUND },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current);
    fit.fit();

    const ws = new WebSocket(terminalSocketUrl(id, term.cols, term.rows));
    ws.binaryType = "arraybuffer";
    const encoder = new TextEncoder();
    const send = (data: string | Uint8Array<ArrayBuffer>) => ws.readyState === WebSocket.OPEN && ws.send(data);

    ws.onopen = () => {
      setStatus("connected");
      term.focus();
    };
    ws.onmessage = (e) => term.write(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = (e) => {
      setStatus("closed");
      const reason = e.reason || (e.code === 1006 ? "The connection to the console server was lost." : "The session ended.");
      term.write(`\r\n\x1b[33m${reason}\x1b[0m\r\n`);
    };

    const onData = term.onData((d) => send(encoder.encode(d)));
    // Some mouse reports are raw bytes, not text. Send them as they are.
    const onBinary = term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    const onResize = term.onResize(({ cols, rows }) => send(JSON.stringify({ type: "resize", cols, rows })));
    const refit = () => fit.fit();
    window.addEventListener("resize", refit);

    return () => {
      window.removeEventListener("resize", refit);
      onData.dispose();
      onBinary.dispose();
      onResize.dispose();
      ws.onclose = null;
      ws.close();
      term.dispose();
    };
  }, [id, attempt]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: BACKGROUND, color: "#d5dbdb", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 16px", borderBottom: "1px solid #2a3440", fontSize: 14, flexWrap: "wrap" }}>
        <strong>EC2 terminal</strong>
        <span style={{ fontFamily: "monospace" }}>{id}</span>
        <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[status] }} />
          {STATUS_TEXT[status]}
        </span>
        {status === "closed" && (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            style={{ marginLeft: "auto", background: "transparent", color: "inherit", border: "1px solid #5f6b7a", borderRadius: 16, padding: "4px 14px", cursor: "pointer" }}
          >
            Reconnect
          </button>
        )}
      </div>
      <div ref={box} style={{ flex: 1, minHeight: 0, padding: "4px 0 0 8px" }} />
    </div>
  );
}
