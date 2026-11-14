import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
