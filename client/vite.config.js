import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build config — modifié pour forcer le rebuild
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,            // accessible depuis les autres PC du réseau local (jouer entre amis)
    allowedHosts: true,    // accepte aussi les adresses de tunnel (Cloudflare, ngrok...)
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',   // skins importés par l'administrateur
      // Le temps réel passe aussi par le port 5173 : un seul tunnel suffit pour jouer à distance
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: {
    copyPublicDir: true,
  },
});
