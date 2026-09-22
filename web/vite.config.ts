import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev only: /api, /reports and /uploads proxy to the R76 backend so the Vite
// origin never trips CORS. Production serves web/dist from the backend itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/reports': 'http://127.0.0.1:4000',
      '/uploads': 'http://127.0.0.1:4000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
