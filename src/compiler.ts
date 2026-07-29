import Ajv2020Module from 'ajv/dist/2020.js'
import { LineCounter, parseDocument } from 'yaml'
import {
  conceptKinds,
  relationshipPolicies,
} from './profile.js'
import {
  closestCandidate,
  describeSchemaViolation,
} from './source-document.js'
import documentSchema from '../schema/yarramate-document.schema.json' with {
  type: 'json',
}
import profileSchema from '../schema/yarramate-profile.schema.json' with {
  type: 'json',
}

const coreProfile = 'yarramate/core@0.1'
const Ajv2020 = Ajv2020Module.default
const validateDocument = new Ajv2020({ allErrors: true }).compile(documentSchema)
const validateProfile = new Ajv2020({ allErrors: true }).compile(profileSchema)

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
  readonly status?: 'planned' | 'current' | 'retired'
  readonly owner?: string
  readonly constraints?: ReadonlyArray<{
    readonly id: string
    readonly ref: string
  }>
  readonly references?: readonly NativeIdentifiedReference[]
  readonly presentIn?: readonly string[]
}

interface NativeIdentifiedReference {
  readonly id: string
  readonly ref: string
}

interface NativeRelationship {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly name?: string
  readonly description?: string
  readonly mode?: 'read' | 'write' | 'read-write' | 'unspecified'
  readonly content?: string
  readonly status?: 'planned' | 'current' | 'retired'
  readonly references?: readonly NativeIdentifiedReference[]
  readonly presentIn?: readonly string[]
}

interface NativeArchitectureState {
  readonly id: string
  readonly kind: 'baseline' | 'transition' | 'target'
  readonly name: string
  readonly description?: string
  readonly after?: string
}

interface NativeDocument {
  readonly format: 'yarramate/v1'
  readonly id: string
  readonly profile: string
  readonly states?: readonly NativeArchitectureState[]
  readonly concepts: readonly NativeConcept[]
  readonly relationships: readonly NativeRelationship[]
}

interface NativeProfileKind {
  readonly id: string
  readonly name: string
  readonly parent: string
}

interface NativeProfileRelationshipKind extends NativeProfileKind {
  readonly sourceAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly targetAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
}

interface NativeProfile {
  readonly format: 'yarramate/profile/v1'
  readonly id: string
  readonly version: string
  readonly extends: string
  readonly conceptKinds: readonly NativeProfileKind[]
  readonly relationshipKinds: readonly NativeProfileRelationshipKind[]
}

interface ResolvedConceptKind {
  readonly identity: string
  readonly aspect: (typeof conceptKinds)[number]['aspect']
  readonly lineage: readonly string[]
}

interface ResolvedRelationshipKind {
  readonly identity: string
  readonly lineage: readonly string[]
  readonly sourceAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly targetAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
}

interface ResolvedProfile {
  readonly identity: string
  readonly lineage: readonly string[]
  readonly conceptKinds: ReadonlyMap<string, ResolvedConceptKind>
  readonly relationshipKinds: ReadonlyMap<string, ResolvedRelationshipKind>
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
  readonly format: 'yarramate/graph/v2'
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

export interface ResolvedProfileContext {
  readonly conceptKindLineages: ReadonlyMap<string, readonly string[]>
  readonly relationshipKindLineages: ReadonlyMap<string, readonly string[]>
}

export type CompilationResult =
  | { readonly ok: true; readonly graph: SemanticGraph }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type ContextualCompilationResult =
  | {
      readonly ok: true
      readonly graph: SemanticGraph
      readonly profileContext: ResolvedProfileContext
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

const compareById = <T extends { readonly id: string }>(left: T, right: T) =>
  left.id.localeCompare(right.id)

const presenceClaimId = (subject: string, state: string) =>
  `${subject}~present-in-${Buffer.from(state, 'utf8').toString('hex')}`

const diagnosticFailure = (
  diagnostics: readonly Diagnostic[],
): Extract<CompilationResult, { readonly ok: false }> => ({
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

function compileWorkspaceResolved(
  sources: readonly WorkspaceSource[],
): ContextualCompilationResult {
  const profileInputs: WorkspaceSource[] = []
  const documentInputs: WorkspaceSource[] = []
  for (const source of sources) {
    const probe = parseDocument(source.source)
    if (probe.get('format') === 'yarramate/profile/v1') {
      profileInputs.push(source)
    } else {
      documentInputs.push(source)
    }
  }

  const profiles = new Map<string, ResolvedProfile>()
  const conceptKindByIdentity = new Map<string, ResolvedConceptKind>()
  const relationshipKindByIdentity = new Map<string, ResolvedRelationshipKind>()
  const coreConceptKinds = new Map<string, ResolvedConceptKind>()
  for (const kind of conceptKinds) {
    const resolved = {
      identity: `${coreProfile}#${kind.id}`,
      aspect: kind.aspect,
      lineage: [`${coreProfile}#${kind.id}`],
    } satisfies ResolvedConceptKind
    coreConceptKinds.set(kind.id, resolved)
    conceptKindByIdentity.set(resolved.identity, resolved)
  }
  const coreRelationshipKinds = new Map<string, ResolvedRelationshipKind>()
  for (const policy of relationshipPolicies) {
    const resolved = {
      identity: `${coreProfile}#${policy.id}`,
      lineage: [`${coreProfile}#${policy.id}`],
      sourceAspects: policy.sourceAspects,
      targetAspects: policy.targetAspects,
    } satisfies ResolvedRelationshipKind
    coreRelationshipKinds.set(policy.id, resolved)
    relationshipKindByIdentity.set(resolved.identity, resolved)
  }
  profiles.set(coreProfile, {
    identity: coreProfile,
    lineage: [coreProfile],
    conceptKinds: coreConceptKinds,
    relationshipKinds: coreRelationshipKinds,
  })

  const profileDiagnostics: Diagnostic[] = []
  const pendingProfiles: Array<{
    readonly input: WorkspaceSource
    readonly value: NativeProfile
    readonly identity: string
    readonly positionFor: (
      yamlPath: readonly (string | number)[],
    ) => { readonly line: number; readonly col: number }
  }> = []
  for (const input of profileInputs) {
    const lineCounter = new LineCounter()
    const yaml = parseDocument(input.source, { lineCounter })
    const value = yaml.toJS() as NativeProfile
    const positionFor = (yamlPath: readonly (string | number)[]) => {
      const node = yaml.getIn(yamlPath, true)
      const offset =
        typeof node === 'object' &&
        node !== null &&
        'range' in node &&
        Array.isArray(node.range)
          ? node.range[0]
          : 0
      return lineCounter.linePos(offset)
    }
    if (yaml.errors.length > 0) {
      for (const error of yaml.errors) {
        const position = error.linePos?.[0] ?? { line: 1, col: 1 }
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM101',
          message: error.message.split(' at line ')[0] ?? error.message,
          path: input.path,
          pointer: '/',
          line: position.line,
          column: position.col,
        })
      }
      continue
    }
    if (!validateProfile(value)) {
      for (const error of validateProfile.errors ?? []) {
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
        const position = positionFor(yamlPath)
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM201',
          message: property
            ? `Property "${property}" is not allowed`
            : `Profile schema violation: ${describeSchemaViolation(error)}`,
          path: input.path,
          pointer,
          line: position.line,
          column: position.col,
        })
      }
      continue
    }

    const identity = `${value.id}@${value.version}`
    pendingProfiles.push({ input, value, identity, positionFor })
  }

  let unresolvedProfiles = pendingProfiles.sort((left, right) =>
    left.identity.localeCompare(right.identity) ||
    left.input.path.localeCompare(right.input.path),
  )
  while (unresolvedProfiles.length > 0) {
    const next: typeof unresolvedProfiles = []
    let resolvedAny = false

    for (const entry of unresolvedProfiles) {
      const { input, value, identity, positionFor } = entry
      const parentProfile = profiles.get(value.extends)
      if (parentProfile === undefined) {
        next.push(entry)
        continue
      }
      if (profiles.has(identity)) {
        const position = positionFor(['id'])
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM411',
          message: `Profile "${identity}" is declared more than once`,
          path: input.path,
          pointer: '/id',
          line: position.line,
          column: position.col,
        })
        continue
      }

      const resolvedConceptKinds = new Map(parentProfile.conceptKinds)
      for (const [index, kind] of value.conceptKinds.entries()) {
        if (resolvedConceptKinds.has(kind.id)) {
          const position = positionFor(['conceptKinds', index, 'id'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM409',
            message: `Concept kind "${kind.id}" conflicts with an inherited kind`,
            path: input.path,
            pointer: `/conceptKinds/${index}/id`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        const parent = conceptKindByIdentity.get(kind.parent)
        if (parent === undefined) {
          const position = positionFor(['conceptKinds', index, 'parent'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM407',
            message: `Concept parent "${kind.parent}" is not available`,
            path: input.path,
            pointer: `/conceptKinds/${index}/parent`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        const resolved = {
          identity: `${identity}#${kind.id}`,
          aspect: parent.aspect,
          lineage: [...parent.lineage, `${identity}#${kind.id}`],
        } satisfies ResolvedConceptKind
        resolvedConceptKinds.set(kind.id, resolved)
        conceptKindByIdentity.set(resolved.identity, resolved)
      }

      const resolvedRelationshipKinds = new Map(
        parentProfile.relationshipKinds,
      )
      for (const [index, kind] of value.relationshipKinds.entries()) {
        if (resolvedRelationshipKinds.has(kind.id)) {
          const position = positionFor(['relationshipKinds', index, 'id'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM410',
            message: `Relationship kind "${kind.id}" conflicts with an inherited kind`,
            path: input.path,
            pointer: `/relationshipKinds/${index}/id`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        const parent = relationshipKindByIdentity.get(kind.parent)
        if (parent === undefined) {
          const position = positionFor(['relationshipKinds', index, 'parent'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM408',
            message: `Relationship parent "${kind.parent}" is not available`,
            path: input.path,
            pointer: `/relationshipKinds/${index}/parent`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        let broadensParent = false
        for (const endpoint of ['source', 'target'] as const) {
          const field = `${endpoint}Aspects` as const
          const declared = kind[field]
          const inherited = parent[field]
          if (
            declared !== undefined &&
            inherited !== undefined &&
            declared.some((aspect) => !inherited.includes(aspect))
          ) {
            const position = positionFor([
              'relationshipKinds',
              index,
              field,
            ])
            profileDiagnostics.push({
              severity: 'error',
              code: 'YM412',
              message: `Relationship kind "${kind.id}" broadens its parent ${endpoint} aspects`,
              path: input.path,
              pointer: `/relationshipKinds/${index}/${field}`,
              line: position.line,
              column: position.col,
            })
            broadensParent = true
          }
        }
        if (broadensParent) {
          continue
        }
        const resolved = {
          identity: `${identity}#${kind.id}`,
          lineage: [...parent.lineage, `${identity}#${kind.id}`],
          sourceAspects: kind.sourceAspects ?? parent.sourceAspects,
          targetAspects: kind.targetAspects ?? parent.targetAspects,
        } satisfies ResolvedRelationshipKind
        resolvedRelationshipKinds.set(kind.id, resolved)
        relationshipKindByIdentity.set(resolved.identity, resolved)
      }

      profiles.set(identity, {
        identity,
        lineage: [...parentProfile.lineage, identity],
        conceptKinds: resolvedConceptKinds,
        relationshipKinds: resolvedRelationshipKinds,
      })
      resolvedAny = true
    }

    if (!resolvedAny) {
      for (const { input, value, positionFor } of next) {
        const position = positionFor(['extends'])
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM406',
          message: `Parent profile "${value.extends}" is not available`,
          path: input.path,
          pointer: '/extends',
          line: position.line,
          column: position.col,
        })
      }
      break
    }
    unresolvedProfiles = next
  }

  if (profileDiagnostics.length > 0) {
    return diagnosticFailure(profileDiagnostics)
  }

  const documents = documentInputs.map((input) => {
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
                  : `Document schema violation: ${describeSchemaViolation(error)}`,
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

  const conceptByQualifiedId = new Map<
    string,
    {
      readonly concept: NativeConcept
      readonly profile: string
      readonly document: string
    }
  >(
    documents.flatMap(({ value }) =>
      value.concepts.map(
        (concept) =>
          [
            `${value.id}#${concept.id}`,
            {
              concept,
              profile: value.profile,
              document: value.id,
            },
          ] as const,
      ),
    ),
  )
  const qualifyReference = (documentId: string, reference: string) =>
    reference.includes('#') ? reference : `${documentId}#${reference}`
  const architectureStateIds = new Set(
    documents.flatMap(({ value }) =>
      (value.states ?? []).map((state) => `${value.id}#${state.id}`),
    ),
  )
  const subjectIds = new Set(
    documents.flatMap(({ value }) => [
      ...(value.states ?? []).map((state) => `${value.id}#${state.id}`),
      ...value.concepts.map((concept) => `${value.id}#${concept.id}`),
      ...value.relationships.map(
        (relationship) => `${value.id}#${relationship.id}`,
      ),
    ]),
  )
  const architectureStateAfter = new Map<string, string>(
    documents.flatMap(({ value }) =>
      (value.states ?? []).flatMap((state) =>
        state.after === undefined
          ? []
          : [
              [
                `${value.id}#${state.id}`,
                qualifyReference(value.id, state.after),
              ] as const,
            ],
      ),
    ),
  )
  const participatesInStateCycle = (start: string) => {
    const visited = new Set<string>()
    let current = architectureStateAfter.get(start)
    while (current !== undefined) {
      if (current === start) return true
      if (visited.has(current)) return false
      visited.add(current)
      current = architectureStateAfter.get(current)
    }
    return false
  }

  for (const { input, value, location } of documents) {
    const selectedProfile = profiles.get(value.profile)
    if (selectedProfile === undefined) {
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
      ...(value.states ?? []).map((state, index) => ({
        id: state.id,
        yamlPath: ['states', index, 'id'] as const,
        pointer: `/states/${index}/id`,
      })),
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

    for (const [index, state] of (value.states ?? []).entries()) {
      const stateIdentity = `${value.id}#${state.id}`
      if (
        state.after !== undefined &&
        !architectureStateIds.has(
          qualifyReference(value.id, state.after),
        )
      ) {
        const pointer = `/states/${index}/after`
        const source = location(['states', index, 'after'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM307',
          message: `Unresolved architecture state reference "${state.after}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      if (
        state.after !== undefined &&
        participatesInStateCycle(stateIdentity)
      ) {
        const pointer = `/states/${index}/after`
        const source = location(['states', index, 'after'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM502',
          message: `Architecture state "${stateIdentity}" participates in an ordering cycle`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
    }

    for (const [index, state] of (value.states ?? []).entries()) {
      const subject = `${value.id}#${state.id}`
      subjects.push({ id: subject, type: 'concept' })
      claims.push(
        {
          id: `${subject}~kind`,
          subject,
          predicate: 'yarramate/concept/kind',
          object: { value: `${coreProfile}#plateau` },
          origin: 'declared',
          source: location(
            ['states', index, 'kind'],
            `/states/${index}/kind`,
          ),
        },
        {
          id: `${subject}~name`,
          subject,
          predicate: 'yarramate/concept/name',
          object: { value: state.name },
          origin: 'declared',
          source: location(
            ['states', index, 'name'],
            `/states/${index}/name`,
          ),
        },
        {
          id: `${subject}~state-type`,
          subject,
          predicate: 'yarramate/state/type',
          object: { value: state.kind },
          origin: 'declared',
          source: location(
            ['states', index, 'kind'],
            `/states/${index}/kind`,
          ),
        },
      )
      if (state.description !== undefined) {
        claims.push({
          id: `${subject}~description`,
          subject,
          predicate: 'yarramate/concept/description',
          object: { value: state.description },
          origin: 'declared',
          source: location(
            ['states', index, 'description'],
            `/states/${index}/description`,
          ),
        })
      }
      if (state.after !== undefined) {
        claims.push({
          id: `${subject}~after`,
          subject,
          predicate: 'yarramate/state/after',
          object: {
            ref: qualifyReference(value.id, state.after),
          },
          origin: 'declared',
          source: location(
            ['states', index, 'after'],
            `/states/${index}/after`,
          ),
        })
      }
    }

    for (const [index, concept] of value.concepts.entries()) {
      if (!selectedProfile.conceptKinds.has(concept.kind)) {
        const pointer = `/concepts/${index}/kind`
        const source = location(['concepts', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM401',
          message: `Unknown concept kind "${concept.kind}" in profile "${value.profile}"${(() => {
            const suggestion = closestCandidate(
              concept.kind,
              selectedProfile.conceptKinds.keys(),
            )
            return suggestion === undefined
              ? ''
              : `; did you mean "${suggestion}"?`
          })()}`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      if (
        concept.owner !== undefined &&
        !conceptByQualifiedId.has(
          qualifyReference(value.id, concept.owner),
        )
      ) {
        const pointer = `/concepts/${index}/owner`
        const source = location(['concepts', index, 'owner'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM304',
          message: `Unresolved owner reference "${concept.owner}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      const seenConstraintIds = new Set<string>()
      for (const [constraintIndex, constraint] of (
        concept.constraints ?? []
      ).entries()) {
        if (seenConstraintIds.has(constraint.id)) {
          const pointer = `/concepts/${index}/constraints/${constraintIndex}/id`
          const source = location(
            ['concepts', index, 'constraints', constraintIndex, 'id'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM306',
            message: `Duplicate constraint ID "${constraint.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenConstraintIds.add(constraint.id)
        if (
          !conceptByQualifiedId.has(
            qualifyReference(value.id, constraint.ref),
          )
        ) {
          const pointer = `/concepts/${index}/constraints/${constraintIndex}/ref`
          const source = location(
            ['concepts', index, 'constraints', constraintIndex, 'ref'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM305',
            message: `Unresolved constraint reference "${constraint.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      const seenReferenceIds = new Set<string>()
      for (const [referenceIndex, reference] of (
        concept.references ?? []
      ).entries()) {
        if (seenReferenceIds.has(reference.id)) {
          const pointer = `/concepts/${index}/references/${referenceIndex}/id`
          const source = location(
            ['concepts', index, 'references', referenceIndex, 'id'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM309',
            message: `Duplicate reference ID "${reference.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenReferenceIds.add(reference.id)
        if (
          !subjectIds.has(
            qualifyReference(value.id, reference.ref),
          )
        ) {
          const pointer = `/concepts/${index}/references/${referenceIndex}/ref`
          const source = location(
            ['concepts', index, 'references', referenceIndex, 'ref'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM308',
            message: `Unresolved subject reference "${reference.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      for (const [stateIndex, state] of (
        concept.presentIn ?? []
      ).entries()) {
        if (
          !architectureStateIds.has(
            qualifyReference(value.id, state),
          )
        ) {
          const pointer = `/concepts/${index}/presentIn/${stateIndex}`
          const source = location(
            ['concepts', index, 'presentIn', stateIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM307',
            message: `Unresolved architecture state reference "${state}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
    }
    for (const [index, relationship] of value.relationships.entries()) {
      const seenReferenceIds = new Set<string>()
      for (const [referenceIndex, reference] of (
        relationship.references ?? []
      ).entries()) {
        if (seenReferenceIds.has(reference.id)) {
          const pointer = `/relationships/${index}/references/${referenceIndex}/id`
          const source = location(
            [
              'relationships',
              index,
              'references',
              referenceIndex,
              'id',
            ],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM309',
            message: `Duplicate reference ID "${reference.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenReferenceIds.add(reference.id)
        if (
          !subjectIds.has(
            qualifyReference(value.id, reference.ref),
          )
        ) {
          const pointer = `/relationships/${index}/references/${referenceIndex}/ref`
          const source = location(
            [
              'relationships',
              index,
              'references',
              referenceIndex,
              'ref',
            ],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM308',
            message: `Unresolved subject reference "${reference.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      for (const [stateIndex, state] of (
        relationship.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        if (
          !architectureStateIds.has(stateIdentity)
        ) {
          const pointer = `/relationships/${index}/presentIn/${stateIndex}`
          const source = location(
            ['relationships', index, 'presentIn', stateIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM307',
            message: `Unresolved architecture state reference "${state}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else {
          for (const endpoint of [
            relationship.from,
            relationship.to,
          ]) {
            const endpointIdentity = qualifyReference(value.id, endpoint)
            const resolved = conceptByQualifiedId.get(endpointIdentity)
            const endpointStates =
              resolved?.concept.presentIn?.map((candidate) =>
                qualifyReference(resolved.document, candidate),
              ) ?? []
            if (
              resolved !== undefined &&
              endpointStates.length > 0 &&
              !endpointStates.includes(stateIdentity)
            ) {
              const pointer = `/relationships/${index}/presentIn/${stateIndex}`
              const source = location(
                ['relationships', index, 'presentIn', stateIndex],
                pointer,
              )
              diagnostics.push({
                severity: 'error',
                code: 'YM503',
                message: `Relationship "${relationship.id}" is present in "${stateIdentity}" but endpoint "${endpointIdentity}" is absent`,
                path: input.path,
                pointer,
                line: source.line,
                column: source.column,
              })
            }
          }
        }
      }
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
      if (!selectedProfile.relationshipKinds.has(relationship.kind)) {
        const pointer = `/relationships/${index}/kind`
        const source = location(['relationships', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM402',
          message: `Unknown relationship kind "${relationship.kind}" in profile "${value.profile}"${(() => {
            const suggestion = closestCandidate(
              relationship.kind,
              selectedProfile.relationshipKinds.keys(),
            )
            return suggestion === undefined
              ? ''
              : `; did you mean "${suggestion}"?`
          })()}`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      for (const endpoint of ['from', 'to'] as const) {
        const reference = relationship[endpoint]
        if (
          !conceptByQualifiedId.has(qualifyReference(value.id, reference))
        ) {
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
      const policy = selectedProfile.relationshipKinds.get(relationship.kind)
      if (policy !== undefined) {
        for (const endpoint of ['source', 'target'] as const) {
          const reference =
            endpoint === 'source' ? relationship.from : relationship.to
          const resolvedConcept = conceptByQualifiedId.get(
            qualifyReference(value.id, reference),
          )
          const kind =
            resolvedConcept === undefined
              ? undefined
              : profiles
                  .get(resolvedConcept.profile)
                  ?.conceptKinds.get(resolvedConcept.concept.kind)
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
          object: {
            value:
              selectedProfile.conceptKinds.get(concept.kind)?.identity ??
              concept.kind,
          },
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
      if (concept.status !== undefined) {
        claims.push({
          id: `${subject}~status`,
          subject,
          predicate: 'yarramate/lifecycle/status',
          object: { value: concept.status },
          origin: 'declared',
          source: location(
            ['concepts', index, 'status'],
            `/concepts/${index}/status`,
          ),
        })
      }
      if (concept.owner !== undefined) {
        claims.push({
          id: `${subject}~owner`,
          subject,
          predicate: 'yarramate/ownership/owner',
          object: {
            ref: qualifyReference(value.id, concept.owner),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'owner'],
            `/concepts/${index}/owner`,
          ),
        })
      }
      for (const [constraintIndex, constraint] of (
        concept.constraints ?? []
      ).entries()) {
        claims.push({
          id: `${subject}~constraint-${constraint.id}`,
          subject,
          predicate: 'yarramate/constraint/requires',
          object: {
            ref: qualifyReference(value.id, constraint.ref),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'constraints', constraintIndex, 'ref'],
            `/concepts/${index}/constraints/${constraintIndex}/ref`,
          ),
        })
      }
      for (const [referenceIndex, reference] of (
        concept.references ?? []
      ).entries()) {
        claims.push({
          id: `${subject}~reference-${reference.id}`,
          subject,
          predicate: 'yarramate/reference/refers-to',
          object: {
            ref: qualifyReference(value.id, reference.ref),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'references', referenceIndex, 'ref'],
            `/concepts/${index}/references/${referenceIndex}/ref`,
          ),
        })
      }
      for (const [stateIndex, state] of (
        concept.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        claims.push({
          id: presenceClaimId(subject, stateIdentity),
          subject,
          predicate: 'yarramate/state/present-in',
          object: { ref: stateIdentity },
          origin: 'declared',
          source: location(
            ['concepts', index, 'presentIn', stateIndex],
            `/concepts/${index}/presentIn/${stateIndex}`,
          ),
        })
      }
    }

    for (const [index, relationship] of value.relationships.entries()) {
      const id = `${value.id}#${relationship.id}`
      subjects.push({ id, type: 'relationship' })
      claims.push({
        id,
        subject: qualifyReference(value.id, relationship.from),
        predicate:
          selectedProfile.relationshipKinds.get(relationship.kind)?.identity ??
          relationship.kind,
        object: { ref: qualifyReference(value.id, relationship.to) },
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
      if (relationship.description !== undefined) {
        claims.push({
          id: `${id}~description`,
          subject: id,
          predicate: 'yarramate/relationship/description',
          object: { value: relationship.description },
          origin: 'declared',
          source: location(
            ['relationships', index, 'description'],
            `/relationships/${index}/description`,
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
      if (relationship.status !== undefined) {
        claims.push({
          id: `${id}~status`,
          subject: id,
          predicate: 'yarramate/lifecycle/status',
          object: { value: relationship.status },
          origin: 'declared',
          source: location(
            ['relationships', index, 'status'],
            `/relationships/${index}/status`,
          ),
        })
      }
      for (const [referenceIndex, reference] of (
        relationship.references ?? []
      ).entries()) {
        claims.push({
          id: `${id}~reference-${reference.id}`,
          subject: id,
          predicate: 'yarramate/reference/refers-to',
          object: {
            ref: qualifyReference(value.id, reference.ref),
          },
          origin: 'declared',
          source: location(
            ['relationships', index, 'references', referenceIndex, 'ref'],
            `/relationships/${index}/references/${referenceIndex}/ref`,
          ),
        })
      }
      for (const [stateIndex, state] of (
        relationship.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        claims.push({
          id: presenceClaimId(id, stateIdentity),
          subject: id,
          predicate: 'yarramate/state/present-in',
          object: { ref: stateIdentity },
          origin: 'declared',
          source: location(
            ['relationships', index, 'presentIn', stateIndex],
            `/relationships/${index}/presentIn/${stateIndex}`,
          ),
        })
      }
    }
  }

  const wholePartByEndpoints = new Map<
    string,
    Array<{
      readonly id: string
      readonly localId: string
      readonly document: string
      readonly kind: 'composition' | 'aggregation'
      readonly states: ReadonlySet<string>
    }>
  >()
  const wholePartRelationships = documents
    .flatMap(({ value, location }) =>
      value.relationships.flatMap((relationship, index) =>
        relationship.kind === 'composition' ||
        relationship.kind === 'aggregation'
          ? [
              {
                id: `${value.id}#${relationship.id}`,
                localId: relationship.id,
                document: value.id,
                kind: relationship.kind as 'composition' | 'aggregation',
                from: qualifyReference(value.id, relationship.from),
                to: qualifyReference(value.id, relationship.to),
                states: new Set(
                  (relationship.presentIn ?? []).map((state) =>
                    qualifyReference(value.id, state),
                  ),
                ),
                source: location(
                  ['relationships', index, 'kind'],
                  `/relationships/${index}/kind`,
                ),
              },
            ]
          : [],
      ),
    )
    .sort(compareById)

  for (const relationship of wholePartRelationships) {
    const endpointKey = `${relationship.from}\u0000${relationship.to}`
    const previousRelationships = wholePartByEndpoints.get(endpointKey) ?? []
    const previous = previousRelationships.find(
      (candidate) =>
        candidate.kind !== relationship.kind &&
        (candidate.states.size === 0 ||
          relationship.states.size === 0 ||
          [...candidate.states].some((state) =>
            relationship.states.has(state),
          )),
    )
    if (previous !== undefined) {
      const currentName =
        previous.document === relationship.document
          ? relationship.localId
          : relationship.id
      const previousName =
        previous.document === relationship.document
          ? previous.localId
          : previous.id
      diagnostics.push({
        severity: 'error',
        code: 'YM501',
        message: `Relationship "${currentName}" contradicts "${previousName}": the same endpoints cannot be both aggregation and composition`,
        path: relationship.source.path,
        pointer: relationship.source.pointer,
        line: relationship.source.line,
        column: relationship.source.column,
      })
    }
    previousRelationships.push(relationship)
    wholePartByEndpoints.set(endpointKey, previousRelationships)
  }

  if (diagnostics.length > 0) {
    return diagnosticFailure(diagnostics)
  }

  return {
    ok: true,
    profileContext: {
      conceptKindLineages: new Map(
        [...conceptKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [identity, kind.lineage]),
      ),
      relationshipKindLineages: new Map(
        [...relationshipKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [identity, kind.lineage]),
      ),
    },
    graph: {
      format: 'yarramate/graph/v2',
      profiles: [
        ...new Set(
          documents.flatMap(
            ({ value }) => profiles.get(value.profile)?.lineage ?? [],
          ),
        ),
      ].sort(),
      documents: documents
        .map(({ input, value }) => ({ id: value.id, source: input.path }))
        .sort(compareById),
      subjects: subjects.sort(compareById),
      claims: claims.sort(compareById),
    },
  }
}

export function compileWorkspace(
  sources: readonly WorkspaceSource[],
): CompilationResult {
  const result = compileWorkspaceResolved(sources)
  return result.ok ? { ok: true, graph: result.graph } : result
}

export const compileWorkspaceWithProfileContext = (
  sources: readonly WorkspaceSource[],
): ContextualCompilationResult => compileWorkspaceResolved(sources)
