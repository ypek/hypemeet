import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const sdk = fileURLToPath(new URL("../../sdk/hypemeet-plugin.ts", import.meta.url));

export default defineConfig({
  // Relative paths: inside the Discord Activity the plugin lives under /plugins/hypetv/.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@hypemeet/sdk": sdk } },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    fs: { allow: [".", sdk] },
    proxy: { "/api": "http://localhost:5175" },
  },
});
