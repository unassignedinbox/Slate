import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Allow the Arena sandbox preview host to reach the dev server.
    allowedHosts: [
      '.e2b.app',
      '.e2b.dev',
      '.arena.ai',
      'localhost',
      '127.0.0.1',
      '.preview.arena.ai',
    ],
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
