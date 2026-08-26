// Vite's `?raw` suffix imports a file's bytes as a string. The visual app is
// built by vite (and tested through vitest's vite pipeline), never by the
// node tsc build — `tsconfig.build.json` excludes `src/visual-app` — so this
// declaration only has to satisfy the typechecker, not a runtime resolver.
declare module '*.yaml?raw' {
  const source: string
  export default source
}
