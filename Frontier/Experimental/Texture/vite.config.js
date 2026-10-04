//============================================================================================================================================
// ⚙ vite.config.js — dev server and build configuration for the experimental texture editor
//============================================================================================================================================
// The editor reads two asset directories outside its own folder: the DM Sans faces the shared theme uses, and the OFL
// font archive the text decals set their type in. Both are allow-listed here so the dev server will serve them.
//============================================================================================================================================

import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const Resolve = (Relative) => fileURLToPath(new URL(Relative, import.meta.url));

export default defineConfig({
    base: "./",
    server: {
        host: "0.0.0.0",
        port: 5173,
        strictPort: true,
        allowedHosts: true,
        fs: {
            allow: [
                Resolve("."),
                Resolve("../../EngineContent/Fonts/SunReference"),
                Resolve("../../../EngineContent/FontArchives"),
            ],
        },
    },
    preview: {
        host: "0.0.0.0",
        port: 5173,
        strictPort: true,
        allowedHosts: true,
    },
});
