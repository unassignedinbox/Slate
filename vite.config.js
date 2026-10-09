import { defineConfig } from 'vite';

// Dev server binds to 0.0.0.0 so the sandbox live preview can reach it. allowedHosts is
// relaxed because the preview host is a generated subdomain.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  worker: { format: 'es' },
});
