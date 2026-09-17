import packageManifest from '../../package.json' with { type: 'json' }
import { renderBrief } from '../brief.js'
import type { GraphClaim, SemanticGraph, WorkspaceSource } from '../compiler.js'
import { sha256Hex } from '../digest.js'
import { evaluateEvidenceWorkspace } from '../evidence.js'
import { serializeSemanticGraph } from '../graph.js'
import {
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
  type ProjectionResult,
} from '../projection.js'
import {
  buildRtm,
  renderRtmMarkdown,
  type RequirementsTraceabilityMatrix,
} from '../rtm.js'
import {
  buildResponsibilityMatrix,
  renderResponsibilityMarkdown,
  type ResponsibilityMatrix,
} from '../responsibility.js'
import {
  buildGovernanceLog,
  renderGovernanceMarkdown,
  type GovernanceLog,
} from '../governance.js'
import { workbookFrom } from '../workbook.js'
import {
  exportLikeC4ProjectFromSources,
  generatedProjectFiles,
} from '../adapters/likec4-project-export.js'
import {
  compileOf,
  compilerSourcesOf,
  evidenceDocumentsOf,
  failed,
  guarded,
  readSource,
  type Compiled,
  type ToolResult,
  type ToolWorkspace,
} from './workspace.js'

/**
 * `yarramate export`, kind by kind, over a store (ADR 0156). Six kinds,
 * matching `yarramate_export`'s enum: markdown, graph, briefs, rtm, likec4,
 * xlsx. Nothing here writes; every kind answers text, files or bytes, and
 * the caller (the CLI under `--out`, a host behind a download address)
 * decides where they go.
 */

const claimValue = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object ? object.value : undefined
}

export const briefFileName = (id: string): string =>
  `${id.replaceAll('#', '--')}.md`

/** The compiled workspace and the projection named, evaluated. */
const projectionOf = (
  workspace: ToolWorkspace,
  compiled: Compiled,
  projection: string,
): ToolResult<ProjectionResult> => {
  const loaded = loadProjection(readSource(workspace, projection))
  if (!loaded.ok) return failed(loaded.diagnostics)
  return {
    ok: true,
    result: evaluateProjection(
      compiled.graph,
      loaded.projection,
      compiled.profileContext,
      compiled.patternMemberships,
    ),
  }
}

/** `yarramate export markdown <projection> <ws>`: the view rendered as prose. */
export const exportMarkdown = (
  workspace: ToolWorkspace,
  projection: string,
): ToolResult<{ readonly markdown: string; readonly result: ProjectionResult }> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const evaluated = projectionOf(workspace, compilation.compiled, projection)
    if (!evaluated.ok) return evaluated
    return {
      ok: true,
      result: {
        markdown: renderProjectionMarkdown(
          evaluated.result,
          compilation.compiled.profileContext,
        ),
        result: evaluated.result,
      },
    }
  })

/** `yarramate export graph <ws>`: the compiled semantic graph as JSON text. */
export const exportGraph = (
  workspace: ToolWorkspace,
): ToolResult<{ readonly json: string; readonly graph: SemanticGraph }> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    return {
      ok: true,
      result: {
        json: serializeSemanticGraph(compilation.compiled.graph),
        graph: compilation.compiled.graph,
      },
    }
  })

export interface BriefsOptions {
  /** Approximate token budget per brief. */
  readonly budget?: number
}

export interface ExportedBriefs {
  /** `INDEX.md` first, then one file per concept, in the order the CLI writes them. */
  readonly files: readonly { readonly path: string; readonly markdown: string }[]
  readonly concepts: number
}

/** `yarramate export briefs <projection> <ws> [--budget]`: one brief per subject, plus the index. */
export const exportBriefs = (
  workspace: ToolWorkspace,
  projection: string,
  options: BriefsOptions = {},
): ToolResult<ExportedBriefs> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const evaluated = projectionOf(workspace, compiled, projection)
    if (!evaluated.ok) return evaluated
    return { ok: true, result: briefsFromResult(compiled, evaluated.result, options) }
  })

/**
 * The briefs of an already evaluated projection: what `exportBriefs` does
 * once it has the view, shared with the CLI's git-derived review slice.
 */
export const briefsFromResult = (
  compiled: Compiled,
  result: ProjectionResult,
  options: BriefsOptions = {},
): ExportedBriefs => {
  {
    const stateIds = new Set(
      result.claims
        .filter(({ predicate }) => predicate === 'yarramate/state/type')
        .map(({ subject }) => subject),
    )
    const concepts = result.subjects
      .filter(({ id, type }) => type === 'concept' && !stateIds.has(id))
      .map(({ id }) => id)
      .sort((left, right) => left.localeCompare(right))
    const indexLines: string[] = [
      `# Briefs — ${result.presentation?.title ?? result.projection}`,
      '',
      `Derived from projection ${result.projection}; one brief per concept,`,
      "each the concept's connected neighbourhood as declared today.",
      '',
    ]
    const files: { readonly path: string; readonly markdown: string }[] = []
    for (const id of concepts) {
      const slice: ProjectionResult = evaluateProjection(
        compiled.graph,
        {
          format: 'yarramate/projection/v1',
          id: 'export-brief',
          version: '0.0',
          query: { subjects: [id], relationships: 'connected' },
          presentation: {
            title:
              claimValue(result.claims, id, 'yarramate/concept/name') ?? id,
            description: `The neighbourhood of ${id} as declared today.`,
          },
        },
        compiled.profileContext,
      )
      const brief = renderBrief(
        slice,
        compiled.profileContext,
        options.budget,
        compiled.graph.claims,
      )
      files.push({ path: briefFileName(id), markdown: brief })
      const name = claimValue(result.claims, id, 'yarramate/concept/name')
      const conceptKind =
        claimValue(result.claims, id, 'yarramate/concept/kind') ?? 'unknown'
      const status = claimValue(result.claims, id, 'yarramate/lifecycle/status')
      indexLines.push(
        `- [${name ?? id}](${briefFileName(id)}) — ` +
          `${conceptKind.split('#')[1] ?? conceptKind}` +
          `${status === undefined ? '' : ` (${status})`} — \`${id}\``,
      )
    }
    if (concepts.length === 0) {
      indexLines.push('No concepts selected by this projection.')
    }
    return {
      files: [
        { path: 'INDEX.md', markdown: `${indexLines.join('\n')}\n` },
        ...files,
      ],
      concepts: concepts.length,
    }
  }
}

/** `yarramate export rtm <ws>`: RTM.md and rtm.json, unwritten. */
export const exportRtm = (
  workspace: ToolWorkspace,
): ToolResult<{
  readonly markdown: string
  readonly rtm: RequirementsTraceabilityMatrix
}> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const evidence = evidenceDocumentsOf(workspace)
    if (!evidence.ok) return evidence
    const evaluation = evaluateEvidenceWorkspace(
      compiled.graph,
      evidence.documents,
    )
    if (!evaluation.ok) return failed(evaluation.diagnostics)
    const rtm = buildRtm(
      workspace.workspace.id,
      compiled.graph,
      compiled.profileContext,
      evaluation.reports,
    )
    return { ok: true, result: { markdown: renderRtmMarkdown(rtm), rtm } }
  })

/**
 * `yarramate export responsibility <projection> <ws>`: the RACI matrix over
 * the projection's subjects (ADR 0159), with the markdown a person reads.
 * Columns are every person the whole model holds, so an idle person is
 * idle against these rows, not absent from them.
 */
export const exportResponsibility = (
  workspace: ToolWorkspace,
  projection: string,
): ToolResult<{
  readonly markdown: string
  readonly matrix: ResponsibilityMatrix
}> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const evaluated = projectionOf(workspace, compiled, projection)
    if (!evaluated.ok) return evaluated
    const matrix = buildResponsibilityMatrix(
      workspace.workspace.id,
      compiled.graph,
      compiled.profileContext,
      {
        rows: evaluated.result.subjects
          .filter(({ type }) => type === 'concept')
          .map(({ id }) => id),
        projection: evaluated.result.projection,
      },
    )
    return {
      ok: true,
      result: { markdown: renderResponsibilityMarkdown(matrix), matrix },
    }
  })

/**
 * `yarramate export governance <ws>`: the RAID log's risks and assumptions
 * as the model holds them (ADR 0160), with the markdown a person reads.
 * Whole-workspace, like the RTM: a risk is a risk wherever it sits.
 */
export const exportGovernance = (
  workspace: ToolWorkspace,
): ToolResult<{
  readonly markdown: string
  readonly log: GovernanceLog
}> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const log = buildGovernanceLog(
      workspace.workspace.id,
      compiled.graph,
      compiled.profileContext,
    )
    return { ok: true, result: { markdown: renderGovernanceMarkdown(log), log } }
  })

/**
 * `yarramate export likec4 <likec4-project.yaml> <out> <ws>`: the generated
 * project as files, unwritten. `project` is the store path of the project
 * definition; the views, subject mapping and kind mapping it names resolve
 * relative to its directory, as the CLI resolves them. Git overlays
 * (`--changed`) are the CLI's own.
 */
export const exportLikeC4 = (
  workspace: ToolWorkspace,
  project: string,
): ToolResult<{ readonly files: readonly WorkspaceSource[] }> =>
  guarded(() => {
    const projectSource = readSource(workspace, project)
    const cut = project.lastIndexOf('/')
    const projectDirectory = cut === -1 ? '' : project.slice(0, cut + 1)
    const exported = exportLikeC4ProjectFromSources({
      project: projectSource,
      sources: compilerSourcesOf(workspace),
      readReference: (path) => {
        const held = workspace.store.read(`${projectDirectory}${path}`)
        return held === undefined ? undefined : { path, source: held.source }
      },
      requireMappedRelationships: false,
      ...(workspace.branding === undefined ? {} : { branding: workspace.branding }),
    })
    if (!exported.ok) return failed(exported.diagnostics)
    return { ok: true, result: { files: generatedProjectFiles(exported) } }
  })

/**
 * `yarramate export xlsx <projection> <ws>`: the workbook bytes, with the
 * same provenance the CLI stamps (the package version, a sha256 of every
 * compiler source, the kinds and statuses the profile admits).
 */
export const exportWorkbook = (
  workspace: ToolWorkspace,
  projection: string,
): ToolResult<{ readonly bytes: Uint8Array; readonly filename: string }> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const evaluated = projectionOf(workspace, compiled, projection)
    if (!evaluated.ok) return evaluated
    const sources = compilerSourcesOf(workspace)
    const bytes = workbookFrom(evaluated.result, {
      workspace: workspace.workspace.id,
      yarramateVersion: workspace.yarramateVersion ?? packageManifest.version,
      sourceDigests: Object.fromEntries(
        sources.map(({ path, source }) => [path, sha256Hex(source)]),
      ),
      conceptKinds: [...compiled.profileContext.conceptKindLineages.keys()].sort(),
      relationshipKinds: [
        ...compiled.profileContext.relationshipKindLineages.keys(),
      ].sort(),
      statuses: ['planned', 'current', 'retired'],
    }, workspace.branding)
    const stem = evaluated.result.projection.split('@')[0] ?? 'workbook'
    return {
      ok: true,
      result: { bytes, filename: `${stem.replaceAll(/[^A-Za-z0-9_-]/g, '-')}.xlsx` },
    }
  })
