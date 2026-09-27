import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 4400,
    strictPort: true,
    // Allow the Arena sandbox preview proxy hosts (*.e2b.app)
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
