import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
  // relative asset paths so the built app can be served from any
  // subdirectory, e.g. a raw.githack.com mirror of the repo
  base: './',
  build: { target: 'es2022' },
});
