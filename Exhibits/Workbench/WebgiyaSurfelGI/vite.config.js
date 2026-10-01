import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'Source.html'),
    },
    chunkSizeWarningLimit: 1400,
  },
});
