import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Im Dev-Modus laufen UI (5173) und API (4000) getrennt; die Proxy-Einträge sorgen
// dafür, dass der Client dieselben relativen Pfade nutzen kann wie im Produktionsbuild,
// wo der Server das Frontend selbst ausliefert.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/accounts': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
