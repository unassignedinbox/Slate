import { defineConfig } from 'vite';

// The dev server is also shown through the sandbox preview proxy, whose host name changes per
// session, so Vite must accept any host (it still binds to 0.0.0.0 via `npm run dev`).
export default defineConfig({
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
});
