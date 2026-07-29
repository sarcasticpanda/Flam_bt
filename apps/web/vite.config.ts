import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Source aliases rather than built packages — one less build step in the dev loop, and
      // types stay live across the workspace without a watch task.
      '@board/shared': r('../../packages/shared/src/index.ts'),
      '@board/canvas-engine': r('../../packages/canvas-engine/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/yjs': { target: 'ws://localhost:3001', ws: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Keep the initial bundle under the 350KB budget: the call layer and AI panels are
        // lazy chunks most sessions never load.
        manualChunks: {
          yjs: ['yjs', 'y-protocols/sync', 'y-protocols/awareness'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
