import {
  compileWorkspaceWithProfileContext,
  type ContextualCompilationResult,
  type Diagnostic,
  type WorkspaceSource,
} from '../compiler.js'
import { loadEvidence, type EvidenceDocument } from '../evidence.js'
import {
  composeCatalogues,
  type CatalogueCompositionResult,
} from '../interrogate-command.js'
import type { Branding } from '../branding.js'
import type { SourceStore } from '../source-store.js'
import type { ResolvedWorkspace } from '../workspace-resolution.js'
import { SHIPPED_CATALOGUE_SOURCE } from '../shipped-catalogue.generated.js'

/**
 * What every tool takes, and nothing else (ADR 0156).
 *
 * No path is ever passed: the store answers every read and takes every
 * write (ADR 0100), and the manifest arrives already resolved
 * (`resolveWorkspaceFrom` does that over a file list, no filesystem). The
 * paths inside `workspace` are store paths, the strings `store.read`
 * answers to: relative to the store's root, `/`-separated. A store rooted at
 * the repository root holds them as `.yarramate/architecture/...` with
 * `manifestDirectory: '.yarramate'`, which is how the CLI runs; a store
 * rooted at the `.yarramate` directory holds `architecture/...` with
 * `manifestDirectory: ''`. Both work; a record's own cross-references
 * (contracts, evidence URIs) are written relative to the repository root,
 * so a record that will ever be exported as a folder should use the first.
 */
export interface ToolWorkspace {
  /** list / read / writeAll. Synchronous, per ADR 0100. */
  readonly store: SourceStore
  /** The manifest, resolved. */
  readonly workspace: ResolvedWorkspace
  /**
   * Where the manifest sits relative to the store root, `/`-separated, no
   * trailing slash; `''` when the manifest is at the root. Lets an operation
   * address a document the way the manifest names it as well as the way the
   * workspace lists it (#216). Default `''`.
   */
  readonly manifestDirectory?: string
  /**
   * REPLACES the shipped base catalogue (`core-enrichment`), as `--catalogue`
   * does on the CLI. The catalogues the workspace itself lists under
   * `questions:` are read from the store and ADDED on top, always
   * (ADR 0129). Absent: the shipped catalogue, bundled as text.
   */
  readonly catalogue?: WorkspaceSource
  /**
   * Stamped into exports that carry a version (the workbook's provenance).
   * Default: the package's own version.
   */
  readonly yarramateVersion?: string
  /**
   * The host's branding (#546, ADR 0158): the workbook's cover sheet and the
   * LikeC4 banner name the product. Absent: the unbranded exports.
   */
  readonly branding?: Branding
}

/**
 * One shape for every tool that can fail. `diagnostics` is the engine
 * refusing with locations (a workspace that does not compile, an operations
 * batch with an invalid operation, a store conflict); `refused` is the tool
 * refusing an argument in one sentence (an unknown subject id, a projection
 * the store does not hold, a query that matches nothing). The CLI's exit 1
 * and exit 2, respectively. `checkWorkspace` alone does not use this: a
 * failing check is its normal answer, not a failure.
 */
export type ToolResult<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly reason: 'diagnostics'
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly message: string }

export type ToolFailure = Exclude<ToolResult<never>, { readonly ok: true }>

export const failed = (diagnostics: readonly Diagnostic[]): ToolFailure => ({
  ok: false,
  reason: 'diagnostics',
  diagnostics,
})

export const refused = (message: string): ToolFailure => ({
  ok: false,
  reason: 'refused',
  message,
})

/** The shipped base catalogue as a source. `path` is a label, not a file. */
export const SHIPPED_CATALOGUE: WorkspaceSource = {
  path: 'core-enrichment.yaml',
  source: SHIPPED_CATALOGUE_SOURCE,
}

/**
 * A store path the workspace lists but the store does not hold. Thrown by
 * the readers below and turned into a `refused` by the tool boundary
 * (`guarded`), the way the CLI turns a missing file into exit 2.
 */
export class MissingSourceError extends Error {
  constructor(readonly path: string) {
    super(`The workspace names "${path}" but the store does not hold it`)
    this.name = 'MissingSourceError'
  }
}

export const readSource = (
  { store }: ToolWorkspace,
  path: string,
): WorkspaceSource => {
  const held = store.read(path)
  if (held === undefined) throw new MissingSourceError(path)
  return { path, source: held.source }
}

/** Every source the compiler is handed: profiles, patterns, documents, in that order. */
export const compilerSourcesOf = (
  workspace: ToolWorkspace,
): readonly WorkspaceSource[] =>
  [
    ...workspace.workspace.profiles,
    ...workspace.workspace.patterns,
    ...workspace.workspace.documents,
  ].map((path) => readSource(workspace, path))

export type Compiled = Extract<ContextualCompilationResult, { readonly ok: true }>

export const compileOf = (
  workspace: ToolWorkspace,
): { readonly ok: true; readonly compiled: Compiled } | ToolFailure => {
  const compilation = compileWorkspaceWithProfileContext(
    compilerSourcesOf(workspace),
  )
  return compilation.ok
    ? { ok: true, compiled: compilation }
    : failed(compilation.diagnostics)
}

/**
 * The catalogues a verb composes: the base, then whatever the workspace
 * carries (#345, ADR 0129). One place, so every verb that interviews makes
 * the same choice.
 */
export const catalogueSourcesOf = (
  workspace: ToolWorkspace,
): readonly WorkspaceSource[] => [
  workspace.catalogue ?? SHIPPED_CATALOGUE,
  ...(workspace.workspace.questions ?? []).map((path) =>
    readSource(workspace, path),
  ),
]

export const composedCatalogueOf = (
  workspace: ToolWorkspace,
  compiled: Compiled,
): CatalogueCompositionResult =>
  composeCatalogues(catalogueSourcesOf(workspace), compiled.profileContext)

export const evidenceDocumentsOf = (
  workspace: ToolWorkspace,
):
  | { readonly ok: true; readonly documents: readonly EvidenceDocument[] }
  | ToolFailure => {
  const documents: EvidenceDocument[] = []
  for (const path of workspace.workspace.evidence) {
    const loaded = loadEvidence(readSource(workspace, path))
    if (!loaded.ok) return failed(loaded.diagnostics)
    documents.push(loaded.evidence)
  }
  return { ok: true, documents }
}

/**
 * The tool boundary: a missing source becomes a `refused` rather than an
 * exception, and nothing else is caught, so a real defect still surfaces.
 */
export const guarded = <T>(run: () => ToolResult<T>): ToolResult<T> => {
  try {
    return run()
  } catch (error) {
    if (error instanceof MissingSourceError) return refused(error.message)
    throw error
  }
}
