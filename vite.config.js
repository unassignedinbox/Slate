import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The live preview is proxied from a random host name, so accept any host.
    allowedHosts: true,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2020',
  },
});
