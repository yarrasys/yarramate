import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCoreContract, loadCoreContract } from '../src/index.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('Core contract manifests', () => {
  it('dogfoods the exact tool-neutral Core 0.1 package boundary', () => {
    const source = {
      path: '.yarramate/contracts/yarramate-core-0.1.yaml',
      source: readFileSync(
        join(
          repositoryRoot,
          '.yarramate/contracts/yarramate-core-0.1.yaml',
        ),
        'utf8',
      ),
    }
    const loaded = loadCoreContract(source)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const packageManifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    )
    const result = checkCoreContract(source, {
      files: [
        'package.json',
        ...loaded.contract.formats.map(({ schema }) => schema),
      ].filter((path) => existsSync(join(repositoryRoot, path))),
      packageManifestValid: true,
      packageExports: packageManifest.exports,
      packageBinaries: Object.keys(packageManifest.bin),
      schemas: Object.fromEntries(
        loaded.contract.formats.map(({ schema }) => {
          const value = JSON.parse(
            readFileSync(join(repositoryRoot, schema), 'utf8'),
          )
          return [
            schema,
            {
              ok: true,
              format: value.properties.format.const,
              validSchema: true,
            },
          ]
        }),
      ),
    })

    expect(result.ok).toBe(true)
    expect(
      loaded.contract.commands.map(({ name }) => name),
    ).toEqual([
      'init',
      'add',
      'connect',
      'new',
      'check',
      'status',
      'next',
      'compile',
      'view',
      'context',
      'compare',
      'evidence',
      'reconcile',
      'interrogate',
      'apply',
    ])
    expect(
      loaded.contract.formats.some(({ id }) => id.includes('likec4')),
    ).toBe(false)
  })

  it('loads the smallest closed release contract', () => {
    const result = loadCoreContract({
      path: 'core.contract.yaml',
      source: `format: yarramate/core-contract/v1
id: yarramate-core
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/yarramate-document.schema.json
    packageExport: ./schema/document
  - id: yarramate/check-result/v1
    schema: schema/yarramate-check-result.schema.json
    packageExport: ./schema/check-result
commands:
  - name: check
    binary: yarramate
    machineFormat: yarramate/check-result/v1
guarantees:
  - canonical-graph-serialization
exclusions:
  - architectural-quality
`,
    })

    expect(result).toEqual({
      ok: true,
      contract: {
        format: 'yarramate/core-contract/v1',
        id: 'yarramate-core',
        version: '0.1',
        packageManifest: 'package.json',
        formats: [
          {
            id: 'yarramate/v1',
            schema: 'schema/yarramate-document.schema.json',
            packageExport: './schema/document',
          },
          {
            id: 'yarramate/check-result/v1',
            schema: 'schema/yarramate-check-result.schema.json',
            packageExport: './schema/check-result',
          },
        ],
        commands: [
          {
            name: 'check',
            binary: 'yarramate',
            machineFormat: 'yarramate/check-result/v1',
          },
        ],
        guarantees: ['canonical-graph-serialization'],
        exclusions: ['architectural-quality'],
      },
    })
  })

  it('rejects duplicate format identities at the later declaration', () => {
    const result = loadCoreContract({
      path: 'duplicate.contract.yaml',
      source: `format: yarramate/core-contract/v1
id: duplicate
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/first.json
    packageExport: ./schema/document
  - id: yarramate/v1
    schema: schema/second.json
    packageExport: ./schema/profile
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC101',
          message:
            'Core contract format "yarramate/v1" is declared more than once',
          path: 'duplicate.contract.yaml',
          pointer: '/formats/1/id',
          line: 9,
          column: 9,
        },
      ],
    })
  })

  it('requires every command machine format to be declared', () => {
    const result = loadCoreContract({
      path: 'reference.contract.yaml',
      source: `format: yarramate/core-contract/v1
id: reference
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
    machineFormat: yarramate/check-result/v1
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC103',
          message:
            'Command "check" references undeclared machine format "yarramate/check-result/v1"',
          path: 'reference.contract.yaml',
          pointer: '/commands/0/machineFormat',
          line: 12,
          column: 20,
        },
      ],
    })
  })

  it('rejects duplicate command families', () => {
    const result = loadCoreContract({
      path: 'commands.contract.yaml',
      source: `format: yarramate/core-contract/v1
id: commands
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC102',
          message:
            'Core contract command "check" is declared more than once',
          path: 'commands.contract.yaml',
          pointer: '/commands/1/name',
          line: 12,
          column: 11,
        },
      ],
    })
  })

  it('checks declared schema exports against an implementation surface', () => {
    const result = checkCoreContract(
      {
        path: 'surface.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: surface
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
  - id: yarramate/check-result/v1
    schema: schema/check-result.json
    packageExport: ./schema/check-result
commands:
  - name: check
    binary: yarramate
    machineFormat: yarramate/check-result/v1
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json', 'schema/check-result.json'],
        packageManifestValid: true,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: ['yarramate'],
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC202',
          message:
            'Package export "./schema/check-result" does not resolve to "schema/check-result.json"',
          path: 'surface.contract.yaml',
          pointer: '/formats/1/packageExport',
          line: 11,
          column: 20,
        },
      ],
    })
  })

  it('rejects a declared schema that is not valid JSON', () => {
    const result = checkCoreContract(
      {
        path: 'invalid-schema.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: invalid-schema
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json'],
        packageManifestValid: true,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: ['yarramate'],
        schemas: {
          'schema/document.json': { ok: false },
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC206',
          message: 'Schema file "schema/document.json" is not valid JSON',
          path: 'invalid-schema.contract.yaml',
          pointer: '/formats/0/schema',
          line: 7,
          column: 13,
        },
      ],
    })
  })

  it('requires a declared schema to identify its contracted format', () => {
    const result = checkCoreContract(
      {
        path: 'mismatched-schema.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: mismatched-schema
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json'],
        packageManifestValid: true,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: ['yarramate'],
        schemas: {
          'schema/document.json': {
            ok: true,
            format: 'yarramate/profile/v1',
          },
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC207',
          message:
            'Schema file "schema/document.json" declares format "yarramate/profile/v1" instead of "yarramate/v1"',
          path: 'mismatched-schema.contract.yaml',
          pointer: '/formats/0/id',
          line: 6,
          column: 9,
        },
      ],
    })
  })

  it('requires a declared schema to be valid JSON Schema', () => {
    const result = checkCoreContract(
      {
        path: 'invalid-json-schema.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: invalid-json-schema
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json'],
        packageManifestValid: true,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: ['yarramate'],
        schemas: {
          'schema/document.json': {
            ok: true,
            format: 'yarramate/v1',
            validSchema: false,
          },
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC208',
          message:
            'Schema file "schema/document.json" is not valid JSON Schema 2020-12',
          path: 'invalid-json-schema.contract.yaml',
          pointer: '/formats/0/schema',
          line: 7,
          column: 13,
        },
      ],
    })
  })

  it('reports missing package and schema files without package-surface cascades', () => {
    const result = checkCoreContract(
      {
        path: 'missing.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: missing
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: [],
        packageManifestValid: false,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: [],
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC204',
          message: 'Package manifest "package.json" does not exist',
          path: 'missing.contract.yaml',
          pointer: '/packageManifest',
          line: 4,
          column: 18,
        },
        {
          severity: 'error',
          code: 'YMC201',
          message: 'Schema file "schema/document.json" does not exist',
          path: 'missing.contract.yaml',
          pointer: '/formats/0/schema',
          line: 7,
          column: 13,
        },
      ],
    })
  })

  it('reports an unreadable declared package without cascading surface errors', () => {
    const result = checkCoreContract(
      {
        path: 'unreadable.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: unreadable
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json'],
        packageManifestValid: false,
        packageExports: {},
        packageBinaries: [],
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC205',
          message:
            'Package manifest "package.json" is not a valid JSON object',
          path: 'unreadable.contract.yaml',
          pointer: '/packageManifest',
          line: 4,
          column: 18,
        },
      ],
    })
  })

  it('requires every declared command binary on the package surface', () => {
    const result = checkCoreContract(
      {
        path: 'binary.contract.yaml',
        source: `format: yarramate/core-contract/v1
id: binary
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/v1
    schema: schema/document.json
    packageExport: ./schema/document
commands:
  - name: check
    binary: yarramate
guarantees: [canonical-graph-serialization]
exclusions: [architectural-quality]
`,
      },
      {
        files: ['package.json', 'schema/document.json'],
        packageManifestValid: true,
        packageExports: {
          './schema/document': './schema/document.json',
        },
        packageBinaries: [],
      },
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMC203',
          message: 'Package binary "yarramate" is not declared',
          path: 'binary.contract.yaml',
          pointer: '/commands/0/binary',
          line: 11,
          column: 13,
        },
      ],
    })
  })
})
