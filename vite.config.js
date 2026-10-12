import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, allowedHosts: ['.e2b.app', 'localhost'] },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: ['.e2b.app', 'localhost'] },
  build: { chunkSizeWarningLimit: 2000 },
});
