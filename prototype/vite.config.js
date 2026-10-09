import { defineConfig } from 'vite';

// Dev server is previewed through a proxied host, so allow any Host header.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
});
