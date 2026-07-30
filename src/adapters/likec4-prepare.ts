import { LineCounter, parseDocument } from 'yaml'
import {
  loadAdapterMapping,
  validateAdapterMapping,
  type AdapterMapping,
} from '../adapter-mapping.js'
import {
  compileWorkspaceWithProfileContext,
  type Diagnostic,
  type WorkspaceSource,
} from '../compiler.js'
import { compareArchitectureStates } from '../architecture-state.js'
import { conceptKinds, relationshipPolicies } from '../profile.js'
import {
  evaluateProjection,
  loadProjection,
  type ProjectionResult,
} from '../projection.js'
import {
  diagnosticOrder,
  locateSourcePath,
} from '../source-document.js'
import {
  exportLikeC4,
  type LikeC4ExportDiagnostic,
} from './likec4-export.js'
import {
  likeC4KindMappingExternalLocation,
  loadLikeC4KindMapping,
  type LikeC4KindMapping,
} from './likec4-kind-mapping.js'

export interface LikeC4PreparationInput {
  readonly sources: readonly WorkspaceSource[]
  readonly projection: WorkspaceSource
  readonly subjectMapping: WorkspaceSource
  readonly kindMapping?: WorkspaceSource
  readonly comparison?: {
    readonly from: string
    readonly to: string
  }
  readonly vocabulary: 'bundled' | 'consumer'
  /**
   * Gate mode. Rendering a relationship needs no external identity — views
   * select it by metadata — but `map --sync` still writes one, so only a
   * check answering "would sync change anything" requires the entry.
   */
  readonly requireMappedRelationships?: boolean
}

export type LikeC4PreparationDiagnostic =
  | Diagnostic
  | LikeC4ExportDiagnostic

export type LikeC4PreparationResult =
  | {
      readonly ok: true
      readonly source: string
      readonly projection: ProjectionResult
      readonly subjectMapping: AdapterMapping
      readonly kindMapping?: LikeC4KindMapping
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly LikeC4PreparationDiagnostic[]
    }

const terminalKind = (identity: string): string => {
  const separator = identity.lastIndexOf('#')
  return separator === -1 ? identity : identity.slice(separator + 1)
}

const unsupportedBundledKinds = (
  projection: ProjectionResult,
  kindMapping: LikeC4KindMapping | undefined,
): readonly LikeC4ExportDiagnostic[] => {
  const supportedConceptKinds = new Set<string>(
    conceptKinds.map(({ id }) => id),
  )
  const supportedRelationshipKinds = new Set<string>(
    relationshipPolicies.map(({ id }) => id),
  )
  const mappedConceptKinds = new Map(
    kindMapping?.conceptKinds.map(({ native, external }) => [
      native,
      external,
    ]) ?? [],
  )
  const mappedRelationshipKinds = new Map(
    kindMapping?.relationshipKinds.map(({ native, external }) => [
      native,
      external,
    ]) ?? [],
  )
  const diagnostics: LikeC4ExportDiagnostic[] = []
  for (const subject of projection.subjects) {
    const semanticKind =
      subject.type === 'concept'
        ? projection.claims.find(
            (claim) =>
              claim.subject === subject.id &&
              claim.predicate === 'yarramate/concept/kind' &&
              'value' in claim.object,
          )?.object
        : projection.claims.find((claim) => claim.id === subject.id)
            ?.predicate
    const identity =
      typeof semanticKind === 'string'
        ? semanticKind
        : semanticKind !== undefined && 'value' in semanticKind
          ? semanticKind.value
          : undefined
    if (identity === undefined) continue
    const external =
      subject.type === 'concept'
        ? (mappedConceptKinds.get(identity) ?? terminalKind(identity))
        : (mappedRelationshipKinds.get(identity) ?? terminalKind(identity))
    const supported =
      subject.type === 'concept'
        ? supportedConceptKinds.has(external)
        : supportedRelationshipKinds.has(external)
    if (!supported) {
      const mappedSource =
        kindMapping === undefined
          ? undefined
          : likeC4KindMappingExternalLocation(
              kindMapping,
              subject.type === 'concept'
                ? 'conceptKinds'
                : 'relationshipKinds',
              identity,
            )
      const sourceClaim =
        subject.type === 'concept'
          ? projection.claims.find(
              (claim) =>
                claim.subject === subject.id &&
                claim.predicate === 'yarramate/concept/kind',
            )
          : projection.claims.find((claim) => claim.id === subject.id)
      const source = mappedSource ?? sourceClaim?.source
      if (source === undefined) continue
      diagnostics.push({
        severity: 'error',
        code: 'YMLC104',
        message: `Semantic ${subject.type} kind "${identity}" resolves to unsupported bundled LikeC4 kind "${external}"`,
        subject: subject.id,
        path: source.path,
        pointer: source.pointer,
        line: source.line,
        column: source.column,
      })
    }
  }
  return diagnostics.sort(diagnosticOrder)
}

const unmappedProjectedRelationships = (
  projection: ProjectionResult,
  mapping: AdapterMapping,
): readonly LikeC4ExportDiagnostic[] => {
  const mapped = new Set(
    mapping.mappings
      .filter(({ type }) => type === 'relationship')
      .map(({ native }) => native),
  )
  return projection.subjects
    .filter(({ type, id }) => type === 'relationship' && !mapped.has(id))
    .flatMap(({ id }) => {
      const source = projection.claims.find(
        (claim) => claim.id === id,
      )?.source
      return source === undefined
        ? []
        : [
            {
              severity: 'error' as const,
              code: 'YMLC111' as const,
              message: `Projected relationship "${id}" has no LikeC4 mapping`,
              subject: id,
              path: source.path,
              pointer: source.pointer,
              line: source.line,
              column: source.column,
            },
          ]
    })
    .sort(diagnosticOrder)
}

export function prepareLikeC4Export(
  input: LikeC4PreparationInput,
): LikeC4PreparationResult {
  const compilation = compileWorkspaceWithProfileContext(input.sources)
  if (!compilation.ok) return compilation
  const projection = loadProjection(input.projection)
  if (!projection.ok) return projection
  const projectionStateLocation = (state: string) => {
    const states = projection.projection.query.states ?? []
    const index = states.indexOf(state)
    const pointer =
      index === -1 ? '/query/states' : `/query/states/${index}`
    const lineCounter = new LineCounter()
    const yaml = parseDocument(input.projection.source, {
      lineCounter,
    })
    return locateSourcePath(
      input.projection.path,
      yaml,
      lineCounter,
      index === -1 ? ['query', 'states'] : ['query', 'states', index],
      pointer,
    )
  }
  const subjectMapping = loadAdapterMapping(input.subjectMapping)
  if (!subjectMapping.ok) return subjectMapping
  const subjectValidation = validateAdapterMapping(
    compilation.graph,
    subjectMapping.mapping,
  )
  if (!subjectValidation.ok) return subjectValidation
  const kindMapping =
    input.kindMapping === undefined
      ? undefined
      : loadLikeC4KindMapping(input.kindMapping)
  if (kindMapping !== undefined && !kindMapping.ok) return kindMapping
  if (input.comparison !== undefined) {
    const selectedStates = projection.projection.query.states ?? []
    const omittedStates = [
      ...new Set([input.comparison.from, input.comparison.to]),
    ].filter((state) => !selectedStates.includes(state))
    if (omittedStates.length > 0) {
      return {
        ok: false,
        diagnostics: omittedStates.map((state) => ({
          severity: 'error' as const,
          code: 'YMLC106' as const,
          message: `Comparison state "${state}" is not selected by projection "${projection.projection.id}@${projection.projection.version}"`,
          subject: state,
          ...projectionStateLocation(state),
        })),
      }
    }
  }
  const projectionResult = evaluateProjection(
    compilation.graph,
    projection.projection,
    compilation.profileContext,
  )
  const comparison =
    input.comparison === undefined
      ? undefined
      : compareArchitectureStates(
          compilation.graph,
          input.comparison.from,
          input.comparison.to,
        )
  if (comparison !== undefined && !comparison.ok) {
    return {
      ok: false,
      diagnostics: comparison.issues.map((issue) => ({
        severity: 'error' as const,
        code: 'YMLC105' as const,
        message: issue.message,
        subject: issue.state,
        ...projectionStateLocation(issue.state),
      })),
    }
  }
  if (input.vocabulary === 'bundled') {
    const diagnostics = unsupportedBundledKinds(
      projectionResult,
      kindMapping?.mapping,
    )
    if (diagnostics.length > 0) return { ok: false, diagnostics }
  }
  const unmappedRelationships =
    input.requireMappedRelationships === true
      ? unmappedProjectedRelationships(
          projectionResult,
          subjectMapping.mapping,
        )
      : []
  const exported = exportLikeC4(
    projectionResult,
    subjectMapping.mapping,
    kindMapping?.mapping,
    comparison === undefined
      ? undefined
      : { comparison: comparison.comparison },
  )
  if (!exported.ok) {
    return {
      ok: false,
      diagnostics: [
        ...exported.diagnostics,
        ...unmappedRelationships,
      ].sort(diagnosticOrder),
    }
  }
  if (unmappedRelationships.length > 0) {
    return { ok: false, diagnostics: unmappedRelationships }
  }
  return {
    ok: true,
    source: exported.source,
    projection: projectionResult,
    subjectMapping: subjectMapping.mapping,
    ...(kindMapping === undefined
      ? {}
      : { kindMapping: kindMapping.mapping }),
  }
}
