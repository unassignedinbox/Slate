import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The sandbox preview is served from https://{port}-{sandboxId}.e2b.app,
// so the dev server must bind 0.0.0.0 and accept any Host header.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
});
