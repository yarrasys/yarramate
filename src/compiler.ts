import Ajv2020Module from 'ajv/dist/2020.js'
import { LineCounter, parseDocument } from 'yaml'
import {
  conceptKinds,
  relationshipKinds,
  relationshipPolicies,
} from './profile.js'
import documentSchema from '../schema/yarramate-document.schema.json' with {
  type: 'json',
}

const knownConceptKinds = new Set(conceptKinds.map(({ id }) => id))
const conceptKindById = new Map(conceptKinds.map((kind) => [kind.id, kind]))
const knownRelationshipKinds = new Set<string>(relationshipKinds)
const relationshipPolicyById = new Map(
  relationshipPolicies.map((policy) => [policy.id, policy]),
)
const coreProfile = 'yarramate/core@0.1'
const Ajv2020 = Ajv2020Module.default
const validateDocument = new Ajv2020({ allErrors: true }).compile(documentSchema)

export interface WorkspaceSource {
  readonly path: string
  readonly source: string
}

export interface Diagnostic {
  readonly severity: 'error'
  readonly code: string
  readonly message: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

interface NativeConcept {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description?: string
}

interface NativeRelationship {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly name?: string
  readonly mode?: 'read' | 'write' | 'read-write' | 'unspecified'
  readonly content?: string
}

interface NativeDocument {
  readonly format: 'yarramate/v1'
  readonly id: string
  readonly profile: string
  readonly concepts: readonly NativeConcept[]
  readonly relationships: readonly NativeRelationship[]
}

export interface GraphSource {
  readonly document: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export interface GraphClaim {
  readonly id: string
  readonly subject: string
  readonly predicate: string
  readonly object: { readonly ref: string } | { readonly value: string }
  readonly origin: 'declared'
  readonly source: GraphSource
}

export interface SemanticGraph {
  readonly format: 'yarramate/graph/v1'
  readonly profiles: readonly string[]
  readonly documents: ReadonlyArray<{
    readonly id: string
    readonly source: string
  }>
  readonly subjects: ReadonlyArray<{
    readonly id: string
    readonly type: 'concept' | 'relationship'
  }>
  readonly claims: readonly GraphClaim[]
}

export type CompilationResult =
  | { readonly ok: true; readonly graph: SemanticGraph }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

const compareById = <T extends { readonly id: string }>(left: T, right: T) =>
  left.id.localeCompare(right.id)

const diagnosticFailure = (
  diagnostics: readonly Diagnostic[],
): CompilationResult => ({
  ok: false,
  diagnostics: [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  ),
})

export function compileWorkspace(
  sources: readonly WorkspaceSource[],
): CompilationResult {
  const documents = sources.map((input) => {
    const lineCounter = new LineCounter()
    const yaml = parseDocument(input.source, { lineCounter })
    const value = yaml.toJS() as NativeDocument

    const location = (
      yamlPath: readonly (string | number)[],
      pointer: string,
    ): GraphSource => {
      const node = yaml.getIn(yamlPath, true)
      const offset =
        typeof node === 'object' &&
        node !== null &&
        'range' in node &&
        Array.isArray(node.range)
          ? node.range[0]
          : 0
      const position = lineCounter.linePos(offset)
      return {
        document: value?.id ?? '<unknown>',
        path: input.path,
        pointer,
        line: position.line,
        column: position.col,
      }
    }

    const parseDiagnostics: Diagnostic[] = yaml.errors.map((error) => {
      const position = error.linePos?.[0] ?? { line: 1, col: 1 }
      return {
        severity: 'error',
        code: 'YM101',
        message: error.message.split(' at line ')[0] ?? error.message,
        path: input.path,
        pointer: '/',
        line: position.line,
        column: position.col,
      }
    })
    const valid = parseDiagnostics.length === 0 && validateDocument(value)
    const schemaDiagnostics: Diagnostic[] =
      parseDiagnostics.length > 0
        ? parseDiagnostics
        : valid
          ? []
          : (validateDocument.errors ?? []).map((error) => {
              const property =
                error.keyword === 'additionalProperties'
                  ? String(error.params.additionalProperty)
                  : undefined
              const pointer = property
                ? `${error.instancePath}/${property}`
                : error.instancePath || '/'
              const yamlPath = pointer
                .split('/')
                .slice(1)
                .map((segment) =>
                  /^\d+$/.test(segment) ? Number(segment) : segment,
                )
              const source = location(yamlPath, pointer)
              return {
                severity: 'error',
                code: 'YM201',
                message: property
                  ? `Property "${property}" is not allowed`
                  : `Document schema violation: ${error.message ?? error.keyword}`,
                path: input.path,
                pointer,
                line: source.line,
                column: source.column,
              }
            })

    return { input, value, location, schemaDiagnostics }
  })

  const claims: GraphClaim[] = []
  const subjects: SemanticGraph['subjects'][number][] = []
  const diagnostics: Diagnostic[] = documents.flatMap(
    ({ schemaDiagnostics }) => schemaDiagnostics,
  )

  if (diagnostics.length > 0) {
    return diagnosticFailure(diagnostics)
  }

  const seenDocumentIds = new Set<string>()
  for (const { input, value, location } of documents) {
    if (seenDocumentIds.has(value.id)) {
      const source = location(['id'], '/id')
      diagnostics.push({
        severity: 'error',
        code: 'YM303',
        message: `Duplicate document ID "${value.id}"`,
        path: input.path,
        pointer: '/id',
        line: source.line,
        column: source.column,
      })
    }
    seenDocumentIds.add(value.id)
  }

  for (const { input, value, location } of documents) {
    if (value.profile !== coreProfile) {
      const source = location(['profile'], '/profile')
      diagnostics.push({
        severity: 'error',
        code: 'YM403',
        message: `Profile "${value.profile}" is not available`,
        path: input.path,
        pointer: '/profile',
        line: source.line,
        column: source.column,
      })
      continue
    }

    const seenIds = new Set<string>()
    const declarations = [
      ...value.concepts.map((concept, index) => ({
        id: concept.id,
        yamlPath: ['concepts', index, 'id'] as const,
        pointer: `/concepts/${index}/id`,
      })),
      ...value.relationships.map((relationship, index) => ({
        id: relationship.id,
        yamlPath: ['relationships', index, 'id'] as const,
        pointer: `/relationships/${index}/id`,
      })),
    ]
    for (const declaration of declarations) {
      if (seenIds.has(declaration.id)) {
        const source = location(declaration.yamlPath, declaration.pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM301',
          message: `Duplicate local ID "${declaration.id}"`,
          path: input.path,
          pointer: declaration.pointer,
          line: source.line,
          column: source.column,
        })
      }
      seenIds.add(declaration.id)
    }

    const conceptIds = new Set(value.concepts.map(({ id }) => id))
    const conceptById = new Map(
      value.concepts.map((concept) => [concept.id, concept]),
    )
    for (const [index, concept] of value.concepts.entries()) {
      if (!knownConceptKinds.has(concept.kind)) {
        const pointer = `/concepts/${index}/kind`
        const source = location(['concepts', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM401',
          message: `Unknown concept kind "${concept.kind}" in profile "${value.profile}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
    }
    const wholePartByEndpoints = new Map<
      string,
      { readonly id: string; readonly kind: 'composition' | 'aggregation' }
    >()
    for (const [index, relationship] of value.relationships.entries()) {
      for (const controlled of [
        { field: 'mode', kind: 'access' },
        { field: 'content', kind: 'flow' },
      ] as const) {
        if (
          relationship[controlled.field] !== undefined &&
          relationship.kind !== controlled.kind
        ) {
          const pointer = `/relationships/${index}/${controlled.field}`
          const source = location(
            ['relationships', index, controlled.field],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM405',
            message: `Field "${controlled.field}" is only valid for relationship kind "${controlled.kind}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      if (!knownRelationshipKinds.has(relationship.kind)) {
        const pointer = `/relationships/${index}/kind`
        const source = location(['relationships', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM402',
          message: `Unknown relationship kind "${relationship.kind}" in profile "${value.profile}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      if (
        relationship.kind === 'composition' ||
        relationship.kind === 'aggregation'
      ) {
        const endpointKey = `${relationship.from}\u0000${relationship.to}`
        const previous = wholePartByEndpoints.get(endpointKey)
        if (previous !== undefined && previous.kind !== relationship.kind) {
          const pointer = `/relationships/${index}/kind`
          const source = location(['relationships', index, 'kind'], pointer)
          diagnostics.push({
            severity: 'error',
            code: 'YM501',
            message: `Relationship "${relationship.id}" contradicts "${previous.id}": the same endpoints cannot be both aggregation and composition`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else if (previous === undefined) {
          wholePartByEndpoints.set(endpointKey, {
            id: relationship.id,
            kind: relationship.kind,
          })
        }
      }
      for (const endpoint of ['from', 'to'] as const) {
        const reference = relationship[endpoint]
        if (!conceptIds.has(reference)) {
          const pointer = `/relationships/${index}/${endpoint}`
          const source = location(
            ['relationships', index, endpoint],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM302',
            message: `Unresolved concept reference "${reference}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      const policy = relationshipPolicyById.get(
        relationship.kind as (typeof relationshipKinds)[number],
      )
      if (policy !== undefined) {
        for (const endpoint of ['source', 'target'] as const) {
          const reference =
            endpoint === 'source' ? relationship.from : relationship.to
          const concept = conceptById.get(reference)
          const kind =
            concept === undefined ? undefined : conceptKindById.get(concept.kind)
          const allowed =
            endpoint === 'source'
              ? policy.sourceAspects
              : policy.targetAspects
          if (
            kind !== undefined &&
            allowed !== undefined &&
            !allowed.includes(kind.aspect)
          ) {
            const field = endpoint === 'source' ? 'from' : 'to'
            const pointer = `/relationships/${index}/${field}`
            const source = location(
              ['relationships', index, field],
              pointer,
            )
            diagnostics.push({
              severity: 'error',
              code: 'YM404',
              message: `Relationship "${relationship.kind}" requires a ${endpoint} with aspect ${allowed.map((aspect) => `"${aspect}"`).join(' or ')}; "${reference}" has aspect "${kind.aspect}"`,
              path: input.path,
              pointer,
              line: source.line,
              column: source.column,
            })
          }
        }
      }
    }

    for (const [index, concept] of value.concepts.entries()) {
      const subject = `${value.id}#${concept.id}`
      subjects.push({ id: subject, type: 'concept' })
      claims.push(
        {
          id: `${subject}~kind`,
          subject,
          predicate: 'yarramate/concept/kind',
          object: { value: concept.kind },
          origin: 'declared',
          source: location(
            ['concepts', index, 'kind'],
            `/concepts/${index}/kind`,
          ),
        },
        {
          id: `${subject}~name`,
          subject,
          predicate: 'yarramate/concept/name',
          object: { value: concept.name },
          origin: 'declared',
          source: location(
            ['concepts', index, 'name'],
            `/concepts/${index}/name`,
          ),
        },
      )
      if (concept.description !== undefined) {
        claims.push({
          id: `${subject}~description`,
          subject,
          predicate: 'yarramate/concept/description',
          object: { value: concept.description },
          origin: 'declared',
          source: location(
            ['concepts', index, 'description'],
            `/concepts/${index}/description`,
          ),
        })
      }
    }

    for (const [index, relationship] of value.relationships.entries()) {
      const id = `${value.id}#${relationship.id}`
      subjects.push({ id, type: 'relationship' })
      claims.push({
        id,
        subject: `${value.id}#${relationship.from}`,
        predicate: `yarramate/relationship/${relationship.kind}`,
        object: { ref: `${value.id}#${relationship.to}` },
        origin: 'declared',
        source: location(
          ['relationships', index],
          `/relationships/${index}`,
        ),
      })
      if (relationship.name !== undefined) {
        claims.push({
          id: `${id}~name`,
          subject: id,
          predicate: 'yarramate/relationship/name',
          object: { value: relationship.name },
          origin: 'declared',
          source: location(
            ['relationships', index, 'name'],
            `/relationships/${index}/name`,
          ),
        })
      }
      if (relationship.mode !== undefined) {
        claims.push({
          id: `${id}~mode`,
          subject: id,
          predicate: 'yarramate/access/mode',
          object: { value: relationship.mode },
          origin: 'declared',
          source: location(
            ['relationships', index, 'mode'],
            `/relationships/${index}/mode`,
          ),
        })
      }
      if (relationship.content !== undefined) {
        claims.push({
          id: `${id}~content`,
          subject: id,
          predicate: 'yarramate/flow/content',
          object: { value: relationship.content },
          origin: 'declared',
          source: location(
            ['relationships', index, 'content'],
            `/relationships/${index}/content`,
          ),
        })
      }
    }
  }

  if (diagnostics.length > 0) {
    return diagnosticFailure(diagnostics)
  }

  return {
    ok: true,
    graph: {
      format: 'yarramate/graph/v1',
      profiles: [...new Set(documents.map(({ value }) => value.profile))].sort(),
      documents: documents
        .map(({ input, value }) => ({ id: value.id, source: input.path }))
        .sort(compareById),
      subjects: subjects.sort(compareById),
      claims: claims.sort(compareById),
    },
  }
}
