import { globSync, realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import type { WorkspaceSource } from './compiler.js'
import { resolveManifest } from './workspace-resolution.js'

// The manifest's validation, pattern arithmetic and diagnostics live in
// `workspace-resolution.ts`, which imports no Node built-in; this module is
// the one caller that resolves a manifest's globs against a real filesystem
// and so is never bundled. `resolveWorkspaceFrom` in the same module is the
// same resolution over a store's file list (ADR 0156).
export type {
  ResolvedWorkspace,
  WorkspaceManifest,
  WorkspaceManifestResult,
} from './workspace-resolution.js'

export function loadWorkspaceManifest(
  source: WorkspaceSource,
  cwd: string,
) {
  const base = dirname(resolve(cwd, source.path))
  const realBase = realpathSync(base)
  return resolveManifest(source, (pattern) =>
    globSync(pattern, { cwd: base })
      .filter((path) => statSync(resolve(base, path)).isFile())
      .map((path) => {
        const realMatch = realpathSync(resolve(base, path))
        const withinBase =
          realMatch === realBase || realMatch.startsWith(`${realBase}${sep}`)
        return {
          path: relative(cwd, resolve(base, path)).split(sep).join('/'),
          identity: realMatch,
          ...(withinBase ? {} : { outside: true as const }),
        }
      }),
  )
}
