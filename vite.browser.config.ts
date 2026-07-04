import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = import.meta.dirname;

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5174,
    open: '/browser-index.html'
  },
  build: {
    outDir: resolve(__dirname, 'out/browser'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/browser-index.html')
      }
    }
  }
});
