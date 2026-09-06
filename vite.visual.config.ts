import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Builds the browser application the session server serves, and nothing else.
 *
 * The output is self-contained by construction: relative asset URLs, flat
 * hashed file names the server's asset route admits, and no external origin,
 * because the page runs under a policy that allows only `'self'`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/visual-app/', import.meta.url)),
  base: './',
  // The layout worker (#490): `main.tsx` imports `elkjs/lib/elk-worker.min.js?worker`
  // and vite emits it as one more flat, hashed asset under `assets/`, which the
  // session server's asset route serves like the rest. As a module worker the
  // file is bundled the way the page is; the classic (iife) form built the
  // same file behind a warning about an export name it does not have.
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./dist/visual-app/', import.meta.url)),
    // Only this directory: `build:node` writes the rest of `dist`.
    emptyOutDir: true,
    assetsDir: 'assets',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
