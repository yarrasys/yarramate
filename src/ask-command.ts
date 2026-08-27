import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import {
  compareArchitectureStates,
  type StateComparison,
} from './architecture-state.js'
import { coreLocalKind, renderBrief } from './brief.js'
import { deriveChangedSubjects } from './changed.js'
import { runCheckCommand } from './check-command.js'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import {
  compileWorkspaceWithProfileContext,
  type Diagnostic,
  type GraphClaim,
  type SemanticGraph,
} from './compiler.js'
import {
  evaluateEvidenceWorkspace,
  loadEvidence,
  type EvidenceDocument,
  type EvidenceObservation,
  type EvidenceResult,
} from './evidence.js'
import { catalogueSources } from './catalogue-sources.js'
import {
  evaluateCatalogue,
  composeCatalogues,
  renderInterrogationReport,
  type InterrogationReport,
} from './interrogate-command.js'
import {
  buildNextSubjects,
  coverageClause,
  type NextSubject,
} from './next-command.js'
import {
  conceptKinds,
  relationshipPolicies,
  type ConceptKind,
} from './profile.js'
import {
  ARCHIMATE_RELATIONSHIPS_VERSION,
  CORE_CONCEPT_KIND_ORDER,
  PERMITTED_RELATIONSHIP_LETTERS,
  RELATIONSHIP_LETTERS,
} from './archimate-relationships.generated.js'
import { matrixEndpointAspects } from './relationship-matrix.js'
import {
  evaluateProjection,
  loadProjection,
  renderBudgetedContext,
  type ProjectionResult,
} from './projection.js'
import {
  reconcileEvidenceReports,
  type ReconciliationFinding,
  type ReconciliationReport,
} from './reconciliation.js'
import { loadWorkspaceManifest } from './workspace.js'

// The same internal catalogue design interviews from: ask reads what
// design asks, so both must see identical open questions.
const here = dirname(fileURLToPath(import.meta.url))
const shippedCataloguePath = join(
  here,
  '..',
  'catalogues',
  'core-enrichment.yaml',
)

interface ConceptEntry {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly status?: string
  readonly description?: string
  readonly aka?: readonly string[]
}

interface OpenQuestionRef {
  readonly wave: string
  readonly id: string
  readonly authority: 'human' | 'agent' | 'either'
  readonly question: string
  readonly materiality: string
  readonly subject?: string
}

interface AskResultBase {
  readonly format: 'yarramate/ask-result/v1'
  readonly workspace: string
}

type AskResult = AskResultBase &
  (
    | {
        readonly mode: 'orientation'
        readonly ok: boolean
        readonly check: {
          readonly ok: boolean
          readonly diagnostics: readonly Diagnostic[]
          readonly counted?: {
            readonly documents: number
            readonly concepts: number
            readonly relationships: number
            readonly states: number
          }
        }
        readonly reconciliation?: ReconciliationReport['summary']
        readonly design?: { readonly catalogue: string; readonly open: number }
        readonly backlog: {
          readonly planned: readonly NextSubject[]
          readonly current: readonly ConceptEntry[]
          readonly retired: readonly ConceptEntry[]
        }
      }
    | {
        readonly mode: 'roster'
        readonly total: number
        readonly subjects: readonly ConceptEntry[]
      }
    | {
        readonly mode: 'slice'
        readonly addressing: 'free-text' | 'subjects' | 'projection' | 'changed'
        readonly topic?: string
        readonly seeds?: readonly string[]
        readonly matched?: number
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
      }
    | {
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
    | {
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
    | { readonly mode: 'next'; readonly subjects: readonly NextSubject[] }
    | { readonly mode: 'open'; readonly report: InterrogationReport }
    | { readonly mode: 'compare'; readonly comparison: StateComparison }
    | {
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
  )

/**
 * One relationship kind as `--kinds` reports it. The aspect lists are the
 * shadow the ArchiMate table casts on the aspect axis - a necessary
 * condition, never the rule; the rule is `relationshipMatrix`.
 */
interface RelationshipKindSummary {
  readonly id: string
  readonly intent: string
  readonly sourceAspects: readonly string[]
  readonly targetAspects: readonly string[]
}

/** The vendored table itself, packed exactly as the generated module holds it (ADR 0097). */
interface RelationshipMatrixSummary {
  readonly standard: string
  readonly letters: Readonly<Record<string, string>>
  readonly kinds: readonly string[]
  readonly rows: Readonly<Record<string, string>>
}

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

// The roster index: every model concept (never the planning states) with
// the fields free-text seeding matches against.
const conceptEntries = (graph: SemanticGraph): readonly ConceptEntry[] => {
  const stateIds = new Set(
    graph.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  return graph.subjects
    .filter(({ id, type }) => type === 'concept' && !stateIds.has(id))
    .map(({ id }) => {
      const name = claimValue(graph.claims, id, 'yarramate/concept/name')
      const status = claimValue(
        graph.claims,
        id,
        'yarramate/lifecycle/status',
      )
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

interface SeedResolution {
  readonly addressing: 'free-text' | 'subjects'
  readonly seeds: readonly string[]
  readonly matched: number
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
const resolveSeeds = (
  terms: readonly string[],
  entries: readonly ConceptEntry[],
): SeedResolution => {
  const known = new Set(entries.map(({ id }) => id))
  const unique = [...new Set(terms)]
  if (unique.every((term) => known.has(term))) {
    return { addressing: 'subjects', seeds: unique, matched: unique.length }
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
  }
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

const reconciliationLine = (
  summary: ReconciliationReport['summary'],
): string =>
  `Reconciliation: ${plural(summary.observations, 'observation')}, ` +
  `${summary.confirmed} confirmed, ` +
  `${plural(summary.findings, 'finding')}` +
  (summary.findings > 0
    ? ` (${summary.contradicted} contradicted, ` +
      `${summary.unknown} unknown, ` +
      `${summary.notObserved} not observed)`
    : '') +
  (summary.subjectsWithoutEvidence > 0
    ? `, ${plural(summary.subjectsWithoutEvidence, 'current subject')} without evidence`
    : '')

const plannedLines = (subjects: readonly NextSubject[]): readonly string[] => {
  if (subjects.length === 0) return ['  none']
  const width = Math.max(...subjects.map(({ id }) => id.length))
  return subjects.map((subject) => {
    const clauses = [
      ...(subject.requiredBy.length > 0
        ? [`<- required by ${subject.requiredBy.join(', ')}`]
        : []),
      coverageClause(subject.evidence),
      ...(subject.cycle === true ? ['dependency cycle'] : []),
    ]
    return `  ${subject.id.padEnd(width)}  ${clauses.join('; ')}`
  })
}

// On a dense graph, hub seeds make 1-hop connected expansion reach most
// of the model (a focused ask on a 248-concept model reached 243). The
// cap keeps each seed's most material neighbours and announces the rest
// (ADR 0070); --neighbours overrides it, 0 lifts it.
const defaultNeighbourCap = 12

interface NeighbourhoodOmission {
  readonly cap: number
  readonly kept: number
  readonly omitted: number
  readonly omittedBySeed: readonly {
    readonly seed: string
    readonly omitted: number
  }[]
}

interface SliceEvaluation {
  readonly result: ProjectionResult
  readonly neighbourhood?: NeighbourhoodOmission
}

const motivationKindIds = new Set(
  conceptKinds
    .filter(({ layer }) => layer === 'motivation')
    .map(({ id }) => id),
)

// Neighbours rank by the same reading the brief ranks paragraphs with
// under a budget (ADR 0042/0055): motivation first, then planned,
// current, retired. Ties break on seed affinity (a neighbour touching
// more seeds is more material to the slice), then id — deterministic.
const materialityRank = (
  graph: SemanticGraph,
  profileContext: Parameters<typeof evaluateProjection>[2],
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
const sliceProjection = (
  graph: SemanticGraph,
  seeds: readonly string[],
  title: string,
  profileContext: Parameters<typeof evaluateProjection>[2],
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

// The honesty line, in the budgeted-ladder voice (ADR 0042): what was
// dropped is named, and so is the way to widen.
const neighbourhoodLine = (
  neighbourhood: NeighbourhoodOmission,
): string =>
  `[neighbours ${neighbourhood.cap}: ${neighbourhood.omitted} of ` +
  `${neighbourhood.kept + neighbourhood.omitted} neighbours omitted — ` +
  `raise --neighbours or pass --neighbours 0 for the full neighbourhood]`

export function runAskCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  let json = false
  let subjects = false
  let next = false
  let open = false
  let kinds = false
  let advise = false
  let where = false
  let compare: readonly [string, string] | undefined
  let changed: string | undefined
  let budget: number | undefined
  let neighbours: number | undefined
  let kindFilter: string | undefined
  let statusFilter: string | undefined
  let cataloguePath: string | undefined
  const positionals: string[] = []
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--json') {
      json = true
      continue
    }
    if (option === '--subjects') {
      subjects = true
      continue
    }
    if (option === '--next') {
      next = true
      continue
    }
    if (option === '--open') {
      open = true
      continue
    }
    if (option === '--kinds') {
      kinds = true
      continue
    }
    if (option === '--advise') {
      advise = true
      continue
    }
    if (option === '--where') {
      where = true
      continue
    }
    if (option === '--compare') {
      const from = options[index + 1]
      const to = options[index + 2]
      if (
        compare !== undefined ||
        from === undefined ||
        to === undefined ||
        from.startsWith('-') ||
        to.startsWith('-')
      ) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      compare = [from, to]
      index += 2
      continue
    }
    if (
      option === '--budget' ||
      option === '--neighbours' ||
      option === '--kind' ||
      option === '--status' ||
      option === '--catalogue' ||
      option === '--changed'
    ) {
      const value = options[index + 1]
      if (value === undefined || value.startsWith('-')) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      if (option === '--budget') {
        if (budget !== undefined || !/^[1-9][0-9]*$/.test(value)) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        budget = Number(value)
      } else if (option === '--neighbours') {
        if (neighbours !== undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        neighbours = Number(value)
      } else if (option === '--changed') {
        if (changed !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        changed = value
      } else if (option === '--kind') {
        if (kindFilter !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        kindFilter = value
      } else if (option === '--status') {
        if (
          statusFilter !== undefined ||
          !['planned', 'current', 'retired'].includes(value)
        ) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        statusFilter = value
      } else {
        if (cataloguePath !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        cataloguePath = value
      }
      index += 1
      continue
    }
    if (option === undefined || option.startsWith('-')) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    positionals.push(option)
  }

  const [workspacePath, ...query] = positionals
  const exclusiveModes = [
    subjects,
    next,
    open,
    kinds,
    compare !== undefined,
  ].filter(Boolean).length
  if (
    workspacePath === undefined ||
    exclusiveModes > 1 ||
    (advise && exclusiveModes > 0) ||
    (advise && query.length === 0) ||
    (where &&
      (exclusiveModes > 0 ||
        advise ||
        changed !== undefined ||
        budget !== undefined ||
        neighbours !== undefined ||
        query.length === 0)) ||
    (query.length > 0 && exclusiveModes > 0) ||
    (changed !== undefined &&
      (query.length > 0 || exclusiveModes > 0 || advise)) ||
    ((kindFilter !== undefined || statusFilter !== undefined) && !subjects) ||
    (cataloguePath !== undefined && !open && !advise) ||
    (budget !== undefined &&
      (json || (query.length === 0 && !advise && changed === undefined))) ||
    (neighbours !== undefined &&
      query.length === 0 &&
      !advise &&
      changed === undefined)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(resolve(cwd, workspacePath), 'utf8')
    if (
      parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'ask requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: json
        ? diagnosticJson(diagnostics)
        : humanDiagnostics(diagnostics),
      stderr: '',
    })
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace

    const emit = (result: AskResult, human: string, exitCode: 0 | 1 = 0) =>
      json
        ? {
            exitCode,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: '',
          }
        : { exitCode, stdout: human, stderr: '' }

    // Orientation is the only mode that reports on a failing model rather
    // than failing with it: the verdict is the content.
    if (
      query.length === 0 &&
      !subjects &&
      !next &&
      !open &&
      !kinds &&
      !advise &&
      compare === undefined &&
      changed === undefined
    ) {
      const checked = runCheckCommand([workspacePath, '--json'], cwd)
      const checkPayload = JSON.parse(checked.stdout) as {
        readonly ok: boolean
        readonly diagnostics: readonly Diagnostic[]
        readonly counted?: {
          readonly documents: number
          readonly concepts: number
          readonly relationships: number
          readonly states: number
        }
      }
      if (!checkPayload.ok) {
        const result: AskResult = {
          format: 'yarramate/ask-result/v1',
          workspace: workspace.id,
          mode: 'orientation',
          ok: false,
          check: { ok: false, diagnostics: checkPayload.diagnostics },
          backlog: { planned: [], current: [], retired: [] },
        }
        return emit(
          result,
          `Workspace ${workspace.id}: check failing\n` +
            `Diagnostics: ${plural(checkPayload.diagnostics.length, 'error')}; run \`yarramate check ${workspacePath}\` for details\n`,
          1,
        )
      }

      const compilation = compileWorkspaceWithProfileContext(
        [
          ...workspace.profiles,
          ...workspace.patterns,
          ...workspace.documents,
        ].map((path) => ({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })),
      )
      if (!compilation.ok) return failed(compilation.diagnostics)
      const entries = conceptEntries(compilation.graph)

      const evidenceDocuments = []
      for (const path of workspace.evidence) {
        const loaded = loadEvidence({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        if (!loaded.ok) return failed(loaded.diagnostics)
        evidenceDocuments.push(loaded.evidence)
      }
      const evaluation = evaluateEvidenceWorkspace(
        compilation.graph,
        evidenceDocuments,
      )
      if (!evaluation.ok) return failed(evaluation.diagnostics)
      const reconciliation =
        workspace.evidence.length > 0
          ? reconcileEvidenceReports(
              workspace.id,
              evaluation.reports,
              compilation.graph,
            ).summary
          : undefined

      const wholeWorkspace = evaluateProjection(
        compilation.graph,
        {
          format: 'yarramate/projection/v1',
          id: 'ask-orientation',
          version: '0.0',
          query: {},
        },
        compilation.profileContext,
      )
      const planned = buildNextSubjects(
        wholeWorkspace,
        compilation.graph,
        compilation.profileContext,
        evaluation.reports,
      )
      const current = entries.filter(({ status }) => status === 'current')
      const retired = entries.filter(({ status }) => status === 'retired')

      const composed = composeCatalogues(
        catalogueSources(
          {
            path: shippedCataloguePath,
            source: readFileSync(shippedCataloguePath, 'utf8'),
          },
          workspace,
          cwd,
        ),
        compilation.profileContext,
      )
      if (!composed.ok) return failed(composed.diagnostics)
      const report = evaluateCatalogue(
        composed.composed.catalogue,
        compilation.graph,
        compilation.profileContext,
        evidenceDocuments.flatMap(({ observations }) => observations),
        composed.composed.catalogues,
      )

      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'orientation',
        ok: true,
        check: {
          ok: true,
          diagnostics: [],
          ...(checkPayload.counted === undefined
            ? {}
            : { counted: checkPayload.counted }),
        },
        ...(reconciliation === undefined ? {} : { reconciliation }),
        design: { catalogue: report.catalogue, open: report.summary.open },
        backlog: { planned, current, retired },
      }

      const counted = checkPayload.counted
      const lines: string[] = [
        `Workspace ${workspace.id}: check ok` +
          (counted === undefined
            ? ''
            : ` (${plural(counted.concepts, 'concept')}, ` +
              `${plural(counted.relationships, 'relationship')}, ` +
              `${plural(counted.states, 'state')}, ` +
              `${plural(counted.documents, 'document')})`),
      ]
      if (reconciliation !== undefined) {
        lines.push(reconciliationLine(reconciliation))
      }
      // Zero open has two causes and only one is complete (#334): a
      // catalogue whose waves are all gated shut has asked nothing, and
      // reporting that as a finished interview is the same empty-set
      // flattery the wave rail carried.
      const askedAnything = report.waves.some(
        (wave) => wave.questions.length > 0,
      )
      lines.push(
        report.summary.open === 0
          ? askedAnything
            ? `Design interview complete (catalogue ${report.catalogue}): no open questions.`
            : `Design interview not started (catalogue ${report.catalogue}): no wave has opened yet.`
          : `Design interview: ${plural(report.summary.open, 'open question')} (catalogue ${report.catalogue}) — continue: yarramate design ${workspacePath}`,
        '',
        'Backlog — planned, dependency order:',
        ...plannedLines(planned),
        '',
        `Current: ${plural(current.length, 'subject')} · Retired: ${retired.length} ` +
          `(roster: yarramate ask ${workspacePath} --subjects)`,
      )
      return emit(result, `${lines.join('\n')}\n`)
    }

    // Every other mode reads the compiled model directly.
    const compilation = compileWorkspaceWithProfileContext(
      [
          ...workspace.profiles,
          ...workspace.patterns,
          ...workspace.documents,
        ].map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    if (!compilation.ok) return failed(compilation.diagnostics)
    const graph = compilation.graph
    const entries = conceptEntries(graph)

    if (subjects) {
      const filtered = entries.filter(
        (entry) =>
          (kindFilter === undefined ||
            entry.kind.toLowerCase().includes(kindFilter.toLowerCase())) &&
          (statusFilter === undefined || entry.status === statusFilter),
      )
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'roster',
        total: entries.length,
        subjects: filtered,
      }
      const lines = [
        `Subjects in workspace ${workspace.id}: ${filtered.length} of ${entries.length}`,
      ]
      if (filtered.length > 0) {
        const width = Math.max(...filtered.map(({ id }) => id.length))
        const kindWidth = Math.max(
          ...filtered.map(
            ({ kind }) => (kind.split('#')[1] ?? kind).length,
          ),
        )
        for (const entry of filtered) {
          const kind = entry.kind.split('#')[1] ?? entry.kind
          const description =
            entry.description === undefined
              ? ''
              : ` — ${
                  entry.description.length > 100
                    ? `${entry.description.slice(0, 100)}…`
                    : entry.description
                }`
          lines.push(
            `  ${entry.id.padEnd(width)}  ${kind.padEnd(kindWidth)}  ` +
              `${entry.name ?? entry.id}` +
              `${entry.status === undefined ? '' : ` (${entry.status})`}` +
              description,
          )
        }
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    // --kinds: the declarable vocabulary (#89) — what agents previously
    // learned by reading src/profile.ts. Core kinds ship with the engine;
    // extensions come from the workspace's resolved profiles.
    if (kinds) {
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
        ['concept', compilation.profileContext.conceptKindLineages],
        ['relationship', compilation.profileContext.relationshipKindLineages],
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
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
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
      const lines: string[] = [
        `Declarable kinds — core profile yarramate/core@0.1`,
        '',
        'Concept kinds (by layer):',
      ]
      const layers = [...new Set(conceptKinds.map(({ layer }) => layer))]
      for (const layer of layers) {
        const inLayer = conceptKinds.filter(
          (candidate) => candidate.layer === layer,
        )
        lines.push(
          `  ${layer}: ${inLayer.map(({ id }) => id).join(', ')}`,
        )
      }
      lines.push('', 'Relationship kinds:')
      for (const policy of relationshipPolicies) {
        const source = [...matrixEndpointAspects(policy.id, 'source')].join('|')
        const target = [...matrixEndpointAspects(policy.id, 'target')].join('|')
        lines.push(`  ${policy.id} — ${policy.intent} [${source} -> ${target}]`)
      }
      lines.push(
        '',
        `Relationship admissibility: ArchiMate ${ARCHIMATE_RELATIONSHIPS_VERSION} kind-to-kind table (${CORE_CONCEPT_KIND_ORDER.length} kinds; see relationshipMatrix in --json)`,
      )
      if (extensions.length > 0) {
        lines.push('', 'Profile extensions in this workspace:')
        for (const extension of extensions) {
          lines.push(
            `  ${extension.id} (${extension.type})` +
              (extension.lineage.length > 0
                ? ` -> ${extension.lineage.join(' -> ')}`
                : ''),
          )
        }
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (compare !== undefined) {
      const comparison = compareArchitectureStates(graph, ...compare)
      if (!comparison.ok) {
        return {
          exitCode: 2,
          stdout: '',
          stderr: `${comparison.issues.map(({ message }) => message).join('\n')}\n`,
        }
      }
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'compare',
        comparison: comparison.comparison,
      }
      const { added, removed, retained } = comparison.comparison
      const lines = [
        `States ${compare[0]} -> ${compare[1]}: ` +
          `${added.length} added, ${removed.length} removed, ${retained.length} retained`,
      ]
      if (added.length > 0) {
        lines.push('Added:', ...added.map(({ id, type }) => `  ${id} (${type})`))
      }
      if (removed.length > 0) {
        lines.push(
          'Removed:',
          ...removed.map(({ id, type }) => `  ${id} (${type})`),
        )
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (next) {
      const evidenceDocuments = []
      for (const path of workspace.evidence) {
        const loaded = loadEvidence({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        if (!loaded.ok) return failed(loaded.diagnostics)
        evidenceDocuments.push(loaded.evidence)
      }
      const evaluation = evaluateEvidenceWorkspace(graph, evidenceDocuments)
      if (!evaluation.ok) return failed(evaluation.diagnostics)
      const wholeWorkspace = evaluateProjection(
        graph,
        {
          format: 'yarramate/projection/v1',
          id: 'ask-next',
          version: '0.0',
          query: {},
        },
        compilation.profileContext,
      )
      const ordered = buildNextSubjects(
        wholeWorkspace,
        graph,
        compilation.profileContext,
        evaluation.reports,
      )
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'next',
        subjects: ordered,
      }
      const human =
        ordered.length === 0
          ? `No planned subjects in workspace ${workspace.id}.\n`
          : `${[
              `Planned subjects in workspace ${workspace.id} (dependency order):`,
              ...plannedLines(ordered),
            ].join('\n')}\n`
      return emit(result, human)
    }

    if (open) {
      const resolvedCataloguePath =
        cataloguePath === undefined
          ? shippedCataloguePath
          : resolve(cwd, cataloguePath)
      const composed = composeCatalogues(
        catalogueSources(
          {
            path: cataloguePath ?? resolvedCataloguePath,
            source: readFileSync(resolvedCataloguePath, 'utf8'),
          },
          workspace,
          cwd,
        ),
        compilation.profileContext,
      )
      if (!composed.ok) return failed(composed.diagnostics)
      // The evidence overlay rides along for the one condition that
      // reads it (unchallenged-evidence); a workspace declaring no
      // evidence passes an overlay known to be empty.
      const evidenceObservations = []
      for (const path of workspace.evidence) {
        const loaded = loadEvidence({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        if (!loaded.ok) return failed(loaded.diagnostics)
        evidenceObservations.push(...loaded.evidence.observations)
      }
      const report: InterrogationReport = {
        ...evaluateCatalogue(
          composed.composed.catalogue,
          graph,
          compilation.profileContext,
          evidenceObservations,
          composed.composed.catalogues,
        ),
        workspace: workspace.id,
      }
      // Field by field, to fix key ORDER in the emitted JSON. Every optional
      // field has to be threaded through explicitly, which is why `catalogues`
      // is here: a copier like this drops a new field silently and the only
      // symptom is an absent one, which reads as "did not apply" rather than
      // as "was lost".
      const ordered: InterrogationReport = {
        format: report.format,
        workspace: report.workspace,
        catalogue: report.catalogue,
        ...(report.catalogues === undefined
          ? {}
          : { catalogues: report.catalogues }),
        semantics: report.semantics,
        summary: report.summary,
        waves: report.waves,
      }
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'open',
        report: ordered,
      }
      return emit(result, renderInterrogationReport(ordered))
    }

    // --changed: the review slice (ADR 0065). Git says what changed; the
    // engine maps changed lines to subjects and renders their connected
    // neighbourhood, plus a coverage note when a changed subject appears
    // in no authored projection.
    if (changed !== undefined) {
      const documentIdByPath = new Map(
        graph.documents.map(({ id, source }) => [source, id]),
      )
      const derived = deriveChangedSubjects(
        cwd,
        changed,
        workspace.documents.map((path) => ({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
          documentId: documentIdByPath.get(path) ?? path,
        })),
      )
      if (!derived.ok) {
        return { exitCode: 2, stdout: '', stderr: `${derived.message}\n` }
      }
      const endpoints = new Set<string>()
      for (const relationshipId of derived.changed.relationships) {
        const claim = graph.claims.find(
          (candidate) =>
            candidate.id === relationshipId && 'ref' in candidate.object,
        )
        if (claim !== undefined && 'ref' in claim.object) {
          endpoints.add(claim.subject)
          endpoints.add(claim.object.ref)
        }
      }
      const seeds = [
        ...new Set([...derived.changed.concepts, ...endpoints]),
      ].sort()
      const changedIds = [
        ...derived.changed.concepts,
        ...derived.changed.relationships,
      ]

      const covered = new Set<string>()
      for (const projectionPath of workspace.projections) {
        const loaded = loadProjection({
          path: projectionPath,
          source: readFileSync(resolve(cwd, projectionPath), 'utf8'),
        })
        if (!loaded.ok) continue
        const membership = evaluateProjection(
          graph,
          loaded.projection,
          compilation.profileContext,
        )
        for (const subject of membership.subjects) {
          covered.add(subject.id)
        }
      }
      const uncovered = changedIds.filter((id) => !covered.has(id))
      const coverage = {
        projections: workspace.projections.length,
        uncovered,
      }

      const { result: evaluated, neighbourhood } = sliceProjection(
        graph,
        seeds,
        `Review slice ${changed}`,
        compilation.profileContext,
        neighbours ?? defaultNeighbourCap,
      )
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'slice',
        addressing: 'changed',
        seeds,
        changed: derived.changed,
        coverage,
        ...(neighbourhood === undefined ? {} : { neighbourhood }),
        result: evaluated,
      }
      if (changedIds.length === 0) {
        return emit(
          result,
          `No model subjects changed in ${changed}.\n`,
        )
      }
      const rendered =
        budget === undefined
          ? renderBrief(evaluated, compilation.profileContext, undefined, compilation.graph.claims)
          : renderBudgetedContext(evaluated, budget)
      const lines = [
        `Review slice ${changed} — ${plural(derived.changed.concepts.length, 'concept')}, ` +
          `${plural(derived.changed.relationships.length, 'relationship')} changed (workspace ${workspace.id})`,
        '',
        rendered.trimEnd(),
        ...(neighbourhood === undefined
          ? []
          : ['', neighbourhoodLine(neighbourhood)]),
        '',
        uncovered.length === 0
          ? `Review coverage: every changed subject appears in at least one of the ${coverage.projections} authored projections.`
          : `Review coverage: ${uncovered.length} of ${changedIds.length} changed subjects appear in no authored projection:` +
            `\n${uncovered.map((id) => `  ${id}`).join('\n')}`,
      ]
      return emit(result, `${lines.join('\n')}\n`)
    }

    // Slice and advice both start from seeds. A single query term that
    // names a projection file is precise addressing; anything else runs
    // through free-text seeding, where exact subject ids win.
    const soleTerm = query.length === 1 ? query[0] : undefined
    const projectionCandidate =
      soleTerm !== undefined &&
      !advise &&
      !where &&
      existsSync(resolve(cwd, soleTerm))
        ? resolve(cwd, soleTerm)
        : undefined
    if (
      projectionCandidate !== undefined &&
      parseDocument(readFileSync(projectionCandidate, 'utf8')).get(
        'format',
      ) === 'yarramate/projection/v1'
    ) {
      // A projection file defines its own query; there is no seeded
      // expansion to cap, so an explicit --neighbours is a contradiction
      // rather than something to ignore silently.
      if (neighbours !== undefined) {
        return {
          exitCode: 2,
          stdout: '',
          stderr:
            `--neighbours applies to seeded slices; ${soleTerm} is a ` +
            'projection that defines its own query\n',
        }
      }
      const loaded = loadProjection({
        path: soleTerm!,
        source: readFileSync(projectionCandidate, 'utf8'),
      })
      if (!loaded.ok) return failed(loaded.diagnostics)
      const evaluated = evaluateProjection(
        graph,
        loaded.projection,
        compilation.profileContext,
      )
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'slice',
        addressing: 'projection',
        result: evaluated,
      }
      return emit(
        result,
        budget === undefined
          ? renderBrief(evaluated, compilation.profileContext, undefined, compilation.graph.claims)
          : renderBudgetedContext(evaluated, budget),
      )
    }

    const topic = query.join(' ')
    const resolution = resolveSeeds(query, entries)
    if (resolution.seeds.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          `No concepts match "${topic}" ` +
          `(searched ${plural(entries.length, 'concept')} by id, name, and description). ` +
          `List the roster: yarramate ask ${workspacePath} --subjects\n`,
      }
    }
    // --where: evidence-backed pointing (ADR 0068). Verified locations for
    // the matched subjects, an explicit list of matched-but-unobserved
    // subjects, and a hand-off note for everything outside the model —
    // authority follows epistemic status, so the routing is stated in the
    // output rather than assumed by the reader.
    if (where) {
      const evidenceDocuments: EvidenceDocument[] = []
      for (const path of workspace.evidence) {
        const loaded = loadEvidence({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        if (!loaded.ok) return failed(loaded.diagnostics)
        evidenceDocuments.push(loaded.evidence)
      }
      const subjectOf = (observation: EvidenceObservation): string =>
        'subject' in observation
          ? observation.subject
          : (observation.claim.split('~')[0] ?? observation.claim)
      // Subject- and claim-level observations often share a locator; the
      // pointer is the same either way, so identical entries collapse.
      const entriesBySeed = resolution.seeds.map((seed) => ({
        subject: seed,
        observations: [
          ...new Map(
            evidenceDocuments
              .flatMap((document) =>
                document.observations
                  .filter((observation) => subjectOf(observation) === seed)
                  .map((observation) => ({
                    uri: observation.evidence.uri,
                    result: observation.result,
                    provider: document.provider,
                    ...(observation.evidence.message === undefined
                      ? {}
                      : { message: observation.evidence.message }),
                  })),
              )
              .map(
                (entry) =>
                  [
                    `${entry.uri}\u0000${entry.result}\u0000${entry.provider}\u0000${entry.message ?? ''}`,
                    entry,
                  ] as const,
              ),
          ).values(),
        ].sort(
          (left, right) =>
            left.uri.localeCompare(right.uri) ||
            left.result.localeCompare(right.result),
        ),
      }))
      const located = entriesBySeed.filter(
        ({ observations }) => observations.length > 0,
      )
      const unobserved = entriesBySeed
        .filter(({ observations }) => observations.length === 0)
        .map(({ subject }) => subject)
      const note =
        workspace.evidence.length === 0
          ? 'This workspace declares no evidence overlay, so no location is verified. For code locations, use your search tools; author evidence observations to make locations verifiable.'
          : 'Locations above are verified by evidence overlays. Subjects listed as unobserved are modeled but unlocated. For code outside the model, use your search tools or a code index.'
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'where',
        addressing: resolution.addressing,
        topic,
        seeds: resolution.seeds,
        matched: resolution.matched,
        located,
        coverage: { unobserved, note },
      }
      const lines: string[] = [
        `Where: "${topic}" — ${plural(resolution.matched, 'concept')} matched` +
          (resolution.matched > resolution.seeds.length
            ? `, seeded from the top ${resolution.seeds.length}`
            : '') +
          `: ${resolution.seeds.join(', ')}`,
        '',
      ]
      for (const entry of located) {
        lines.push(`  ${entry.subject}`)
        for (const observation of entry.observations) {
          lines.push(
            `    ${observation.result}  ${observation.uri}  (${observation.provider})`,
          )
          if (observation.message !== undefined) {
            lines.push(`      ${observation.message}`)
          }
        }
      }
      if (located.length === 0) {
        lines.push('  no verified locations')
      }
      if (unobserved.length > 0) {
        lines.push(
          '',
          `  unobserved — modeled, no evidence: ${unobserved.join(', ')}`,
        )
      }
      lines.push('', note)
      return emit(result, `${lines.join('\n')}\n`)
    }

    const { result: evaluated, neighbourhood } = sliceProjection(
      graph,
      resolution.seeds,
      topic,
      compilation.profileContext,
      neighbours ?? defaultNeighbourCap,
    )

    if (!advise) {
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'slice',
        addressing: resolution.addressing,
        topic,
        seeds: resolution.seeds,
        matched: resolution.matched,
        ...(neighbourhood === undefined ? {} : { neighbourhood }),
        result: evaluated,
      }
      const rendered =
        budget === undefined
          ? renderBrief(evaluated, compilation.profileContext, undefined, compilation.graph.claims)
          : renderBudgetedContext(evaluated, budget)
      const header =
        resolution.addressing === 'free-text'
          ? `Slice for "${topic}" — ${plural(resolution.matched, 'concept')} matched` +
            (resolution.matched > resolution.seeds.length
              ? `, seeded from the top ${resolution.seeds.length}`
              : '') +
            `: ${resolution.seeds.join(', ')}\n\n`
          : ''
      return emit(
        result,
        neighbourhood === undefined
          ? `${header}${rendered}`
          : `${header}${rendered.trimEnd()}\n\n${neighbourhoodLine(neighbourhood)}\n`,
      )
    }

    // --advise: the expert composition. The engine assembles ground
    // truth — slice, open questions, drift — and stops; the reading and
    // the advice belong to the LLM on top (ADR 0054).
    const brief = renderBrief(evaluated, compilation.profileContext, budget, compilation.graph.claims)
    const sliceIds = new Set(
      evaluated.subjects
        .filter(({ type }) => type === 'concept')
        .map(({ id }) => id),
    )

    const resolvedCataloguePath =
      cataloguePath === undefined
        ? shippedCataloguePath
        : resolve(cwd, cataloguePath)
    const composed = composeCatalogues(
      catalogueSources(
        {
          path: cataloguePath ?? resolvedCataloguePath,
          source: readFileSync(resolvedCataloguePath, 'utf8'),
        },
        workspace,
        cwd,
      ),
      compilation.profileContext,
    )
    if (!composed.ok) return failed(composed.diagnostics)
    // Loaded ahead of evaluation so the overlay feeds the one condition
    // that reads it (unchallenged-evidence), then reused for the
    // reconciliation summary below.
    const evidenceDocuments: EvidenceDocument[] = []
    for (const path of workspace.evidence) {
      const loaded = loadEvidence({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })
      if (!loaded.ok) return failed(loaded.diagnostics)
      evidenceDocuments.push(loaded.evidence)
    }
    const report = evaluateCatalogue(
      composed.composed.catalogue,
      graph,
      compilation.profileContext,
      evidenceDocuments.flatMap(({ observations }) => observations),
      composed.composed.catalogues,
    )
    const openQuestions: OpenQuestionRef[] = []
    for (const wave of report.waves) {
      for (const question of wave.questions) {
        if (!question.open) continue
        if (question.subjects === undefined) {
          openQuestions.push({
            wave: wave.id,
            id: question.id,
            authority: question.authority,
            question: question.question,
            materiality: question.materiality,
          })
          continue
        }
        for (const subject of question.subjects) {
          if (!sliceIds.has(subject.id)) continue
          openQuestions.push({
            wave: wave.id,
            id: question.id,
            authority: question.authority,
            question: subject.question,
            materiality: question.materiality,
            subject: subject.id,
          })
        }
      }
    }

    let reconciliation:
      | {
          readonly summary: ReconciliationReport['summary']
          readonly findings: readonly ReconciliationFinding[]
        }
      | undefined
    if (workspace.evidence.length > 0) {
      const evaluation = evaluateEvidenceWorkspace(graph, evidenceDocuments)
      if (!evaluation.ok) return failed(evaluation.diagnostics)
      const reconciled = reconcileEvidenceReports(
        workspace.id,
        evaluation.reports,
        graph,
      )
      reconciliation = {
        summary: reconciled.summary,
        findings: reconciled.findings.filter((finding) => {
          if (sliceIds.has(finding.target.id)) return true
          const asserted =
            'asserted' in finding ? finding.asserted : undefined
          return (
            asserted !== undefined &&
            (sliceIds.has(asserted.from) || sliceIds.has(asserted.to))
          )
        }),
      }
    }

    const result: AskResult = {
      format: 'yarramate/ask-result/v1',
      workspace: workspace.id,
      mode: 'advice',
      topic,
      seeds: resolution.seeds,
      matched: resolution.matched,
      slice: brief,
      ...(neighbourhood === undefined ? {} : { neighbourhood }),
      openQuestions,
      ...(reconciliation === undefined ? {} : { reconciliation }),
    }

    const lines: string[] = [
      `Advise on: ${topic} — workspace ${workspace.id}`,
      'The engine composed the ground truth below from the model; the reading and the advice are yours.',
      '',
      '== Model slice ==',
      '',
      brief.trimEnd(),
      ...(neighbourhood === undefined
        ? []
        : ['', neighbourhoodLine(neighbourhood)]),
      '',
      '== Open questions touching this slice ==',
    ]
    if (openQuestions.length === 0) {
      lines.push('  none — the catalogue is satisfied here')
    } else {
      for (const question of openQuestions) {
        lines.push(
          `  [${question.wave} · ${question.id}] ${question.question}`,
          `    why: ${question.materiality}`,
        )
      }
    }
    lines.push('', '== Evidence drift ==')
    if (reconciliation === undefined) {
      lines.push('  no evidence declared in this workspace')
    } else {
      lines.push(`  ${reconciliationLine(reconciliation.summary)}`)
      if (reconciliation.findings.length === 0) {
        lines.push('  no findings touch this slice')
      } else {
        for (const finding of reconciliation.findings) {
          lines.push(
            `  ${finding.target.id}: ${finding.result} (${finding.provider})`,
          )
        }
      }
    }
    return emit(result, `${lines.join('\n')}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
