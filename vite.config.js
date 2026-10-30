import { defineConfig } from 'vite';

// base './' → the build works from any sub-path (GitHub Pages project site, local file server).
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
