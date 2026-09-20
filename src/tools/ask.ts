import type { StateComparison } from '../architecture-state.js'
import { coreLocalKind, renderBrief } from '../brief.js'
import type {
  Diagnostic,
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
} from '../compiler.js'
import {
  evaluateEvidenceWorkspace,
  type EvidenceResult,
} from '../evidence.js'
import {
  evaluateCatalogue,
  type InterrogationReport,
} from '../interrogate-command.js'
import { buildNextSubjects, type NextSubject } from '../next-command.js'
import { conceptKinds, relationshipPolicies, type ConceptKind } from '../profile.js'
import {
  ARCHIMATE_RELATIONSHIPS_VERSION,
  CORE_CONCEPT_KIND_ORDER,
  PERMITTED_RELATIONSHIP_LETTERS,
  RELATIONSHIP_LETTERS,
} from '../archimate-relationships.generated.js'
import { matrixEndpointAspects } from '../relationship-matrix.js'
import {
  evaluateProjection,
  loadProjection,
  renderBudgetedContext,
  type ProjectionResult,
} from '../projection.js'
import {
  reconcileEvidenceReports,
  type ReconciliationFinding,
  type ReconciliationReport,
} from '../reconciliation.js'
import { checkWorkspace, type CheckCounts } from './check.js'
import {
  compileOf,
  composedCatalogueOf,
  evidenceDocumentsOf,
  failed,
  guarded,
  readSource,
  refused,
  type Compiled,
  type ToolResult,
  type ToolWorkspace,
} from './workspace.js'

/**
 * `yarramate ask`, mode by mode, over a store (ADR 0156). The result
 * documents are the published `yarramate/ask-result/v1` shapes, exactly as
 * `ask --json` prints them; the CLI renders its human forms from these same
 * values, so the two surfaces cannot drift. The modes that need git
 * (`--changed`) or stay CLI-only (`--advise`, `--where`, `--compare`) keep
 * their types here so the CLI's union is one type.
 */

export interface ConceptEntry {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly status?: string
  readonly description?: string
  readonly aka?: readonly string[]
}

export interface OpenQuestionRef {
  readonly wave: string
  readonly id: string
  readonly authority: 'human' | 'agent' | 'either'
  readonly question: string
  readonly materiality: string
  readonly subject?: string
}

export interface AskResultBase {
  readonly format: 'yarramate/ask-result/v1'
  readonly workspace: string
}

/**
 * One relationship kind as `--kinds` reports it. The aspect lists are the
 * shadow the ArchiMate table casts on the aspect axis - a necessary
 * condition, never the rule; the rule is `relationshipMatrix`.
 */
export interface RelationshipKindSummary {
  readonly id: string
  readonly intent: string
  readonly sourceAspects: readonly string[]
  readonly targetAspects: readonly string[]
}

/** The vendored table itself, packed exactly as the generated module holds it (ADR 0097). */
export interface RelationshipMatrixSummary {
  readonly standard: string
  readonly letters: Readonly<Record<string, string>>
  readonly kinds: readonly string[]
  readonly rows: Readonly<Record<string, string>>
}

export interface NeighbourhoodOmission {
  readonly cap: number
  readonly kept: number
  readonly omitted: number
  readonly omittedBySeed: readonly {
    readonly seed: string
    readonly omitted: number
  }[]
}

export type AskOrientation = AskResultBase & {
  readonly mode: 'orientation'
  readonly ok: boolean
  readonly check: {
    readonly ok: boolean
    readonly diagnostics: readonly Diagnostic[]
    readonly counted?: CheckCounts
  }
  readonly reconciliation?: ReconciliationReport['summary']
  readonly design?: { readonly catalogue: string; readonly open: number }
  readonly backlog: {
    readonly planned: readonly NextSubject[]
    readonly current: readonly ConceptEntry[]
    readonly retired: readonly ConceptEntry[]
  }
}

export type AskRoster = AskResultBase & {
  readonly mode: 'roster'
  readonly total: number
  readonly subjects: readonly ConceptEntry[]
}

export type AskSlice = AskResultBase & {
  readonly mode: 'slice'
  readonly addressing: 'free-text' | 'subjects' | 'projection' | 'changed'
  readonly topic?: string
  readonly seeds?: readonly string[]
  readonly matched?: number
  /**
   * Every concept a term touched, ranked, present on a free-text slice (#569).
   * The seeds are the first few of these; a caller with a judgment to spend
   * reorders the list and asks again with `subjects` addressing.
   */
  readonly candidates?: readonly SeedCandidate[]
  readonly changed?: {
    readonly range: string
    readonly concepts: readonly string[]
    readonly relationships: readonly string[]
  }
  readonly coverage?: {
    readonly projections: number
    readonly uncovered: readonly string[]
  }
  readonly neighbourhood?: NeighbourhoodOmission
  readonly result: ProjectionResult
  /**
   * The text the CLI prints for the same call: the brief, or the budgeted
   * context when a budget was given. A hosted tool answers an agent with
   * text and should not re-render on its side of the seam. Additive to the
   * published document (ADR 0156); absent from the git-derived slices the
   * CLI alone produces.
   */
  readonly rendered?: string
}

export type AskAdvice = AskResultBase & {
  readonly mode: 'advice'
  readonly topic: string
  readonly seeds: readonly string[]
  readonly matched: number
  readonly slice: string
  readonly neighbourhood?: NeighbourhoodOmission
  readonly openQuestions: readonly OpenQuestionRef[]
  readonly reconciliation?: {
    readonly summary: ReconciliationReport['summary']
    readonly findings: readonly ReconciliationFinding[]
  }
}

export type AskWhere = AskResultBase & {
  readonly mode: 'where'
  readonly addressing: 'free-text' | 'subjects'
  readonly topic: string
  readonly seeds: readonly string[]
  readonly matched: number
  readonly located: readonly {
    readonly subject: string
    readonly observations: readonly {
      readonly uri: string
      readonly result: EvidenceResult
      readonly provider: string
      readonly message?: string
    }[]
  }[]
  readonly coverage: {
    readonly unobserved: readonly string[]
    readonly note: string
  }
}

export type AskNext = AskResultBase & {
  readonly mode: 'next'
  readonly subjects: readonly NextSubject[]
}

export type AskOpen = AskResultBase & {
  readonly mode: 'open'
  readonly report: InterrogationReport
}

export type AskCompare = AskResultBase & {
  readonly mode: 'compare'
  readonly comparison: StateComparison
}

export type AskKinds = AskResultBase & {
  readonly mode: 'kinds'
  readonly conceptKinds: readonly ConceptKind[]
  readonly relationshipKinds: readonly RelationshipKindSummary[]
  readonly relationshipMatrix: RelationshipMatrixSummary
  readonly extensions: readonly {
    readonly id: string
    readonly type: 'concept' | 'relationship'
    readonly lineage: readonly string[]
  }[]
}

export type AskResult =
  | AskOrientation
  | AskRoster
  | AskSlice
  | AskAdvice
  | AskWhere
  | AskNext
  | AskOpen
  | AskCompare
  | AskKinds

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export const claimValue = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object ? object.value : undefined
}

// The roster index: every model concept (never the planning states) with
// the fields free-text seeding matches against.
export const conceptEntries = (graph: SemanticGraph): readonly ConceptEntry[] => {
  const stateIds = new Set(
    graph.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  return graph.subjects
    .filter(({ id, type }) => type === 'concept' && !stateIds.has(id))
    .map(({ id }) => {
      const name = claimValue(graph.claims, id, 'yarramate/concept/name')
      const status = claimValue(graph.claims, id, 'yarramate/lifecycle/status')
      const description = claimValue(
        graph.claims,
        id,
        'yarramate/concept/description',
      )
      // Alternative labels (ADR 0076) are matchable, not renderable: they
      // widen what free-text seeding finds without changing the name any
      // renderer prints.
      const aka = graph.claims
        .filter(
          (claim) =>
            claim.subject === id &&
            claim.predicate === 'yarramate/concept/alias' &&
            'value' in claim.object,
        )
        .map((claim) => ('value' in claim.object ? claim.object.value : ''))
      return {
        id,
        kind:
          claimValue(graph.claims, id, 'yarramate/concept/kind') ?? 'unknown',
        ...(name === undefined ? {} : { name }),
        ...(status === undefined ? {} : { status }),
        ...(description === undefined ? {} : { description }),
        ...(aka.length === 0 ? {} : { aka }),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

const seedLimit = 5

/**
 * How many ranked candidates `resolveSeeds` hands back beside the seeds. Thirty
 * is the shortlist the #569 measurement reranked, and it is a cap rather than a
 * target: most queries match fewer.
 */
export const candidateLimit = 30

export interface SeedCandidate {
  readonly id: string
  /** How many distinct query terms this concept's text contains. The whole of the ranking. */
  readonly terms: number
}

export interface SeedResolution {
  readonly addressing: 'free-text' | 'subjects'
  readonly seeds: readonly string[]
  readonly matched: number
  /**
   * Every concept a term touched, ranked, not just the handful that seeded the
   * slice (#569).
   *
   * The term count finds the right subject and then buries it. Measured on the
   * Halcyon showcase against 32 questions written by someone other than the
   * author: the subject the asker meant was inside this list 87% of the time
   * and was the FIRST seed only 43% of the time. Retrieval was not the
   * weakness; ordering was.
   *
   * The engine cannot fix that on its own, because deciding which of several
   * term-matching concepts actually answers a question is a judgment and this
   * is a deterministic CLI (ADR 0059). So it hands the list over instead. A
   * caller with a judgment to spend - an agent, a host with a decision model -
   * reorders these and calls back with `subjects` addressing, which already
   * exists. A caller with none uses `seeds` exactly as before.
   *
   * Capped, so a one-word query against a large workspace cannot return the
   * whole record: `candidateLimit`, which a caller may raise.
   */
  readonly candidates: readonly SeedCandidate[]
}

// Free text is the default addressing mode: terms match concept ids,
// names, alternative labels, and descriptions; matching concepts seed the
// slice. Exact subject ids short-circuit to precise addressing: the
// seeding finds what an explicit --subject flag would have named.
//
// Aliases join the same flat haystack the id, name, and description
// already share, so they score at equal weight (ADR 0076). Weighting only
// aliases would be the one graded field in an otherwise ungraded match,
// and the whole point of recording the team's actual word for a subject is
// that it should find it.
export const resolveSeeds = (
  terms: readonly string[],
  entries: readonly ConceptEntry[],
  options: { readonly candidates?: number } = {},
): SeedResolution => {
  const known = new Set(entries.map(({ id }) => id))
  const unique = [...new Set(terms)]
  if (unique.every((term) => known.has(term))) {
    // Precise addressing named the subjects outright. There is nothing to
    // rank, so the candidates ARE the seeds: a caller reranking whatever it is
    // given never has to ask which addressing produced them.
    return {
      addressing: 'subjects',
      seeds: unique,
      matched: unique.length,
      candidates: unique.map((id) => ({ id, terms: 1 })),
    }
  }
  const lowered = [
    ...new Set(
      terms
        .flatMap((term) => term.split(/\s+/))
        .filter((term) => term.length > 0)
        .map((term) => term.toLowerCase()),
    ),
  ]
  const scored = entries
    .map((entry) => {
      const text =
        `${entry.id} ${entry.name ?? ''} ${(entry.aka ?? []).join(' ')} ${entry.description ?? ''}`.toLowerCase()
      return {
        id: entry.id,
        score: lowered.filter((term) => text.includes(term)).length,
      }
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
  return {
    addressing: 'free-text',
    seeds: scored.slice(0, seedLimit).map(({ id }) => id),
    matched: scored.length,
    candidates: scored
      .slice(0, Math.max(seedLimit, options.candidates ?? candidateLimit))
      .map(({ id, score }) => ({ id, terms: score })),
  }
}

// On a dense graph, hub seeds make 1-hop connected expansion reach most
// of the model (a focused ask on a 248-concept model reached 243). The
// cap keeps each seed's most material neighbours and announces the rest
// (ADR 0070); --neighbours overrides it, 0 lifts it.
export const defaultNeighbourCap = 12

export interface SliceEvaluation {
  readonly result: ProjectionResult
  readonly neighbourhood?: NeighbourhoodOmission
}

const motivationKindIds = new Set(
  conceptKinds.filter(({ layer }) => layer === 'motivation').map(({ id }) => id),
)

// Neighbours rank by the same reading the brief ranks paragraphs with
// under a budget (ADR 0042/0055): motivation first, then planned,
// current, retired. Ties break on seed affinity (a neighbour touching
// more seeds is more material to the slice), then id — deterministic.
const materialityRank = (
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext | undefined,
  id: string,
): number => {
  const kind = claimValue(graph.claims, id, 'yarramate/concept/kind')
  const core =
    kind === undefined
      ? undefined
      : coreLocalKind(kind, profileContext?.conceptKindLineages)
  if (core !== undefined && motivationKindIds.has(core)) return 0
  const status = claimValue(graph.claims, id, 'yarramate/lifecycle/status')
  return status === 'planned' ? 1 : status === 'retired' ? 3 : 2
}

// The one-hop connected neighbourhood every slice and advice mode uses:
// the same machinery context --subject exposed, now seeded by matching.
// The capped result is always a subset of the uncapped one — the cap
// drops neighbours and their edges, never seeds, and never adds edges
// the connected expansion would not have selected.
export const sliceProjection = (
  graph: SemanticGraph,
  seeds: readonly string[],
  title: string,
  profileContext: ResolvedProfileContext | undefined,
  neighbourCap: number,
): SliceEvaluation => {
  const full = evaluateProjection(
    graph,
    {
      format: 'yarramate/projection/v1',
      id: 'ask-slice',
      version: '0.0',
      query: { subjects: [...seeds], relationships: 'connected' },
      presentation: {
        title,
        description: `Connected neighbourhood of ${seeds.join(', ')}`,
        // A brief is prose, not a picture: it speaks every relationship, so
        // the slice walks responsibility edges the canvas would hide (#563).
        showResponsibility: true,
      },
    },
    profileContext,
  )
  if (neighbourCap === 0) return { result: full }

  const seedSet = new Set(seeds)
  const relationshipIds = new Set(
    full.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const endpointsById = new Map<string, readonly [string, string]>()
  for (const claim of full.claims) {
    if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
      endpointsById.set(claim.id, [claim.subject, claim.object.ref])
    }
  }
  const neighboursOf = new Map<string, string[]>(
    seeds.map((seed) => [seed, []]),
  )
  const affinity = new Map<string, number>()
  for (const [from, to] of endpointsById.values()) {
    for (const [seed, neighbour] of [
      [from, to],
      [to, from],
    ] as const) {
      if (!seedSet.has(seed) || seedSet.has(neighbour)) continue
      const list = neighboursOf.get(seed)
      if (list !== undefined && !list.includes(neighbour)) {
        list.push(neighbour)
        affinity.set(neighbour, (affinity.get(neighbour) ?? 0) + 1)
      }
    }
  }

  const keptNeighbours = new Set<string>()
  for (const list of neighboursOf.values()) {
    const ordered = [...list].sort(
      (left, right) =>
        materialityRank(graph, profileContext, left) -
          materialityRank(graph, profileContext, right) ||
        (affinity.get(right) ?? 0) - (affinity.get(left) ?? 0) ||
        left.localeCompare(right),
    )
    for (const neighbour of ordered.slice(0, neighbourCap)) {
      keptNeighbours.add(neighbour)
    }
  }
  const allNeighbours = new Set([...neighboursOf.values()].flat())
  const omitted = allNeighbours.size - keptNeighbours.size
  if (omitted === 0) return { result: full }

  const keptConcepts = new Set([...seedSet, ...keptNeighbours])
  const keptRelationships = new Set(
    [...endpointsById]
      .filter(
        ([, [from, to]]) => keptConcepts.has(from) && keptConcepts.has(to),
      )
      .map(([id]) => id),
  )
  const keptSubjects = new Set([...keptConcepts, ...keptRelationships])
  const keptDocuments = new Set(
    [...keptConcepts].map((id) => id.slice(0, id.indexOf('#'))),
  )
  const result: ProjectionResult = {
    ...full,
    documents: full.documents.filter(({ id }) => keptDocuments.has(id)),
    subjects: full.subjects.filter(({ id }) => keptSubjects.has(id)),
    claims: full.claims.filter(
      (claim) =>
        (keptConcepts.has(claim.subject) && !relationshipIds.has(claim.id)) ||
        keptRelationships.has(claim.subject) ||
        keptRelationships.has(claim.id),
    ),
  }
  return {
    result,
    neighbourhood: {
      cap: neighbourCap,
      kept: keptNeighbours.size,
      omitted,
      omittedBySeed: seeds.flatMap((seed) => {
        const dropped = (neighboursOf.get(seed) ?? []).filter(
          (neighbour) => !keptNeighbours.has(neighbour),
        ).length
        return dropped > 0 ? [{ seed, omitted: dropped }] : []
      }),
    },
  }
}

/** The brief, or the budgeted context when a budget was given: what the CLI prints. */
export const renderSlice = (
  evaluated: ProjectionResult,
  compiled: Pick<Compiled, 'profileContext' | 'graph'>,
  budget: number | undefined,
): string =>
  budget === undefined
    ? renderBrief(evaluated, compiled.profileContext, undefined, compiled.graph.claims)
    : renderBudgetedContext(evaluated, budget)

/** The declarable vocabulary, as `--kinds` reports it. */
export const kindsOf = (
  workspaceId: string,
  profileContext: ResolvedProfileContext,
): AskKinds => {
  const coreConceptIds = new Set<string>(conceptKinds.map(({ id }) => id))
  const coreRelationshipIds = new Set<string>(
    relationshipPolicies.map(({ id }) => id),
  )
  const extensions: {
    readonly id: string
    readonly type: 'concept' | 'relationship'
    readonly lineage: readonly string[]
  }[] = []
  const lineagePairs: ReadonlyArray<
    readonly ['concept' | 'relationship', ReadonlyMap<string, readonly string[]>]
  > = [
    ['concept', profileContext.conceptKindLineages],
    ['relationship', profileContext.relationshipKindLineages],
  ]
  for (const [type, lineages] of lineagePairs) {
    for (const [id, lineage] of [...lineages.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const local = id.slice(id.indexOf('#') + 1)
      const isCore =
        id.startsWith('yarramate/core@') &&
        (type === 'concept'
          ? coreConceptIds.has(local)
          : coreRelationshipIds.has(local))
      if (!isCore) extensions.push({ id, type, lineage })
    }
  }
  return {
    format: 'yarramate/ask-result/v1',
    workspace: workspaceId,
    mode: 'kinds',
    conceptKinds,
    relationshipKinds: relationshipPolicies.map((policy) => ({
      id: policy.id,
      intent: policy.intent,
      sourceAspects: [...matrixEndpointAspects(policy.id, 'source')],
      targetAspects: [...matrixEndpointAspects(policy.id, 'target')],
    })),
    relationshipMatrix: {
      standard: `ArchiMate ${ARCHIMATE_RELATIONSHIPS_VERSION}`,
      letters: RELATIONSHIP_LETTERS,
      kinds: CORE_CONCEPT_KIND_ORDER,
      rows: PERMITTED_RELATIONSHIP_LETTERS,
    },
    extensions,
  }
}

// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

/** What orientation needs beside its document: the report, for the CLI's sentence. */
export interface OrientationDetailed {
  readonly result: AskOrientation
  /** Absent when the check failed: nothing was compiled. */
  readonly report?: Omit<InterrogationReport, 'workspace'>
}

/** `yarramate ask <ws> --json` with no query: check verdict, drift summary, open count, backlog. */
export const askOrientationDetailed = (
  workspace: ToolWorkspace,
): ToolResult<OrientationDetailed> =>
  guarded<OrientationDetailed>(() => {
    const checked = checkWorkspace(workspace)
    const workspaceId = workspace.workspace.id
    if (!checked.ok) {
      return {
        ok: true,
        result: {
          result: {
            format: 'yarramate/ask-result/v1',
            workspace: workspaceId,
            mode: 'orientation',
            ok: false,
            check: { ok: false, diagnostics: checked.diagnostics },
            backlog: { planned: [], current: [], retired: [] },
          },
        },
      }
    }
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const entries = conceptEntries(compiled.graph)

    const evidence = evidenceDocumentsOf(workspace)
    if (!evidence.ok) return evidence
    const evaluation = evaluateEvidenceWorkspace(
      compiled.graph,
      evidence.documents,
    )
    if (!evaluation.ok) return failed(evaluation.diagnostics)
    const reconciliation =
      workspace.workspace.evidence.length > 0
        ? reconcileEvidenceReports(workspaceId, evaluation.reports, compiled.graph)
            .summary
        : undefined

    const wholeWorkspace = evaluateProjection(
      compiled.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'ask-orientation',
        version: '0.0',
        query: {},
      },
      compiled.profileContext,
    )
    const planned = buildNextSubjects(
      wholeWorkspace,
      compiled.graph,
      compiled.profileContext,
      evaluation.reports,
    )
    const current = entries.filter(({ status }) => status === 'current')
    const retired = entries.filter(({ status }) => status === 'retired')

    const composed = composedCatalogueOf(workspace, compiled)
    if (!composed.ok) return failed(composed.diagnostics)
    const report = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      evidence.documents.flatMap(({ observations }) => observations),
      composed.composed.catalogues,
      compiled.patternMemberships,
      compiled.patternVacancies,
    )

    return {
      ok: true,
      result: {
        result: {
          format: 'yarramate/ask-result/v1',
          workspace: workspaceId,
          mode: 'orientation',
          ok: true,
          check: {
            ok: true,
            diagnostics: [],
            ...(checked.counted === undefined ? {} : { counted: checked.counted }),
          },
          ...(reconciliation === undefined ? {} : { reconciliation }),
          design: { catalogue: report.catalogue, open: report.summary.open },
          backlog: { planned, current, retired },
        },
        report,
      },
    }
  })

export const askOrientation = (
  workspace: ToolWorkspace,
): ToolResult<AskOrientation> => {
  const detailed = askOrientationDetailed(workspace)
  return detailed.ok ? { ok: true, result: detailed.result.result } : detailed
}

export interface RosterOptions {
  /** Substring match on the kind id, as `--kind`. */
  readonly kind?: string
  readonly status?: 'planned' | 'current' | 'retired'
}

/** The roster plus every entry, for the CLI's "n of total" line. */
export interface RosterDetailed {
  readonly result: AskRoster
  readonly entries: readonly ConceptEntry[]
}

export const askRosterDetailed = (
  workspace: ToolWorkspace,
  options: RosterOptions = {},
): ToolResult<RosterDetailed> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const entries = conceptEntries(compilation.compiled.graph)
    const kindFilter = options.kind
    const statusFilter = options.status
    const filtered = entries.filter(
      (entry) =>
        (kindFilter === undefined ||
          entry.kind.toLowerCase().includes(kindFilter.toLowerCase())) &&
        (statusFilter === undefined || entry.status === statusFilter),
    )
    return {
      ok: true,
      result: {
        result: {
          format: 'yarramate/ask-result/v1',
          workspace: workspace.workspace.id,
          mode: 'roster',
          total: entries.length,
          subjects: filtered,
        },
        entries,
      },
    }
  })

/** `yarramate ask <ws> --subjects [--kind] [--status] --json`. */
export const askRoster = (
  workspace: ToolWorkspace,
  options: RosterOptions = {},
): ToolResult<AskRoster> => {
  const detailed = askRosterDetailed(workspace, options)
  return detailed.ok ? { ok: true, result: detailed.result.result } : detailed
}

/** `yarramate ask <ws> --kinds --json`. */
export const askKinds = (workspace: ToolWorkspace): ToolResult<AskKinds> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    return {
      ok: true,
      result: kindsOf(
        workspace.workspace.id,
        compilation.compiled.profileContext,
      ),
    }
  })

/** `yarramate ask <ws> --next --json`. */
export const askNext = (workspace: ToolWorkspace): ToolResult<AskNext> =>
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
    const wholeWorkspace = evaluateProjection(
      compiled.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'ask-next',
        version: '0.0',
        query: {},
      },
      compiled.profileContext,
    )
    const ordered = buildNextSubjects(
      wholeWorkspace,
      compiled.graph,
      compiled.profileContext,
      evaluation.reports,
    )
    return {
      ok: true,
      result: {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.workspace.id,
        mode: 'next',
        subjects: ordered,
      },
    }
  })

/** `yarramate ask <ws> --open --json`. */
export const askOpen = (workspace: ToolWorkspace): ToolResult<AskOpen> =>
  guarded(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const composed = composedCatalogueOf(workspace, compiled)
    if (!composed.ok) return failed(composed.diagnostics)
    const evidence = evidenceDocumentsOf(workspace)
    if (!evidence.ok) return evidence
    const report: InterrogationReport = {
      ...evaluateCatalogue(
        composed.composed.catalogue,
        compiled.graph,
        compiled.profileContext,
        evidence.documents.flatMap(({ observations }) => observations),
        composed.composed.catalogues,
        compiled.patternMemberships,
        compiled.patternVacancies,
      ),
      workspace: workspace.workspace.id,
    }
    // Key order is the published one: workspace before catalogue, the
    // optional set after it.
    const ordered: InterrogationReport = {
      format: report.format,
      workspace: report.workspace,
      catalogue: report.catalogue,
      ...(report.catalogues === undefined ? {} : { catalogues: report.catalogues }),
      semantics: report.semantics,
      inputs: report.inputs,
      summary: report.summary,
      waves: report.waves,
    }
    return {
      ok: true,
      result: {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.workspace.id,
        mode: 'open',
        report: ordered,
      },
    }
  })

/**
 * What a slice is asked about. Free text matches ids, names and
 * descriptions; subject ids address precisely; a projection path names a
 * saved view in the store. The CLI decides between the three by looking at
 * the filesystem and the id syntax; a tool says which it means.
 */
export type SliceQuery =
  | { readonly text: string }
  | { readonly subjects: readonly string[] }
  | { readonly projection: string }

export interface SliceOptions {
  /** Approximate token budget; renders the budgeted context instead of the brief. */
  readonly budget?: number
  /** Neighbour cap for seeded slices (text and subjects); 0 lifts it. Refused with a projection. */
  readonly neighbours?: number
}

/** `yarramate ask <ws> "<text>" | <id>... | <projection.yaml> [--budget] [--neighbours]`. */
export const askSlice = (
  workspace: ToolWorkspace,
  query: SliceQuery,
  options: SliceOptions = {},
): ToolResult<AskSlice> =>
  guarded<AskSlice>(() => {
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation
    const workspaceId = workspace.workspace.id

    if ('projection' in query) {
      if (options.neighbours !== undefined) {
        return refused(
          `--neighbours applies to seeded slices; ${query.projection} is a projection that defines its own query`,
        )
      }
      const loaded = loadProjection(readSource(workspace, query.projection))
      if (!loaded.ok) return failed(loaded.diagnostics)
      const evaluated = evaluateProjection(
        compiled.graph,
        loaded.projection,
        compiled.profileContext,
        compiled.patternMemberships,
      )
      return {
        ok: true,
        result: {
          format: 'yarramate/ask-result/v1',
          workspace: workspaceId,
          mode: 'slice',
          addressing: 'projection',
          result: evaluated,
          rendered: renderSlice(evaluated, compiled, options.budget),
        },
      }
    }

    const terms = 'text' in query ? [query.text] : [...query.subjects]
    const topic = terms.join(' ')
    const entries = conceptEntries(compiled.graph)
    const resolution = resolveSeeds(terms, entries)
    if (resolution.seeds.length === 0) {
      return refused(
        `No concepts match "${topic}" (searched ${entries.length} concept${entries.length === 1 ? '' : 's'} by id, name, and description).`,
      )
    }
    const { result: evaluated, neighbourhood } = sliceProjection(
      compiled.graph,
      resolution.seeds,
      topic,
      compiled.profileContext,
      options.neighbours ?? defaultNeighbourCap,
    )
    return {
      ok: true,
      result: {
        format: 'yarramate/ask-result/v1',
        workspace: workspaceId,
        mode: 'slice',
        addressing: resolution.addressing,
        topic,
        seeds: resolution.seeds,
        matched: resolution.matched,
        // Everything a term touched, ranked, so an agent can reorder the list
        // and ask again with `subjects` rather than take the term count's word
        // for which five mattered (#569). Only where there was ranking to do.
        ...(resolution.addressing === 'free-text'
          ? { candidates: resolution.candidates }
          : {}),
        ...(neighbourhood === undefined ? {} : { neighbourhood }),
        result: evaluated,
        rendered: renderSlice(evaluated, compiled, options.budget),
      },
    }
  })
