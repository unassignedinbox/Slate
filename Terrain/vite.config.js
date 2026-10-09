// Dev and preview servers bind to all interfaces so the sandbox preview proxy can reach them. allowedHosts is enabled
// because the preview host is generated per sandbox and Vite would otherwise reject it.
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
