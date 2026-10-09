import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server and preview bind to all interfaces so the sandbox preview can reach them.
export default defineConfig({
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        port: 5180,
        strictPort: true,
        allowedHosts: true,
    },
    preview: {
        host: "0.0.0.0",
        port: 5180,
        strictPort: true,
        allowedHosts: true,
    },
    worker: {
        format: "es",
    },
    build: {
        target: "es2020",
    },
});
