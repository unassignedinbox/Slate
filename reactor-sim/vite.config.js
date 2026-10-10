import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Preview requirements: bind to 0.0.0.0 and accept the sandbox preview host.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    allowedHosts: ['.e2b.app', 'localhost'],
  },
  preview: { host: '0.0.0.0', port: 5180, allowedHosts: ['.e2b.app', 'localhost'] },
});
