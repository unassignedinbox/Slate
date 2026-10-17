import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The greybox imports the level data from ../levels, so Vite must be allowed to serve the repo root.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Live previews are served under a sandbox host name. Allow any host for this dev server.
    allowedHosts: true,
    fs: { allow: [repoRoot] },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
