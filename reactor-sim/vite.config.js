import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server is previewed from a remote host, so accept any Host header and bind to all interfaces.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
});
