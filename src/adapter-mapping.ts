import Ajv2020Module from 'ajv/dist/2020.js'
import type {
  Diagnostic,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
import {
  diagnosticOrder,
  loadSourceDocument,
  locateSourcePath,
  type SourceLocation,
} from './source-document.js'
import adapterMappingSchema from '../schema/yarramate-adapter-mapping.schema.json' with {
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
const validateSchema = new Ajv2020({ allErrors: true }).compile(
  adapterMappingSchema,
)

export interface AdapterSubjectMapping {
  readonly native: string
  readonly external: string
  readonly type: 'concept' | 'relationship'
}

export interface AdapterMapping {
  readonly format: 'yarramate/adapter-mapping/v1'
  readonly id: string
  readonly version: string
  readonly adapter: string
  readonly mappings: readonly AdapterSubjectMapping[]
}

type MappingLocation = SourceLocation

interface AdapterMappingLocations {
  readonly id: MappingLocation
  readonly adapter: MappingLocation
  readonly mappings: readonly Readonly<
    Record<'native' | 'external' | 'type', MappingLocation>
  >[]
}

const mappingLocations = new WeakMap<AdapterMapping, AdapterMappingLocations>()

export type AdapterMappingLoadResult =
  | { readonly ok: true; readonly mapping: AdapterMapping }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type AdapterMappingValidationResult =
  | { readonly ok: true; readonly mapping: AdapterMapping }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type AdapterMappingsValidationResult =
  | { readonly ok: true; readonly mappings: readonly AdapterMapping[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export function loadAdapterMapping(
  source: WorkspaceSource,
): AdapterMappingLoadResult {
  const loaded = loadSourceDocument<AdapterMapping>(
    source,
    validateSchema,
    'Adapter mapping',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document

  const mapping: AdapterMapping = {
    ...value,
    mappings: [...value.mappings].sort(
      (left, right) =>
        left.native.localeCompare(right.native) ||
        left.external.localeCompare(right.external) ||
        left.type.localeCompare(right.type),
    ),
  }
  const locateNode = (
    yamlPath: readonly (string | number)[],
    pointer: string,
  ): MappingLocation =>
    locateSourcePath(
      source.path,
      yaml,
      lineCounter,
      yamlPath,
      pointer,
    )
  mappingLocations.set(mapping, {
    id: locateNode(['id'], '/id'),
    adapter: locateNode(['adapter'], '/adapter'),
    mappings: mapping.mappings.map((entry) => {
      const authoredIndex = value.mappings.indexOf(entry)
      const locate = (
        field: 'native' | 'external' | 'type',
      ): MappingLocation =>
        locateNode(
          ['mappings', authoredIndex, field],
          `/mappings/${authoredIndex}/${field}`,
        )
      return {
        native: locate('native'),
        external: locate('external'),
        type: locate('type'),
      }
    }),
  })
  return { ok: true, mapping }
}

export function adapterMappingLocation(
  mapping: AdapterMapping,
  field: 'id' | 'adapter',
): SourceLocation {
  return (
    mappingLocations.get(mapping)?.[field] ?? {
      path: `${mapping.id}.mapping.yaml`,
      pointer: `/${field}`,
      line: 1,
      column: 1,
    }
  )
}

export function adapterMappingEntryLocation(
  mapping: AdapterMapping,
  entry: AdapterSubjectMapping,
  field: 'native' | 'external' | 'type',
): SourceLocation {
  const index = mapping.mappings.indexOf(entry)
  return (
    mappingLocations.get(mapping)?.mappings[index]?.[field] ?? {
      path: `${mapping.id}.mapping.yaml`,
      pointer: `/mappings/${Math.max(index, 0)}/${field}`,
      line: 1,
      column: 1,
    }
  )
}

export function validateAdapterMapping(
  graph: SemanticGraph,
  mapping: AdapterMapping,
): AdapterMappingValidationResult {
  const subjectTypes = new Map(
    graph.subjects.map(({ id, type }) => [id, type] as const),
  )
  const locations = mappingLocations.get(mapping)?.mappings ?? []
  const diagnostics: Diagnostic[] = []
  const seenNativeSubjects = new Set<string>()
  const seenExternalIdentities = new Set<string>()

  for (const [index, entry] of mapping.mappings.entries()) {
    const fallback = (field: 'native' | 'external' | 'type') => ({
      path: `${mapping.id}.mapping.yaml`,
      pointer: `/mappings/${index}/${field}`,
      line: 1,
      column: 1,
    })
    const nativeLocation = locations[index]?.native ?? fallback('native')
    const externalLocation =
      locations[index]?.external ?? fallback('external')
    const typeLocation = locations[index]?.type ?? fallback('type')
    const actualType = subjectTypes.get(entry.native)
    if (actualType === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'YM601',
        message: `Native subject "${entry.native}" does not exist`,
        path: nativeLocation.path,
        pointer: nativeLocation.pointer,
        line: nativeLocation.line,
        column: nativeLocation.column,
      })
    } else if (actualType !== entry.type) {
      diagnostics.push({
        severity: 'error',
        code: 'YM602',
        message: `Native subject "${entry.native}" is a ${actualType}, not a ${entry.type}`,
        path: typeLocation.path,
        pointer: typeLocation.pointer,
        line: typeLocation.line,
        column: typeLocation.column,
      })
    }
    if (seenNativeSubjects.has(entry.native)) {
      diagnostics.push({
        severity: 'error',
        code: 'YM603',
        message: `Native subject "${entry.native}" is mapped more than once`,
        path: nativeLocation.path,
        pointer: nativeLocation.pointer,
        line: nativeLocation.line,
        column: nativeLocation.column,
      })
    }
    seenNativeSubjects.add(entry.native)
    if (seenExternalIdentities.has(entry.external)) {
      diagnostics.push({
        severity: 'error',
        code: 'YM604',
        message: `External identity "${entry.external}" is mapped more than once`,
        path: externalLocation.path,
        pointer: externalLocation.pointer,
        line: externalLocation.line,
        column: externalLocation.column,
      })
    }
    seenExternalIdentities.add(entry.external)
  }

  return diagnostics.length === 0
    ? { ok: true, mapping }
    : { ok: false, diagnostics: diagnostics.sort(diagnosticOrder) }
}

export function validateAdapterMappings(
  graph: SemanticGraph,
  mappings: readonly AdapterMapping[],
): AdapterMappingsValidationResult {
  const ordered = [...mappings].sort((left, right) => {
    const identityOrder = `${left.id}@${left.version}`.localeCompare(
      `${right.id}@${right.version}`,
    )
    if (identityOrder !== 0) return identityOrder
    const leftPath = mappingLocations.get(left)?.id.path ?? ''
    const rightPath = mappingLocations.get(right)?.id.path ?? ''
    return leftPath.localeCompare(rightPath)
  })
  const diagnostics: Diagnostic[] = []
  const seenIdentities = new Set<string>()
  const nativeOwnersByAdapter = new Map<
    string,
    Map<string, AdapterMapping>
  >()
  const externalOwnersByAdapter = new Map<
    string,
    Map<string, AdapterMapping>
  >()

  for (const mapping of ordered) {
    const identity = `${mapping.id}@${mapping.version}`
    const validation = validateAdapterMapping(graph, mapping)
    if (!validation.ok) {
      diagnostics.push(...validation.diagnostics)
    }
    if (seenIdentities.has(identity)) {
      const location = mappingLocations.get(mapping)?.id ?? {
        path: `${mapping.id}.mapping.yaml`,
        pointer: '/id',
        line: 1,
        column: 1,
      }
      diagnostics.push({
        severity: 'error',
        code: 'YM605',
        message: `Adapter mapping "${identity}" is declared more than once`,
        ...location,
      })
    }
    seenIdentities.add(identity)

    const nativeOwners =
      nativeOwnersByAdapter.get(mapping.adapter) ??
      new Map<string, AdapterMapping>()
    const externalOwners =
      externalOwnersByAdapter.get(mapping.adapter) ??
      new Map<string, AdapterMapping>()
    nativeOwnersByAdapter.set(mapping.adapter, nativeOwners)
    externalOwnersByAdapter.set(mapping.adapter, externalOwners)
    const locations = mappingLocations.get(mapping)?.mappings ?? []
    for (const [index, entry] of mapping.mappings.entries()) {
      const nativeOwner = nativeOwners.get(entry.native)
      if (nativeOwner !== undefined && nativeOwner !== mapping) {
        const location = locations[index]?.native ?? {
          path: `${mapping.id}.mapping.yaml`,
          pointer: `/mappings/${index}/native`,
          line: 1,
          column: 1,
        }
        diagnostics.push({
          severity: 'error',
          code: 'YM603',
          message: `Native subject "${entry.native}" is mapped more than once for adapter "${mapping.adapter}"`,
          ...location,
        })
      }
      nativeOwners.set(entry.native, nativeOwner ?? mapping)

      const externalOwner = externalOwners.get(entry.external)
      if (externalOwner !== undefined && externalOwner !== mapping) {
        const location = locations[index]?.external ?? {
          path: `${mapping.id}.mapping.yaml`,
          pointer: `/mappings/${index}/external`,
          line: 1,
          column: 1,
        }
        diagnostics.push({
          severity: 'error',
          code: 'YM604',
          message: `External identity "${entry.external}" is mapped more than once for adapter "${mapping.adapter}"`,
          ...location,
        })
      }
      externalOwners.set(entry.external, externalOwner ?? mapping)
    }
  }

  return diagnostics.length === 0
    ? { ok: true, mappings: ordered }
    : { ok: false, diagnostics: diagnostics.sort(diagnosticOrder) }
}
