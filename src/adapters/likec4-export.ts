import {
  adapterMappingEntryLocation,
  adapterMappingLocation,
  type AdapterMapping,
} from '../adapter-mapping.js'
import type { GraphClaim } from '../compiler.js'
import type { StateComparison } from '../architecture-state.js'
import type { ProjectionResult } from '../projection.js'
import { diagnosticOrder } from '../source-document.js'
import type { LikeC4KindMapping } from './likec4-kind-mapping.js'

export interface LikeC4ExportDiagnostic {
  readonly severity: 'error'
  readonly code:
    | 'YMLC101'
    | 'YMLC102'
    | 'YMLC103'
    | 'YMLC104'
    | 'YMLC105'
    | 'YMLC106'
  readonly message: string
  readonly subject?: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export type LikeC4ExportResult =
  | { readonly ok: true; readonly source: string }
  | {
      readonly ok: false
      readonly diagnostics: readonly LikeC4ExportDiagnostic[]
    }

export interface LikeC4ExportOptions {
  readonly comparison?: StateComparison
}

const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/

const valueFor = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object
    ? object.value
    : undefined
}

const referencesFor = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): readonly string[] =>
  claims
    .flatMap((claim) =>
      claim.subject === subject &&
      claim.predicate === predicate &&
      'ref' in claim.object
        ? [claim.object.ref]
        : [],
    )
    .sort()

const sourceForConcept = (
  claims: readonly GraphClaim[],
  subject: string,
) =>
  claims.find(
    (claim) =>
      claim.subject === subject &&
      claim.predicate === 'yarramate/concept/kind',
  )?.source

const metadataLines = (
  entries: readonly [
    key: string,
    value: string | readonly string[] | undefined,
  ][],
  indentation: string,
): readonly string[] => {
  const present = entries.filter(
    (
      entry,
    ): entry is [string, string | readonly string[]] =>
      entry[1] !== undefined &&
      (typeof entry[1] === 'string' || entry[1].length > 0),
  )
  if (present.length === 0) return []
  return [
    `${indentation}metadata {`,
    ...present.map(([key, value]) =>
      Array.isArray(value)
        ? `${indentation}  ${key} [${value.map(quote).join(', ')}]`
        : `${indentation}  ${key} ${quote(value as string)}`,
    ),
    `${indentation}}`,
  ]
}

const kindId = (identity: string): string => {
  const separator = identity.lastIndexOf('#')
  return separator === -1 ? identity : identity.slice(separator + 1)
}

const quote = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`

export function exportLikeC4(
  projection: ProjectionResult,
  mapping: AdapterMapping,
  kindMapping?: LikeC4KindMapping,
  options: LikeC4ExportOptions = {},
): LikeC4ExportResult {
  const diagnostics: LikeC4ExportDiagnostic[] = []
  if (mapping.adapter !== 'likec4') {
    const source = adapterMappingLocation(mapping, 'adapter')
    diagnostics.push({
      severity: 'error',
      code: 'YMLC101',
      message: `Adapter mapping "${mapping.id}@${mapping.version}" targets "${mapping.adapter}", not "likec4"`,
      path: source.path,
      pointer: source.pointer,
      line: source.line,
      column: source.column,
    })
  }

  const externalByNative = new Map(
    mapping.mappings
      .filter(({ type }) => type === 'concept')
      .map(({ native, external }) => [native, external] as const),
  )
  const externalConceptKind = new Map(
    kindMapping?.conceptKinds.map(({ native, external }) => [
      native,
      external,
    ]) ?? [],
  )
  const externalRelationshipKind = new Map(
    kindMapping?.relationshipKinds.map(({ native, external }) => [
      native,
      external,
    ]) ?? [],
  )
  const concepts = projection.subjects
    .filter(({ type }) => type === 'concept')
    .sort((left, right) => left.id.localeCompare(right.id))
  const comparisonChange = new Map(
    options.comparison === undefined
      ? []
      : [
          ...options.comparison.added.map(
            ({ id }) => [id, 'added'] as const,
          ),
          ...options.comparison.removed.map(
            ({ id }) => [id, 'removed'] as const,
          ),
          ...options.comparison.retained.map(
            ({ id }) => [id, 'retained'] as const,
          ),
        ],
  )

  for (const concept of concepts) {
    const external = externalByNative.get(concept.id)
    if (external === undefined) {
      const source = sourceForConcept(projection.claims, concept.id)
      if (source === undefined) continue
      diagnostics.push({
        severity: 'error',
        code: 'YMLC102',
        message: `Projected concept "${concept.id}" has no LikeC4 mapping`,
        subject: concept.id,
        path: source.path,
        pointer: source.pointer,
        line: source.line,
        column: source.column,
      })
    } else if (!identifier.test(external)) {
      const entry = mapping.mappings.find(
        ({ native, type }) =>
          native === concept.id && type === 'concept',
      )!
      const source = adapterMappingEntryLocation(
        mapping,
        entry,
        'external',
      )
      diagnostics.push({
        severity: 'error',
        code: 'YMLC103',
        message: `LikeC4 identity "${external}" is not a valid identifier`,
        subject: concept.id,
        path: source.path,
        pointer: source.pointer,
        line: source.line,
        column: source.column,
      })
    }
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.sort(diagnosticOrder),
    }
  }

  const lines = [
    '// Generated by YarraMate. Edit the native documents, not this file.',
    'model {',
  ]
  for (const concept of concepts) {
    const external = externalByNative.get(concept.id)!
    const semanticKind =
      valueFor(
        projection.claims,
        concept.id,
        'yarramate/concept/kind',
      ) ?? 'element'
    const kind =
      externalConceptKind.get(semanticKind) ?? kindId(semanticKind)
    const name =
      valueFor(
        projection.claims,
        concept.id,
        'yarramate/concept/name',
      ) ?? concept.id
    const description = valueFor(
      projection.claims,
      concept.id,
      'yarramate/concept/description',
    )
    const metadata = metadataLines(
      [
        ['yarramateId', concept.id],
        ['yarramateKind', semanticKind],
        ['yarramateChange', comparisonChange.get(concept.id)],
        [
          'status',
          valueFor(
            projection.claims,
            concept.id,
            'yarramate/lifecycle/status',
          ),
        ],
        [
          'owner',
          referencesFor(
            projection.claims,
            concept.id,
            'yarramate/ownership/owner',
          )[0],
        ],
        [
          'constraints',
          referencesFor(
            projection.claims,
            concept.id,
            'yarramate/constraint/requires',
          ),
        ],
      ],
      '    ',
    )
    if (description === undefined && metadata.length === 0) {
      lines.push(`  ${external} = ${kind} ${quote(name)}`)
    } else {
      lines.push(
        `  ${external} = ${kind} ${quote(name)} {`,
        ...(description === undefined
          ? []
          : [`    description ${quote(description)}`]),
        ...metadata,
        '  }',
      )
    }
  }

  const relationships = projection.subjects
    .filter(({ type }) => type === 'relationship')
    .sort((left, right) => left.id.localeCompare(right.id))
  if (relationships.length > 0) lines.push('')
  for (const relationship of relationships) {
    const structural = projection.claims.find(
      (claim) => claim.id === relationship.id,
    )
    if (
      structural === undefined ||
      !('ref' in structural.object)
    ) {
      continue
    }
    const source = externalByNative.get(structural.subject)
    const target = externalByNative.get(structural.object.ref)
    if (source === undefined || target === undefined) continue
    const name = valueFor(
      projection.claims,
      relationship.id,
      'yarramate/relationship/name',
    )
    const metadata = metadataLines(
      [
        ['yarramateId', relationship.id],
        ['yarramateKind', structural.predicate],
        ['yarramateChange', comparisonChange.get(relationship.id)],
        [
          'status',
          valueFor(
            projection.claims,
            relationship.id,
            'yarramate/lifecycle/status',
          ),
        ],
        [
          'mode',
          valueFor(
            projection.claims,
            relationship.id,
            'yarramate/access/mode',
          ),
        ],
        [
          'content',
          valueFor(
            projection.claims,
            relationship.id,
            'yarramate/flow/content',
          ),
        ],
      ],
      '    ',
    )
    lines.push(
      `  ${source} -[${externalRelationshipKind.get(structural.predicate) ?? kindId(structural.predicate)}]-> ${target}${name === undefined ? '' : ` ${quote(name)}`}${metadata.length === 0 ? '' : ' {'}`,
      ...metadata,
      ...(metadata.length === 0 ? [] : ['  }']),
    )
  }

  const viewId = identifier.test(projection.projection.split('@')[0] ?? '')
    ? projection.projection.split('@')[0]!
    : 'index'
  lines.push(
    '}',
    '',
    'views {',
    `  view ${viewId} {`,
    ...(projection.presentation?.title === undefined
      ? []
      : [`    title ${quote(projection.presentation.title)}`]),
    ...(projection.presentation?.description === undefined
      ? []
      : [
          `    description ${quote(projection.presentation.description)}`,
        ]),
    '    include *',
    ...(options.comparison === undefined
      ? []
      : concepts.map((concept) => {
          const external = externalByNative.get(concept.id)!
          const change = comparisonChange.get(concept.id)
          if (change === 'added') {
            return `    style ${external} { color green }`
          }
          if (change === 'removed') {
            return `    style ${external} { color red; border dashed }`
          }
          return `    style ${external} { color gray }`
        })),
    '    autoLayout LeftRight',
    '  }',
    '}',
    '',
  )
  return { ok: true, source: lines.join('\n') }
}
