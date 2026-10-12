import { defineConfig } from 'vite';

// The editor is previewed through a proxied sandbox host, so the dev server
// must accept arbitrary Host headers and listen on all interfaces.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
