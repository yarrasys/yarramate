import Ajv2020Module from 'ajv/dist/2020.js'
import type {
  Diagnostic,
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
import {
  loadSourceDocument,
  locateSourcePath,
} from './source-document.js'
import { nearDuplicateIndex } from './subject-identity.js'
import {
  sourceKindsPermitting,
  tableKnowsConceptKind,
  tableKnowsRelationshipKind,
  targetKindsPermitting,
  type CoreConceptKindId,
} from './relationship-matrix.js'
import type { RelationshipKind } from './profile.js'
import catalogueSchema from '../schema/yarramate-question-catalogue.schema.json' with {
  type: 'json',
}

// `.default ?? module`, not a bare `.default`: NodeNext sees the raw CJS
// `module.exports` and a bundler the unwrapped class. One shape for all of
// them, so which modules a browser happens to reach is not a thing anyone has
// to keep track of (#252).
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
import { compileValidator } from './schema-validation.js'
const validateCatalogue = compileValidator(catalogueSchema)

/**
 * The version of condition evaluation itself, not of the package.
 *
 * A report says which catalogue asked its questions. It could not say which
 * engine answered them, so a consumer holding stored answers could tell a
 * model change from a catalogue deepening (via `since`) but not from a change
 * in what a condition means. ADR 0097 replaced four aspect rules with the
 * ArchiMate 3.2 table and flipped `missing-relationship` answers for unchanged
 * models and unchanged questions; ADR 0083's `unconstrained-kind` goes
 * near-empty under that same table. Neither was visible in any report.
 *
 * **Bump this when an existing question's answer can change for an unchanged
 * model.** Do not bump it for anything else: not a release, not a new
 * condition, not a catalogue edit, not a rendering change. A version that
 * moves when answers did not is a version consumers learn to ignore.
 *
 * `test/interrogation-semantics.test.ts` fingerprints every condition against
 * a fixture and fails if evaluation moves without this bumping, so the rule is
 * enforced rather than remembered.
 */
export const INTERROGATION_SEMANTICS_VERSION = '1'

export interface CatalogueSelector {
  /**
   * Kinds to select. Absent selects every concept, which is what a
   * kind-agnostic condition wants: succession can be declared on any subject,
   * so enumerating the kinds that may carry it would be a list nobody can keep
   * right rather than a constraint (ADR 0109).
   */
  readonly kinds?: readonly string[]
  readonly kindMatching?: 'exact' | 'descendants'
  readonly statuses?: readonly string[]
  readonly documents?: readonly string[]
}

export type CatalogueCondition =
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
  | {
      /**
       * The positive twin of `no-subject-of-kind`, and workspace-scope like it
       * (#398). A gate wants the opposite polarity from a question: a question
       * exists to be closed by an absence ending, while a gate opens once the
       * thing is there. `opensWhen` requires every condition to hold and has no
       * `not`, so inverting was not available and the phase-ordered interview
       * an adopter was authoring could say "the model still lacks X" but never
       * "the model now has X".
       *
       * ADR 0125 anticipated arrivals in this position: a further condition
       * "can join later without changing the mechanism".
       */
      readonly condition: 'has-subject-of-kind'
      readonly kinds: readonly string[]
      readonly kindMatching?: 'exact' | 'descendants'
    }
  | {
      /**
       * The cardinality member of the same family, workspace-scope like the
       * other two (#411). Fires while FEWER than `atLeast` subjects of the
       * named kinds exist, so `no-subject-of-kind` is its `atLeast: 1` case.
       *
       * It exists because a **vocabulary question** — "which data sensitivity
       * classes does this platform recognise?" — had no way to say it wanted
       * more than one term. `no-subject-of-kind` closes on the first
       * instance, so a one-term vocabulary was indistinguishable from a
       * complete one, and an adopter measured two live cases where a class
       * authored incidentally to answer a different question closed the
       * vocabulary question before it was ever asked.
       *
       * `atLeast` is required and must be at least 2 (`YM918`): 1 is
       * `no-subject-of-kind` spelled a second way, and 0 is a condition that
       * can never fire, which is what `YM914` exists to refuse.
       *
       * Deliberately NOT a general numeric comparison. A kind's population
       * against a floor is the whole need, and the narrow condition is the
       * same trade that kept `has-subject-of-kind` a twin rather than a
       * predicate: a vocabulary of parameterised comparisons is a query
       * language, which this design declines.
       */
      readonly condition: 'below-subject-count'
      readonly kinds: readonly string[]
      readonly atLeast: number
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
      /**
       * The negative twin of `exists-linkage`, workspace-scope like it
       * (#436, ADR 0138). Fires while NO concept in the workspace satisfies
       * the linkage, so a question can ask "nothing anywhere links this way".
       *
       * It exists because a **vocabulary question** was asking the wrong
       * thing. `below-subject-count` measures a population, and a vocabulary
       * question means "did anyone survey this" — a proxy that fails in both
       * directions, measured on a live engagement: two throwaway values close
       * it dishonestly, while a truthful single-value estate can never close
       * it at all.
       *
       * `MODEL-FLOOR.md` prescribes the answer's home: a classification axis
       * is a `grouping` that aggregates its members, so a scheme aggregating
       * its classes IS the statement that these are the classes. Asking "no
       * scheme aggregates any class" needs this condition; asking how many
       * classes exist does not reach it.
       *
       * Deliberately NOT `!exists-linkage` in the evaluator, for the reason
       * `has-subject-of-kind` is not `!no-subject-of-kind`: written as its own
       * check, an empty workspace falls out right rather than by double
       * negative.
       */
      readonly condition: 'no-linkage-exists'
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
  | { readonly condition: 'unscoped-succession' }
  | { readonly condition: 'unchallenged-evidence' }
  | { readonly condition: 'has-any-subject' }
  | {
      /**
       * The subject fills a slot of a pattern instance (ADR 0131). A GUARD,
       * per the #334 split: it says a question applies here, and an
       * ordinary condition beside it says what would answer it. Bare, it
       * means bound into any slot of any instance; `patternKinds` narrows
       * by the pattern's kind identity (never a document path, ADR 0129)
       * and `slots` by part name.
       */
      readonly condition: 'fills-pattern-slot'
      readonly patternKinds?: readonly string[]
      readonly slots?: readonly string[]
    }

/**
 * One observation from the workspace's evidence overlay, reduced to what
 * interrogation reads: the result, and whether a search was recorded with
 * it. The only condition that reads the overlay is `unchallenged-evidence`;
 * every other condition reads the compiled graph alone, and the overlay
 * never influences which subjects a selector matches.
 *
 * Shaped structurally rather than importing {@link EvidenceObservation} so
 * the pure engine entry (`./interrogation-entry`) keeps owning its whole
 * input surface: a caller passes
 * `evidenceDocuments.flatMap(({ observations }) => observations)` and the
 * wider evidence shape is never dragged in.
 */
export interface CatalogueEvidenceObservation {
  readonly result: 'confirmed' | 'contradicted' | 'unknown' | 'not-observed'
  readonly searched?: readonly unknown[]
}

/**
 * One slot of one pattern instance and the subject bound into it, as
 * interrogation reads it. Shaped structurally rather than importing the
 * compiler's {@link PatternMembership} for the same reason
 * {@link CatalogueEvidenceObservation} is: the pure engine entry keeps
 * owning its whole input surface, and a host passes
 * `compilation.patternMemberships` without the compiler's types. Only
 * `fills-pattern-slot` reads it (ADR 0131).
 */
export interface CataloguePatternMembership {
  readonly member: string
  readonly slot: string
  readonly instance: string
  readonly pattern: string
}

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
    /**
     * Conditions that must all hold before this wave opens (#334, ADR 0125).
     * Absent means always open, which is what every wave did before this.
     */
    readonly opensWhen?: readonly CatalogueCondition[]
  }[]
  readonly questions: readonly CatalogueQuestion[]
}

export interface OpenSubject {
  readonly id: string
  readonly name?: string
  readonly question: string
}

export interface ReportQuestion {
  readonly id: string
  readonly scope: 'workspace' | 'subject'
  readonly authority: 'human' | 'agent' | 'either'
  readonly open: boolean
  /**
   * Whether the question was asked at all (#375, ADR 0132). Absent means
   * true; only a subject-scoped question whose selector matched NO subject
   * carries `asked: false`. Without it, never-asked and answered were
   * byte-identical (`open: false`), and a host summing closed questions
   * read an empty model as a satisfied interview — completion inferred
   * from an empty set, the exact reading ADR 0125 refuses one level up by
   * not evaluating a closed wave's questions at all.
   */
  readonly asked?: boolean
  readonly question: string
  readonly materiality: string
  readonly resolution: string
  /**
   * The catalogue trigger, verbatim (#289). The conditions that opened a
   * question are its machine-readable answer shape: a host builds the
   * matching affordance (a prefilled form, an operations skeleton) from
   * them instead of re-deriving the shape from its own catalogue copy and
   * drifting from engine semantics.
   */
  readonly trigger: readonly CatalogueCondition[]
  readonly since?: string
  readonly subjects?: readonly OpenSubject[]
}

export interface ReportWave {
  readonly id: string
  readonly name: string
  /**
   * Whether the wave's gate is met (#334, ADR 0125). A wave with no
   * `opensWhen` is always open.
   *
   * A wave reported `false` carries NO questions and contributes nothing to
   * the summary. Its questions are premature rather than answered, and a
   * progress rail that counted them as answered would flatter itself exactly
   * where someone is most likely to trust it.
   */
  readonly opened: boolean
  readonly questions: readonly ReportQuestion[]
}

export interface InterrogationSummary {
  readonly questions: number
  readonly openQuestions: number
  readonly open: number
}

export interface InterrogationReport {
  readonly format: 'yarramate/interrogation-report/v1'
  readonly workspace: string
  /** The BASE catalogue, `id@version`. Unchanged in shape by composition. */
  readonly catalogue: string
  /**
   * Every contributing catalogue as `id@version`, base first, when more than
   * one contributed (#345, ADR 0129). Optional so that adding it breaks no
   * constructor, and `catalogue` keeps its value shape so it breaks no reader.
   */
  readonly catalogues?: readonly string[]
  /** {@link INTERROGATION_SEMANTICS_VERSION} at the time of evaluation. */
  readonly semantics: string
  readonly summary: InterrogationSummary
  readonly waves: readonly ReportWave[]
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
  let ids =
    selector.kinds === undefined
      ? [...index.concepts]
      : [...index.concepts].filter((id) =>
          kindMatches(
            index.kindOf.get(id),
            selector.kinds!,
            matching,
            profileContext,
          ),
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
      case 'has-subject-of-kind':
      case 'below-subject-count':
      case 'missing-constraint':
        kinds.push(...condition.kinds)
        break
      case 'missing-linkage':
      case 'has-linkage':
      case 'exists-linkage':
      case 'no-linkage-exists':
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

/**
 * What a condition needs in order to mean anything: a subject, or only the
 * workspace (#400).
 *
 * A wave gate evaluates with NO subject, and the catalogue schema offered the
 * whole vocabulary in that position, so a subject-scope condition in
 * `opensWhen` produced a wave that silently never opened (`has-linkage`,
 * `near-duplicate`, `fills-pattern-slot`) or a gate that was silently inert
 * (`missing-linkage`, `isolated`, `missing-claim`, `missing-constraint`) —
 * measured, both halves. Neither was refused. That is the same failure
 * `YM914` already refuses from a different cause: a gate nothing can satisfy
 * is indistinguishable from a gate that is merely unmet.
 *
 * This is a `Record` over the union's discriminant rather than a list of the
 * workspace-scope names, and that is the point. An allowlist cannot fail for
 * the author who wrote it (CONTRIBUTING.md's ninth rule), so a new condition
 * must not be able to arrive and be quietly absent from a gate check. Here it
 * cannot: adding a member to `CatalogueCondition` is a TYPECHECK ERROR until
 * its scope is declared, so the compiler asks the question rather than this
 * table remembering the answer.
 */
const CONDITION_SCOPE: Record<
  CatalogueCondition['condition'],
  'workspace' | 'subject'
> = {
  'has-any-subject': 'workspace',
  'no-subject-of-kind': 'workspace',
  'has-subject-of-kind': 'workspace',
  'below-subject-count': 'workspace',
  'no-state-defined': 'workspace',
  'exists-linkage': 'workspace',
  'no-linkage-exists': 'workspace',
  'missing-claim': 'subject',
  'missing-relationship': 'subject',
  isolated: 'subject',
  'missing-linkage': 'subject',
  'has-linkage': 'subject',
  'missing-constraint': 'subject',
  'missing-flow-content': 'subject',
  'missing-reference': 'subject',
  'missing-attestation': 'subject',
  'near-duplicate': 'subject',
  'unconstrained-kind': 'subject',
  'unscoped-succession': 'subject',
  'unchallenged-evidence': 'workspace',
  'fills-pattern-slot': 'subject',
}

export const conditionScope = (
  condition: CatalogueCondition,
): 'workspace' | 'subject' => CONDITION_SCOPE[condition.condition]

const conditionHolds = (
  index: GraphIndex,
  condition: CatalogueCondition,
  subjectId: string | undefined,
  profileContext: ResolvedProfileContext | undefined,
  evidence: readonly CatalogueEvidenceObservation[] | undefined,
  memberships: readonly CataloguePatternMembership[] | undefined,
): boolean => {
  switch (condition.condition) {
    case 'fills-pattern-slot':
      // Absent memberships stay quiet: the caller did not derive them, so
      // participation is unknown, not absent — the same rule
      // `unchallenged-evidence` applies to a missing overlay and
      // `unconstrained-kind` to a missing profile context (ADR 0131).
      return (
        memberships !== undefined &&
        subjectId !== undefined &&
        memberships.some(
          (membership) =>
            membership.member === subjectId &&
            (condition.patternKinds === undefined ||
              condition.patternKinds.includes(membership.pattern)) &&
            (condition.slots === undefined ||
              condition.slots.includes(membership.slot)),
        )
      )
    case 'has-any-subject':
      // The guard a late wave needs to say "only once the model has
      // substance" (#334). An empty model is not an architecture at rest -
      // ADR 0120's reading, which stays true for a model that HAS started -
      // it has not begun, and asking it how the planned architecture becomes
      // real greets someone ahead of question one.
      return index.concepts.size > 0
    case 'unchallenged-evidence':
      // Fires where the overlay records observations and every one is a
      // frictionless confirmation: no contradicted, unknown, or
      // not-observed result, and no recorded search. A discovery that
      // never records anything but success never tested a claim it might
      // fail — 39 of 39 GitLab observations said confirmed while Praefect
      // sat declared upstream and absent from the tree (#272). A recorded
      // search closes it even on a confirmed result, because a
      // confirmation of a negative claim rests on exactly the empty
      // search ADR 0107 made auditable; so does any honest non-confirmed
      // result. An empty overlay stays quiet: with no observations there
      // is no inspection to interrogate. An absent overlay also stays
      // quiet — the caller did not supply one, so its diversity is
      // unknown, not absent, the same rule `unconstrained-kind` applies
      // to a missing profile context.
      return (
        evidence !== undefined &&
        evidence.length > 0 &&
        evidence.every(
          ({ result, searched }) =>
            result === 'confirmed' &&
            (searched === undefined || searched.length === 0),
        )
      )
    case 'missing-claim':
      return !(index.claimsBySubject.get(subjectId!) ?? []).some(
        ({ predicate }) => predicate === condition.predicate,
      )
    case 'unscoped-succession': {
      // A succession that replaced its predecessor outright says so by the
      // predecessor being gone. One where both subjects are still current is
      // usually partial, and the respect is the part a reader needs: a model
      // claimed Zoekt superseded the Elasticsearch indexer while the source
      // said Zoekt "does not replace" it for any scope but code search
      // (ADR 0109). Fires only where the qualifier is missing AND the
      // predecessor is still current, so a completed replacement stays quiet.
      const claims = index.claimsBySubject.get(subjectId!) ?? []
      return claims.some((claim) => {
        if (claim.predicate !== 'yarramate/lineage/supersedes') return false
        if (!('ref' in claim.object)) return false
        const scoped = claims.some(
          (other) =>
            other.predicate === 'yarramate/lineage/supersedes-respect' &&
            other.id === `${claim.id}~respect`,
        )
        if (scoped) return false
        const predecessorStatus = index.statusOf.get(claim.object.ref)
        return predecessorStatus !== 'retired'
      })
    }
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
    case 'has-subject-of-kind': {
      // Deliberately not `!no-subject-of-kind`: written as its own existence
      // check so the empty workspace falls out right rather than by double
      // negative. No subjects of any kind means every gate using it stays
      // shut, which is the #334 posture.
      const matching = condition.kindMatching ?? 'descendants'
      return [...index.concepts].some((id) =>
        kindMatches(
          index.kindOf.get(id),
          condition.kinds,
          matching,
          profileContext,
        ),
      )
    }
    case 'below-subject-count': {
      // Counts, then compares. Written as its own count rather than as
      // `!has-subject-of-kind` plus arithmetic so the degenerate reading
      // stays visible: at `atLeast: 1` this IS `no-subject-of-kind`, which
      // is why the loader refuses that spelling rather than quietly
      // accepting two names for one condition.
      //
      // Stops at the threshold instead of counting the whole workspace: the
      // answer is a comparison, not a tally, and a model with ten thousand
      // subjects of a kind should cost the same as one with two.
      const matching = condition.kindMatching ?? 'descendants'
      let seen = 0
      for (const id of index.concepts) {
        if (
          kindMatches(
            index.kindOf.get(id),
            condition.kinds,
            matching,
            profileContext,
          )
        ) {
          seen += 1
          if (seen >= condition.atLeast) return false
        }
      }
      return true
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
    case 'no-linkage-exists':
      // Its own check rather than `!exists-linkage`, so an empty workspace
      // falls out right: no concepts means no linkage, which is exactly the
      // model a vocabulary question is loudest about.
      return ![...index.concepts].some((id) =>
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
  evidence?: readonly CatalogueEvidenceObservation[],
  /**
   * Contributing catalogues, from {@link composeCatalogues}. Composition
   * happens BEFORE evaluation and hands this function an ordinary catalogue,
   * so the only thing evaluation learns about composition is what to name in
   * the report. A fifth optional parameter rather than an options object,
   * because this signature is published and a consumer already calls it.
   */
  catalogues?: readonly string[],
  /**
   * Pattern memberships from the compilation (ADR 0131) — pass
   * `compilation.patternMemberships`, or `fills-pattern-slot` conditions
   * never fire. A sixth optional parameter for the same reason
   * `catalogues` is a fifth: this signature is published and a consumer
   * already calls it.
   */
  patternMemberships?: readonly CataloguePatternMembership[],
): Omit<InterrogationReport, 'workspace'> {
  const index = indexGraph(graph)
  let open = 0
  let openQuestions = 0
  const applicableQuestions = catalogue.questions.filter((question) =>
    questionIsApplicable(question, graph.profiles),
  )
  const waveOpens = (wave: QuestionCatalogue['waves'][number]): boolean =>
    wave.opensWhen === undefined ||
    wave.opensWhen.every((condition) =>
      conditionHolds(index, condition, undefined, profileContext, evidence, patternMemberships),
    )
  const waves = catalogue.waves.map((wave) => ({
    id: wave.id,
    name: wave.name,
    opened: waveOpens(wave),
    // A closed wave asks nothing. Its questions are not evaluated at all,
    // rather than evaluated and reported closed - the latter would say they
    // had been asked and answered - so they reach neither the report nor the
    // summary.
    questions: !waveOpens(wave)
      ? []
      : applicableQuestions
      .filter((question) => question.wave === wave.id)
      .map((question): ReportQuestion => {
        const base = {
          id: question.id,
          scope: question.scope,
          authority: question.authority,
          question: question.question.trim(),
          materiality: question.materiality.trim(),
          resolution: question.resolution.trim(),
          trigger: question.trigger,
          ...(question.since === undefined ? {} : { since: question.since }),
        }
        if (question.scope === 'workspace') {
          const isOpen = question.trigger.every((condition) =>
            conditionHolds(index, condition, undefined, profileContext, evidence, patternMemberships),
          )
          if (isOpen) {
            open += 1
            openQuestions += 1
          }
          return { ...base, open: isOpen }
        }
        // Selection and trigger filtering are separate reads on purpose
        // (#375, ADR 0132): a selector matching nobody means the question
        // was never asked, and reporting that as a closed question said it
        // had been asked and answered — completion inferred from an empty
        // set, the reading ADR 0125 refuses one level up.
        const selected = selectSubjects(
          index,
          question.subjects!,
          profileContext,
        )
        if (selected.length === 0) {
          return { ...base, open: false, asked: false }
        }
        const matches = selected.filter((id) =>
          question.trigger.every((condition) =>
            conditionHolds(index, condition, id, profileContext, evidence, patternMemberships),
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
    // Only when composition actually happened. A single-catalogue report is
    // byte-identical to what it was before this existed.
    ...(catalogues === undefined || catalogues.length < 2
      ? {}
      : { catalogues }),
    semantics: INTERROGATION_SEMANTICS_VERSION,
    summary: {
      // Questions in OPENED waves only (#334, ADR 0125). A closed wave's
      // questions have not been asked, so counting them in the denominator
      // would report them as answered - "3 of 51" reading as forty-eight
      // done when forty-eight were never put. The denominator grows as the
      // model gains substance and waves open, which is the interview
      // revealing itself rather than a rail filling up.
      questions: waves.reduce((total, wave) => total + wave.questions.length, 0),
      openQuestions,
      open,
    },
    waves,
  }
}

export type CatalogueLoadResult =
  | { readonly ok: true; readonly catalogue: QuestionCatalogue }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/** One qualified kind a catalogue names, and where it names it. */
interface CatalogueKindReference {
  readonly kind: string
  readonly path: readonly (string | number)[]
}

/**
 * Every qualified kind a catalogue names, from all three fields that carry
 * one.
 *
 * All three die the same way when the kind does not resolve, and two of them
 * are easy to forget. A trigger's kind never matches, so the question never
 * opens. A subject selector's kind selects nothing, so the question is scoped
 * to an empty set. A wave gate's kind never holds, so after #334 the whole
 * wave never opens and carries no questions at all - one typo silently
 * retiring a wave (#351).
 */
/**
 * Every condition the catalogue holds, gate and trigger alike, with the path
 * that locates it. `kindReferencesOf` walks the same two places for kinds;
 * this walks them for the conditions themselves, so a check about a
 * condition's own shape does not have to re-derive where conditions live.
 */
const conditionsOf = (
  catalogue: QuestionCatalogue,
): readonly { condition: CatalogueCondition; path: (string | number)[] }[] => {
  const found: { condition: CatalogueCondition; path: (string | number)[] }[] =
    []
  catalogue.waves.forEach((wave, waveIndex) => {
    ;(wave.opensWhen ?? []).forEach((condition, conditionIndex) => {
      found.push({
        condition,
        path: ['waves', waveIndex, 'opensWhen', conditionIndex],
      })
    })
  })
  catalogue.questions.forEach((question, questionIndex) => {
    question.trigger.forEach((condition, conditionIndex) => {
      found.push({
        condition,
        path: ['questions', questionIndex, 'trigger', conditionIndex],
      })
    })
  })
  return found
}

/**
 * `YM918`: `below-subject-count` must ask for at least two (#411).
 *
 * `atLeast: 1` is `no-subject-of-kind` under a second name, and this design
 * refuses second spellings of one meaning wherever it finds them. `atLeast: 0`
 * is worse: the count can never be below zero, so the question can never fire,
 * which is what `YM914` refuses from a different cause.
 *
 * The message names `no-subject-of-kind` rather than stating a bound, because
 * an author who wrote `atLeast: 1` did not make an arithmetic mistake. They
 * wanted the condition that already exists.
 */
const subjectCountFloorDiagnostics = ({
  catalogue,
  locate,
}: LoadedCatalogueDocument): readonly Diagnostic[] =>
  conditionsOf(catalogue).flatMap(({ condition, path }) =>
    condition.condition === 'below-subject-count' && condition.atLeast < 2
      ? [
          {
            severity: 'error' as const,
            code: 'YM918',
            message:
              `Condition "below-subject-count" asks for atLeast ${condition.atLeast}, ` +
              (condition.atLeast === 1
                ? 'which is what "no-subject-of-kind" already asks. Use that condition instead.'
                : 'so a count could never fall below it and the question could never fire. ' +
                  'Ask for at least 2, or use "no-subject-of-kind" for the presence case.'),
            ...locate([...path, 'atLeast']),
          },
        ]
      : [],
  )

const kindReferencesOf = (
  catalogue: QuestionCatalogue,
): readonly CatalogueKindReference[] => {
  const found: CatalogueKindReference[] = []
  const fromCondition = (
    condition: unknown,
    path: readonly (string | number)[],
  ) => {
    if (typeof condition !== 'object' || condition === null) return
    for (const field of ['kinds', 'counterpartKinds', 'patternKinds'] as const) {
      const value = (condition as Record<string, unknown>)[field]
      if (!Array.isArray(value)) continue
      value.forEach((kind, index) => {
        if (typeof kind === 'string')
          found.push({ kind, path: [...path, field, index] })
      })
    }
  }
  catalogue.waves.forEach((wave, waveIndex) => {
    ;(wave.opensWhen ?? []).forEach((condition, conditionIndex) => {
      fromCondition(condition, ['waves', waveIndex, 'opensWhen', conditionIndex])
    })
  })
  catalogue.questions.forEach((question, questionIndex) => {
    ;(question.subjects?.kinds ?? []).forEach((kind, index) => {
      found.push({
        kind,
        path: ['questions', questionIndex, 'subjects', 'kinds', index],
      })
    })
    question.trigger.forEach((condition, conditionIndex) => {
      fromCondition(condition, [
        'questions',
        questionIndex,
        'trigger',
        conditionIndex,
      ])
    })
  })
  return found
}

/**
 * Kinds this catalogue names that the profile they belong to does not have.
 *
 * The check is deliberately narrow, and the narrowness is the design (#351).
 * A kind is reported ONLY when its profile is loaded and the kind is absent
 * from it, which is unambiguously a typo. A kind whose profile is not loaded
 * at all is left alone, because that is a legitimately dormant cross-profile
 * question rather than a mistake: `core-enrichment` names four
 * `yarramate/policy@0.1` constraint kinds, and `yarramate/policy@0.1` loads
 * only when a document selects it or a profile extends it. Reporting those
 * four would put four false positives on the catalogue this repository ships,
 * and a check that cries wolf on its own catalogue gets turned off.
 *
 * Resolution is tested against the kind maps rather than a declared-kinds
 * list, so a kind inherited through `extends` counts. A profile that declares
 * no kinds of its own and inherits every one of them is the case a
 * declared-kinds check would call entirely missing.
 */
const unresolvableKinds = (
  catalogue: QuestionCatalogue,
  profileContext: ResolvedProfileContext,
): readonly CatalogueKindReference[] => {
  const known = new Set<string>([
    ...profileContext.conceptKindLineages.keys(),
    ...profileContext.relationshipKindLineages.keys(),
  ])
  const loadedProfiles = new Set<string>()
  for (const identity of known) {
    const hash = identity.indexOf('#')
    if (hash > 0) loadedProfiles.add(identity.slice(0, hash))
  }
  return kindReferencesOf(catalogue).filter(({ kind }) => {
    if (known.has(kind)) return false
    const hash = kind.indexOf('#')
    // Profile absent entirely: dormant, not wrong.
    return hash > 0 && loadedProfiles.has(kind.slice(0, hash))
  })
}

/** One remedy a trigger offers that the relationship table forbids. */
interface UnauthorableOffer {
  readonly questionId: string
  readonly subjectKind: string
  readonly relationshipKind: string
  readonly direction: string
  readonly counterpartKinds: readonly string[] | undefined
  readonly path: readonly (string | number)[]
}

// The core kind an authored kind resolves to, or undefined when this workspace
// cannot resolve it at all. Lineage is ancestor-first, so `lineage[0]` is the
// core identity and an extension inherits its parent's row in the table
// (ADR 0097); a core kind is its own lineage head. This is also why
// `kindMatching: descendants` needs no special handling: a descendant shares
// its ancestor's row and column, so checking the named kind covers them all.
// A kind the table has no row for answers every query with an empty set,
// which reads exactly like "forbidden". The guards keep the two apart, so a
// vocabulary the table cannot judge is passed over in silence rather than
// accused - the direction every ambiguity here resolves in. They are the
// reason nothing below casts: the typed queries are reached through the
// check rather than around it.
const localKindOf = (
  kind: string,
  lineages: ReadonlyMap<string, readonly string[]>,
): string | undefined => {
  const lineage = lineages.get(kind)
  if (lineage === undefined) return undefined
  const identity = lineage[0] ?? kind
  return identity.slice(identity.indexOf('#') + 1)
}

const coreConceptKindOf = (
  kind: string,
  lineages: ReadonlyMap<string, readonly string[]>,
): CoreConceptKindId | undefined => {
  const local = localKindOf(kind, lineages)
  return local !== undefined && tableKnowsConceptKind(local) ? local : undefined
}

const coreRelationshipKindOf = (
  kind: string,
  lineages: ReadonlyMap<string, readonly string[]>,
): RelationshipKind | undefined => {
  const local = localKindOf(kind, lineages)
  return local !== undefined && tableKnowsRelationshipKind(local)
    ? local
    : undefined
}

/**
 * Remedies a trigger offers that no model could author.
 *
 * A trigger names the ways its question can be satisfied, and each one is an
 * OFFER: add this relationship, in this direction, from one of these kinds.
 * The ArchiMate table the compiler admits relationships against decides which
 * of those are authorable. An offer it forbids is a lie the catalogue tells,
 * and the unit is the offer rather than the question, because a question with
 * three offers and one dead one still reads as answerable: a reader takes the
 * dead option, authors it, and the compiler refuses the write (ADR 0133).
 *
 * Both conditions naming a relationship are checked, and `missing-linkage` is
 * the MORE checkable of the two. `missing-relationship` asks whether any of
 * the 62 core kinds may stand opposite, which only the seven kinds nothing may
 * realize can fail. `missing-linkage` names its own counterpart kinds, so the
 * question narrows to those, a dead offer is far likelier, and the diagnostic
 * can point at the exact list that admits nothing. Both of the defects that
 * prompted this check in the reporting consumer's catalogue were linkage
 * offers, not relationship ones.
 *
 * `missing-attestation` and `missing-claim` are not checked: they name no
 * relationship, so there is no table to consult, and inventing one for them
 * would be the second encoding of ArchiMate's rules this check exists to
 * prevent.
 *
 * Narrow in the same two ways `unresolvableKinds` is narrow. Without a profile
 * context there is no lineage to resolve an extension kind through, so nothing
 * is reported rather than guessed; and a kind that resolves nowhere is
 * `YM914`'s business, not this one. A trigger with any unresolvable counterpart
 * is skipped whole, because a partial reading could accuse a question that a
 * dormant cross-profile kind would have answered.
 */
const unauthorableOffers = (
  catalogue: QuestionCatalogue,
  profileContext: ResolvedProfileContext,
): readonly UnauthorableOffer[] => {
  const found: UnauthorableOffer[] = []
  const conceptCore = (kind: string) =>
    coreConceptKindOf(kind, profileContext.conceptKindLineages)
  for (const [questionIndex, question] of catalogue.questions.entries()) {
    const subjectKinds = question.subjects?.kinds ?? []
    if (subjectKinds.length === 0) continue
    for (const [conditionIndex, condition] of question.trigger.entries()) {
      const trigger = condition as {
        condition?: string
        kinds?: readonly string[]
        direction?: string
        counterpartKinds?: readonly string[]
      }
      if (
        trigger.condition !== 'missing-relationship' &&
        trigger.condition !== 'missing-linkage'
      ) {
        continue
      }
      // `any` and `either` are satisfied by a relationship in either
      // direction, so an offer is dead only when both directions are.
      const directions =
        trigger.direction === 'any' || trigger.direction === 'either'
          ? (['incoming', 'outgoing'] as const)
          : ([trigger.direction ?? 'any'] as const)
      const named = trigger.counterpartKinds
      const counterparts = named?.map(conceptCore)
      if (counterparts?.some((kind) => kind === undefined) === true) continue
      for (const subjectKind of subjectKinds) {
        const subject = conceptCore(subjectKind)
        if (subject === undefined) continue
        for (const [kindIndex, relationshipKind] of (
          trigger.kinds ?? []
        ).entries()) {
          const relationship = coreRelationshipKindOf(
            relationshipKind,
            profileContext.relationshipKindLineages,
          )
          if (relationship === undefined) continue
          const authorable = directions.some((direction) => {
            const opposite =
              direction === 'incoming'
                ? sourceKindsPermitting(relationship, subject)
                : targetKindsPermitting(relationship, subject)
            return counterparts === undefined
              ? opposite.size > 0
              : counterparts.some(
                  (kind) => kind !== undefined && opposite.has(kind),
                )
          })
          if (authorable) continue
          found.push({
            questionId: question.id,
            subjectKind,
            relationshipKind,
            direction: trigger.direction ?? 'any',
            counterpartKinds: named,
            path: [
              'questions',
              questionIndex,
              'trigger',
              conditionIndex,
              'kinds',
              kindIndex,
            ],
          })
        }
      }
    }
  }
  return found
}

/** A catalogue parsed and located, before any cross-catalogue check. */
interface LoadedCatalogueDocument {
  readonly source: WorkspaceSource
  readonly catalogue: QuestionCatalogue
  readonly locate: (
    path: readonly (string | number)[],
  ) => Pick<Diagnostic, 'path' | 'pointer' | 'line' | 'column'>
}

type CatalogueDocumentResult =
  | { readonly ok: true; readonly document: LoadedCatalogueDocument }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

const loadCatalogueDocument = (
  catalogueSource: WorkspaceSource,
): CatalogueDocumentResult => {
  const loaded = loadSourceDocument<QuestionCatalogue>(
    catalogueSource,
    validateCatalogue,
    'Question catalogue',
  )
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics }
  return {
    ok: true,
    document: {
      source: catalogueSource,
      catalogue: loaded.document.value,
      locate: (path) =>
        locateSourcePath(
          catalogueSource.path,
          loaded.document.yaml,
          loaded.document.lineCounter,
          path,
          `/${path.join('/')}`,
        ),
    },
  }
}

/**
 * The YM911 undeclared-wave check, against a set of wave ids that may be
 * WIDER than the catalogue's own.
 *
 * That width is the whole of #345. A project catalogue's reason to exist is
 * adding "one more Assurance question for this client" to a wave the domain
 * catalogue declared, so checking each file against only its own waves would
 * refuse precisely the case the feature enables. Composed, the set is the
 * union; alone, it is the catalogue's own and the check is what it always was.
 */
const undeclaredWaveDiagnostics = (
  { catalogue, locate }: LoadedCatalogueDocument,
  declaredWaves: ReadonlySet<string>,
): readonly Diagnostic[] =>
  catalogue.questions.flatMap((question, questionIndex) =>
    declaredWaves.has(question.wave)
      ? []
      : [
          {
            severity: 'error' as const,
            code: 'YM911',
            message: `Question "${question.id}" references undeclared wave "${question.wave}"`,
            ...locate(['questions', questionIndex, 'wave']),
          },
        ],
  )

/**
 * `YM917`: a wave gate may only ask about the workspace (#400).
 *
 * `opensWhen` is evaluated with no subject, so a subject-scope condition here
 * cannot mean what it reads as. Half of them then leave the wave permanently
 * shut and half leave the gate inert, and an author reviewing the YAML sees a
 * gate either way — the same invisible failure `YM914` refuses when a gate
 * names a kind that resolves nowhere.
 *
 * Refused at load rather than narrowed in the schema on purpose. The schema
 * could express it as a second `oneOf`, but a `oneOf` miss reports "must match
 * exactly one schema", which names neither the offending condition nor the
 * ones that would work — and this diagnostic exists precisely because the
 * author cannot see the problem.
 */
const gateScopeDiagnostics = ({
  catalogue,
  locate,
}: LoadedCatalogueDocument): readonly Diagnostic[] =>
  catalogue.waves.flatMap((wave, waveIndex) =>
    (wave.opensWhen ?? []).flatMap((condition, conditionIndex) =>
      conditionScope(condition) === 'subject'
        ? [
            {
              severity: 'error' as const,
              code: 'YM917',
              message:
                `Condition "${condition.condition}" gates wave "${wave.id}" but asks about a subject, ` +
                'and a gate is evaluated with none, so the wave would never open or the gate would do ' +
                `nothing. Gate on the workspace instead: ${workspaceScopeConditions().join(', ')}.`,
              ...locate(['waves', waveIndex, 'opensWhen', conditionIndex]),
            },
          ]
        : [],
    ),
  )

// Read off the scope table rather than restated, so the remedy a diagnostic
// offers cannot drift from the set the engine actually accepts.
const workspaceScopeConditions = (): readonly string[] =>
  Object.entries(CONDITION_SCOPE)
    .filter(([, scope]) => scope === 'workspace')
    .map(([condition]) => condition)
    .sort()

const unresolvableKindDiagnostics = (
  { catalogue, locate }: LoadedCatalogueDocument,
  profileContext?: ResolvedProfileContext,
): readonly Diagnostic[] =>
  // Only when a caller has a compiled workspace to check against. Without one
  // there is no way to tell a typo from a kind whose profile simply is not
  // here, and guessing would be the false positive this check exists to avoid.
  profileContext === undefined
    ? []
    : unresolvableKinds(catalogue, profileContext).map((reference) => ({
        severity: 'error' as const,
        code: 'YM914',
        message: `Kind "${reference.kind}" is not declared by profile "${reference.kind.slice(
          0,
          reference.kind.indexOf('#'),
        )}", which this workspace loads, so the question can never fire`,
        ...locate(reference.path),
      }))

// YM916, the sibling of YM914. YM914 refuses a question that can never FIRE;
// this refuses one that offers a remedy nobody could author. Both failures are
// invisible, and this one twice over: the question reads as ordinary
// unfinished work, and a reader who takes the dead offer learns only when the
// compiler refuses the write it led them to (ADR 0133).
const unauthorableOfferDiagnostics = (
  { catalogue, locate }: LoadedCatalogueDocument,
  profileContext?: ResolvedProfileContext,
): readonly Diagnostic[] =>
  profileContext === undefined
    ? []
    : unauthorableOffers(catalogue, profileContext).map((offer) => ({
        severity: 'error' as const,
        code: 'YM916',
        message:
          `Question "${offer.questionId}" offers "${offer.relationshipKind}" ` +
          `${offer.direction} on "${offer.subjectKind}", which the ` +
          'ArchiMate relationship table permits from ' +
          (offer.counterpartKinds === undefined
            ? 'no kind at all'
            : `none of the counterpart kinds it names (${offer.counterpartKinds.join(', ')})`) +
          ', so no model could author it',
        ...locate(offer.path),
      }))

/**
 * A catalogue is qualified on the way OUT, never in what an author writes.
 *
 * The authored schema keeps ids local (`^[a-z][a-z0-9-]*$`) and that does not
 * change; a consultant writes `regulator-signoff`, not
 * `consulting#regulator-signoff`. The engine qualifies when it composes, which
 * is the only moment two catalogues can be confused for each other.
 *
 * NO VERSION, and that is the decision rather than an omission (ADR 0129).
 * `core-enrichment` went 1.0 to 1.3 in a single day renaming nothing; a
 * versioned identity would have stranded every stored dismissal in every
 * adopter's database three times that day, for changes that removed no
 * question. Versioned identity is safe for things that are AUTHORED - a
 * document keeps naming the version it was written against and an author
 * updates it deliberately - and unsafe for things that are STORED, because a
 * row in someone's database has no author to update it.
 */
export const qualifiedQuestionId = (
  catalogueId: string,
  questionId: string,
): string => `${catalogueId}#${questionId}`

export interface ComposedCatalogue {
  /**
   * The composed catalogue, ready for `evaluateCatalogue`. Structurally a
   * `QuestionCatalogue`, but its question ids are QUALIFIED, so it is a
   * composition result rather than something an author could have written and
   * must never be validated against the authored schema again.
   */
  readonly catalogue: QuestionCatalogue
  /** Every contributing catalogue as `id@version`, base first. */
  readonly catalogues: readonly string[]
}

export type CatalogueCompositionResult =
  | { readonly ok: true; readonly composed: ComposedCatalogue }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/**
 * Compose a base catalogue with the ones a workspace carries (#345, ADR 0129).
 *
 * ADDITIVE. `--catalogue` and `MountOptions.catalogue` replace the base; this
 * adds to it, which is what lets a consultant author a question at any point
 * in an engagement with no product release.
 *
 * A WAVE IS DECLARED EXACTLY ONCE across the resolved set, and any catalogue
 * may contribute questions to a wave it did not declare. That one rule settles
 * three questions composition would otherwise raise. Wave identity: a project
 * catalogue joins a declared wave rather than colliding with it. Ordering:
 * only a declaration places a wave, so the base's order is untouched and new
 * waves append. And the `opensWhen` precedence ADR 0125 made load-bearing does
 * not arise at all, because there is only ever one declarer to ask.
 *
 * QUALIFICATION IS A PROPERTY OF COMPOSITION, NOT OF EVALUATION. A caller
 * that hands `evaluateCatalogue` a catalogue directly still gets local ids,
 * exactly as before this existed. Route through here even for ONE catalogue -
 * which is what every CLI verb does - and ids are qualified from the start, so
 * they do not change later when a workspace first carries a question of its
 * own. That transition is the one thing an adopter keying stored judgments on
 * a question id must not experience, and composing unconditionally is how it
 * is avoided.
 *
 * ID COLLISIONS DISSOLVE rather than being resolved. Two catalogues may both
 * carry `outcome-missing`; qualified, they are two different questions. There
 * is no merge rule, no last-wins and no refusal, because there is nothing to
 * merge.
 */
export function composeCatalogues(
  sources: readonly WorkspaceSource[],
  profileContext?: ResolvedProfileContext,
): CatalogueCompositionResult {
  const documents: LoadedCatalogueDocument[] = []
  const loadDiagnostics: Diagnostic[] = []
  for (const source of sources) {
    const loaded = loadCatalogueDocument(source)
    if (loaded.ok) documents.push(loaded.document)
    else loadDiagnostics.push(...loaded.diagnostics)
  }
  if (loadDiagnostics.length > 0) {
    return { ok: false, diagnostics: loadDiagnostics }
  }
  const base = documents[0]
  if (base === undefined) {
    // Never reached through the CLI, which always has the shipped catalogue,
    // but an empty set must not compose into an empty catalogue that reports
    // a finished interview.
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM915',
          message: 'No question catalogue to compose',
          path: '',
          pointer: '',
          line: 1,
          column: 1,
        },
      ],
    }
  }

  // Declared exactly once. A second declaration is refused rather than merged,
  // because the two carry independent `opensWhen` gates and silently picking
  // one would decide when a wave opens by file order.
  const declaredBy = new Map<string, LoadedCatalogueDocument>()
  const duplicates: Diagnostic[] = []
  for (const document of documents) {
    document.catalogue.waves.forEach((wave, waveIndex) => {
      const first = declaredBy.get(wave.id)
      if (first === undefined) {
        declaredBy.set(wave.id, document)
        return
      }
      duplicates.push({
        severity: 'error',
        code: 'YM915',
        message:
          `Wave "${wave.id}" is already declared by catalogue "${first.catalogue.id}" ` +
          `(${first.source.path}). A wave is declared once and contributed to freely: ` +
          'drop the declaration here and questions in this catalogue will join it.',
        ...document.locate(['waves', waveIndex, 'id']),
      })
    })
  }
  if (duplicates.length > 0) return { ok: false, diagnostics: duplicates }

  const declaredWaves = new Set(declaredBy.keys())
  const crossDiagnostics = documents.flatMap((document) => [
    ...undeclaredWaveDiagnostics(document, declaredWaves),
    ...gateScopeDiagnostics(document),
    ...subjectCountFloorDiagnostics(document),
    ...unresolvableKindDiagnostics(document, profileContext),
    ...unauthorableOfferDiagnostics(document, profileContext),
  ])
  if (crossDiagnostics.length > 0) {
    return { ok: false, diagnostics: crossDiagnostics }
  }

  return {
    ok: true,
    composed: {
      catalogue: {
        ...base.catalogue,
        // The base names the composition, which is why the report's
        // `catalogue` field keeps its value shape while `catalogues` lists
        // every contributor.
        waves: documents.flatMap(({ catalogue }) => catalogue.waves),
        questions: documents.flatMap(({ catalogue }) =>
          catalogue.questions.map((question) => ({
            ...question,
            id: qualifiedQuestionId(catalogue.id, question.id),
          })),
        ),
      },
      catalogues: documents.map(
        ({ catalogue }) => `${catalogue.id}@${catalogue.version}`,
      ),
    },
  }
}

// Shared by interrogate and design: schema validation plus the YM911
// undeclared-wave check, both source-located against the catalogue file.
export function loadQuestionCatalogue(
  catalogueSource: WorkspaceSource,
  profileContext?: ResolvedProfileContext,
): CatalogueLoadResult {
  const loaded = loadCatalogueDocument(catalogueSource)
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics }

  const waveDiagnostics = undeclaredWaveDiagnostics(
    loaded.document,
    new Set(loaded.document.catalogue.waves.map(({ id }) => id)),
  )
  if (waveDiagnostics.length > 0) {
    return { ok: false, diagnostics: waveDiagnostics }
  }
  // Before the kind checks, and unlike them it needs no profile context: a
  // gate that asks about a subject is wrong on its own terms, whether or not
  // a caller brought a compiled workspace to resolve kinds against.
  const scopeDiagnostics = gateScopeDiagnostics(loaded.document)
  if (scopeDiagnostics.length > 0) {
    return { ok: false, diagnostics: scopeDiagnostics }
  }
  // Beside the scope check and for the same reason: a threshold below 2 is
  // wrong on the condition's own terms, with no profile context needed.
  const floorDiagnostics = subjectCountFloorDiagnostics(loaded.document)
  if (floorDiagnostics.length > 0) {
    return { ok: false, diagnostics: floorDiagnostics }
  }
  const kindDiagnostics = unresolvableKindDiagnostics(
    loaded.document,
    profileContext,
  )
  if (kindDiagnostics.length > 0) {
    return { ok: false, diagnostics: kindDiagnostics }
  }
  const offerDiagnostics = unauthorableOfferDiagnostics(
    loaded.document,
    profileContext,
  )
  if (offerDiagnostics.length > 0) {
    return { ok: false, diagnostics: offerDiagnostics }
  }
  return { ok: true, catalogue: loaded.document.catalogue }
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
    // A wave that has not opened must not read like one whose questions are
    // all closed (#334). Both carry no OPEN questions, and a bare heading with
    // nothing under it is the more flattering of the two readings: "nothing
    // outstanding here" rather than "nobody has been asked anything here".
    // The same shape - completion inferred from an empty set - was found in a
    // consuming product's wave rail on the same day.
    if (!wave.opened) {
      lines.push('  not yet — this wave has not opened')
      continue
    }
    for (const question of wave.questions) {
      if (question.asked === false) {
        // Never asked is not closed (#375): `closed` says answered, and a
        // selector that matched nobody asked nothing — the question-level
        // twin of the wave's own "not yet" line above.
        lines.push(
          `  unasked ${question.id} — nothing it selects exists yet`,
        )
        continue
      }
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

