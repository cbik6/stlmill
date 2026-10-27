import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the same build works at
// https://<user>.github.io/<repo>/ and at a custom domain root.
//
// Multi-page build: every tool is its own HTML entry. When adding a tool,
// add `<id>/index.html` here and register it in src/hub/tools.js.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        clicker: resolve(import.meta.dirname, 'clicker/index.html'),
        lithophane: resolve(import.meta.dirname, 'lithophane/index.html'),
        // Character Cap is parked (hidden on the hub, not deployed). To bring it back:
        // charcap: resolve(import.meta.dirname, 'character-cap/index.html'),
      },
    },
  },
});
