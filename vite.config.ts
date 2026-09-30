import { defineConfig } from 'vite';
export default defineConfig({
  // COOP/COEP enable SharedArrayBuffer -> the multithreaded Jolt build.
  // If the hosting proxy strips them the app silently uses single-thread Jolt.
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true, cors: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['jolt-physics'] },
  preview: { host: '0.0.0.0', allowedHosts: true },
});
