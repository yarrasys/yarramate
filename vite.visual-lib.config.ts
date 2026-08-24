import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Builds the editor as a library someone else can mount (#252).
 *
 * SELF-CONTAINED, exactly like the served app: React, cytoscape and the engine
 * are inside. A host calls `mountEditor(el, …)` and needs no React of its own,
 * no peer dependencies, and no build configuration - which is what lets a
 * product that is not a React application have the editor at all.
 *
 * `vite.visual.config.ts` still builds the page the session server serves.
 * Neither output is derived from the other; they are two entries over the same
 * source, and the served page is the one that must stay byte-addressable by
 * the asset route.
 *
 * SIZE, measured rather than assumed: the library is 4.0 MB raw and 968 KB
 * gzipped against the served page's 2.2 MB and 683 KB. The 285 KB gzipped
 * difference is the engine - the compiler, Ajv and the schemas - which is what
 * a host is buying: a canvas that compiles, projects and plans without a
 * server. Lib mode leaves whitespace in whatever `minify` is set to, so the
 * raw number reads worse than what ships; gzip is the honest one.
 */
export default defineConfig({
  /**
   * React's CJS entry picks its build with `process.env.NODE_ENV`, and library
   * mode leaves that for the consumer's bundler to replace. This bundle is
   * self-contained precisely so a host needs no bundler, so nobody would - and
   * the page died on `process is not defined` before the editor drew anything.
   * Defining it here also drops React's development half.
   */
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // Keep Vite's JSX transform aligned with React's production runtime selected
  // above; otherwise a `jsxDEV` call reaches a runtime that only exports `jsx`.
  esbuild: { jsxDev: false },
  plugins: [
    {
      name: 'editor-declaration-entry',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'editor.d.ts',
          source: "export * from './types/visual-app/mount.js'\n",
        })
      },
    },
  ],
  build: {
    // NOT under `dist/visual-app/`: that directory is `emptyOutDir` for the
    // served page's build, so a library written inside it survives only until
    // the next app build - and only in the order `build:visual` happens to run
    // them. A sibling directory owes nothing to that ordering.
    outDir: fileURLToPath(new URL('./dist/visual-app-lib/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(
        new URL('./src/visual-app/mount.tsx', import.meta.url),
      ),
      formats: ['es'],
      fileName: () => 'editor.js',
      cssFileName: 'styles',
    },
  },
})
