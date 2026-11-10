import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the web app runs on its own port and forwards API calls to the server.
const apiTarget = process.env.RP_API_TARGET ?? `http://127.0.0.1:${process.env.RP_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
