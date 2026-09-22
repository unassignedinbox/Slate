import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        // Preview proxies serve the app under an arbitrary *.e2b.app host.
        allowedHosts: true,
        cors: true,
        hmr: { clientPort: 443, protocol: 'wss' },
    },
    preview: {
        host: '0.0.0.0',
        port: 5173,
        allowedHosts: true,
    },
});
