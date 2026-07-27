import Ajv2020Module from 'ajv/dist/2020.js'
import type {
  Diagnostic,
  GraphClaim,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
import { loadSourceDocument } from './source-document.js'
import projectionSchema from '../schema/yarramate-projection.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
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
    readonly statuses?: readonly LifecycleStatus[]
    readonly owners?: readonly string[]
    readonly constraints?: readonly string[]
    readonly relationships?: 'between' | 'none'
  }
  readonly presentation?: {
    readonly title?: string
    readonly description?: string
  }
}

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
): ProjectionResult {
  const selectedConceptIds = new Set(
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
          (projection.query.subjects === undefined ||
            projection.query.subjects.includes(id)) &&
          (projection.query.documents === undefined ||
            projection.query.documents.includes(documentId)) &&
          (projection.query.kinds === undefined ||
            (kind !== undefined && projection.query.kinds.includes(kind))) &&
          (projection.query.statuses === undefined ||
            (status !== undefined &&
              projection.query.statuses.includes(status as LifecycleStatus))) &&
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

  const selectedRelationshipIds = new Set<string>()
  if ((projection.query.relationships ?? 'between') === 'between') {
    for (const subject of graph.subjects) {
      if (subject.type !== 'relationship') continue
      const relationship = graph.claims.find(
        (claim) => claim.id === subject.id,
      )
      if (
        relationship !== undefined &&
        'ref' in relationship.object &&
        selectedConceptIds.has(relationship.subject) &&
        selectedConceptIds.has(relationship.object.ref)
      ) {
        selectedRelationshipIds.add(subject.id)
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
          },
        }),
    documents: graph.documents.filter(({ id }) => selectedDocuments.has(id)),
    subjects,
    claims,
  }
}

const markdownText = (value: string) =>
  value.replaceAll('\n', ' ').replaceAll('`', '\\`')

export function renderProjectionMarkdown(result: ProjectionResult): string {
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

  return `${lines.join('\n')}\n`
}
