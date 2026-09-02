import Ajv2020Import from 'ajv/dist/2020.js'
import type Ajv2020Type from 'ajv/dist/2020.js'
import { isDeclaredNonGoal } from './brief.js'
import type {
  Diagnostic,
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
import { loadSourceDocument } from './source-document.js'
import { similarity } from './subject-identity.js'
import projectionSchema from '../schema/yarramate-projection.schema.json' with {
  type: 'json',
}

// `ajv/dist/2020.js` is CJS, and its default-export shape is resolved
// differently under this repo's two tsconfigs: NodeNext (root) sees the raw
// `module.exports` (needs `.default`), Bundler+esModuleInterop
// (tsconfig.visual.json) sees the already-unwrapped class. The `??` picks
// whichever arrived; the type is normalized the same way.
//
// A STATIC import, never `createRequire`. A bundler cannot follow
// `createRequire`, so loading Ajv that way put `(0, cre.createRequire)(...)`
// into the browser bundle, where it is not a function - which is exactly how
// this module became unimportable from a browser, and why the editor could
// only ever run behind a Node process (#252).
type Ajv2020Ctor = typeof Ajv2020Type extends { default: infer D } ? D : typeof Ajv2020Type
const ajv2020Module = Ajv2020Import as unknown as {
  default?: Ajv2020Ctor
} & Ajv2020Ctor
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const validateProjection = lazyValidator(() =>
  new Ajv2020({ allErrors: true }).compile(projectionSchema),
)

export type LifecycleStatus = 'planned' | 'current' | 'retired'

export interface ProjectionDefinition {
  readonly format: 'yarramate/projection/v1'
  readonly id: string
  readonly version: string
  readonly query: {
    readonly subjects?: readonly string[]
    /**
     * Subjects this query would otherwise select and the author has taken out
     * (#267, ADR 0122). A facet view states a rule, and every interesting rule
     * has an exception someone would rather state than abandon the rule for;
     * this is where that exception is written down instead of being the silent
     * absence a hand-enumerated list produces. Applied after every other facet
     * AND after `relationships: connected` expansion, so an excluded subject is
     * out whichever way it would have come back in.
     */
    readonly exclude?: readonly string[]
    readonly documents?: readonly string[]
    readonly kinds?: readonly string[]
    readonly layers?: readonly string[]
    readonly statuses?: readonly LifecycleStatus[]
    readonly excludeStatuses?: readonly LifecycleStatus[]
    readonly states?: readonly string[]
    readonly owners?: readonly string[]
    readonly constraints?: readonly string[]
    readonly relationshipKinds?: readonly string[]
    readonly kindMatching?: 'exact' | 'descendants'
    readonly relationships?: 'between' | 'connected' | 'none'
    readonly isolatedConcepts?: 'include' | 'exclude'
  }
  readonly presentation?: {
    readonly title?: string
    readonly description?: string
    readonly layout?: 'layered'
    /**
     * Which way this view runs its layers. Read by the LikeC4 export for its
     * `autoLayout` and by the canvas for ELK's `elk.direction` (ADR 0121); a
     * view that says nothing runs `top-down`, which is what ArchiMate's layer
     * bands read as.
     */
    readonly direction?: LayoutDirection
    /**
     * The relationship kinds that draw as nesting in this view, in precedence
     * order (ADR 0101). Absent means `['composition']`, which is the behaviour
     * that shipped before a view could say; `[]` draws everything as a line.
     */
    readonly nesting?: readonly NestingKind[]
    readonly showLifecycle?: boolean
    readonly showEvidence?: boolean
    readonly showOwnership?: boolean
    /**
     * The folder this view files itself under in an editor's rail: a label the
     * author declares, nested with `/`, never the directory the projection
     * sits in (ADR 0104). The same word `yarramate/likec4-project/v1` uses for
     * the same thing.
     */
    readonly folder?: string
    /**
     * The notation this view draws in. `archimate` is the only one, and the
     * field is kept rather than dropped so a second notation has somewhere to
     * land - the same reason `layout` stayed an enum when `radial` and `force`
     * went (ADR 0086, ADR 0087).
     */
    readonly notation?: 'archimate'
  }
}

/**
 * A relationship kind a view may draw as nesting, and the default. Defined in
 * `./nesting.js`, which imports nothing, and re-exported here so a consumer
 * that already reads projection types keeps finding them. The browser should
 * still import them from there rather than from here: this module loads Ajv
 * and a schema, which is a great deal of bundle for one constant (ADR 0101).
 */
export { DEFAULT_NESTING, type NestingKind } from './nesting.js'
import type { NestingKind } from './nesting.js'

/**
 * Which way a view runs, and the default. Split out for the same reason as the
 * nesting vocabulary above, and re-exported here on the same terms (ADR 0121).
 */
export { DEFAULT_DIRECTION, type LayoutDirection } from './layout-direction.js'
import type { LayoutDirection } from './layout-direction.js'
import { lazyValidator } from './schema-validation.js'

export type ProjectionQuery = ProjectionDefinition['query']

export interface ProjectionResult {
  readonly format: 'yarramate/projection-result/v1'
  readonly projection: string
  readonly presentation?: ProjectionDefinition['presentation']
  readonly documents: SemanticGraph['documents']
  readonly subjects: SemanticGraph['subjects']
  readonly claims: readonly GraphClaim[]
}

export type ProjectionLoadResult =
  | { readonly ok: true; readonly projection: ProjectionDefinition }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export function loadProjection(source: WorkspaceSource): ProjectionLoadResult {
  const loaded = loadSourceDocument<ProjectionDefinition>(
    source,
    validateProjection(),
    'Projection',
  )
  return loaded.ok
    ? { ok: true, projection: loaded.document.value }
    : loaded
}

export function canonicalProjection(
  projection: ProjectionDefinition,
): ProjectionDefinition {
  const query = projection.query
  const presentation = projection.presentation
  return {
    format: projection.format,
    id: projection.id,
    version: projection.version,
    query: {
      ...(query.subjects === undefined ? {} : { subjects: [...query.subjects].sort() }),
      ...(query.documents === undefined ? {} : { documents: [...query.documents].sort() }),
      ...(query.kinds === undefined ? {} : { kinds: [...query.kinds].sort() }),
      ...(query.layers === undefined ? {} : { layers: [...query.layers].sort() }),
      ...(query.statuses === undefined ? {} : { statuses: [...query.statuses].sort() }),
      ...(query.excludeStatuses === undefined ? {} : { excludeStatuses: [...query.excludeStatuses].sort() }),
      ...(query.states === undefined ? {} : { states: [...query.states].sort() }),
      ...(query.owners === undefined ? {} : { owners: [...query.owners].sort() }),
      ...(query.constraints === undefined ? {} : { constraints: [...query.constraints].sort() }),
      ...(query.relationshipKinds === undefined ? {} : { relationshipKinds: [...query.relationshipKinds].sort() }),
      ...(query.kindMatching === undefined ? {} : { kindMatching: query.kindMatching }),
      ...(query.relationships === undefined ? {} : { relationships: query.relationships }),
      ...(query.isolatedConcepts === undefined ? {} : { isolatedConcepts: query.isolatedConcepts }),
    },
    ...(presentation === undefined
      ? {}
      : {
          presentation: {
            ...(presentation.title === undefined ? {} : { title: presentation.title }),
            ...(presentation.description === undefined ? {} : { description: presentation.description }),
            ...(presentation.layout === undefined ? {} : { layout: presentation.layout }),
            ...(presentation.direction === undefined ? {} : { direction: presentation.direction }),
            ...(presentation.nesting === undefined ? {} : { nesting: presentation.nesting }),
            ...(presentation.showLifecycle === undefined ? {} : { showLifecycle: presentation.showLifecycle }),
            ...(presentation.showEvidence === undefined ? {} : { showEvidence: presentation.showEvidence }),
            ...(presentation.showOwnership === undefined ? {} : { showOwnership: presentation.showOwnership }),
            ...(presentation.notation === undefined ? {} : { notation: presentation.notation }),
          },
        }),
  }
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

const claimReference = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'ref' in object ? object.ref : undefined
}

const claimReferences = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): readonly string[] =>
  claims.flatMap((claim) =>
    claim.subject === subject &&
    claim.predicate === predicate &&
    'ref' in claim.object
      ? [claim.object.ref]
      : [],
  )

/**
 * A facet of a query, named the way the query names it. What
 * {@link explainProjection} reports as the reason a subject is not in a view.
 */
export type ConceptFacet =
  | 'exclude'
  | 'states'
  | 'subjects'
  | 'documents'
  | 'kinds'
  | 'layers'
  | 'statuses'
  | 'excludeStatuses'
  | 'owners'
  | 'constraints'

/** One subject a query dropped, and the facet that dropped it. */
export interface ProjectionExclusion {
  readonly id: string
  readonly facet: ConceptFacet
}

interface ConceptSelector {
  /** The facet that drops this concept, or `undefined` when the query keeps it. */
  readonly droppedBy: (id: string) => ConceptFacet | undefined
  readonly architectureStateIds: ReadonlySet<string>
  readonly participatesInSelectedState: (subject: string) => boolean
}

/**
 * How a query decides about concepts, built once and shared by the two things
 * that ask.
 *
 * `evaluateProjection` asks whether a subject is in; `explainProjection` asks
 * why one is out. They must never be able to disagree, which is why there is
 * one selector rather than a filter here and a reason-finder somewhere else.
 */
const conceptSelector = (
  graph: SemanticGraph,
  projection: ProjectionDefinition,
  profileContext?: ResolvedProfileContext,
): ConceptSelector => {
  const architectureStateIds = new Set(
    graph.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  const selectedStateIds =
    projection.query.states === undefined
      ? undefined
      : projection.query.states.filter((state) =>
          architectureStateIds.has(state),
        )
  const participatesInSelectedState = (subject: string) => {
    if (selectedStateIds === undefined) return true
    if (selectedStateIds.length === 0) return false
    const presence = claimReferences(
      graph.claims,
      subject,
      'yarramate/state/present-in',
    )
    return (
      presence.length === 0 ||
      presence.some((state) => selectedStateIds.includes(state))
    )
  }
  // A subject id no longer carries the document that declared it, so the
  // `documents` selector reads provenance from the claim that declares the
  // concept's kind - the one claim every concept has, recorded in the document
  // that authored it. Built once: the alternative is a claim scan per subject
  // per query.
  const documentOfSubject = new Map<string, string>()
  for (const claim of graph.claims) {
    if (claim.predicate !== 'yarramate/concept/kind') continue
    const document = claim.source?.document
    if (typeof document === 'string') {
      documentOfSubject.set(claim.subject, document)
    }
  }

  return {
    architectureStateIds,
    participatesInSelectedState,
    droppedBy: (id: string): ConceptFacet | undefined => {
      const query = projection.query
      const documentId = documentOfSubject.get(id) ?? ''
      const kind = claimValue(graph.claims, id, 'yarramate/concept/kind')
      const status = claimValue(graph.claims, id, 'yarramate/lifecycle/status')
      const owner = claimReference(
        graph.claims,
        id,
        'yarramate/ownership/owner',
      )
      const constraints = claimReferences(
        graph.claims,
        id,
        'yarramate/constraint/requires',
      )
      const kindLayer =
        kind === undefined
          ? undefined
          : profileContext?.conceptKindLayers.get(kind)

      // Ordered the way a query declares its facets, so "the first reason" is
      // the one a reader would reach first themselves - except the explicit
      // exception, which outranks every rule: when someone has written the
      // subject down as taken out, that IS the first reason, whatever else
      // would also have dropped it (#267).
      if (query.exclude?.includes(id) === true) {
        return 'exclude'
      }
      if (
        query.states !== undefined &&
        (architectureStateIds.has(id) || !participatesInSelectedState(id))
      ) {
        return 'states'
      }
      if (query.subjects !== undefined && !query.subjects.includes(id)) {
        return 'subjects'
      }
      if (
        query.documents !== undefined &&
        !query.documents.includes(documentId)
      ) {
        return 'documents'
      }
      if (
        query.kinds !== undefined &&
        !(
          kind !== undefined &&
          query.kinds.some(
            (selectedKind) =>
              selectedKind === kind ||
              (query.kindMatching === 'descendants' &&
                profileContext?.conceptKindLineages
                  .get(kind)
                  ?.includes(selectedKind) === true),
          )
        )
      ) {
        return 'kinds'
      }
      if (
        query.layers !== undefined &&
        !(kindLayer !== undefined && query.layers.includes(kindLayer))
      ) {
        return 'layers'
      }
      if (
        query.statuses !== undefined &&
        !(
          status !== undefined &&
          query.statuses.includes(status as LifecycleStatus)
        )
      ) {
        return 'statuses'
      }
      if (
        query.excludeStatuses !== undefined &&
        status !== undefined &&
        query.excludeStatuses.includes(status as LifecycleStatus)
      ) {
        return 'excludeStatuses'
      }
      if (
        query.owners !== undefined &&
        !(owner !== undefined && query.owners.includes(owner))
      ) {
        return 'owners'
      }
      if (
        query.constraints !== undefined &&
        !constraints.some((constraint) => query.constraints?.includes(constraint))
      ) {
        return 'constraints'
      }
      return undefined
    },
  }
}

/** A query facet naming something the model does not have. */
export interface UnmatchedSelector {
  readonly facet: string
  readonly value: string
  /** The closest name the facet does offer, when one is close enough to be a likely typo. */
  readonly nearest?: string
}

/** Below this, a suggestion is noise rather than a hint. */
const SUGGESTION_THRESHOLD = 0.6

/**
 * Every value in a projection query that names nothing.
 *
 * A projection is a DOCUMENT, and a query holds references the same way a
 * relationship does. YarraMate refuses a relationship pointing at a concept
 * that does not exist; it did not refuse a query naming a state that does not
 * exist, and the symptom is silent. `states: [target-stat]` selects no state,
 * which selects no subject, which exports a clean empty artifact with exit 0.
 * Someone hands that to a client.
 *
 * Checked at `check`, not at `export`, because the typo is in a file rather
 * than in an invocation: CI catches it, and every verb over the same
 * projection inherits the guard instead of each growing its own.
 *
 * ONLY FACETS WITH A CLOSED NAMESPACE ARE CHECKED. `statuses` and
 * `excludeStatuses` are schema enums, refused upstream before this runs.
 * Everything else names something: `owners` and `constraints` are REFS to
 * concepts, which the compiler itself proves by refusing an unresolved owner
 * with YM304, so their namespace is the subject list like `subjects`.
 *
 * Each namespace is derived the way the FILTER derives it, so the check cannot
 * drift from what it guards: `documents` reads the same provenance the
 * `documents` facet compares against, and `states` is the same
 * `yarramate/state/type` scan `conceptSelector` runs.
 *
 * A kind whose profile is not loaded is DORMANT rather than wrong, the same
 * distinction #351 drew for question catalogues, so the kind facets are
 * checked only when a profile context is present.
 *
 * An empty RESULT is not reported here and must not be. A query whose every
 * name resolves and which selects nothing is a real answer to a real question:
 * a target state nobody has populated yet is empty, correctly.
 */
export function unmatchedSelectors(
  graph: SemanticGraph,
  projection: ProjectionDefinition,
  profileContext?: ResolvedProfileContext,
): readonly UnmatchedSelector[] {
  const query = projection.query
  const found: UnmatchedSelector[] = []

  const check = (
    facet: string,
    values: readonly string[] | undefined,
    known: ReadonlySet<string>,
  ): void => {
    if (values === undefined) return
    for (const value of values) {
      if (known.has(value)) continue
      let nearest: string | undefined
      let best = 0
      for (const candidate of known) {
        const score = similarity(value, candidate)
        if (score > best) {
          best = score
          nearest = candidate
        }
      }
      found.push({
        facet,
        value,
        ...(nearest !== undefined && best >= SUGGESTION_THRESHOLD
          ? { nearest }
          : {}),
      })
    }
  }

  const subjectIds = new Set(graph.subjects.map(({ id }) => id))
  check('subjects', query.subjects, subjectIds)
  check('exclude', query.exclude, subjectIds)
  // Against the SUBJECT list rather than against owners currently in use: a
  // team that owns nothing yet is a real concept and selecting it is a real
  // question with an empty answer, which is exactly what must not be refused.
  check('owners', query.owners, subjectIds)
  check('constraints', query.constraints, subjectIds)

  // The same provenance `documents` filters on: a subject id no longer carries
  // the document that declared it, so both read it off the kind claim.
  const documentIds = new Set<string>()
  for (const claim of graph.claims) {
    if (claim.predicate !== 'yarramate/concept/kind') continue
    const document = claim.source?.document
    if (typeof document === 'string') documentIds.add(document)
  }
  check('documents', query.documents, documentIds)

  check(
    'states',
    query.states,
    new Set(
      graph.claims
        .filter(({ predicate }) => predicate === 'yarramate/state/type')
        .map(({ subject }) => subject),
    ),
  )

  if (profileContext !== undefined) {
    check('kinds', query.kinds, new Set(profileContext.conceptKindLineages.keys()))
    check(
      'relationshipKinds',
      query.relationshipKinds,
      new Set(profileContext.relationshipKindLineages.keys()),
    )
    check('layers', query.layers, new Set(profileContext.conceptKindLayers.values()))
  }

  return found
}

/**
 * Where a value sits in the projection source, so the diagnostic is clickable.
 * A query value appears once in a list item, and finding it by text is enough:
 * the alternative is threading a YAML CST through a check that only needs to
 * point at a line.
 */
const locate = (source: string, value: string): { line: number; column: number } => {
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const at = lines[index]!.indexOf(value)
    if (at >= 0) return { line: index + 1, column: at + 1 }
  }
  return { line: 1, column: 1 }
}

/**
 * {@link unmatchedSelectors} as diagnostics, built HERE rather than at each
 * caller so `check`, and anything that adopts this later, refuse in identical
 * words with an identical code.
 */
export function projectionReferenceDiagnostics(
  source: WorkspaceSource,
  projection: ProjectionDefinition,
  graph: SemanticGraph,
  profileContext?: ResolvedProfileContext,
): readonly Diagnostic[] {
  return unmatchedSelectors(graph, projection, profileContext).map(
    ({ facet, value, nearest }) => ({
      severity: 'error' as const,
      code: 'YM921',
      message:
        `Projection query \`${facet}\` names ${JSON.stringify(value)}, ` +
        'which this workspace does not have, so it can never match. ' +
        (nearest === undefined
          ? 'Check the spelling against the model.'
          : `Did you mean ${JSON.stringify(nearest)}?`),
      path: source.path,
      pointer: `/query/${facet}`,
      ...locate(source.source, value),
    }),
  )
}

/**
 * Every concept a query leaves out, and the facet that left it out.
 *
 * The editor needs this to say why a subject is not on the canvas (#248): a
 * query that selects nothing, or that quietly drops the one subject the
 * reviewer was looking for, is otherwise indistinguishable from a model that
 * does not hold it. Relationships are not reported - they enter a view through
 * their endpoints rather than by matching a facet of their own, so "why" for a
 * relationship is a statement about the concepts it joins.
 *
 * Separate from `evaluateProjection` rather than a field on its result,
 * because `yarramate/projection-result/v1` is a published document with
 * `additionalProperties: false` and this is a question about a query rather
 * than part of what a projection IS.
 */
export function explainProjection(
  graph: SemanticGraph,
  projection: ProjectionDefinition,
  profileContext?: ResolvedProfileContext,
): readonly ProjectionExclusion[] {
  const { droppedBy } = conceptSelector(graph, projection, profileContext)
  const exclusions: ProjectionExclusion[] = []
  for (const subject of graph.subjects) {
    if (subject.type !== 'concept') continue
    const facet = droppedBy(subject.id)
    if (facet !== undefined) exclusions.push({ id: subject.id, facet })
  }
  return exclusions
}

export function evaluateProjection(
  graph: SemanticGraph,
  projection: ProjectionDefinition,
  profileContext?: ResolvedProfileContext,
): ProjectionResult {
  const { droppedBy, architectureStateIds, participatesInSelectedState } =
    conceptSelector(graph, projection, profileContext)
  const endpointExcluded = (id: string): boolean => {
    // An exclusion is final (#267, ADR 0122). Dropping the subject from the
    // initial selection alone would not be: `relationships: connected` adds
    // the far end of every relationship it draws, so an excluded subject would
    // walk back in by the other end of a relationship to one that stayed.
    if (projection.query.exclude?.includes(id) === true) return true
    if (!participatesInSelectedState(id)) return true
    const status = claimValue(
      graph.claims,
      id,
      'yarramate/lifecycle/status',
    )
    return (
      status !== undefined &&
      projection.query.excludeStatuses?.includes(status as LifecycleStatus) ===
        true
    )
  }
  const initiallySelectedConceptIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'concept')
      .filter(({ id }) => droppedBy(id) === undefined)
      .map(({ id }) => id),
  )
  const selectedConceptIds = new Set(initiallySelectedConceptIds)

  const selectedRelationshipIds = new Set<string>()
  const relationshipMode = projection.query.relationships ?? 'between'
  if (relationshipMode !== 'none') {
    for (const subject of graph.subjects) {
      if (subject.type !== 'relationship') continue
      const relationship = graph.claims.find(
        (claim) => claim.id === subject.id,
      )

      const relationshipStatus = claimValue(
        graph.claims,
        subject.id,
        'yarramate/lifecycle/status',
      )
      if (
        // A relationship can be taken out by name too: `exclude` names
        // subjects, and a relationship is a subject.
        projection.query.exclude?.includes(subject.id) === true ||
        relationship === undefined ||
        !('ref' in relationship.object) ||
        (projection.query.excludeStatuses !== undefined &&
          relationshipStatus !== undefined &&
          projection.query.excludeStatuses.includes(
            relationshipStatus as LifecycleStatus,
          )) ||
        (projection.query.relationshipKinds !== undefined &&
          !projection.query.relationshipKinds.some(
            (selectedKind) =>
              selectedKind === relationship.predicate ||
              (projection.query.kindMatching === 'descendants' &&
                profileContext?.relationshipKindLineages
                  .get(relationship.predicate)
                  ?.includes(selectedKind) === true),
          )) ||
        !participatesInSelectedState(subject.id)
      ) {
        continue
      }
      const sourceSelected = initiallySelectedConceptIds.has(
        relationship.subject,
      )
      const targetSelected = initiallySelectedConceptIds.has(
        relationship.object.ref,
      )
      if (
        endpointExcluded(relationship.subject) ||
        endpointExcluded(relationship.object.ref)
      ) {
        continue
      }
      if (
        (relationshipMode === 'between' &&
          sourceSelected &&
          targetSelected) ||
        (relationshipMode === 'connected' &&
          (sourceSelected || targetSelected))
      ) {
        selectedRelationshipIds.add(subject.id)
        if (relationshipMode === 'connected') {
          selectedConceptIds.add(relationship.subject)
          selectedConceptIds.add(relationship.object.ref)
        }
      }
    }
  }
  if (projection.query.isolatedConcepts === 'exclude') {
    const relationshipEndpoints = new Set<string>()
    for (const relationshipId of selectedRelationshipIds) {
      const relationship = graph.claims.find(
        ({ id, object }) => id === relationshipId && 'ref' in object,
      )
      if (relationship !== undefined && 'ref' in relationship.object) {
        relationshipEndpoints.add(relationship.subject)
        relationshipEndpoints.add(relationship.object.ref)
      }
    }
    for (const conceptId of selectedConceptIds) {
      if (!relationshipEndpoints.has(conceptId)) {
        selectedConceptIds.delete(conceptId)
      }
    }
  }

  const selectedSubjectIds = new Set([
    ...selectedConceptIds,
    ...selectedRelationshipIds,
  ])
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const subjects = graph.subjects.filter(({ id }) => selectedSubjectIds.has(id))
  const claims = graph.claims.filter(
    (claim) =>
      (selectedConceptIds.has(claim.subject) &&
        !relationshipIds.has(claim.id)) ||
      selectedRelationshipIds.has(claim.subject) ||
      selectedRelationshipIds.has(claim.id),
  )
  const selectedDocuments = new Set(
    [...selectedConceptIds].map((id) => id.slice(0, id.indexOf('#'))),
  )

  return {
    format: 'yarramate/projection-result/v1',
    projection: `${projection.id}@${projection.version}`,
    ...(projection.presentation === undefined
      ? {}
      : {
          presentation: {
            ...(projection.presentation.title === undefined
              ? {}
              : { title: projection.presentation.title }),
            ...(projection.presentation.description === undefined
              ? {}
              : { description: projection.presentation.description }),
            ...(projection.presentation.layout === undefined
              ? {}
              : { layout: projection.presentation.layout }),
            ...(projection.presentation.direction === undefined
              ? {}
              : { direction: projection.presentation.direction }),
            ...(projection.presentation.nesting === undefined
              ? {}
              : { nesting: projection.presentation.nesting }),
            ...(projection.presentation.showLifecycle === undefined
              ? {}
              : { showLifecycle: projection.presentation.showLifecycle }),
            ...(projection.presentation.showEvidence === undefined
              ? {}
              : { showEvidence: projection.presentation.showEvidence }),
            ...(projection.presentation.showOwnership === undefined
              ? {}
              : { showOwnership: projection.presentation.showOwnership }),
            ...(projection.presentation.notation === undefined
              ? {}
              : { notation: projection.presentation.notation }),
          },
        }),
    documents: graph.documents.filter(({ id }) => selectedDocuments.has(id)),
    subjects,
    claims,
  }
}

const markdownText = (value: string) =>
  value.replaceAll('\n', ' ').replaceAll('`', '\\`')

export function renderProjectionMarkdown(
  result: ProjectionResult,
  profileContext?: ResolvedProfileContext,
): string {
  const title = result.presentation?.title ?? result.projection
  const concepts = result.subjects.filter(({ type }) => type === 'concept')
  const relationships = result.subjects.filter(
    ({ type }) => type === 'relationship',
  )
  const lines = [`# ${markdownText(title)}`, '']

  if (result.presentation?.description !== undefined) {
    lines.push(markdownText(result.presentation.description), '')
  }

  lines.push('## Concepts', '')
  for (const concept of concepts) {
    const name =
      claimValue(result.claims, concept.id, 'yarramate/concept/name') ??
      concept.id
    const kind =
      claimValue(result.claims, concept.id, 'yarramate/concept/kind') ??
      'unknown'
    const status = claimValue(
      result.claims,
      concept.id,
      'yarramate/lifecycle/status',
    )
    lines.push(
      `- ${markdownText(name)} (\`${concept.id}\`) — \`${kind}\`${status === undefined ? '' : ` — ${status}`}`,
    )
  }

  lines.push('', '## Relationships', '')
  for (const relationship of relationships) {
    const claim = result.claims.find(
      ({ id, object }) => id === relationship.id && 'ref' in object,
    )
    if (claim !== undefined && 'ref' in claim.object) {
      lines.push(
        `- \`${claim.subject}\` — \`${claim.predicate}\` → \`${claim.object.ref}\` (\`${relationship.id}\`)`,
      )
    }
  }

  // First-class non-goals (ADR 0073): retired goals, outcomes, and
  // requirements in the result are declared decisions, not history to
  // bury. They stay in the Concepts inventory above (relationship
  // endpoints must resolve there) and are restated here with their
  // rationale. Subjects a projection's excludeStatuses dropped never
  // reach this renderer, so exclusion still wins.
  const nonGoals = concepts.filter(({ id }) =>
    isDeclaredNonGoal(
      claimValue(result.claims, id, 'yarramate/concept/kind'),
      claimValue(result.claims, id, 'yarramate/lifecycle/status'),
      profileContext?.conceptKindLineages,
    ),
  )
  if (nonGoals.length > 0) {
    lines.push('', '## Non-goals', '')
    for (const concept of nonGoals) {
      const name =
        claimValue(result.claims, concept.id, 'yarramate/concept/name') ??
        concept.id
      const description = claimValue(
        result.claims,
        concept.id,
        'yarramate/concept/description',
      )
      lines.push(
        `- ${markdownText(name)} (\`${concept.id}\`)${description === undefined ? '' : ` — ${markdownText(description)}`}`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export function renderBudgetedContext(
  result: ProjectionResult,
  budgetTokens: number,
): string {
  const concepts = result.subjects.filter(({ type }) => type === 'concept')
  const relationships = result.subjects.filter(
    ({ type }) => type === 'relationship',
  )
  const title = result.presentation?.title ?? result.projection

  const header: string[] = [
    `context ${result.projection} — ${title}`,
    `subjects: ${concepts.length} concepts, ${relationships.length} relationships`,
  ]
  const subjectLines: string[] = []
  for (const concept of concepts) {
    const name = claimValue(
      result.claims,
      concept.id,
      'yarramate/concept/name',
    )
    const kind =
      claimValue(result.claims, concept.id, 'yarramate/concept/kind') ??
      'unknown'
    const status = claimValue(
      result.claims,
      concept.id,
      'yarramate/lifecycle/status',
    )
    subjectLines.push(
      `- ${concept.id} [${kind.split('#')[1] ?? kind}]` +
        `${name === undefined ? '' : ` ${name}`}` +
        `${status === undefined ? '' : ` (${status})`}`,
    )
  }

  const relationshipLines: string[] = []
  for (const relationship of relationships) {
    const claim = result.claims.find(
      ({ id, object }) => id === relationship.id && 'ref' in object,
    )
    if (claim !== undefined && 'ref' in claim.object) {
      const kind = claim.predicate.split('#')[1] ?? claim.predicate
      relationshipLines.push(
        `- ${claim.subject} -${kind}-> ${claim.object.ref}`,
      )
    }
  }

  const descriptionLines: string[] = []
  for (const subject of result.subjects) {
    const description =
      claimValue(
        result.claims,
        subject.id,
        'yarramate/concept/description',
      ) ??
      claimValue(
        result.claims,
        subject.id,
        'yarramate/relationship/description',
      )
    if (description !== undefined) {
      descriptionLines.push(`- ${subject.id}: ${description}`)
    }
  }

  const detailPredicates = new Set([
    'yarramate/ownership/owner',
    'yarramate/constraint/requires',
    'yarramate/reference/refers-to',
    'yarramate/access/mode',
    'yarramate/state/present-in',
  ])
  const detailLines: string[] = []
  for (const claim of result.claims) {
    if (!detailPredicates.has(claim.predicate)) continue
    const value = 'ref' in claim.object ? claim.object.ref : claim.object.value
    const predicate = claim.predicate.split('/').pop() ?? claim.predicate
    detailLines.push(`- ${claim.subject} ${predicate}: ${value}`)
  }

  // Ranked ladder: the two header lines always render; every other line —
  // including the subject skeleton — competes for the remaining budget in
  // priority order, and anything dropped is always announced rather than
  // silently omitted.
  const sections: ReadonlyArray<{
    readonly heading: string
    readonly lines: readonly string[]
  }> = [
    { heading: 'relationships:', lines: relationshipLines },
    { heading: 'descriptions:', lines: descriptionLines },
    { heading: 'details:', lines: detailLines },
  ]
  const rendered: string[] = [...header]
  const omitted: string[] = []
  let spent = estimateTokens(rendered.join('\n'))
  let droppedSubjects = 0
  for (const line of subjectLines) {
    const cost = estimateTokens(line)
    if (spent + cost > budgetTokens) {
      droppedSubjects += 1
      continue
    }
    rendered.push(line)
    spent += cost
  }
  if (droppedSubjects > 0) {
    omitted.push(`subjects ${droppedSubjects} omitted`)
  }
  for (const section of sections) {
    if (section.lines.length === 0) continue
    const kept: string[] = [section.heading]
    let sectionSpent = estimateTokens(section.heading)
    let dropped = 0
    for (const line of section.lines) {
      const cost = estimateTokens(line)
      if (spent + sectionSpent + cost > budgetTokens) {
        dropped += 1
        continue
      }
      kept.push(line)
      sectionSpent += cost
    }
    if (kept.length > 1) {
      rendered.push('', ...kept)
      spent += sectionSpent
    } else {
      dropped = section.lines.length
    }
    if (dropped > 0) {
      omitted.push(
        `${section.heading.replace(':', '')} ${dropped} omitted`,
      )
    }
  }
  if (omitted.length > 0) {
    rendered.push(
      '',
      `[budget ${budgetTokens}: ${omitted.join('; ')} — raise --budget or use JSON mode for the complete slice]`,
    )
  }
  return `${rendered.join('\n')}\n`
}
