import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { sep } from 'node:path'

// Artifact coverage derives from git (ADR 0130), so it belongs to
// reconcile, the verb that reports observed reality. The manifest declares
// the scope; this module enumerates it; the pure reconciliation takes the
// result as data, so a host with no filesystem can pass its own.

export interface CoverageScopePattern {
  readonly pattern: string
  /** Repository-relative files the pattern selected, sorted. */
  readonly artifacts: readonly string[]
}

export type ArtifactCoverage =
  | { readonly assessed: false; readonly reason: string }
  | {
      readonly assessed: true
      readonly scope: readonly CoverageScopePattern[]
    }

const runGit = (cwd: string, args: readonly string[]) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

export function deriveArtifactCoverage(
  manifestDirectory: string,
  patterns: readonly string[] | undefined,
): ArtifactCoverage {
  if (patterns === undefined) {
    return {
      assessed: false,
      reason: 'the workspace manifest declares no coverage scope',
    }
  }
  // The root is the git toplevel of the manifest's directory, never the
  // process cwd: the same command must report the same coverage wherever it
  // was invoked (the #216 bug shape), and the repository boundary is git's
  // to draw, not a directory-layout guess.
  const toplevel = runGit(manifestDirectory, [
    'rev-parse',
    '--show-toplevel',
  ])
  if (toplevel.status !== 0) {
    return {
      assessed: false,
      reason: 'the workspace does not live in a git repository',
    }
  }
  const root = toplevel.stdout.trim()
  // An artifact is any file git can see: tracked, or untracked and not
  // ignored. Tracked-only would blind the report to exactly the newest
  // files — the recurrence this feature exists to catch (ADR 0130).
  const listed = runGit(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ])
  if (listed.status !== 0) {
    return {
      assessed: false,
      reason: `git ls-files failed: ${(listed.stderr ?? '').trim()}`,
    }
  }
  const visible = new Set(
    (listed.stdout ?? '').split('\0').filter((path) => path.length > 0),
  )
  // Glob matches are intersected with git's view, so a symlink escaping the
  // repository or a build tree git ignores cannot enter the artifact set
  // however broad the glob. The intersection also drops directories: git
  // lists files only.
  return {
    assessed: true,
    scope: patterns.map((pattern) => ({
      pattern,
      artifacts: globSync(pattern, { cwd: root })
        .map((path) => path.split(sep).join('/'))
        .filter((path) => visible.has(path))
        .sort((left, right) => left.localeCompare(right)),
    })),
  }
}
