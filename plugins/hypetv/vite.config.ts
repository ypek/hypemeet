import cascadeLayers from "@csstools/postcss-cascade-layers";
import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tvCssPlugin } from "./tv/web";

const sdk = fileURLToPath(new URL("../../sdk/hypemeet-plugin.ts", import.meta.url));

/**
 * `vite build --mode tv` is the page the TV apps open (tv/android, tv/webos), served at /tv/. TV browsers are old:
 * LG webOS 5 (2020) is Chromium 68, webOS 6 is 79, up to webOS 23 (94); Android TV boxes often ship an old WebView.
 * So that build lowers the syntax, adds the polyfills it needs, and flattens Tailwind's @layer blocks (Chromium < 99
 * drops a whole @layer stylesheet, leaving the page unstyled).
 */
const TV_TARGETS = ["chrome>=68"];

export default defineConfig(({ mode }) => {
  const tv = mode === "tv";
  return {
    // Relative paths: inside the Discord Activity the plugin lives under /plugins/hypetv/.
    base: "./",
    plugins: [react(), tailwindcss(), ...(tv ? [legacy({ modernTargets: TV_TARGETS, modernPolyfills: true, renderLegacyChunks: false }), tvCssPlugin()] : [])],
    resolve: { alias: { "@hypemeet/sdk": sdk } },
    css: tv ? { postcss: { plugins: [cascadeLayers()] } } : undefined,
    build: tv ? { outDir: "dist/tv", target: "chrome68", cssMinify: false, chunkSizeWarningLimit: 2000 } : { chunkSizeWarningLimit: 2000 },
    server: {
      port: 5174,
      strictPort: true,
      host: true,
      fs: { allow: [".", sdk] },
      proxy: { "/api": "http://localhost:5175" },
    },
  };
});
