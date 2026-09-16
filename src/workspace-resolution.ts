import type { Diagnostic, WorkspaceSource } from './compiler.js'
import { diagnosticOrder, loadSourceDocument } from './source-document.js'
import { validateWorkspace } from './schema-validation.js'

/** The directory of a `/`-separated path, `''` at the root. Both separators by hand: no `node:path` here. */
const posixDirectoryOf = (path: string): string => {
  const normalised = path.split(/[\\/]/).join('/')
  const cut = normalised.lastIndexOf('/')
  return cut === -1 ? '' : normalised.slice(0, cut)
}

/**
 * Resolving a manifest without a filesystem (ADR 0156).
 *
 * `loadWorkspaceManifest` (workspace.ts) validates the manifest, expands its
 * patterns and reports what does not resolve. Only the expansion touches a
 * filesystem: it asks `globSync`, then `realpath` for confinement and for
 * aliasing. Everything else is arithmetic on the manifest and on the paths
 * the expansion hands back, so it lives here with the expansion injected,
 * and the Node loader is one caller of it. The other is
 * `resolveWorkspaceFrom`: the same manifest over a listed set of paths, which
 * is what a store with no filesystem has (`SourceStore.list()`, ADR 0100).
 *
 * The two agree on every diagnostic: YM701 for a pattern that is absolute,
 * carries `..` or a backslash, YM702 for a pattern matching nothing, YM703
 * for one file claimed by two categories.
 */

export interface WorkspaceManifest {
  readonly format: 'yarramate/workspace/v1'
  readonly id: string
  readonly documents: readonly string[]
  readonly profiles: readonly string[]
  readonly projections: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly patterns?: readonly string[]
  readonly questions?: readonly string[]
  readonly evidence?: readonly string[]
  readonly contracts?: readonly string[]
  /**
   * Glob patterns naming the artifacts the model intends to cover (#175,
   * ADR 0130). Not a document category: nothing here is loaded or compiled,
   * so it never joins ResolvedWorkspace. reconcile resolves the patterns
   * against the root of the git repository the manifest lives in and reports
   * every selected file no evidence observation claims.
   */
  readonly coverage?: readonly string[]
}

export interface ResolvedWorkspace {
  readonly id: string
  readonly documents: readonly string[]
  readonly profiles: readonly string[]
  readonly projections: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly patterns: readonly string[]
  /**
   * Question catalogues the workspace itself carries (#345, ADR 0129).
   * ADDITIVE to the shipped catalogue: `--catalogue` replaces the base, this
   * adds to it, which is what lets a consultant author a question mid
   * engagement without a product release.
   *
   * OPTIONAL in the type although every resolver populates it, and that is
   * deliberate. `ResolvedWorkspace` is published, and adding `patterns` to
   * it as a required field broke a consumer's production module: a required
   * field is free for readers and a break for CONSTRUCTORS. Six fixtures in
   * this repository construct one, which is the same signal from inside.
   * Read it as `workspace.questions ?? []`.
   */
  readonly questions?: readonly string[]
  readonly evidence: readonly string[]
  readonly contracts: readonly string[]
}

export type WorkspaceManifestResult =
  | {
      readonly ok: true
      readonly manifest: WorkspaceManifest
      readonly workspace: ResolvedWorkspace
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type ManifestCategory =
  | 'documents'
  | 'profiles'
  | 'projections'
  | 'adapterMappings'
  | 'patterns'
  | 'questions'
  | 'evidence'
  | 'contracts'

/** One expanded match: where it is written, and what physical thing it is. */
export interface ExpandedMatch {
  /** The path as the resolved workspace will carry it. */
  readonly path: string
  /**
   * The identity two categories must not share (YM703): a real path on a
   * filesystem, the path itself in a store, which has no links.
   */
  readonly identity: string
  /** Set when the match lies outside the manifest directory (YM701). */
  readonly outside?: true
}

/**
 * How a pattern becomes files. Receives the pattern as written, already
 * screened for the shapes YM701 refuses on sight, and answers every match in
 * any order; the core sorts and de-duplicates.
 */
export type PatternExpander = (pattern: string) => readonly ExpandedMatch[]

const unsafePattern = (pattern: string): boolean =>
  pattern.startsWith('/') ||
  /^[A-Za-z]:[\\/]/.test(pattern) ||
  pattern.includes('\\') ||
  pattern.split('/').includes('..')

export const resolveManifest = (
  source: WorkspaceSource,
  expand: PatternExpander,
): WorkspaceManifestResult => {
  const loaded = loadSourceDocument<WorkspaceManifest>(
    source,
    validateWorkspace,
    'Workspace',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document

  const resolutionDiagnostics: Diagnostic[] = []
  const categoryByIdentity = new Map<string, string>()
  const positionOf = (field: string, index: number) => {
    const node = yaml.getIn([field, index], true)
    const offset =
      typeof node === 'object' &&
      node !== null &&
      'range' in node &&
      Array.isArray(node.range)
        ? node.range[0]
        : 0
    return lineCounter.linePos(offset)
  }
  const diagnostic = (
    code: string,
    message: string,
    field: string,
    index: number,
  ): void => {
    const position = positionOf(field, index)
    resolutionDiagnostics.push({
      severity: 'error',
      code,
      message,
      path: source.path,
      pointer: `/${field}/${index}`,
      line: position.line,
      column: position.col,
    })
  }
  const expandCategory = (
    field: ManifestCategory,
    label: string,
    patterns: readonly string[],
  ): readonly string[] =>
    [
      ...new Set(
        patterns.flatMap((pattern, index) => {
          if (unsafePattern(pattern)) {
            diagnostic(
              'YM701',
              `Workspace ${label} pattern "${pattern}" must be a relative path beneath the manifest directory`,
              field,
              index,
            )
            return []
          }
          const matches = expand(pattern)
          if (matches.length === 0) {
            diagnostic(
              'YM702',
              `Workspace ${label} pattern "${pattern}" matched no files`,
              field,
              index,
            )
          }
          return matches.flatMap((match) => {
            if (match.outside === true) {
              diagnostic(
                'YM701',
                `Workspace ${label} pattern "${pattern}" resolved outside the manifest directory`,
                field,
                index,
              )
              return []
            }
            const previousLabel = categoryByIdentity.get(match.identity)
            if (previousLabel !== undefined && previousLabel !== label) {
              diagnostic(
                'YM703',
                `Resolved file "${match.path}" is declared as both ${previousLabel} and ${label}`,
                field,
                index,
              )
            } else {
              categoryByIdentity.set(match.identity, label)
            }
            return [match.path]
          })
        }),
      ),
    ].sort()
  const workspace: ResolvedWorkspace = {
    id: value.id,
    documents: expandCategory('documents', 'document', value.documents),
    profiles: expandCategory('profiles', 'profile', value.profiles),
    projections: expandCategory('projections', 'projection', value.projections),
    adapterMappings: expandCategory(
      'adapterMappings',
      'adapter mapping',
      value.adapterMappings,
    ),
    patterns: expandCategory('patterns', 'pattern', value.patterns ?? []),
    questions: expandCategory(
      'questions',
      'question catalogue',
      value.questions ?? [],
    ),
    evidence: expandCategory('evidence', 'evidence', value.evidence ?? []),
    contracts: expandCategory(
      'contracts',
      'Core contract',
      value.contracts ?? [],
    ),
  }
  // Coverage patterns resolve to nothing here: they are not a document
  // category, and reconcile interprets them against the repository root
  // (ADR 0130). Load-time validation covers only pattern safety, with the
  // same guard every resolving category gets, but relative to the
  // repository, so escaping it is what YM701 refuses.
  for (const [index, pattern] of (value.coverage ?? []).entries()) {
    if (!unsafePattern(pattern)) continue
    diagnostic(
      'YM701',
      `Workspace coverage pattern "${pattern}" must be a relative path beneath the repository root`,
      'coverage',
      index,
    )
  }
  if (resolutionDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: resolutionDiagnostics.sort(diagnosticOrder),
    }
  }
  return { ok: true, manifest: value, workspace }
}

// ---------------------------------------------------------------------------
// Pattern matching over a listed set of paths
// ---------------------------------------------------------------------------

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A manifest pattern as a regular expression over a `/`-separated relative
 * path: `**` crosses directories, `*` and `?` stay inside a segment, `{a,b}`
 * lists alternatives, `[...]` is a character class. What `globSync` accepts
 * for the shapes a manifest writes; a pattern with no wildcard matches its
 * own path exactly.
 */
export const patternToRegExp = (pattern: string): RegExp => {
  let out = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]!
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` matches zero or more directories; a bare `**` matches anything.
        if (pattern[index + 2] === '/') {
          out += '(?:[^/]+/)*'
          index += 3
        } else {
          out += '.*'
          index += 2
        }
      } else {
        out += '[^/]*'
        index += 1
      }
      continue
    }
    if (char === '?') {
      out += '[^/]'
      index += 1
      continue
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index)
      if (close === -1) {
        out += escapeRegExp(char)
        index += 1
        continue
      }
      const alternatives = pattern
        .slice(index + 1, close)
        .split(',')
        .map((alternative) => patternToRegExp(alternative).source.slice(1, -1))
      out += `(?:${alternatives.join('|')})`
      index = close + 1
      continue
    }
    if (char === '[') {
      const close = pattern.indexOf(']', index)
      if (close === -1) {
        out += escapeRegExp(char)
        index += 1
        continue
      }
      const body = pattern.slice(index + 1, close)
      out += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
      index = close + 1
      continue
    }
    out += escapeRegExp(char)
    index += 1
  }
  return new RegExp(`^${out}$`)
}

/**
 * The manifest over a file list: what `loadWorkspaceManifest` does over a
 * directory, with `paths` (every path the store holds, `/`-separated,
 * relative to the store root) in place of `globSync`. The manifest's own
 * path says where its patterns are rooted; the resolved paths are store
 * paths, rooted where `paths` are. A store holds no links, so a file's
 * identity is its path.
 */
export const resolveWorkspaceFrom = (
  manifest: WorkspaceSource,
  paths: readonly string[],
): WorkspaceManifestResult => {
  const base = posixDirectoryOf(manifest.path)
  const prefix = base === '' ? '' : `${base}/`
  const candidates = paths.flatMap((path) =>
    path.startsWith(prefix) ? [path.slice(prefix.length)] : [],
  )
  return resolveManifest(manifest, (pattern) => {
    const matcher = patternToRegExp(pattern)
    return candidates
      .filter((candidate) => matcher.test(candidate))
      .map((candidate) => {
        const path = `${prefix}${candidate}`
        return { path, identity: path }
      })
  })
}
