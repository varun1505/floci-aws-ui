import { afterEach, describe, expect, it, vi } from "vitest";
import { sshCommand, terminalInfo, terminalSocketUrl } from "./connect";

describe("sshCommand", () => {
  it("uses the key, the host and the published port", () => {
    expect(sshCommand("my-key", "floci.internal", 2201)).toBe('ssh -i "my-key.pem" -p 2201 root@floci.internal');
  });
  it("shows placeholders for what it does not know", () => {
    expect(sshCommand(undefined, "", null)).toBe('ssh -i "<your-key>.pem" -p <ssh-port> root@<floci-host>');
  });
});

describe("terminalSocketUrl", () => {
  it("uses ws on http and wss on https, on the page's own host", () => {
    expect(terminalSocketUrl("i-0123456789abcdef0", 80, 24, { protocol: "http:", host: "console:8080" })).toBe("ws://console:8080/api/terminal/i-0123456789abcdef0/ws?cols=80&rows=24");
    expect(terminalSocketUrl("i-0123456789abcdef0", 120, 40, { protocol: "https:", host: "console.test" })).toBe("wss://console.test/api/terminal/i-0123456789abcdef0/ws?cols=120&rows=40");
  });
});

describe("terminalInfo", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (body: unknown, init: ResponseInit = {}) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" }, ...init })));

  it("passes on what the server says about an instance", async () => {
    answer({ enabled: true, reason: null, state: "running", sshPort: 2201 });
    expect(await terminalInfo("i-0123456789abcdef0")).toEqual({ enabled: true, reason: null, state: "running", sshPort: 2201 });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/terminal/i-0123456789abcdef0");
  });
  it("reports off when the server answers with the app's HTML instead", async () => {
    answer("<html>app</html>");
    const info = await terminalInfo();
    expect(info.enabled).toBe(false);
    expect(info.reason).toContain("EC2_TERMINAL=1");
  });
  it("reports off with the server's message on an error", async () => {
    answer({ message: "'x' is not an instance ID." }, { status: 400 });
    expect(await terminalInfo("x")).toEqual({ enabled: false, reason: "'x' is not an instance ID." });
  });
  it("reports off when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await terminalInfo()).enabled).toBe(false);
  });
});
