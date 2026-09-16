/**
 * PROPOSED public surface for `yarramate/tools`, `yarramate/host` and the
 * `createSocketHost` export of `yarramate/visual-app`.
 *
 * Status: DESIGN, 2026-09-15 (amended the same day after ym-website's build feedback:
 * generic ToolDefinition, STDIO_PROPERTIES, files outcome, actor note), written by the yarramate maintainer session for
 * the yarramate.dev hosted-workspaces build (website brief, section 15).
 * Nothing here is built or published yet; building it is Nabeel's call. The
 * shapes are chosen so that every function below is a straight extraction of
 * code that already runs today in `design-command.ts`, `ask-command.ts`,
 * `check-command.ts`, `apply-command.ts`, `export-command.ts` and
 * `likec4-cli.ts`, behind their `readFileSync` calls. Anything that would need
 * new engine behaviour is marked NEW.
 *
 * Reading order for a consumer: ToolWorkspace, ToolResult, the thirteen
 * functions, resolveWorkspaceFrom, then TOOL_CATALOGUE and runTool.
 *
 * Every type imported below is already exported from `yarramate` (the `.`
 * entry) or `yarramate/interrogation` at 1.30.1 unless marked "exported
 * here for the first time".
 */

import type {
  Diagnostic,
  ProjectionResult,
  ResolvedProfileContext,
  ResolvedWorkspace,
  SemanticGraph,
  SourceStore,
  WorkspaceManifestResult,
  WorkspaceSource,
} from 'yarramate'
import type {
  CatalogueCondition,
  InterrogationReport,
} from 'yarramate/interrogation'
import type { RequirementsTraceabilityMatrix, StateComparison } from 'yarramate'
import type { EditorHost, EditorHostEvents } from 'yarramate/visual-app'

// ---------------------------------------------------------------------------
// 1. The workspace every tool takes
// ---------------------------------------------------------------------------

/**
 * What a tool needs to run, and nothing else. No path is ever passed: the
 * store answers every read and takes every write (ADR 0100), and the manifest
 * arrives already resolved (`resolveWorkspaceFrom` below does that over a
 * file list, no filesystem).
 *
 * The paths inside `workspace` are store paths: the strings `store.read`
 * answers to. They are relative to the store's root, `/`-separated. A store
 * rooted at the repository root holds them as `.yarramate/architecture/...`
 * with `manifestDirectory: '.yarramate'`; a store rooted at the `.yarramate`
 * directory (the site's free editor today) holds `architecture/...` with
 * `manifestDirectory: ''`. Both work; the record's own cross-references
 * (contracts, evidence URIs) are written relative to the repository root, so
 * a hosted record that will ever be exported as a folder should use the
 * first layout.
 */
export interface ToolWorkspace {
  /** list / read / writeAll. Synchronous, per ADR 0100. */
  readonly store: SourceStore
  /** The manifest, resolved. `resolveWorkspaceFrom` produces one from a file list. */
  readonly workspace: ResolvedWorkspace
  /**
   * Where the manifest sits relative to the store root, `/`-separated, no
   * trailing slash; `''` when the manifest is at the root. What
   * `posixDirectoryOf(manifestPath)` returns. Lets an operation address a
   * document the way the manifest names it as well as the way the workspace
   * lists it (#216). Default `''`.
   */
  readonly manifestDirectory?: string
  /**
   * REPLACES the shipped base catalogue (`core-enrichment`), as `--catalogue`
   * does on the CLI. The catalogues the workspace itself lists under
   * `questions:` are read from the store and ADDED on top, always (ADR 0129).
   * Absent: the shipped catalogue, bundled into the entry as text so no
   * filesystem is needed (NEW: a generated module replaces the `?raw` import
   * the browser build uses today; same bytes).
   */
  readonly catalogue?: WorkspaceSource
  /**
   * Stamped into exports that carry a version (the workbook's provenance).
   * Default: the package's own version.
   */
  readonly yarramateVersion?: string
}

// ---------------------------------------------------------------------------
// 2. How a tool answers
// ---------------------------------------------------------------------------

/**
 * One shape for every tool that can fail. `diagnostics` is the engine
 * refusing with locations (a manifest that does not resolve, a workspace that
 * does not compile, an operations batch with an invalid operation, a store
 * conflict); `refused` is the tool refusing an argument in one sentence (an
 * unknown subject id, a projection path the store does not hold, a free-text
 * query that matches nothing). The CLI's exit 1 and exit 2, respectively.
 *
 * `checkWorkspace` is the one function that does not use this: a failing
 * check is its normal answer, not a failure.
 */
export type ToolResult<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly reason: 'diagnostics'
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly message: string }

// ---------------------------------------------------------------------------
// 3. The thirteen functions (SPEC section 13 item 1, brief section 15 item 1)
// ---------------------------------------------------------------------------

// ---- design ----------------------------------------------------------------

/** Exported here for the first time; today a private interface in design-command.ts. */
export interface DesignStep {
  readonly questionId: string
  readonly wave: string
  readonly scope: 'workspace' | 'subject'
  readonly authority: 'human' | 'agent' | 'either'
  readonly question: string
  readonly askPlain?: string
  readonly materiality: string
  readonly resolution: string
  /** The catalogue trigger, verbatim: the question's answer shape (#289). */
  readonly trigger: readonly CatalogueCondition[]
  readonly subject?: { readonly id: string; readonly name?: string }
  readonly remainingSubjects?: number
  readonly openSubjects?: readonly string[]
  readonly since?: string
}

/** The published `yarramate/design-step/v1` document, exactly as `design --json` prints it. */
export interface DesignStepResult {
  readonly format: 'yarramate/design-step/v1'
  readonly workspace: string
  readonly catalogue: string
  readonly progress: {
    readonly questions: number
    readonly openQuestions: number
    readonly open: number
    readonly waves: readonly { readonly id: string; readonly open: number }[]
  }
  readonly step: DesignStep | null
  /** The subject's neighbourhood as a brief, when the step has a subject. */
  readonly slice?: string
}

export interface DesignStepOptions {
  /** A globally qualified subject id; narrows the interview to it. `refused` if unknown. */
  readonly subject?: string
  /** Prefer the plain phrasing in `step.askPlain` when the catalogue has one. */
  readonly facilitate?: boolean
}

/** `yarramate design <ws> [--subject] --json`, path-free. */
export declare function designStep(
  workspace: ToolWorkspace,
  options?: DesignStepOptions,
): ToolResult<DesignStepResult>

// ---- ask -------------------------------------------------------------------

/** Exported here for the first time; today private in ask-command.ts. */
export interface ConceptEntry {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly status?: string
  readonly description?: string
  readonly aka?: readonly string[]
}

/** Exported here for the first time; today in next-command.ts, not on the barrel. */
export interface NextSubject {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly dependsOn: readonly string[]
  readonly requiredBy: readonly string[]
  readonly evidence: EvidenceCoverage
  readonly cycle?: true
}
/** Exported here for the first time; today private in next-command.ts. */
export interface EvidenceCoverage {
  readonly observations: number
  readonly confirmed: number
  readonly contradicted: number
  readonly unknown: number
  readonly notObserved: number
}

/**
 * The `yarramate/ask-result/v1` document, one member per mode, exactly as
 * `ask --json` prints it. Only the modes the tools serve are listed; the
 * CLI's `--advise`, `--where`, `--compare` and `--changed` are not tools
 * (`--changed` needs git; the others stay CLI-only until asked for).
 */
export interface AskResultBase {
  readonly format: 'yarramate/ask-result/v1'
  readonly workspace: string
}

export type AskOrientation = AskResultBase & {
  readonly mode: 'orientation'
  readonly ok: boolean
  readonly check: {
    readonly ok: boolean
    readonly diagnostics: readonly Diagnostic[]
    readonly counted?: CheckCounts
  }
  readonly reconciliation?: ReconciliationSummary
  readonly design?: { readonly catalogue: string; readonly open: number }
  readonly backlog: {
    readonly planned: readonly NextSubject[]
    readonly current: readonly ConceptEntry[]
    readonly retired: readonly ConceptEntry[]
  }
}

export type AskSlice = AskResultBase & {
  readonly mode: 'slice'
  readonly addressing: 'free-text' | 'subjects' | 'projection'
  readonly topic?: string
  readonly seeds?: readonly string[]
  readonly matched?: number
  readonly neighbourhood?: NeighbourhoodOmission
  readonly result: ProjectionResult
  /**
   * NEW FIELD, additive: the text the CLI prints for the same call (the brief
   * without a budget, the budgeted context with one). A hosted tool returns
   * text to an agent and should not re-render on its side of the seam. The
   * schema gains one optional string; `additionalProperties` stays honest.
   */
  readonly rendered: string
}

export type AskRoster = AskResultBase & {
  readonly mode: 'roster'
  readonly total: number
  readonly subjects: readonly ConceptEntry[]
}

export type AskKinds = AskResultBase & {
  readonly mode: 'kinds'
  readonly conceptKinds: readonly ConceptKindSummary[]
  readonly relationshipKinds: readonly RelationshipKindSummary[]
  readonly relationshipMatrix: RelationshipMatrixSummary
  readonly extensions: readonly {
    readonly id: string
    readonly type: 'concept' | 'relationship'
    readonly lineage: readonly string[]
  }[]
}

export type AskNext = AskResultBase & {
  readonly mode: 'next'
  readonly subjects: readonly NextSubject[]
}

export type AskOpen = AskResultBase & {
  readonly mode: 'open'
  readonly report: InterrogationReport
}

/** The shapes ask already prints; exported here for the first time. */
export interface NeighbourhoodOmission {
  readonly cap: number
  readonly kept: number
  readonly omitted: number
  readonly omittedBySeed: readonly { readonly seed: string; readonly omitted: number }[]
}
/**
 * `ConceptKind` from profile.ts (id, name, layer, aspect, rigidity?, ...),
 * exported here for the first time; the barrel does not carry it today.
 */
export interface ConceptKindSummary {
  readonly id: string
  readonly name: string
  readonly layer: string
  readonly aspect: string
  readonly rigidity?: string
}
export interface RelationshipKindSummary {
  readonly id: string
  readonly intent: string
  readonly sourceAspects: readonly string[]
  readonly targetAspects: readonly string[]
}
export interface RelationshipMatrixSummary {
  readonly standard: string
  readonly letters: Readonly<Record<string, string>>
  readonly kinds: readonly string[]
  readonly rows: Readonly<Record<string, string>>
}
export interface CheckCounts {
  readonly documents: number
  readonly concepts: number
  readonly relationships: number
  readonly states: number
}
/** `ReconciliationReport['summary']`, already exported from `yarramate`. */
export type ReconciliationSummary = import('yarramate').ReconciliationReport['summary']

/** `yarramate ask <ws> --json` with no query: check verdict, drift summary, open count, backlog. */
export declare function askOrientation(
  workspace: ToolWorkspace,
): ToolResult<AskOrientation>

/**
 * What a slice is asked about. Free text matches ids, names and descriptions;
 * subject ids address precisely; a projection path names a saved view in the
 * store. The CLI decides between the three by looking at the filesystem
 * (`existsSync`) and the id syntax; a tool says which it means.
 */
export type SliceQuery =
  | { readonly text: string }
  | { readonly subjects: readonly string[] }
  | { readonly projection: string }

export interface SliceOptions {
  /** Approximate token budget; renders the budgeted context instead of the brief. */
  readonly budget?: number
  /** Neighbour cap for seeded slices (text and subjects); `refused` with a projection. */
  readonly neighbours?: number
}

/** `yarramate ask <ws> "<text>" | <id>... | <projection.yaml> [--budget] [--neighbours]`. */
export declare function askSlice(
  workspace: ToolWorkspace,
  query: SliceQuery,
  options?: SliceOptions,
): ToolResult<AskSlice>

export interface RosterOptions {
  /** Substring match on the kind id, as `--kind`. */
  readonly kind?: string
  readonly status?: 'planned' | 'current' | 'retired'
}

/** `yarramate ask <ws> --subjects [--kind] [--status] --json`. */
export declare function askRoster(
  workspace: ToolWorkspace,
  options?: RosterOptions,
): ToolResult<AskRoster>

/** `yarramate ask <ws> --kinds --json`. */
export declare function askKinds(
  workspace: ToolWorkspace,
): ToolResult<AskKinds>

/** `yarramate ask <ws> --next --json`. */
export declare function askNext(workspace: ToolWorkspace): ToolResult<AskNext>

/** `yarramate ask <ws> --open --json`. */
export declare function askOpen(workspace: ToolWorkspace): ToolResult<AskOpen>

// ---- check -----------------------------------------------------------------

/** The published `yarramate/check-result/v1` document, as `check --json` prints it. */
export interface CheckResult {
  readonly format: 'yarramate/check-result/v1'
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly counted?: CheckCounts
  readonly strict?: { readonly observations: number; readonly contradicted: number }
}

export interface CheckOptions {
  /** Contradicted evidence fails the check (YM901), as `--strict`. */
  readonly strict?: boolean
}

/**
 * `yarramate check <workspace.yaml> [--strict] --json`, path-free. Never a
 * ToolResult: `ok: false` with diagnostics IS the answer.
 *
 * Contracts (`contracts:` in the manifest) name files by repository-root
 * path, a package manifest among them. They are read through the store like
 * everything else; a file the store does not hold is treated as absent, which
 * is what the CLI does for a missing schema file today and what a hosted
 * record with no contracts needs.
 */
export declare function checkWorkspace(
  workspace: ToolWorkspace,
  options?: CheckOptions,
): CheckResult

// ---- apply -----------------------------------------------------------------

/**
 * The `yarramate/apply-result/v1` document. `YarramateApplyResult` lives in
 * operations.ts and is not on the barrel; it is reachable today through
 * `ApplyOutcome`, and `yarramate/tools` exports it by name.
 */
export type ApplyResult = Extract<import('yarramate').ApplyOutcome, { ok: true }>['result']

/**
 * One `yarramate/operations/v1` document: YAML or JSON text, or the object
 * (serialised for you; JSON is YAML to the loader). Diagnostics point into it
 * as `/operations/<i>/<field>` and name `path`, so give it one; default
 * `operations.yaml`.
 */
export type OperationsInput =
  | string
  | { readonly path?: string; readonly source: string }
  | { readonly path?: string; readonly document: Record<string, unknown> }

/**
 * `yarramate apply <operations.yaml> <ws> --json`, path-free: plan over the
 * store, compile the candidate, write all or nothing under compare-and-swap
 * (ADR 0100, 0103). `landOperations` already does this; this is it with the
 * input shapes an MCP call carries. A refused `writeAll` comes back as
 * YM704/YM705 diagnostics, as the CLI reports it.
 */
export declare function applyBatch(
  workspace: ToolWorkspace,
  operations: OperationsInput,
): ToolResult<ApplyResult>
// No actor parameter, by design: the record's own `by` fields are whatever
// the person writes, and a history row is the SERVER's stamp (who, from
// which client), written by the host beside the store write. If an actor is
// ever taken here, its client name is `client`, matching the hosted grant
// props `{ accountId, workspaceId, role, client }`.

// ---- export ----------------------------------------------------------------
// Six kinds, matching `yarramate_export`'s enum exactly: markdown, rtm,
// graph, briefs, xlsx, likec4. (The brief's list said `exportBrief`; the CLI
// kind is `briefs`, one brief per subject of a view, and the design step's
// `slice` is the single-subject form. `exportBriefs` keeps the CLI's word.)

/** `yarramate export markdown <projection> <ws>`: the view rendered as prose. */
export declare function exportMarkdown(
  workspace: ToolWorkspace,
  projection: string,
): ToolResult<{ readonly markdown: string; readonly result: ProjectionResult }>

/** `yarramate export graph <ws>`: the compiled semantic graph as JSON text. */
export declare function exportGraph(
  workspace: ToolWorkspace,
): ToolResult<{ readonly json: string; readonly graph: SemanticGraph }>

/** `yarramate export briefs <projection> <ws> [--budget]`: one brief per subject, plus the index. */
export declare function exportBriefs(
  workspace: ToolWorkspace,
  projection: string,
  options?: { readonly budget?: number },
): ToolResult<{
  /** `INDEX.md` first, then one entry per concept, in the order the CLI writes them. */
  readonly files: readonly { readonly path: string; readonly markdown: string }[]
}>

/** `yarramate export rtm <ws>`: RTM.md and rtm.json, unwritten. */
export declare function exportRtm(
  workspace: ToolWorkspace,
): ToolResult<{
  readonly markdown: string
  readonly rtm: RequirementsTraceabilityMatrix
}>

/**
 * `yarramate export likec4 <likec4-project.yaml> <out> <ws>`: the generated
 * project as files, unwritten. `project` is the store path of the project
 * definition; the views, subject mapping and kind mapping it names resolve
 * relative to its directory, as the CLI resolves them. The files are what
 * `publishGeneratedProject` writes today: `likec4.config.json`, the model
 * `.c4`, the ownership marker. Git overlays (`--changed`) are not offered.
 */
export declare function exportLikeC4(
  workspace: ToolWorkspace,
  project: string,
): ToolResult<{ readonly files: readonly WorkspaceSource[] }>

/**
 * `yarramate export xlsx <projection> <ws>`: the workbook bytes. Provenance
 * digests are the store's revisions (opaque, equality-only, ADR 0100) rather
 * than a sha256 the CLI computes with node:crypto; the import side reads
 * them back without comparing (import-command.ts), so nothing observes the
 * difference.
 */
export declare function exportWorkbook(
  workspace: ToolWorkspace,
  projection: string,
): ToolResult<{ readonly bytes: Uint8Array; readonly filename: string }>

// ---------------------------------------------------------------------------
// 4. Resolving a manifest without a filesystem (the "also useful" question)
// ---------------------------------------------------------------------------

/**
 * NEW. `loadWorkspaceManifest` expands the manifest's globs with
 * `node:fs.globSync`, which is why it is the one engine step that needs a
 * filesystem. This is the same function over a listed set of paths: the
 * candidates are `store.list()` (that is what `list` exists for, per the
 * SourceStore contract), the patterns are matched with the same semantics
 * (`**`, `*`, `?`, `{a,b}`, `[...]`, `/`-separated, confined beneath the
 * manifest directory: YM701), a pattern matching nothing is YM702, and the
 * result is the same `WorkspaceManifestResult` with store paths in it.
 *
 * `manifest.path` is the manifest's store path; the patterns resolve beneath
 * `posixDirectoryOf(manifest.path)`. Call it at create time and after any
 * apply that adds a document, as the spec's section 9 says.
 */
export declare function resolveWorkspaceFrom(
  manifest: WorkspaceSource,
  paths: readonly string[],
): WorkspaceManifestResult

/** The shipped base catalogue as a source, bundled as text. `path` is a label. */
export declare const SHIPPED_CATALOGUE: WorkspaceSource

// ---------------------------------------------------------------------------
// 5. The shared tool table (brief section 15 item 3) and the path-free runner
// ---------------------------------------------------------------------------

export type ToolName =
  | 'yarramate_ask'
  | 'yarramate_design'
  | 'yarramate_apply'
  | 'yarramate_check'
  | 'yarramate_reconcile'
  | 'yarramate_export'

/**
 * One row per tool, read by both adapters. The stdio adapter publishes these
 * rows with its own `workspace` property spread into `inputSchema.properties`
 * and its own sentence about it appended to `description`; the hosted server
 * publishes them as they are. Names, schemas and descriptions are otherwise
 * byte-identical at both layers, which is the brief's ADR candidate.
 */
export interface ToolDefinition<N extends string = ToolName> {
  readonly name: N
  /** Ends with LOOP. No mention of `workspace`: that sentence is the stdio adapter's. */
  readonly description: string
  /** JSON Schema for the arguments, without `workspace`. */
  readonly inputSchema: Record<string, unknown>
  readonly access: 'read' | 'write'
  /**
   * Whether `runTool` can serve it. `reconcile` compares the record with
   * evidence it evaluates against a repository (git, files), so it is
   * `stdio-only`; `unavailable` is the one line a hosted tool list shows
   * for it, as the spec's section 7 asks.
   */
  readonly served: 'everywhere' | 'stdio-only'
  readonly unavailable?: string
}

/**
 * Typed over `ToolName`; a host that adds tools of its own (the hosted
 * `yarramate_workspace`) builds `[...TOOL_CATALOGUE, own]` as
 * `readonly ToolDefinition<string>[]` with no cast. `runTool` serves only
 * `ToolName`; a host dispatches its own names itself.
 */
export declare const TOOL_CATALOGUE: readonly ToolDefinition<ToolName>[]

/**
 * The two argument properties that exist only where a filesystem does:
 * `workspace` (which manifest) and `out` (where export writes). The stdio
 * adapter spreads these into the rows it publishes; a hosted server never
 * sees them. Kept beside the catalogue so the two adapters agree on the
 * words.
 */
export declare const STDIO_PROPERTIES: Readonly<Record<'workspace' | 'out', Record<string, unknown>>>

/** The loop in two sentences, as it ends every description today. */
export declare const LOOP: string

/**
 * What a tool call returns to an agent. `text` is the answer for every tool
 * but the binary and multi-file exports (xlsx, likec4, briefs when a host
 * wants them as files): those answer `files`, and an MCP reply has nowhere
 * to put bytes, so the host stores them and answers with an address (a
 * download URL, an MCP resource); the stdio adapter writes them where `out`
 * says. `text` is still set on a files outcome: one line naming the files,
 * for a caller that can do nothing else with them.
 */
export type ToolOutcome =
  | {
      readonly kind: 'text'
      readonly ok: boolean
      /** The JSON document for ask, design, apply and check; the deliverable for export. */
      readonly text: string
      /** The typed result behind `text`, for a caller that wants it. */
      readonly result?: unknown
    }
  | {
      readonly kind: 'files'
      readonly ok: true
      readonly text: string
      readonly files: readonly ToolFile[]
    }

export interface ToolFile {
  /** Relative, `/`-separated, as the CLI would write it under `out`. */
  readonly path: string
  readonly contentType: string
  /** Exactly one of the two. */
  readonly text?: string
  readonly bytes?: Uint8Array
}

/**
 * The path-free executor both adapters can dispatch to: parses `input`
 * against the row's schema, calls the function above that the row names
 * (ask's `query`/`mode` become the six ask functions; export's `kind` the six
 * export functions), renders exactly the text the stdio adapter returns for
 * the same call today. `yarramate_reconcile` answers `ok: false` with the
 * row's `unavailable` line. `yarramate_export` kinds that are binary or
 * multi-file (xlsx, likec4) answer the `files` variant of `ToolOutcome` (with `result` beside it) and a one-line `text` naming them; the hosted server turns them into downloads, which is its own affair.
 */
export declare function runTool(
  name: ToolName,
  input: Record<string, unknown>,
  workspace: ToolWorkspace,
): ToolOutcome

// ---------------------------------------------------------------------------
// 6. `createSocketHost` from `yarramate/visual-app` (brief section 15 item 4)
// ---------------------------------------------------------------------------

/**
 * The published socket host, parameterised. Today it is hard-wired to the
 * session server's two same-origin routes; the hosted page needs the same
 * host over `/w/<slug>/socket` with the snapshot from `/w/<slug>/session`.
 * The protocol does not move: `VisualBrowserInput` out, `VisualServerFrame`
 * in, the opening snapshot reported as the `ready` frame, reconnects with
 * `?after=<lastSequence>` read from the reducer at connect time.
 *
 * Defaults are the published behaviour exactly, so `createSocketHost()` with
 * no argument is byte-for-byte what `yarramate-visual` mounts.
 */
export interface SocketHostOptions {
  /**
   * Where the opening `VisualSessionSnapshot` is fetched (GET, same-origin
   * credentials, `Accept: application/json`). Default `/api/session`,
   * resolved against the page.
   */
  readonly session?: string | URL
  /**
   * Where the socket connects. A string or URL is resolved against the page
   * and its scheme flipped to ws/wss; `after` is appended as a query
   * parameter. A function receives `after` and returns the URL itself, for a
   * server that wants it on the path. Default `/socket`.
   */
  readonly socket?: string | URL | ((after: number) => string | URL)
  /** Delay before a reconnect attempt. Default 1000 ms. */
  readonly retryMs?: number
  /**
   * How long a lost socket keeps retrying before the host reports a
   * `closing` frame with reason `browser-timeout`. Default: the reducer's
   * published grace (`canReconnect`). A hosted workspace that never hands
   * off may pass `Infinity`.
   */
  readonly reconnectWindowMs?: number
}

export declare function createSocketHost(options?: SocketHostOptions): EditorHost

// ---------------------------------------------------------------------------
// 7. `yarramate/host` (ym-website's ask B): the local host without React
// ---------------------------------------------------------------------------

/**
 * NEW ENTRY. `createLocalHost` and the `EditorHost` seam, built by `tsc` into
 * `dist/host.js` like every other engine entry, with no React, cytoscape or
 * stylesheet behind it. Today `local-host.ts` already imports nothing from
 * the UI: its only bundler-shaped dependency is the `?raw` catalogue import,
 * which the generated catalogue module (section 4) replaces. The files move
 * from `src/visual-app/` to `src/host/`; `yarramate/visual-app` re-exports
 * them, so nothing a host imports today changes.
 *
 * The same purity test that guards `yarramate/interrogation` guards this
 * entry, with the compiler ALLOWED at runtime: compiling is the point, and
 * the compiler runs in a Durable Object already (the spike, 2026-09-15).
 *
 * Frames carry no sequence numbers from the local host (its `ready` snapshot
 * says `lastSequence: 0`). The object stamps them on fan-out and answers
 * `after` from its own replay buffer; the host does not need to know.
 */
export type {
  LocalEditorHost,
  LocalHostOptions,
  RefreshOutcome,
} from 'yarramate/visual-app'
export type { EditorHost, EditorHostEvents }
export declare function createLocalHost(
  options: import('yarramate/visual-app').LocalHostOptions,
): import('yarramate/visual-app').LocalEditorHost

// ---------------------------------------------------------------------------
// 8. What stays as it is, for the record
// ---------------------------------------------------------------------------
//
// - `workspace` optional on every stdio tool: shipped in 1.26.0 (#514, ADR
//   0149). Brief section 15 item 2 needs nothing.
// - `LocalEditorHost.refresh` is public and stays so; after an out-of-band
//   write (an MCP apply) the object calls `refresh({})` and every attached
//   socket gets a `model` frame, as the spike measured.
// - `mountEditorWith(element, host, sections, readOnly, ...)` is how the
//   hosted page mounts over the socket host; unchanged.
// - The engine's types referenced above (`ProjectionResult`,
//   `InterrogationReport`, `RequirementsTraceabilityMatrix`,
//   `YarramateApplyResult`, `NextSubject`, `Diagnostic`) are the published
//   ones; no new shapes except the three marked NEW FIELD / exported here
//   for the first time.
//
// Build shape, for the maintainer: `src/tools/*.ts` holds the extracted
// cores; `src/tools-entry.ts` is the barrel; the five CLI commands call the
// same cores over `createFileSystemStore`, so the CLI, the stdio adapter and
// the hosted server have one semantics by construction (ADR candidate: the
// brief's third). Whether the stdio adapter dispatches to `runTool` in
// process or keeps running the CLI (ADR 0044/0149 as written) is Nabeel's
// call; the table and the signatures are the same either way.

// Silence unused-type warnings in editors that lint this file as source.
export type _Unused = ResolvedProfileContext | StateComparison
