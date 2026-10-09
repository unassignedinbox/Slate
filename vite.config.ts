import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Slate is a browser tool: the dev server is bound to all interfaces so the
// hosted preview (https://<port>-<sandbox>.e2b.app) can reach it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.e2b.app', '.arena.ai', 'localhost'],
  },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
