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
