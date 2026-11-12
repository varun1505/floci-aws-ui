import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The browser cannot call floci directly: floci does not answer CORS preflight
// requests. So the dev server forwards /aws/* to floci, and the page stays same-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.FLOCI_ENDPOINT || "http://localhost:4566";
  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: {
        "/aws": { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/aws/, "") || "/" },
      },
    },
  };
});
