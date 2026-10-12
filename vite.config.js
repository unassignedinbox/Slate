import { defineConfig } from 'vite';

// The editor is a static ES-module app; workers are loaded as modules so the kernel can be shared
// between the main thread (editing, preview) and the bake worker (tessellation of the whole world).
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: { target: 'esnext', sourcemap: true },
  worker: { format: 'es' },
});
