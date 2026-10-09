//============================================================================================================================================
//                                                               VITE.CONFIG.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/vite.config.js — Vite build configuration: React plugin, LAN and preview hosting on 0.0.0.0 with the
//    sandbox preview domain allowed, and ES-module workers.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------
export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1']
    },
    preview: {
        host: '0.0.0.0',
        port: 4173,
        strictPort: true,
        allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1']
    },
    worker: {
        format: 'es'
    }
});
