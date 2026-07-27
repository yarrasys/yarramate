import Ajv2020Module from 'ajv/dist/2020.js'
import type { Diagnostic, WorkspaceSource } from '../compiler.js'
import {
  diagnosticOrder,
  loadSourceDocument,
  locateSourcePath,
  type SourceLocation,
} from '../source-document.js'
import kindMappingSchema from '../../schema/yarramate-likec4-kind-mapping.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateSchema = new Ajv2020({ allErrors: true }).compile(
  kindMappingSchema,
)

export interface LikeC4KindEntry {
  readonly native: string
  readonly external: string
}

export interface LikeC4KindMapping {
  readonly format: 'yarramate/likec4-kind-mapping/v1'
  readonly id: string
  readonly version: string
  readonly conceptKinds: readonly LikeC4KindEntry[]
  readonly relationshipKinds: readonly LikeC4KindEntry[]
}

export type LikeC4KindMappingLoadResult =
  | { readonly ok: true; readonly mapping: LikeC4KindMapping }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

interface LikeC4KindMappingLocations {
  readonly conceptKinds: readonly SourceLocation[]
  readonly relationshipKinds: readonly SourceLocation[]
}

const kindMappingLocations = new WeakMap<
  LikeC4KindMapping,
  LikeC4KindMappingLocations
>()

const entryOrder = (left: LikeC4KindEntry, right: LikeC4KindEntry) =>
  left.native.localeCompare(right.native) ||
  left.external.localeCompare(right.external)

export function loadLikeC4KindMapping(
  source: WorkspaceSource,
): LikeC4KindMappingLoadResult {
  const loaded = loadSourceDocument<LikeC4KindMapping>(
    source,
    validateSchema,
    'LikeC4 kind mapping',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document
  const diagnostics: Diagnostic[] = []
  const checkDuplicates = (
    field: 'conceptKinds' | 'relationshipKinds',
    label: 'concept' | 'relationship',
  ) => {
    const seen = new Set<string>()
    for (const [index, entry] of value[field].entries()) {
      if (seen.has(entry.native)) {
        const location = locateSourcePath(
          source.path,
          yaml,
          lineCounter,
          [field, index, 'native'],
          `/${field}/${index}/native`,
        )
        diagnostics.push({
          severity: 'error',
          code: 'YMLC201',
          message: `Native ${label} kind "${entry.native}" is mapped more than once`,
          ...location,
        })
      }
      seen.add(entry.native)
    }
  }
  checkDuplicates('conceptKinds', 'concept')
  checkDuplicates('relationshipKinds', 'relationship')
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.sort(diagnosticOrder),
    }
  }
  const mapping: LikeC4KindMapping = {
    ...value,
    conceptKinds: [...value.conceptKinds].sort(entryOrder),
    relationshipKinds: [...value.relationshipKinds].sort(entryOrder),
  }
  const locateExternal = (
    field: 'conceptKinds' | 'relationshipKinds',
    entry: LikeC4KindEntry,
  ) => {
    const authoredIndex = value[field].indexOf(entry)
    return locateSourcePath(
      source.path,
      yaml,
      lineCounter,
      [field, authoredIndex, 'external'],
      `/${field}/${authoredIndex}/external`,
    )
  }
  kindMappingLocations.set(mapping, {
    conceptKinds: mapping.conceptKinds.map((entry) =>
      locateExternal('conceptKinds', entry),
    ),
    relationshipKinds: mapping.relationshipKinds.map((entry) =>
      locateExternal('relationshipKinds', entry),
    ),
  })
  return { ok: true, mapping }
}

export function likeC4KindMappingExternalLocation(
  mapping: LikeC4KindMapping,
  category: 'conceptKinds' | 'relationshipKinds',
  native: string,
): SourceLocation | undefined {
  const index = mapping[category].findIndex(
    (entry) => entry.native === native,
  )
  return index === -1
    ? undefined
    : kindMappingLocations.get(mapping)?.[category][index]
}
