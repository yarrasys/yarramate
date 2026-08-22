import Ajv2020Module from 'ajv/dist/2020.js'
import {
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
import { nearDuplicateIndex } from './subject-identity.js'
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
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | { readonly condition: 'isolated' }
  | {
      readonly condition: 'no-subject-of-kind'
      readonly kinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | { readonly condition: 'no-state-defined' }
  | {
      readonly condition: 'missing-linkage'
      readonly kinds: readonly string[]
      readonly direction: 'incoming' | 'outgoing'
      readonly counterpartKinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | {
      readonly condition: 'has-linkage'
      readonly kinds: readonly string[]
      readonly direction: 'incoming' | 'outgoing' | 'either'
      readonly counterpartKinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | {
      readonly condition: 'exists-linkage'
      readonly kinds: readonly string[]
      readonly direction: 'incoming' | 'outgoing' | 'either'
      readonly counterpartKinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | {
      readonly condition: 'missing-constraint'
      readonly kinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | { readonly condition: 'missing-flow-content' }
  | {
      readonly condition: 'missing-reference'
      readonly predicate: string
      readonly direction: 'incoming' | 'outgoing'
    }
  | { readonly condition: 'missing-attestation'; readonly topic: string }
  | { readonly condition: 'near-duplicate' }
  | { readonly condition: 'unconstrained-kind' }

export interface CatalogueQuestion {
  readonly id: string
  readonly wave: string
  readonly scope: 'workspace' | 'subject'
  readonly subjects?: CatalogueSelector
  readonly trigger: readonly CatalogueCondition[]
  readonly question: string
  readonly askPlain?: string
  readonly materiality: string
  readonly resolution: string
  readonly authority: 'human' | 'agent' | 'either'
  readonly since?: string
}

export interface QuestionCatalogue {
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
  readonly since?: string
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
  // Memoized: pairwise identity comparison costs nothing for a catalogue
  // that never asks about it, so it is only paid on first use.
  readonly nearDuplicates: () => ReadonlyMap<string, readonly string[]>
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
  const claimsBySubject = new Map<string, GraphClaim[]>()
  const kindOf = new Map<string, string>()
  const nameOf = new Map<string, string>()
  const statusOf = new Map<string, string>()
  const relationshipClaims: GraphClaim[] = []
  const referenceClaims: GraphClaim[] = []
  const aliasesOf = new Map<string, string[]>()
  const ownerOf = new Map<string, string>()
  const distinctFromOf = new Map<string, Set<string>>()
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
    if ('ref' in claim.object) {
      if (claim.predicate === 'yarramate/ownership/owner') {
        ownerOf.set(claim.subject, claim.object.ref)
      } else if (claim.predicate === 'yarramate/identity/distinct-from') {
        const existing = distinctFromOf.get(claim.subject)
        if (existing === undefined) {
          distinctFromOf.set(claim.subject, new Set([claim.object.ref]))
        } else {
          existing.add(claim.object.ref)
        }
      }
    }
    if ('value' in claim.object) {
      if (claim.predicate === 'yarramate/concept/kind') {
        kindOf.set(claim.subject, claim.object.value)
      } else if (claim.predicate === 'yarramate/concept/name') {
        nameOf.set(claim.subject, claim.object.value)
      } else if (claim.predicate === 'yarramate/lifecycle/status') {
        statusOf.set(claim.subject, claim.object.value)
      } else if (claim.predicate === 'yarramate/concept/alias') {
        const existing = aliasesOf.get(claim.subject)
        if (existing === undefined) aliasesOf.set(claim.subject, [claim.object.value])
        else existing.push(claim.object.value)
      }
    }
  }
  // Architecture states carry concept subjects in the graph but are not
  // enrichment targets; the catalogue interrogates the model, not the
  // planning overlay. Retired concepts are excluded for the same reason
  // (ADR 0064): retirement is the recorded decision that a subject left
  // the design conversation, so no question stays open against it.
  const concepts = new Set(
    graph.subjects
      .filter(
        ({ id, type }) =>
          type === 'concept' &&
          !stateSubjects.has(id) &&
          statusOf.get(id) !== 'retired',
      )
      .map(({ id }) => id),
  )
  let pairs: ReadonlyMap<string, readonly string[]> | undefined
  const nearDuplicates = (): ReadonlyMap<string, readonly string[]> => {
    if (pairs !== undefined) return pairs
    const neighboursOf = new Map<string, Set<string>>()
    const link = (from: string, to: string) => {
      const existing = neighboursOf.get(from)
      if (existing === undefined) neighboursOf.set(from, new Set([to]))
      else existing.add(to)
    }
    for (const claim of relationshipClaims) {
      if (!('ref' in claim.object)) continue
      link(claim.subject, claim.object.ref)
      link(claim.object.ref, claim.subject)
    }
    pairs = nearDuplicateIndex(
      [...concepts].map((id) => {
        const owner = ownerOf.get(id)
        return {
          id,
          kind: kindOf.get(id) ?? 'unknown',
          // The local id is a label in its own right: an agent that named a
          // subject `order-gateway` and gave it the display name "Gateway"
          // still declared "order gateway" about it.
          labels: [
            id.slice(id.indexOf('#') + 1),
            ...(nameOf.get(id) === undefined ? [] : [nameOf.get(id)!]),
            ...(aliasesOf.get(id) ?? []),
          ],
          ...(owner === undefined ? {} : { owner }),
          neighbours: neighboursOf.get(id) ?? new Set<string>(),
          distinctFrom: distinctFromOf.get(id) ?? new Set<string>(),
        }
      }),
    )
    return pairs
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
    nearDuplicates,
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

const relationshipKindMatches = (
  predicate: string,
  selectedKinds: readonly string[],
  matching: 'exact' | 'descendants',
  profileContext: ResolvedProfileContext | undefined,
): boolean =>
  selectedKinds.some(
    (selected) =>
      selected === predicate ||
      (matching === 'descendants' &&
        profileContext?.relationshipKindLineages
          .get(predicate)
          ?.includes(selected) === true),
  )

const profileIdentityOfKind = (qualifiedKind: string): string => {
  const separator = qualifiedKind.indexOf('#')
  return separator === -1 ? qualifiedKind : qualifiedKind.slice(0, separator)
}

const namedKinds = (question: CatalogueQuestion): readonly string[] => {
  const kinds = [...(question.subjects?.kinds ?? [])]
  for (const condition of question.trigger) {
    switch (condition.condition) {
      case 'missing-relationship':
      case 'no-subject-of-kind':
      case 'missing-constraint':
        kinds.push(...condition.kinds)
        break
      case 'missing-linkage':
      case 'has-linkage':
      case 'exists-linkage':
        kinds.push(...condition.kinds, ...condition.counterpartKinds)
        break
      default:
        break
    }
  }
  return kinds
}

const questionIsApplicable = (
  question: CatalogueQuestion,
  selectedProfiles: readonly string[],
): boolean => {
  const selected = new Set(selectedProfiles)
  return namedKinds(question).every((kind) =>
    selected.has(profileIdentityOfKind(kind)),
  )
}

type LinkageShape = {
  readonly kinds: readonly string[]
  readonly direction: 'incoming' | 'outgoing' | 'either'
  readonly counterpartKinds: readonly string[]
  readonly kindMatching?: 'exact' | 'descendants'
}

const linkageHits = (
  index: GraphIndex,
  condition: LinkageShape,
  subjectId: string,
  profileContext: ResolvedProfileContext | undefined,
): boolean => {
  const matching = condition.kindMatching ?? 'descendants'
  return index.relationshipClaims.some((claim) => {
    if (!('ref' in claim.object)) return false
    if (
      !relationshipKindMatches(
        claim.predicate,
        condition.kinds,
        matching,
        profileContext,
      )
    ) {
      return false
    }
    const counterparts: string[] = []
    if (
      (condition.direction === 'outgoing' || condition.direction === 'either') &&
      claim.subject === subjectId
    ) {
      counterparts.push(claim.object.ref)
    }
    if (
      (condition.direction === 'incoming' || condition.direction === 'either') &&
      claim.object.ref === subjectId
    ) {
      counterparts.push(claim.subject)
    }
    return counterparts.some((counterpart) =>
      kindMatches(
        index.kindOf.get(counterpart),
        condition.counterpartKinds,
        matching,
        profileContext,
      ),
    )
  })
}

const conditionHolds = (
  index: GraphIndex,
  condition: CatalogueCondition,
  subjectId: string | undefined,
  profileContext: ResolvedProfileContext | undefined,
): boolean => {
  switch (condition.condition) {
    case 'missing-claim':
      return !(index.claimsBySubject.get(subjectId!) ?? []).some(
        ({ predicate }) => predicate === condition.predicate,
      )
    case 'missing-relationship': {
      // Relationship kinds resolve through profile lineage by default, the
      // same rule as selectors: a catalogue written against core kinds must
      // see a profile-derived kind such as implements (realization child).
      const matching = condition.kindMatching ?? 'descendants'
      const touching = index.relationshipClaims.filter(({ predicate }) =>
        relationshipKindMatches(
          predicate,
          condition.kinds,
          matching,
          profileContext,
        ),
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
    case 'no-subject-of-kind': {
      const matching = condition.kindMatching ?? 'descendants'
      return ![...index.concepts].some((id) =>
        kindMatches(
          index.kindOf.get(id),
          condition.kinds,
          matching,
          profileContext,
        ),
      )
    }
    case 'no-state-defined':
      return !index.hasStates
    case 'missing-linkage':
      // The linkage-depth primitive: the subject lacks a relationship of
      // these kinds, in this direction, whose counterpart is of one of
      // these kinds. Both relationship and counterpart kinds resolve
      // through profile lineage by default, matching the selector rule.
      return !linkageHits(
        index,
        condition,
        subjectId!,
        profileContext,
      )
    case 'has-linkage':
      return (
        subjectId !== undefined &&
        linkageHits(index, condition, subjectId, profileContext)
      )
    case 'exists-linkage':
      return [...index.concepts].some((id) =>
        linkageHits(index, condition, id, profileContext),
      )
    case 'missing-constraint': {
      const matching = condition.kindMatching ?? 'descendants'
      return !(index.claimsBySubject.get(subjectId!) ?? []).some(
        (claim) =>
          claim.predicate === 'yarramate/constraint/requires' &&
          'ref' in claim.object &&
          kindMatches(
            index.kindOf.get(claim.object.ref),
            condition.kinds,
            matching,
            profileContext,
          ),
      )
    }
    case 'missing-flow-content': {
      if (subjectId === undefined) return false
      const matching = 'descendants' as const
      return index.relationshipClaims.some((claim) => {
        if (!('ref' in claim.object)) return false
        if (
          !relationshipKindMatches(
            claim.predicate,
            ['yarramate/core@0.1#flow'],
            matching,
            profileContext,
          )
        ) {
          return false
        }
        if (claim.subject !== subjectId && claim.object.ref !== subjectId) {
          return false
        }
        return !(index.claimsBySubject.get(claim.id) ?? []).some(
          ({ predicate, object }) =>
            predicate === 'yarramate/flow/content' && 'value' in object,
        )
      })
    }
    case 'missing-reference':
      return !index.referenceClaims.some(
        (claim) =>
          claim.predicate === condition.predicate &&
          'ref' in claim.object &&
          (condition.direction === 'outgoing'
            ? claim.subject === subjectId
            : claim.object.ref === subjectId),
      )
    case 'missing-attestation':
      return !(index.claimsBySubject.get(subjectId!) ?? []).some(
        ({ predicate }) =>
          predicate === `yarramate/attestation/${condition.topic}`,
      )
    case 'near-duplicate':
      // A recorded distinctness judgment removes the pair upstream, in the
      // index, so this reads exactly like every other condition: the claim's
      // existence is the whole signal (ADR 0056).
      return (index.nearDuplicates().get(subjectId!) ?? []).length > 0
    case 'unconstrained-kind': {
      // A kind is a label when nothing in the model could tell it apart from
      // a kind of another aspect: every relationship the subject has would
      // still be permitted by the ArchiMate relationship table with the
      // subject reclassified. Two exclusions keep this the question ADR 0083
      // meant rather than a hum. Same-aspect siblings are not compared: node
      // and device share most of a row, and a question that fires on that
      // gap is the one ADR 0083 declined to ship. Composite kinds are not
      // offered as alternatives: a grouping, location, or junction carries a
      // row broad enough to stand in for almost anything, and none of them
      // is a classification a subject could honestly be moved to. A subject
      // with no relationships at all is untested by definition. Without a
      // profile context the table is unknown, not absent, so the condition
      // reports nothing rather than inventing a finding.
      if (profileContext === undefined) return false
      const subjectKind = index.kindOf.get(subjectId!)
      if (subjectKind === undefined) return false
      const subjectAspect = profileContext.conceptKindAspects.get(subjectKind)
      if (subjectAspect === undefined) return false
      const touching: {
        readonly claim: GraphClaim
        readonly end: 'source' | 'target'
        readonly counterpart: string
      }[] = []
      for (const claim of index.relationshipClaims) {
        if (!('ref' in claim.object)) continue
        if (claim.subject === subjectId) {
          touching.push({ claim, end: 'source', counterpart: claim.object.ref })
        } else if (claim.object.ref === subjectId) {
          touching.push({ claim, end: 'target', counterpart: claim.subject })
        }
      }
      if (touching.length === 0) return true
      const alternatives = [...profileContext.conceptKindCoreAncestors.keys()]
        .filter((identity) => identity.startsWith('yarramate/core@'))
        .map((identity) => ({
          identity,
          aspect: profileContext.conceptKindAspects.get(identity),
        }))
        .filter(
          ({ aspect }) =>
            aspect !== undefined &&
            aspect !== subjectAspect &&
            aspect !== 'composite',
        )
      return alternatives.some(({ identity, aspect }) =>
        touching.every(({ claim, end, counterpart }) => {
          const relationshipKind =
            profileContext.relationshipKindCoreAncestors.get(claim.predicate)
          const counterpartKind = index.kindOf.get(counterpart)
          if (relationshipKind === undefined || counterpartKind === undefined) {
            return false
          }
          const permitted =
            end === 'source'
              ? profileContext.permittedRelationshipKinds(identity, counterpartKind)
              : profileContext.permittedRelationshipKinds(counterpartKind, identity)
          if (permitted === undefined || !permitted.has(relationshipKind)) {
            return false
          }
          // An extension relationship kind may narrow by aspect beyond the
          // table; the alternative has to clear that narrowing as well.
          const narrowing = profileContext.relationshipKindEndpointAspects.get(
            claim.predicate,
          )
          const allowed = end === 'source' ? narrowing?.source : narrowing?.target
          return allowed === undefined || allowed.some((entry) => entry === aspect)
        }),
      )
    }
  }
}

// Shared with design: question templates (standard and askPlain alike)
// interpolate the same subject placeholders.
//
// `{counterparts}` is the one placeholder that names other subjects. A
// finding still references exactly one subject, because openSubject is a
// closed shape shared by three report contracts and widening all of them
// for one question would be disproportionate. Naming the counterpart by
// qualified id inside the rendered question keeps the answer actionable
// anyway: that id is literally the value the answer writes back into
// distinctFrom.
export const renderQuestion = (
  template: string,
  subjectId: string,
  subjectName: string | undefined,
  counterparts?: readonly string[],
): string =>
  template
    .trim()
    .replaceAll('{subject.name}', subjectName ?? subjectId)
    .replaceAll('{subject.id}', subjectId)
    .replaceAll('{counterparts}', (counterparts ?? []).join(', '))

// Only the pairwise condition has counterparts to name, so nothing is
// computed for the other thirty-eight questions.
const describeCounterparts = (
  index: GraphIndex,
  question: CatalogueQuestion,
  subjectId: string,
): readonly string[] | undefined => {
  if (
    !question.trigger.some(({ condition }) => condition === 'near-duplicate')
  ) {
    return undefined
  }
  return (index.nearDuplicates().get(subjectId) ?? []).map((id) => {
    const name = index.nameOf.get(id)
    return name === undefined ? id : `${name} (${id})`
  })
}

export function evaluateCatalogue(
  catalogue: QuestionCatalogue,
  graph: SemanticGraph,
  profileContext?: ResolvedProfileContext,
): Omit<InterrogationReport, 'workspace'> {
  const index = indexGraph(graph)
  let open = 0
  let openQuestions = 0
  const applicableQuestions = catalogue.questions.filter((question) =>
    questionIsApplicable(question, graph.profiles),
  )
  const waves = catalogue.waves.map((wave) => ({
    id: wave.id,
    name: wave.name,
    questions: applicableQuestions
      .filter((question) => question.wave === wave.id)
      .map((question): ReportQuestion => {
        const base = {
          id: question.id,
          scope: question.scope,
          authority: question.authority,
          question: question.question.trim(),
          materiality: question.materiality.trim(),
          resolution: question.resolution.trim(),
          ...(question.since === undefined ? {} : { since: question.since }),
        }
        if (question.scope === 'workspace') {
          const isOpen = question.trigger.every((condition) =>
            conditionHolds(index, condition, undefined, profileContext),
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
            conditionHolds(index, condition, id, profileContext),
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
              question: renderQuestion(
                question.question,
                id,
                name,
                describeCounterparts(index, question, id),
              ),
            }
          }),
        }
      }),
  }))
  return {
    format: 'yarramate/interrogation-report/v1',
    catalogue: `${catalogue.id}@${catalogue.version}`,
    summary: {
      questions: applicableQuestions.length,
      openQuestions,
      open,
    },
    waves,
  }
}

export type CatalogueLoadResult =
  | { readonly ok: true; readonly catalogue: QuestionCatalogue }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

// Shared by interrogate and design: schema validation plus the YM911
// undeclared-wave check, both source-located against the catalogue file.
export function loadQuestionCatalogue(
  catalogueSource: WorkspaceSource,
): CatalogueLoadResult {
  const loadedCatalogue = loadSourceDocument<QuestionCatalogue>(
    catalogueSource,
    validateCatalogue,
    'Question catalogue',
  )
  if (!loadedCatalogue.ok) {
    return { ok: false, diagnostics: loadedCatalogue.diagnostics }
  }
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
  if (waveDiagnostics.length > 0) {
    return { ok: false, diagnostics: waveDiagnostics }
  }
  return { ok: true, catalogue }
}

// Shared by interrogate and `ask --open`: the wave-by-wave human report.
export function renderInterrogationReport(
  report: InterrogationReport,
): string {
  const lines: string[] = [
    `Catalogue ${report.catalogue} on workspace ${report.workspace}: ` +
      `${report.summary.open} open ` +
      `(${report.summary.openQuestions} of ${report.summary.questions} questions)`,
  ]
  for (const wave of report.waves) {
    lines.push('', `== ${wave.name} ==`)
    for (const question of wave.questions) {
      if (!question.open) {
        lines.push(`  closed ${question.id}`)
        continue
      }
      const sinceMarker =
        question.since === undefined ? '' : ` [since ${question.since}]`
      if (question.subjects === undefined) {
        lines.push(
          `  OPEN   ${question.id}${sinceMarker} — ${question.question}`,
        )
        lines.push(`         why: ${question.materiality}`)
        continue
      }
      lines.push(
        `  OPEN   ${question.id}${sinceMarker} (${question.subjects.length} ${question.subjects.length === 1 ? 'subject' : 'subjects'})`,
      )
      for (const subject of question.subjects) {
        lines.push(
          `         ask: "${subject.question}" [authority: ${question.authority}]`,
        )
      }
    }
  }
  return `${lines.join('\n')}\n`
}

