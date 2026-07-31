import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import Ajv2020Module from 'ajv/dist/2020.js'
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
  type ResolvedProfileContext,
  type SemanticGraph,
  type WorkspaceSource,
} from './compiler.js'
import {
  loadSourceDocument,
  locateSourcePath,
} from './source-document.js'
import { loadWorkspaceManifest } from './workspace.js'
import catalogueSchema from '../schema/yarramate-question-catalogue.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateCatalogue = new Ajv2020({ allErrors: true }).compile(
  catalogueSchema,
)

interface CatalogueSelector {
  readonly kinds: readonly string[]
  readonly kindMatching?: 'exact' | 'descendants'
  readonly statuses?: readonly string[]
  readonly documents?: readonly string[]
}

type CatalogueCondition =
  | { readonly condition: 'missing-claim'; readonly predicate: string }
  | {
      readonly condition: 'missing-relationship'
      readonly kinds: readonly string[]
      readonly direction: 'incoming' | 'outgoing' | 'any'
    }
  | { readonly condition: 'isolated' }
  | {
      readonly condition: 'no-subject-of-kind'
      readonly kinds: readonly string[]
    }
  | { readonly condition: 'no-state-defined' }

interface CatalogueQuestion {
  readonly id: string
  readonly wave: string
  readonly scope: 'workspace' | 'subject'
  readonly subjects?: CatalogueSelector
  readonly trigger: readonly CatalogueCondition[]
  readonly question: string
  readonly materiality: string
  readonly resolution: string
  readonly authority: 'human' | 'agent' | 'either'
}

interface QuestionCatalogue {
  readonly format: 'yarramate/question-catalogue/v1'
  readonly id: string
  readonly version: string
  readonly profile: string
  readonly presentation?: {
    readonly title?: string
    readonly description?: string
  }
  readonly waves: readonly {
    readonly id: string
    readonly name: string
    readonly description?: string
  }[]
  readonly questions: readonly CatalogueQuestion[]
}

interface OpenSubject {
  readonly id: string
  readonly name?: string
  readonly question: string
}

interface ReportQuestion {
  readonly id: string
  readonly scope: 'workspace' | 'subject'
  readonly authority: 'human' | 'agent' | 'either'
  readonly open: boolean
  readonly question: string
  readonly materiality: string
  readonly resolution: string
  readonly subjects?: readonly OpenSubject[]
}

export interface InterrogationReport {
  readonly format: 'yarramate/interrogation-report/v1'
  readonly workspace: string
  readonly catalogue: string
  readonly summary: {
    readonly questions: number
    readonly openQuestions: number
    readonly open: number
  }
  readonly waves: readonly {
    readonly id: string
    readonly name: string
    readonly questions: readonly ReportQuestion[]
  }[]
}

interface GraphIndex {
  readonly concepts: ReadonlySet<string>
  readonly claimsBySubject: ReadonlyMap<string, readonly GraphClaim[]>
  readonly relationshipClaims: readonly GraphClaim[]
  readonly referenceClaims: readonly GraphClaim[]
  readonly kindOf: ReadonlyMap<string, string>
  readonly nameOf: ReadonlyMap<string, string>
  readonly statusOf: ReadonlyMap<string, string>
  readonly hasStates: boolean
}

const indexGraph = (graph: SemanticGraph): GraphIndex => {
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const stateSubjects = new Set(
    graph.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  // Architecture states carry concept subjects in the graph but are not
  // enrichment targets; the catalogue interrogates the model, not the
  // planning overlay.
  const concepts = new Set(
    graph.subjects
      .filter(
        ({ id, type }) => type === 'concept' && !stateSubjects.has(id),
      )
      .map(({ id }) => id),
  )
  const claimsBySubject = new Map<string, GraphClaim[]>()
  const kindOf = new Map<string, string>()
  const nameOf = new Map<string, string>()
  const statusOf = new Map<string, string>()
  const relationshipClaims: GraphClaim[] = []
  const referenceClaims: GraphClaim[] = []
  for (const claim of graph.claims) {
    const forSubject = claimsBySubject.get(claim.subject)
    if (forSubject === undefined) {
      claimsBySubject.set(claim.subject, [claim])
    } else {
      forSubject.push(claim)
    }
    if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
      relationshipClaims.push(claim)
    } else if ('ref' in claim.object) {
      referenceClaims.push(claim)
    }
    if ('value' in claim.object) {
      if (claim.predicate === 'yarramate/concept/kind') {
        kindOf.set(claim.subject, claim.object.value)
      } else if (claim.predicate === 'yarramate/concept/name') {
        nameOf.set(claim.subject, claim.object.value)
      } else if (claim.predicate === 'yarramate/lifecycle/status') {
        statusOf.set(claim.subject, claim.object.value)
      }
    }
  }
  return {
    concepts,
    claimsBySubject,
    relationshipClaims,
    referenceClaims,
    kindOf,
    nameOf,
    statusOf,
    hasStates: stateSubjects.size > 0,
  }
}

const kindMatches = (
  subjectKind: string | undefined,
  selectedKinds: readonly string[],
  matching: 'exact' | 'descendants',
  profileContext: ResolvedProfileContext | undefined,
): boolean => {
  if (subjectKind === undefined) return false
  return selectedKinds.some(
    (selected) =>
      selected === subjectKind ||
      (matching === 'descendants' &&
        profileContext?.conceptKindLineages
          .get(subjectKind)
          ?.includes(selected) === true),
  )
}

const selectSubjects = (
  index: GraphIndex,
  selector: CatalogueSelector,
  profileContext: ResolvedProfileContext | undefined,
): readonly string[] => {
  // The schema's declared default for kindMatching is descendants, so a
  // profile-derived kind satisfies a catalogue written against its parent.
  const matching = selector.kindMatching ?? 'descendants'
  let ids = [...index.concepts].filter((id) =>
    kindMatches(index.kindOf.get(id), selector.kinds, matching, profileContext),
  )
  if (selector.statuses !== undefined) {
    const statuses = new Set(selector.statuses)
    ids = ids.filter((id) => {
      const status = index.statusOf.get(id)
      return status !== undefined && statuses.has(status)
    })
  }
  if (selector.documents !== undefined) {
    const documents = new Set(selector.documents)
    ids = ids.filter((id) => documents.has(id.slice(0, id.indexOf('#'))))
  }
  return ids.sort((left, right) => left.localeCompare(right))
}

const conditionHolds = (
  index: GraphIndex,
  condition: CatalogueCondition,
  subjectId: string | undefined,
): boolean => {
  switch (condition.condition) {
    case 'missing-claim':
      return !(index.claimsBySubject.get(subjectId!) ?? []).some(
        ({ predicate }) => predicate === condition.predicate,
      )
    case 'missing-relationship': {
      const kinds = new Set(condition.kinds)
      const touching = index.relationshipClaims.filter(({ predicate }) =>
        kinds.has(predicate),
      )
      const outgoing = touching.some(({ subject }) => subject === subjectId)
      const incoming = touching.some(
        ({ object }) => 'ref' in object && object.ref === subjectId,
      )
      if (condition.direction === 'outgoing') return !outgoing
      if (condition.direction === 'incoming') return !incoming
      return !outgoing && !incoming
    }
    case 'isolated':
      // Participation includes reference-bearing claims (ownership,
      // constraints, identified references), not only relationships.
      return (
        !index.relationshipClaims.some(
          ({ subject, object }) =>
            subject === subjectId ||
            ('ref' in object && object.ref === subjectId),
        ) &&
        !index.referenceClaims.some(
          ({ object }) => 'ref' in object && object.ref === subjectId,
        )
      )
    case 'no-subject-of-kind':
      return ![...index.concepts].some((id) =>
        condition.kinds.includes(index.kindOf.get(id) ?? ''),
      )
    case 'no-state-defined':
      return !index.hasStates
  }
}

const renderQuestion = (
  template: string,
  subjectId: string,
  subjectName: string | undefined,
): string =>
  template
    .trim()
    .replaceAll('{subject.name}', subjectName ?? subjectId)
    .replaceAll('{subject.id}', subjectId)

export function evaluateCatalogue(
  catalogue: QuestionCatalogue,
  graph: SemanticGraph,
  profileContext?: ResolvedProfileContext,
): Omit<InterrogationReport, 'workspace'> {
  const index = indexGraph(graph)
  let open = 0
  let openQuestions = 0
  const waves = catalogue.waves.map((wave) => ({
    id: wave.id,
    name: wave.name,
    questions: catalogue.questions
      .filter((question) => question.wave === wave.id)
      .map((question): ReportQuestion => {
        const base = {
          id: question.id,
          scope: question.scope,
          authority: question.authority,
          question: question.question.trim(),
          materiality: question.materiality.trim(),
          resolution: question.resolution.trim(),
        }
        if (question.scope === 'workspace') {
          const isOpen = question.trigger.every((condition) =>
            conditionHolds(index, condition, undefined),
          )
          if (isOpen) {
            open += 1
            openQuestions += 1
          }
          return { ...base, open: isOpen }
        }
        const matches = selectSubjects(
          index,
          question.subjects!,
          profileContext,
        ).filter((id) =>
          question.trigger.every((condition) =>
            conditionHolds(index, condition, id),
          ),
        )
        if (matches.length === 0) {
          return { ...base, open: false }
        }
        open += matches.length
        openQuestions += 1
        return {
          ...base,
          open: true,
          subjects: matches.map((id) => {
            const name = index.nameOf.get(id)
            return {
              id,
              ...(name === undefined ? {} : { name }),
              question: renderQuestion(question.question, id, name),
            }
          }),
        }
      }),
  }))
  return {
    format: 'yarramate/interrogation-report/v1',
    catalogue: `${catalogue.id}@${catalogue.version}`,
    summary: {
      questions: catalogue.questions.length,
      openQuestions,
      open,
    },
    waves,
  }
}

export function runInterrogateCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const rest = options.filter((option) => option !== '--json')
  const [cataloguePath, workspacePath] = rest
  if (
    rest.length !== 2 ||
    cataloguePath === undefined ||
    workspacePath === undefined ||
    rest.some((option) => option.startsWith('-'))
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
          'interrogate requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: json
        ? diagnosticJson(diagnostics)
        : humanDiagnostics(diagnostics),
      stderr: '',
    })
    const catalogueSource: WorkspaceSource = {
      path: cataloguePath,
      source: readFileSync(resolve(cwd, cataloguePath), 'utf8'),
    }
    const loadedCatalogue = loadSourceDocument<QuestionCatalogue>(
      catalogueSource,
      validateCatalogue,
      'Question catalogue',
    )
    if (!loadedCatalogue.ok) return failed(loadedCatalogue.diagnostics)
    const catalogue = loadedCatalogue.document.value
    const waveIds = new Set(catalogue.waves.map(({ id }) => id))
    const waveDiagnostics = catalogue.questions.flatMap(
      (question, questionIndex): readonly Diagnostic[] =>
        waveIds.has(question.wave)
          ? []
          : [
              {
                severity: 'error',
                code: 'YM911',
                message: `Question "${question.id}" references undeclared wave "${question.wave}"`,
                ...locateSourcePath(
                  catalogueSource.path,
                  loadedCatalogue.document.yaml,
                  loadedCatalogue.document.lineCounter,
                  ['questions', questionIndex, 'wave'],
                  `/questions/${questionIndex}/wave`,
                ),
              },
            ],
    )
    if (waveDiagnostics.length > 0) return failed(waveDiagnostics)

    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace
    const compilation = compileWorkspaceWithProfileContext(
      [...workspace.profiles, ...workspace.documents].map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    if (!compilation.ok) return failed(compilation.diagnostics)

    const report: InterrogationReport = {
      ...evaluateCatalogue(
        catalogue,
        compilation.graph,
        compilation.profileContext,
      ),
      workspace: workspace.id,
    }
    // Keep the declared key order stable for consumers reading the raw JSON.
    const ordered: InterrogationReport = {
      format: report.format,
      workspace: report.workspace,
      catalogue: report.catalogue,
      summary: report.summary,
      waves: report.waves,
    }

    if (json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(ordered, null, 2)}\n`,
        stderr: '',
      }
    }

    const lines: string[] = [
      `Catalogue ${ordered.catalogue} on workspace ${ordered.workspace}: ` +
        `${ordered.summary.open} open ` +
        `(${ordered.summary.openQuestions} of ${ordered.summary.questions} questions)`,
    ]
    for (const wave of ordered.waves) {
      lines.push('', `== ${wave.name} ==`)
      for (const question of wave.questions) {
        if (!question.open) {
          lines.push(`  closed ${question.id}`)
          continue
        }
        if (question.subjects === undefined) {
          lines.push(`  OPEN   ${question.id} — ${question.question}`)
          lines.push(`         why: ${question.materiality}`)
          continue
        }
        lines.push(
          `  OPEN   ${question.id} (${question.subjects.length} ${question.subjects.length === 1 ? 'subject' : 'subjects'})`,
        )
        for (const subject of question.subjects) {
          lines.push(
            `         ask: "${subject.question}" [authority: ${question.authority}]`,
          )
        }
      }
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
