import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
  server: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
  build: { target: "esnext", chunkSizeWarningLimit: 1500 },
});
