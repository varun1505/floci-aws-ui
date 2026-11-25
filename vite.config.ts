import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createTerminal } from "./terminal.mjs";

// The browser cannot call floci directly: floci does not answer CORS preflight
// requests. So the dev server forwards /aws/* to floci, and the page stays same-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.FLOCI_ENDPOINT || "http://localhost:4566";
  return {
    plugins: [
      react(),
      {
        // Same route as server.mjs, so database pages can show the floci host in dev too.
        name: "console-config",
        configureServer(server) {
          server.middlewares.use("/console-config.json", (_req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ flociHost: new URL(target).hostname }));
          });
          // Same as server.mjs: floci's default account and the FLOCI_ACCOUNTS presets.
          server.middlewares.use("/console-accounts.json", async (_req, res) => {
            const isId = (id: unknown): id is string => typeof id === "string" && /^\d{12}$/.test(id);
            let fromManifest: unknown;
            try {
              fromManifest = (await (await fetch(new URL("/_floci/info", target), { signal: AbortSignal.timeout(2000) })).json())?.defaults?.account_id;
            } catch {
              /* older floci, or floci is down */
            }
            const accounts = (env.FLOCI_ACCOUNTS || "")
              .split(",")
              .map((entry) => {
                const [id, ...name] = entry.split("=");
                return { id: id.trim(), name: name.join("=").trim() || undefined };
              })
              .filter((a) => isId(a.id));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ defaultAccountId: [fromManifest, env.FLOCI_DEFAULT_ACCOUNT_ID].find(isId) ?? "000000000000", accounts }));
          });
          // The EC2 browser terminal, as in server.mjs. Set EC2_TERMINAL=1 in .env.local to turn it on.
          const terminal = createTerminal({ ...process.env, ...env });
          server.middlewares.use((req, res, next) => {
            if (!terminal.handleRequest(req, res)) next();
          });
          server.httpServer?.on("upgrade", (req, socket) => terminal.handleUpgrade(req, socket));
        },
      },
    ],
    test: {
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
      css: false,
      // Form tests type into many fields. They are slow on a busy machine.
      testTimeout: 20000,
    },
    server: {
      host: true,
      proxy: {
        "/aws": { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/aws/, "") || "/" },
      },
    },
  };
});
