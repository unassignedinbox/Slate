import { defineConfig } from 'vite';

// Road Studio is a standalone single-page app. It is served from the root so the
// live preview works without any path rewriting.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
});
