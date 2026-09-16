import type { Diagnostic, WorkspaceSource } from '../compiler.js'
import { isLikeC4ProjectDefinition } from '../adapters/likec4-project-export.js'
import { parseDocument } from 'yaml'
import { applyBatch, type OperationsInput } from './apply.js'
import {
  askKinds,
  askNext,
  askOpen,
  askOrientation,
  askRoster,
  askSlice,
  type AskSlice,
} from './ask.js'
import { checkWorkspace } from './check.js'
import { designStep } from './design.js'
import {
  exportBriefs,
  exportGraph,
  exportLikeC4,
  exportMarkdown,
  exportRtm,
  exportWorkbook,
} from './export.js'
import type { ToolResult, ToolWorkspace } from './workspace.js'

/**
 * The tool surface, once (ADR 0156). The stdio adapter and a hosted server
 * publish these rows; `runTool` answers a call over a store, and both
 * dispatch to it, so an agent connected over stdio and one connected over
 * the network read the same names, the same schemas, the same sentences,
 * and get the same text back.
 */

export type ToolName =
  | 'yarramate_ask'
  | 'yarramate_design'
  | 'yarramate_apply'
  | 'yarramate_check'
  | 'yarramate_reconcile'
  | 'yarramate_export'

/**
 * One row per tool. Generic over the name so a host that adds tools of its
 * own builds `[...TOOL_CATALOGUE, own]` as `ToolDefinition<string>[]` with
 * no cast; `runTool` serves `ToolName` only.
 */
export interface ToolDefinition<N extends string = ToolName> {
  readonly name: N
  /** Ends with LOOP. Says nothing about `workspace` or `out`: those sentences are the stdio adapter's. */
  readonly description: string
  /** JSON Schema for the arguments, without the stdio-only properties. */
  readonly inputSchema: Record<string, unknown>
  readonly access: 'read' | 'write'
  /**
   * Whether `runTool` can serve it. `reconcile` compares the record with
   * evidence it evaluates against a repository, so it is `stdio-only`;
   * `unavailable` is the one line a hosted tool list shows for it.
   */
  readonly served: 'everywhere' | 'stdio-only'
  readonly unavailable?: string
}

/**
 * The loop, in two sentences, on every tool. A desktop-app agent connecting
 * for the first time has never seen the skill file; the tool list is the
 * only place it learns that design asks, apply lands, and design asks again.
 */
export const LOOP =
  'The loop: call yarramate_design for the top open question, answer it with the person, land the answer with yarramate_apply, then call yarramate_design again.'

/**
 * The two argument properties that exist only where a filesystem does:
 * `workspace` (which manifest) and `out` (where export writes). The stdio
 * adapter spreads these into the rows it publishes; a hosted server never
 * sees them. Kept beside the catalogue so the two adapters agree on the
 * words.
 */
export const STDIO_PROPERTIES: Readonly<
  Record<'workspace' | 'out', Record<string, unknown>>
> = {
  workspace: {
    type: 'string',
    description:
      "Path to the workspace manifest, for example .yarramate/workspace.yaml. Optional: defaults to the server's --workspace, then to .yarramate/workspace.yaml under the working directory. Desktop apps start the server outside the repository, so give the full path there.",
  },
  out: {
    type: 'string',
    description:
      'Where to write, relative to the repository root (the directory that holds .yarramate) unless absolute: a file for markdown, graph and xlsx; a directory for rtm, briefs and likec4. Optional for the text kinds, which then return the text instead.',
  },
}

export const TOOL_CATALOGUE: readonly ToolDefinition<ToolName>[] = [
  {
    name: 'yarramate_ask',
    description: `The consumed-now read surface. Without a query: orientation — check verdict, drift summary, open-question count, and the backlog in dependency order. With a query: free text matches concept ids, names, and descriptions and returns the connected slice; exact subject ids (document-id#local-id) and projection paths address precisely. Set mode for the roster (subjects), declarable vocabulary (kinds), build order (next), or the full open-questions report (open). ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free text, a globally qualified subject id, or a projection path',
        },
        mode: {
          type: 'string',
          enum: ['subjects', 'kinds', 'next', 'open'],
          description:
            'Optional flag mode instead of a query: the filterable roster, the declarable kind vocabulary, dependency-ordered planned work, or the open-questions report',
        },
        budget: {
          type: 'integer',
          minimum: 1,
          description:
            'Approximate token budget for the compact slice rendering (query form only)',
        },
      },
    },
    access: 'read',
    served: 'everywhere',
  },
  {
    name: 'yarramate_design',
    description: `The design interview, one stateless step: the top open question with its subject slice, materiality, progress, and the operations skeleton that would answer it. Ask the person, land their answer with yarramate_apply, then call this again; the next question is computed from the record, never remembered. A question whose authority is human is for the person to decide, not the agent. ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description:
            'Optional globally qualified subject id to narrow the interview',
        },
      },
    },
    access: 'read',
    served: 'everywhere',
  },
  {
    name: 'yarramate_apply',
    description: `Lands answers in the record: one yarramate/operations/v1 document, applied as an atomic batch by the same engine a person's CLI runs. Any invalid operation refuses the whole batch and nothing is written; the result names each diagnostic with its source location. Writes are spliced into the native documents, never re-serialized, so the diff is exactly the answer. ${LOOP}`,
    inputSchema: {
      type: 'object',
      required: ['operations'],
      properties: {
        operations: {
          description:
            'The operations document: `format: yarramate/operations/v1` with an `operations` list. Each operation names its `op` and its `document` (the native document path, for example .yarramate/architecture/main.yaml) and nests the record under the key its op names: add-concept carries `concept: { id, kind, name, description?, status?, ... }`, add-relationship carries `relationship: { id, kind, from, to, description? }`, update-concept and update-relationship carry the same key with only the fields that change, delete-* and rename-* carry the id (and `to` for a rename). Shape, as JSON: {"format":"yarramate/operations/v1","operations":[{"op":"add-concept","document":".yarramate/architecture/main.yaml","concept":{"id":"ops-portal","kind":"applicationComponent","name":"Operations portal"}}]}. YAML or JSON text, or the equivalent JSON object.',
          oneOf: [{ type: 'string' }, { type: 'object' }],
        },
      },
    },
    access: 'write',
    served: 'everywhere',
  },
  {
    name: 'yarramate_check',
    description: `Deterministic correctness check of a workspace; returns the machine-readable check result. Never a quality or completeness judgement. Run it after every apply. ${LOOP}`,
    inputSchema: { type: 'object', properties: {} },
    access: 'read',
    served: 'everywhere',
  },
  {
    name: 'yarramate_reconcile',
    description: `Compare declared architecture with evaluated evidence; returns the reconciliation report with contradicted, unknown, and not-observed findings. ${LOOP}`,
    inputSchema: { type: 'object', properties: {} },
    access: 'read',
    served: 'stdio-only',
    unavailable:
      'yarramate_reconcile is not served here: reconciliation evaluates evidence against a repository on disk, which this workspace does not have. Run yarramate reconcile beside the code.',
  },
  {
    name: 'yarramate_export',
    description: `Derives a deliverable from the record and returns it as text: markdown (a projection rendered as prose; needs projection), rtm (the requirements traceability matrix), graph (the compiled semantic graph as JSON), briefs (one brief per subject of a projection; needs projection). xlsx (needs projection) and likec4 (needs project) produce binary or multi-file output, which comes back as files for the caller to store. ${LOOP}`,
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: {
          type: 'string',
          enum: ['markdown', 'rtm', 'graph', 'briefs', 'xlsx', 'likec4'],
        },
        projection: {
          type: 'string',
          description:
            'Projection path, relative to the repository root unless absolute; required for markdown, briefs and xlsx',
        },
        project: {
          type: 'string',
          description: 'The likec4-project.yaml, required for likec4',
        },
        budget: {
          type: 'integer',
          minimum: 1,
          description: 'Approximate token budget per brief (briefs only)',
        },
      },
    },
    access: 'read',
    served: 'everywhere',
  },
]

export interface ToolFile {
  /** Relative, `/`-separated, as the CLI would write it under `out`. */
  readonly path: string
  readonly contentType: string
  /** Exactly one of the two. */
  readonly text?: string
  readonly bytes?: Uint8Array
}

/**
 * What a tool call returns to an agent. `text` is the answer for every tool
 * but the binary and multi-file exports (xlsx, likec4): those answer
 * `files`, and an MCP reply has nowhere to put bytes, so the host stores
 * them and answers with an address; the stdio adapter writes them where
 * `out` says. `text` is still set on a files outcome: one line naming the
 * files, for a caller that can do nothing else with them.
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
      readonly result?: unknown
    }

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const diagnosticJson = (diagnostics: readonly Diagnostic[]): string =>
  json({ format: 'yarramate/diagnostic-result/v1', diagnostics })

const refuse = (message: string): ToolOutcome => ({
  kind: 'text',
  ok: false,
  text: `${message}\n`,
})

/** A `ToolResult` as the text an agent reads: the document, or the refusal. */
const answer = <T>(
  result: ToolResult<T>,
  render: (value: T) => string = json,
): ToolOutcome => {
  if (!result.ok) {
    return result.reason === 'diagnostics'
      ? { kind: 'text', ok: false, text: diagnosticJson(result.diagnostics) }
      : refuse(result.message)
  }
  return { kind: 'text', ok: true, text: render(result.result), result: result.result }
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

/** The CLI's human rendering of a budgeted slice, which is what a budget asks for. */
const budgetedSliceText = (slice: AskSlice): string => {
  const rendered = slice.rendered ?? ''
  const header =
    slice.addressing === 'free-text' &&
    slice.topic !== undefined &&
    slice.seeds !== undefined &&
    slice.matched !== undefined
      ? `Slice for "${slice.topic}" — ${plural(slice.matched, 'concept')} matched` +
        (slice.matched > slice.seeds.length
          ? `, seeded from the top ${slice.seeds.length}`
          : '') +
        `: ${slice.seeds.join(', ')}\n\n`
      : ''
  const neighbourhood = slice.neighbourhood
  return neighbourhood === undefined
    ? `${header}${rendered}`
    : `${header}${rendered.trimEnd()}\n\n[neighbours ${neighbourhood.cap}: ${neighbourhood.omitted} of ${neighbourhood.kept + neighbourhood.omitted} neighbours omitted — raise --neighbours or pass --neighbours 0 for the full neighbourhood]\n`
}

const asProjectionPath = (
  workspace: ToolWorkspace,
  query: string,
): boolean => {
  const held = workspace.store.read(query)
  if (held === undefined) return false
  try {
    return parseDocument(held.source).get('format') === 'yarramate/projection/v1'
  } catch {
    return false
  }
}

const isOperationsInput = (value: unknown): value is OperationsInput =>
  typeof value === 'string' ||
  (typeof value === 'object' && value !== null)

/**
 * A tool call over a store: parses `input` against the row's schema, calls
 * the function the row names, renders exactly the text the stdio adapter
 * returns for the same call. `yarramate_reconcile` answers `ok: false`
 * with the row's `unavailable` line.
 */
export const runTool = (
  name: ToolName,
  input: Record<string, unknown>,
  workspace: ToolWorkspace,
): ToolOutcome => {
  switch (name) {
    case 'yarramate_ask': {
      if (typeof input.mode === 'string') {
        switch (input.mode) {
          case 'subjects':
            return answer(askRoster(workspace))
          case 'kinds':
            return answer(askKinds(workspace))
          case 'next':
            return answer(askNext(workspace))
          case 'open':
            return answer(askOpen(workspace))
          default:
            return refuse(
              `yarramate_ask mode must be one of subjects, kinds, next, open; got "${input.mode}".`,
            )
        }
      }
      if (typeof input.query === 'string' && input.query.length > 0) {
        const budget = typeof input.budget === 'number' ? input.budget : undefined
        const query = asProjectionPath(workspace, input.query)
          ? { projection: input.query }
          : { text: input.query }
        const sliced = askSlice(
          workspace,
          query,
          budget === undefined ? {} : { budget },
        )
        // A budget asks for the compact rendering, as `--budget` does on the
        // CLI; without one the document comes back, as `--json` does.
        return budget === undefined
          ? answer(sliced)
          : answer(sliced, budgetedSliceText)
      }
      return answer(askOrientation(workspace))
    }
    case 'yarramate_design':
      return answer(
        designStep(
          workspace,
          typeof input.subject === 'string' ? { subject: input.subject } : {},
        ),
      )
    case 'yarramate_apply': {
      if (!isOperationsInput(input.operations)) {
        return refuse(
          'yarramate_apply needs `operations`: a yarramate/operations/v1 document as YAML or JSON text, or as an object.',
        )
      }
      const operations: OperationsInput =
        typeof input.operations === 'string'
          ? input.operations
          : { document: input.operations as Record<string, unknown> }
      return answer(applyBatch(workspace, operations))
    }
    case 'yarramate_check': {
      const result = checkWorkspace(workspace)
      return { kind: 'text', ok: result.ok, text: json(result), result }
    }
    case 'yarramate_reconcile':
      return refuse(
        TOOL_CATALOGUE.find((tool) => tool.name === name)?.unavailable ??
          'yarramate_reconcile is not served here.',
      )
    case 'yarramate_export': {
      const kind = typeof input.kind === 'string' ? input.kind : ''
      const projection =
        typeof input.projection === 'string' ? input.projection : undefined
      if (kind === 'markdown') {
        if (projection === undefined) {
          return refuse(
            'yarramate_export markdown needs `projection`: the path of the view to render.',
          )
        }
        return answer(exportMarkdown(workspace, projection), ({ markdown }) => markdown)
      }
      if (kind === 'graph') {
        return answer(exportGraph(workspace), ({ json: text }) => text)
      }
      if (kind === 'rtm') {
        return answer(exportRtm(workspace), ({ markdown }) => markdown)
      }
      if (kind === 'briefs') {
        if (projection === undefined) {
          return refuse(
            'yarramate_export briefs needs `projection`: the path of the view whose subjects get a brief each.',
          )
        }
        const budget = typeof input.budget === 'number' ? input.budget : undefined
        return answer(
          exportBriefs(
            workspace,
            projection,
            budget === undefined ? {} : { budget },
          ),
          ({ files }) =>
            files
              .map(({ path, markdown }) => `<!-- ${path} -->\n${markdown}`)
              .join('\n'),
        )
      }
      if (kind === 'xlsx') {
        if (projection === undefined) {
          return refuse(
            'yarramate_export xlsx needs `projection`: the view to export as a workbook.',
          )
        }
        const exported = exportWorkbook(workspace, projection)
        if (!exported.ok) return answer(exported)
        const { bytes, filename } = exported.result
        return {
          kind: 'files',
          ok: true,
          text: `Workbook ${filename} (${bytes.byteLength} bytes)\n`,
          files: [
            {
              path: filename,
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              bytes,
            },
          ],
          result: exported.result,
        }
      }
      if (kind === 'likec4') {
        const project = typeof input.project === 'string' ? input.project : undefined
        if (project === undefined) {
          return refuse(
            'yarramate_export likec4 needs `project` (the likec4-project.yaml).',
          )
        }
        if (!isProjectDefinitionInStore(workspace, project)) {
          return refuse(
            `yarramate_export likec4: "${project}" is not a yarramate/likec4-project/v1 document in this workspace.`,
          )
        }
        const exported = exportLikeC4(workspace, project)
        if (!exported.ok) return answer(exported)
        return {
          kind: 'files',
          ok: true,
          text: `LikeC4 project: ${exported.result.files.map(({ path }) => path).join(', ')}\n`,
          files: exported.result.files.map((file) => ({
            path: file.path,
            contentType: file.path.endsWith('.json')
              ? 'application/json'
              : 'text/plain; charset=utf-8',
            text: file.source,
          })),
          result: exported.result,
        }
      }
      return refuse(
        'yarramate_export needs `kind`: one of markdown, rtm, graph, briefs, xlsx, likec4.',
      )
    }
  }
}

const isProjectDefinitionInStore = (
  workspace: ToolWorkspace,
  path: string,
): boolean => {
  const held = workspace.store.read(path)
  if (held === undefined) return false
  try {
    return isLikeC4ProjectDefinition(held.source)
  } catch {
    return false
  }
}

/** The files a text kind would write under `out`, for a caller with a filesystem. */
export const filesOf = (outcome: ToolOutcome): readonly ToolFile[] =>
  outcome.kind === 'files' ? outcome.files : []

export type { WorkspaceSource }
