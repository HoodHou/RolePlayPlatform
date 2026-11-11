import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the web app runs on its own port and forwards API calls to the server.
const apiTarget = process.env.RP_API_TARGET ?? `http://127.0.0.1:${process.env.RP_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/zustand')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next') || id.includes('/src/i18n/')) {
            return 'i18n';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
