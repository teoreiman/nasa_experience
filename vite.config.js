import { defineConfig } from 'vite';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Music the player drops into public/audio/music/ and the radio voices recorded with the macOS system
// voices (public/audio/voice/) are for local play only: keep them out of the build.
const stripPrivateMusic = {
  name: 'strip-private-music',
  closeBundle() {
    for (const sub of ['audio/music', 'audio/voice']) {
      const dir = resolve(import.meta.dirname, 'dist', sub);
      try {
        for (const f of readdirSync(dir)) if (!/^LEEME/i.test(f)) rmSync(join(dir, f), { recursive: true, force: true });
      } catch {
        /* no such folder */
      }
    }
  },
};

// base './' → the build works from any sub-path (GitHub Pages project site, local file server).
export default defineConfig({
  base: './',
  plugins: [stripPrivateMusic],
  server: { port: 5173, strictPort: false, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
