import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
  build: {
    outDir: 'site',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'Source.html'),
    },
    chunkSizeWarningLimit: 1400,
  },
});
