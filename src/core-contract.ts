import { LineCounter, parseDocument } from 'yaml'
import type { Diagnostic, WorkspaceSource } from './compiler.js'
import {
  diagnosticOrder,
  loadSourceDocument,
  locateSourcePath,
} from './source-document.js'
import { validateCoreContract } from './schema-validation.js'
import coreContractSchema from '../schema/yarramate-core-contract.schema.json' with {
  type: 'json',
}



export interface CoreContractFormat {
  readonly id: string
  readonly schema: string
  readonly packageExport: string
}

export interface CoreContractCommand {
  readonly name:
    | 'init'
    | 'design'
    | 'apply'
    | 'ask'
    | 'check'
    | 'reconcile'
    | 'export'
  readonly binary: 'yarramate'
  readonly machineFormat?: string
}

export interface CoreContract {
  readonly format: 'yarramate/core-contract/v1'
  readonly id: string
  readonly version: string
  readonly packageManifest: string
  readonly formats: readonly CoreContractFormat[]
  readonly commands: readonly CoreContractCommand[]
  readonly guarantees: readonly string[]
  readonly exclusions: readonly string[]
}

export type CoreContractLoadResult =
  | { readonly ok: true; readonly contract: CoreContract }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export interface CoreContractSurface {
  readonly files: readonly string[]
  readonly packageManifestValid: boolean
  readonly packageExports: Readonly<Record<string, string>>
  readonly packageBinaries: readonly string[]
  readonly schemas?: Readonly<
    Record<
      string,
      | { readonly ok: false }
      | {
          readonly ok: true
          readonly format?: string
          readonly validSchema?: boolean
        }
    >
  >
}

export function loadCoreContract(
  source: WorkspaceSource,
): CoreContractLoadResult {
  const loaded = loadSourceDocument<CoreContract>(
    source,
    validateCoreContract,
    'Core contract',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document
  const diagnostics: Diagnostic[] = []
  const formatIds = new Set<string>()
  value.formats.forEach((format, index) => {
    if (formatIds.has(format.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'YMC101',
        message: `Core contract format "${format.id}" is declared more than once`,
        ...locateSourcePath(
          source.path,
          yaml,
          lineCounter,
          ['formats', index, 'id'],
          `/formats/${index}/id`,
        ),
      })
    }
    formatIds.add(format.id)
  })
  const commandNames = new Set<string>()
  value.commands.forEach((command, index) => {
    if (commandNames.has(command.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'YMC102',
        message: `Core contract command "${command.name}" is declared more than once`,
        ...locateSourcePath(
          source.path,
          yaml,
          lineCounter,
          ['commands', index, 'name'],
          `/commands/${index}/name`,
        ),
      })
    }
    commandNames.add(command.name)
    if (
      command.machineFormat !== undefined &&
      !formatIds.has(command.machineFormat)
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'YMC103',
        message: `Command "${command.name}" references undeclared machine format "${command.machineFormat}"`,
        ...locateSourcePath(
          source.path,
          yaml,
          lineCounter,
          ['commands', index, 'machineFormat'],
          `/commands/${index}/machineFormat`,
        ),
      })
    }
  })
  return diagnostics.length === 0
    ? { ok: true, contract: value }
    : { ok: false, diagnostics: diagnostics.sort(diagnosticOrder) }
}

export function checkCoreContract(
  source: WorkspaceSource,
  surface: CoreContractSurface,
): CoreContractLoadResult {
  const loaded = loadCoreContract(source)
  if (!loaded.ok) return loaded
  const lineCounter = new LineCounter()
  const yaml = parseDocument(source.source, { lineCounter })
  const files = new Set(surface.files)
  const binaries = new Set(surface.packageBinaries)
  const diagnostics: Diagnostic[] = []
  if (!files.has(loaded.contract.packageManifest)) {
    diagnostics.push({
      severity: 'error',
      code: 'YMC204',
      message: `Package manifest "${loaded.contract.packageManifest}" does not exist`,
      ...locateSourcePath(
        source.path,
        yaml,
        lineCounter,
        ['packageManifest'],
        '/packageManifest',
      ),
    })
  } else if (!surface.packageManifestValid) {
    diagnostics.push({
      severity: 'error',
      code: 'YMC205',
      message: `Package manifest "${loaded.contract.packageManifest}" is not a valid JSON object`,
      ...locateSourcePath(
        source.path,
        yaml,
        lineCounter,
        ['packageManifest'],
        '/packageManifest',
      ),
    })
  }
  diagnostics.push(
    ...loaded.contract.formats.flatMap(
    (format, index): Diagnostic[] => {
      const missingSchema: Diagnostic[] = files.has(format.schema)
        ? []
        : [
            {
              severity: 'error',
              code: 'YMC201',
              message: `Schema file "${format.schema}" does not exist`,
              ...locateSourcePath(
                source.path,
                yaml,
                lineCounter,
                ['formats', index, 'schema'],
                `/formats/${index}/schema`,
              ),
            },
          ]
      const schemaSurface = surface.schemas?.[format.schema]
      const invalidSchema: Diagnostic[] =
        files.has(format.schema) &&
        schemaSurface !== undefined &&
        !schemaSurface.ok
          ? [
              {
                severity: 'error',
                code: 'YMC206',
                message: `Schema file "${format.schema}" is not valid JSON`,
                ...locateSourcePath(
                  source.path,
                  yaml,
                  lineCounter,
                  ['formats', index, 'schema'],
                  `/formats/${index}/schema`,
                ),
              },
            ]
          : []
      const mismatchedFormat: Diagnostic[] =
        files.has(format.schema) &&
        schemaSurface?.ok === true &&
        schemaSurface.format !== format.id
          ? [
              {
                severity: 'error',
                code: 'YMC207',
                message:
                  schemaSurface.format === undefined
                    ? `Schema file "${format.schema}" does not declare contracted format "${format.id}"`
                    : `Schema file "${format.schema}" declares format "${schemaSurface.format}" instead of "${format.id}"`,
                ...locateSourcePath(
                  source.path,
                  yaml,
                  lineCounter,
                  ['formats', index, 'id'],
                  `/formats/${index}/id`,
                ),
              },
            ]
          : []
      const invalidJsonSchema: Diagnostic[] =
        files.has(format.schema) &&
        schemaSurface?.ok === true &&
        schemaSurface.validSchema === false
          ? [
              {
                severity: 'error',
                code: 'YMC208',
                message: `Schema file "${format.schema}" is not valid JSON Schema 2020-12`,
                ...locateSourcePath(
                  source.path,
                  yaml,
                  lineCounter,
                  ['formats', index, 'schema'],
                  `/formats/${index}/schema`,
                ),
              },
            ]
          : []
      const expected = `./${format.schema}`
      const invalidExport: Diagnostic[] =
        !surface.packageManifestValid
          ? []
          : surface.packageExports[format.packageExport] === expected
            ? []
            : [
                {
                  severity: 'error',
                  code: 'YMC202',
                  message: `Package export "${format.packageExport}" does not resolve to "${format.schema}"`,
                  ...locateSourcePath(
                    source.path,
                    yaml,
                    lineCounter,
                    ['formats', index, 'packageExport'],
                    `/formats/${index}/packageExport`,
                  ),
                },
              ]
      return [
        ...missingSchema,
        ...invalidSchema,
        ...mismatchedFormat,
        ...invalidJsonSchema,
        ...invalidExport,
      ]
    },
    ),
  )
  loaded.contract.commands.forEach((command, index) => {
    if (
      surface.packageManifestValid &&
      !binaries.has(command.binary)
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'YMC203',
        message: `Package binary "${command.binary}" is not declared`,
        ...locateSourcePath(
          source.path,
          yaml,
          lineCounter,
          ['commands', index, 'binary'],
          `/commands/${index}/binary`,
        ),
      })
    }
  })
  return diagnostics.length === 0
    ? loaded
    : { ok: false, diagnostics: diagnostics.sort(diagnosticOrder) }
}
