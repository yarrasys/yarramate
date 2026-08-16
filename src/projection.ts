import { createRequire } from 'node:module'
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
import projectionSchema from '../schema/yarramate-projection.schema.json' with {
  type: 'json',
}

// `ajv/dist/2020.js` is CJS. Its default-export shape is resolved
// differently under this repo's two tsconfigs: NodeNext (root) sees the raw
// `module.exports` (needs `.default`), Bundler+esModuleInterop
// (tsconfig.visual.json) sees the already-unwrapped class. `require()`
// sidesteps the value-level ambiguity; the type is normalized the same way.
type Ajv2020Ctor = typeof Ajv2020Type extends { default: infer D } ? D : typeof Ajv2020Type
const require = createRequire(import.meta.url)
const ajv2020Module = require('ajv/dist/2020.js') as { default?: Ajv2020Ctor } & Ajv2020Ctor
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const validateProjection = new Ajv2020({ allErrors: true }).compile(
  projectionSchema,
)

export type LifecycleStatus = 'planned' | 'current' | 'retired'

export interface ProjectionDefinition {
  readonly format: 'yarramate/projection/v1'
  readonly id: string
  readonly version: string
  readonly query: {
    readonly subjects?: readonly string[]
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
    readonly layout?: 'layered' | 'radial' | 'force'
    readonly direction?: 'top-down' | 'left-right'
    readonly seed?: string
    readonly showLifecycle?: boolean
    readonly showEvidence?: boolean
    readonly showOwnership?: boolean
    readonly notation?: 'native' | 'archimate'
  }
}

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
    validateProjection,
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
            ...(presentation.seed === undefined ? {} : { seed: presentation.seed }),
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

export function evaluateProjection(
  graph: SemanticGraph,
  projection: ProjectionDefinition,
  profileContext?: ResolvedProfileContext,
): ProjectionResult {
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
  const endpointExcluded = (id: string): boolean => {
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
      .filter(({ id }) => {
        const documentId = id.slice(0, id.indexOf('#'))
        const kind = claimValue(
          graph.claims,
          id,
          'yarramate/concept/kind',
        )
        const status = claimValue(
          graph.claims,
          id,
          'yarramate/lifecycle/status',
        )
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
        return (
          (projection.query.states === undefined ||
            (!architectureStateIds.has(id) &&
              participatesInSelectedState(id))) &&
          (projection.query.subjects === undefined ||
            projection.query.subjects.includes(id)) &&
          (projection.query.documents === undefined ||
            projection.query.documents.includes(documentId)) &&
          (projection.query.kinds === undefined ||
            (kind !== undefined &&
              projection.query.kinds.some(
                (selectedKind) =>
                  selectedKind === kind ||
                  (projection.query.kindMatching === 'descendants' &&
                    profileContext?.conceptKindLineages
                      .get(kind)
                      ?.includes(selectedKind) === true),
              ))) &&
          (projection.query.layers === undefined ||
            (kind !== undefined &&
              profileContext?.conceptKindLayers.get(kind) !== undefined &&
              projection.query.layers.includes(
                profileContext.conceptKindLayers.get(kind)!,
              ))) &&
          (projection.query.statuses === undefined ||
            (status !== undefined &&
              projection.query.statuses.includes(status as LifecycleStatus))) &&
          (projection.query.excludeStatuses === undefined ||
            status === undefined ||
            !projection.query.excludeStatuses.includes(
              status as LifecycleStatus,
            )) &&
          (projection.query.owners === undefined ||
            (owner !== undefined &&
              projection.query.owners.includes(owner))) &&
          (projection.query.constraints === undefined ||
            constraints.some((constraint) =>
              projection.query.constraints?.includes(constraint),
            ))
        )
      })
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
            ...(projection.presentation.seed === undefined
              ? {}
              : { seed: projection.presentation.seed }),
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
