import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv2020Module from 'ajv/dist/2020.js'
import { runLikeC4Cli } from '../src/adapters/likec4-cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const Ajv2020 = Ajv2020Module.default

describe('YarraMate LikeC4 adapter CLI', () => {
  it('prints the package version for --version', () => {
    const { version } = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { version: string }
    const result = runLikeC4Cli(['--version'], repositoryRoot)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(`yarramate-likec4 ${version}\n`)
    expect(result.stderr).toBe('')
  })

  it('syncs missing subject mappings without changing authored overrides', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-map-'))
    const architecture = join(parent, 'architecture.yaml')
    const workspace = join(parent, 'workspace.yaml')
    const mapping = join(parent, 'mapping.yaml')
    try {
      writeFileSync(
        architecture,
        `format: yarramate/v1
id: delivery
profile: yarramate/core@0.1
states:
  - id: target
    kind: target
    name: Target
concepts:
  - id: delivery-api
    kind: applicationComponent
    name: Delivery API
  - id: delivery-store
    kind: dataObject
    name: Delivery store
relationships:
  - id: api-reads-store
    kind: access
    from: delivery-api
    to: delivery-store
    mode: read
`,
      )
      writeFileSync(
        workspace,
        `format: yarramate/workspace/v1
id: delivery
documents: [architecture.yaml]
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      )
      writeFileSync(
        mapping,
        `format: yarramate/adapter-mapping/v1
id: delivery-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: delivery#delivery-api
    external: customApi
    type: concept
`,
      )

      const first = runLikeC4Cli(
        ['map', '--sync', 'mapping.yaml', 'workspace.yaml'],
        parent,
      )
      expect(first).toEqual({
        exitCode: 0,
        stdout: 'Added 2 LikeC4 mappings to mapping.yaml\n',
        stderr: '',
      })
      expect(readFileSync(mapping, 'utf8')).toContain(
        'external: customApi',
      )
      expect(readFileSync(mapping, 'utf8')).toContain(
        'native: delivery#delivery-store\n    external: deliveryStore\n    type: concept',
      )
      expect(readFileSync(mapping, 'utf8')).toContain(
        'native: delivery#api-reads-store\n    external: apiReadsStore\n    type: relationship',
      )
      expect(readFileSync(mapping, 'utf8')).not.toContain(
        'native: delivery#target',
      )

      const before = readFileSync(mapping, 'utf8')
      expect(
        runLikeC4Cli(
          ['map', '--sync', 'mapping.yaml', 'workspace.yaml'],
          parent,
        ),
      ).toEqual({
        exitCode: 0,
        stdout: 'LikeC4 mapping mapping.yaml is already synchronized\n',
        stderr: '',
      })
      expect(readFileSync(mapping, 'utf8')).toBe(before)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('adds missing mappings while retaining and reporting stale entries', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-stale-'))
    const mapping = join(parent, 'mapping.yaml')
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: delivery
profile: yarramate/core@0.1
concepts:
  - id: current-api
    kind: applicationComponent
    name: Current API
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'workspace.yaml'),
        `format: yarramate/workspace/v1
id: delivery
documents: [architecture.yaml]
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      )
      writeFileSync(
        mapping,
        `format: yarramate/adapter-mapping/v1
id: delivery-likec4
version: "1.0"
adapter: likec4
mappings:
  # Retained until pruning is explicit.
  - native: delivery#renamed-api
    external: renamedApi
    type: concept
`,
      )

      expect(
        runLikeC4Cli(
          ['map', '--sync', 'mapping.yaml', 'workspace.yaml'],
          parent,
        ),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Added 1 LikeC4 mapping to mapping.yaml; left 1 stale mapping (use --prune)\n',
        stderr: '',
      })
      const synchronized = readFileSync(mapping, 'utf8')
      expect(synchronized).toContain(
        '# Retained until pruning is explicit.',
      )
      expect(synchronized).toContain('native: delivery#renamed-api')
      expect(synchronized).toContain('native: delivery#current-api')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('prunes stale mappings only when explicitly requested', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-prune-'))
    const mapping = join(parent, 'mapping.yaml')
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: delivery
profile: yarramate/core@0.1
concepts:
  - id: current-api
    kind: applicationComponent
    name: Current API
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'workspace.yaml'),
        `format: yarramate/workspace/v1
id: delivery
documents: [architecture.yaml]
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      )
      writeFileSync(
        mapping,
        `format: yarramate/adapter-mapping/v1
id: delivery-likec4
version: "1.0"
adapter: likec4
mappings:
  # Removed together with the stale mapping.
  - native: delivery#renamed-api
    external: renamedApi
    type: concept
`,
      )

      expect(
        runLikeC4Cli(
          ['map', '--sync', '--prune', 'mapping.yaml', 'workspace.yaml'],
          parent,
        ),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Added 1 and pruned 1 stale LikeC4 mapping in mapping.yaml\n',
        stderr: '',
      })
      const synchronized = readFileSync(mapping, 'utf8')
      expect(synchronized).not.toContain('delivery#renamed-api')
      expect(synchronized).not.toContain(
        '# Removed together with the stale mapping.',
      )
      expect(synchronized).toContain('native: delivery#current-api')
      expect(synchronized).toContain('external: currentApi')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('checks a complete adapter export without writing derived output', () => {
    const result = runLikeC4Cli(
      [
        'check',
        'test/fixtures/valid/governed-change.projection.yaml',
        'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        'test/fixtures/valid/governed-change.workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Checked LikeC4 export governed-change@1.0: no errors\n',
      stderr: '',
    })
  })

  it('fails the check when a projected relationship has no mapping', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-gate-'))
    try {
      const mapping = readFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        ),
        'utf8',
      )
      const conceptOnly = mapping
        .split('  - native: ')
        .filter((entry, index) => index === 0 || !entry.includes('type: relationship'))
        .join('  - native: ')
      writeFileSync(join(parent, 'concept-only.mapping.yaml'), conceptOnly)

      const gated = runLikeC4Cli(
        [
          'check',
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.projection.yaml',
          ),
          join(parent, 'concept-only.mapping.yaml'),
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.workspace.yaml',
          ),
        ],
        repositoryRoot,
      )

      expect(gated.exitCode).toBe(1)
      expect(gated.stdout).toContain('YMLC111')
      expect(gated.stdout).toContain('no LikeC4 mapping')

      // The same incomplete mapping still renders: a view selects a
      // relationship by metadata, not by external identity.
      const exported = runLikeC4Cli(
        [
          'export',
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.projection.yaml',
          ),
          join(parent, 'concept-only.mapping.yaml'),
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.workspace.yaml',
          ),
        ],
        repositoryRoot,
      )

      expect(exported.exitCode).toBe(0)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('summarizes a flood of unmapped relationships for the check gate', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-flood-'))
    try {
      const mapping = readFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        ),
        'utf8',
      )
      const conceptOnly = mapping
        .split('  - native: ')
        .filter((entry, index) => index === 0 || !entry.includes('type: relationship'))
        .join('  - native: ')
      writeFileSync(join(parent, 'concept-only.mapping.yaml'), conceptOnly)

      const gated = runLikeC4Cli(
        [
          'check',
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.projection.yaml',
          ),
          join(parent, 'concept-only.mapping.yaml'),
          join(
            repositoryRoot,
            'test/fixtures/valid/governed-change.workspace.yaml',
          ),
        ],
        repositoryRoot,
      )

      const payload = JSON.parse(gated.stdout) as {
        diagnostics: readonly { code: string; message: string }[]
      }
      const relationshipDiagnostics = payload.diagnostics.filter(
        ({ code }) => code === 'YMLC111',
      )
      expect(relationshipDiagnostics).toHaveLength(1)
      expect(relationshipDiagnostics[0]!.message).toMatch(
        /^\d+ projected relationships have no LikeC4 mapping \(first: /,
      )
      expect(relationshipDiagnostics[0]!.message).toContain(
        'yarramate-likec4 map --sync',
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('emits schema-valid machine results for successful and failing checks', () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-likec4-check-result.schema.json',
        ),
        'utf8',
      ),
    )
    const adapterDiagnosticSchema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-likec4-diagnostic-result.schema.json',
        ),
        'utf8',
      ),
    )
    const coreDiagnosticSchema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-diagnostic-result.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true })
      .addSchema(coreDiagnosticSchema)
      .addSchema(adapterDiagnosticSchema)
      .compile(schema)
    const success = runLikeC4Cli(
      [
        'check',
        'test/fixtures/valid/governed-change.projection.yaml',
        'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        '--json',
        'test/fixtures/valid/governed-change.workspace.yaml',
      ],
      repositoryRoot,
    )
    const failure = runLikeC4Cli(
      [
        'check',
        '.yarramate/projections/likec4-export-path.yaml',
        '.yarramate/integrations/likec4/subject-mapping.yaml',
        '--json',
        '.yarramate/workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(JSON.parse(success.stdout)).toEqual({
      format: 'yarramate/likec4-check-result/v1',
      ok: true,
      diagnostics: [],
    })
    expect(JSON.parse(failure.stdout)).toMatchObject({
      format: 'yarramate/likec4-check-result/v1',
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'YMLC104' }),
      ]),
    })
    expect(validate(JSON.parse(success.stdout))).toBe(true)
    expect(
      validate(JSON.parse(failure.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('checks bundled kind compatibility without creating a project', () => {
    const result = runLikeC4Cli(
      [
        'check',
        '.yarramate/projections/likec4-export-path.yaml',
        '.yarramate/integrations/likec4/subject-mapping.yaml',
        '.yarramate/workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'YMLC104',
          subject: 'yarramate-repository#likec4-export-source',
        }),
      ]),
    })
  })

  it('summarizes many unmapped concepts in human check output only', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-unmapped-'),
    )
    const mapping = join(parent, 'likec4.mapping.yaml')
    const writeMapping = (mappings: string) =>
      writeFileSync(
        mapping,
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
${mappings}`,
      )
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: api
    kind: applicationComponent
    name: API
  - id: worker
    kind: applicationComponent
    name: Worker
  - id: store
    kind: dataObject
    name: Store
  - id: queue
    kind: applicationComponent
    name: Queue
  - id: gateway
    kind: applicationComponent
    name: Gateway
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'system.projection.yaml'),
        `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      )
      writeMapping(
        `  - native: system#gateway
    external: gateway
    type: concept
`,
      )
      const args = [
        'check',
        'system.projection.yaml',
        'likec4.mapping.yaml',
        'architecture.yaml',
      ]

      const human = runLikeC4Cli(args, parent)
      expect(human.exitCode).toBe(1)
      expect(human.stderr).toBe('')
      expect(JSON.parse(human.stdout)).toEqual({
        format: 'yarramate/likec4-diagnostic-result/v1',
        diagnostics: [
          {
            severity: 'error',
            code: 'YMLC102',
            message:
              '4 projected concepts have no LikeC4 mapping (first: ' +
              '"system#api", "system#worker", "system#store"); run ' +
              '"yarramate-likec4 map --sync" to add the missing mappings',
            subject: 'system#api',
            path: 'architecture.yaml',
            pointer: '/concepts/0/kind',
            line: 6,
            column: 11,
          },
        ],
      })
      const schema = JSON.parse(
        readFileSync(
          join(
            repositoryRoot,
            'schema/yarramate-likec4-diagnostic-result.schema.json',
          ),
          'utf8',
        ),
      )
      const diagnosticSchema = JSON.parse(
        readFileSync(
          join(
            repositoryRoot,
            'schema/yarramate-diagnostic-result.schema.json',
          ),
          'utf8',
        ),
      )
      const validate = new Ajv2020({ allErrors: true })
        .addSchema(diagnosticSchema)
        .compile(schema)
      expect(
        validate(JSON.parse(human.stdout)),
        JSON.stringify(validate.errors ?? []),
      ).toBe(true)

      const machine = runLikeC4Cli([...args, '--json'], parent)
      expect(machine.exitCode).toBe(1)
      const parsed = JSON.parse(machine.stdout) as {
        readonly format: string
        readonly ok: boolean
        readonly diagnostics: readonly {
          readonly code: string
          readonly subject?: string
        }[]
      }
      expect(parsed.format).toBe('yarramate/likec4-check-result/v1')
      expect(parsed.ok).toBe(false)
      expect(
        parsed.diagnostics
          .filter(({ code }) => code === 'YMLC102')
          .map(({ subject }) => subject),
      ).toEqual([
        'system#api',
        'system#worker',
        'system#store',
        'system#queue',
      ])

      writeMapping(
        `  - native: system#gateway
    external: gateway
    type: concept
  - native: system#worker
    external: worker
    type: concept
`,
      )
      const boundary = runLikeC4Cli(args, parent)
      expect(boundary.exitCode).toBe(1)
      expect(
        (JSON.parse(boundary.stdout) as {
          readonly diagnostics: readonly {
            readonly subject?: string
          }[]
        }).diagnostics.map(({ subject }) => subject),
      ).toEqual(['system#api', 'system#store', 'system#queue'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('exports a native workspace projection to LikeC4 source', () => {
    const result = runLikeC4Cli(
      [
        'export',
        'test/fixtures/valid/governed-change.projection.yaml',
        'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        'test/fixtures/valid/governed-change.workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(
      '// Generated by YarraMate. Edit the native documents, not this file.',
    )
    expect(result.stdout).toContain(
      "controlPlane = applicationComponent 'Control plane'",
    )
    expect(result.stdout).toContain(
      "controlPlane -[assignment]-> edgeRuntime 'deployed on'",
    )
  })

  it('exports a state comparison without moving presentation into Core', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-compare-'))
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
  - id: target
    kind: target
    name: Target
concepts:
  - id: legacy
    kind: applicationComponent
    name: Legacy
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern
    presentIn: [target]
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'comparison.projection.yaml'),
        `format: yarramate/projection/v1
id: system-change
version: "1.0"
query:
  states: [system#baseline, system#target]
`,
      )
      writeFileSync(
        join(parent, 'likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#legacy
    external: legacy
    type: concept
  - native: system#modern
    external: modern
    type: concept
`,
      )

      const result = runLikeC4Cli(
        [
          'export',
          'comparison.projection.yaml',
          'likec4.mapping.yaml',
          '--compare',
          'system#baseline',
          'system#target',
          'architecture.yaml',
        ],
        parent,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain(`yarramateChange 'removed'`)
      expect(result.stdout).toContain(`yarramateChange 'added'`)
      writeFileSync(join(parent, 'model.likec4'), result.stdout)
      copyFileSync(
        join(repositoryRoot, 'assets/likec4/specification.likec4'),
        join(parent, 'specification.likec4'),
      )
      writeFileSync(
        join(parent, 'likec4.config.json'),
        JSON.stringify({
          $schema: 'https://likec4.dev/schemas/config.json',
          name: 'state-comparison',
        }),
      )
      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        [
          'validate',
          '--json',
          '--no-layout',
          '--file',
          'model.likec4',
          '.',
        ],
        { cwd: parent, encoding: 'utf8' },
      )
      expect(
        validation.status,
        `${validation.stderr}\n${validation.stdout}`,
      ).toBe(0)
      expect(JSON.parse(validation.stdout)).toMatchObject({
        valid: true,
        errors: [],
        stats: { totalErrors: 0 },
      })
      const project = join(parent, 'generated')
      const materialized = runLikeC4Cli(
        [
          'export-project',
          'comparison.projection.yaml',
          'likec4.mapping.yaml',
          project,
          '--compare',
          'system#baseline',
          'system#target',
          'architecture.yaml',
        ],
        parent,
      )
      expect(materialized.exitCode).toBe(0)
      expect(
        JSON.parse(
          readFileSync(
            join(project, 'yarramate.generated.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({
        comparison: {
          from: 'system#baseline',
          to: 'system#target',
        },
      })
      const reversed = runLikeC4Cli(
        [
          'export-project',
          'comparison.projection.yaml',
          'likec4.mapping.yaml',
          project,
          '--compare',
          'system#target',
          'system#baseline',
          'architecture.yaml',
        ],
        parent,
      )
      expect(reversed).toEqual({
        exitCode: 0,
        stdout: `Updated LikeC4 project at ${project}\n`,
        stderr: '',
      })
      expect(
        JSON.parse(
          readFileSync(
            join(project, 'yarramate.generated.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({
        comparison: {
          from: 'system#target',
          to: 'system#baseline',
        },
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('emits schema-valid diagnostics for adapter command failures', () => {
    const schema = JSON.parse(
      readFileSync(
        `${repositoryRoot}/schema/yarramate-likec4-diagnostic-result.schema.json`,
        'utf8',
      ),
    )
    const diagnosticSchema = JSON.parse(
      readFileSync(
        `${repositoryRoot}/schema/yarramate-diagnostic-result.schema.json`,
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true })
      .addSchema(diagnosticSchema)
      .compile(schema)
    const result = runLikeC4Cli(
      [
        'export',
        'test/fixtures/valid/governed-change.projection.yaml',
        'test/fixtures/invalid/adapter-mapping-missing-adapter.yaml',
        'test/fixtures/valid/governed-change.workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(
      validate(JSON.parse(result.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('produces source whose generated project resolves profile kinds', () => {
    const result = runLikeC4Cli(
      [
        'export',
        'test/fixtures/valid/governed-change.projection.yaml',
        'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        'test/fixtures/valid/governed-change.workspace.yaml',
      ],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-validation-'),
    )
    try {
      writeFileSync(join(fixtureRoot, 'model.likec4'), result.stdout)
      copyFileSync(
        join(repositoryRoot, 'assets/likec4/specification.likec4'),
        join(fixtureRoot, 'specification.likec4'),
      )
      writeFileSync(
        join(fixtureRoot, 'likec4.config.json'),
        JSON.stringify({
          $schema: 'https://likec4.dev/schemas/config.json',
          name: 'yarramate-generated-validation',
        }),
      )
      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        [
          'validate',
          '--json',
          '--no-layout',
          '--file',
          'model.likec4',
          '.',
        ],
        { cwd: fixtureRoot, encoding: 'utf8' },
      )

      expect(
        validation.status,
        `${validation.stderr}\n${validation.stdout}`,
      ).toBe(0)
      expect(JSON.parse(validation.stdout)).toMatchObject({
        valid: true,
        errors: [],
        stats: { totalErrors: 0 },
      })
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('materializes a self-contained project without merging projections', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-project-'))
    const project = join(parent, 'governed-change')
    try {
      const result = runLikeC4Cli(
        [
          'export-project',
          'test/fixtures/valid/governed-change.projection.yaml',
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
          project,
          'test/fixtures/valid/governed-change.workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result).toEqual({
        exitCode: 0,
        stdout: `Wrote LikeC4 project to ${project}\n`,
        stderr: '',
      })
      expect(readFileSync(join(project, 'model.likec4'), 'utf8')).toContain(
        "controlPlane = applicationComponent 'Control plane'",
      )
      expect(
        JSON.parse(
          readFileSync(join(project, 'likec4.config.json'), 'utf8'),
        ),
      ).toMatchObject({
        name: 'yarramate-governed-change-1-0',
      })
      expect(
        readFileSync(join(project, 'specification.likec4'), 'utf8'),
      ).toContain('element driver')
      const marker = JSON.parse(
        readFileSync(
          join(project, 'yarramate.generated.json'),
          'utf8',
        ),
      )
      expect(marker).toMatchObject({
        format: 'yarramate/likec4-generated-project/v1',
        projection: 'governed-change@1.0',
        mapping: 'governed-change-likec4@1.0',
        files: [
          'likec4.config.json',
          'model.likec4',
          'specification.likec4',
        ],
      })
      expect(marker.digests).toEqual({
        'likec4.config.json': expect.stringMatching(/^[a-f0-9]{64}$/),
        'model.likec4': expect.stringMatching(/^[a-f0-9]{64}$/),
        'specification.likec4': expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(marker.inputDigests).toEqual({
        'test/fixtures/valid/governed-change.projection.yaml':
          expect.stringMatching(/^[a-f0-9]{64}$/),
        'test/fixtures/valid/governed-change.likec4-mapping.yaml':
          expect.stringMatching(/^[a-f0-9]{64}$/),
        'test/fixtures/valid/governed-change.yaml':
          expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      const markerSchema = JSON.parse(
        readFileSync(
          join(
            repositoryRoot,
            'schema/yarramate-likec4-generated-project.schema.json',
          ),
          'utf8',
        ),
      )
      const validateMarker = new Ajv2020({ allErrors: true }).compile(
        markerSchema,
      )
      expect(
        validateMarker(marker),
        JSON.stringify(validateMarker.errors ?? []),
      ).toBe(true)

      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        ['validate', '--json', '--no-layout', project],
        { cwd: repositoryRoot, encoding: 'utf8' },
      )
      expect(
        validation.status,
        `${validation.stderr}\n${validation.stdout}`,
      ).toBe(0)
      expect(JSON.parse(validation.stdout)).toMatchObject({
        valid: true,
        errors: [],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('materializes one project with multiple projection views', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-model-'))
    const project = join(parent, 'generated')
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
  - id: target
    kind: target
    name: Target
concepts:
  - id: shared
    kind: applicationComponent
    name: Shared
  - id: legacy
    kind: applicationComponent
    name: Legacy
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern
    presentIn: [target]
relationships:
  - id: legacy-uses-shared
    kind: association
    from: legacy
    to: shared
    presentIn: [baseline]
  - id: modern-uses-shared
    kind: association
    from: modern
    to: shared
    presentIn: [target]
`,
      )
      writeFileSync(
        join(parent, 'baseline.projection.yaml'),
        `format: yarramate/projection/v1
id: baseline
version: "1.0"
query:
  states: [system#baseline]
`,
      )
      writeFileSync(
        join(parent, 'target.projection.yaml'),
        `format: yarramate/projection/v1
id: target
version: "1.0"
query:
  states: [system#target]
`,
      )
      writeFileSync(
        join(parent, 'empty.projection.yaml'),
        `format: yarramate/projection/v1
id: empty
version: "1.0"
query:
  kinds: [yarramate/core@0.1#device]
  relationships: connected
`,
      )
      writeFileSync(
        join(parent, 'likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#legacy
    external: legacy
    type: concept
  - native: system#modern
    external: modern
    type: concept
  - native: system#shared
    external: shared
    type: concept
  - native: system#legacy-uses-shared
    external: legacyUsesShared
    type: relationship
  - native: system#modern-uses-shared
    external: modernUsesShared
    type: relationship
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: baseline.projection.yaml
  - projection: target.projection.yaml
  - projection: empty.projection.yaml
`,
      )

      const checked = runLikeC4Cli(
        [
          'check',
          'yarramate.likec4.yaml',
          '--json',
          'architecture.yaml',
        ],
        parent,
      )
      expect(checked).toEqual({
        exitCode: 0,
        stdout: `${JSON.stringify(
          {
            format: 'yarramate/likec4-check-result/v1',
            ok: true,
            diagnostics: [],
          },
          null,
          2,
        )}\n`,
        stderr: '',
      })

      const args = [
        'export-project',
        'yarramate.likec4.yaml',
        project,
        'architecture.yaml',
      ]
      const result = runLikeC4Cli(args, parent)

      expect(result).toEqual({
        exitCode: 0,
        stdout: `Wrote LikeC4 project to ${project}\n`,
        stderr: '',
      })
      const model = readFileSync(join(project, 'model.likec4'), 'utf8')
      expect(model.match(/^model \{/gm)).toHaveLength(1)
      expect(model.match(/^views \{/gm)).toHaveLength(1)
      expect(model).toContain('view index')
      expect(model).not.toContain('view baseline')
      expect(model).toContain('view target')
      expect(model).toContain('view empty')
      expect(model).toContain("legacy = applicationComponent 'Legacy'")
      expect(model).toContain("modern = applicationComponent 'Modern'")
      expect(model).toContain("shared = applicationComponent 'Shared'")
      expect(model).toContain(
        'view index {\n    include legacy, shared\n',
      )
      expect(model).toContain(
        'view target {\n    include modern, shared\n',
      )
      expect(model).not.toContain(
        'view index {\n    include *\n',
      )
      expect(model).not.toContain(
        'view target {\n    include *\n',
      )
      expect(model).toContain(
        "view empty {\n    include * where metadata.yarramateId is '__yarramate_no_match__'\n",
      )
      const baselineView = model.slice(
        model.indexOf('  view index {'),
        model.indexOf('  view target {'),
      )
      const targetView = model.slice(
        model.indexOf('  view target {'),
        model.indexOf('  view empty {'),
      )
      expect(baselineView).toContain('    exclude * -> *')
      expect(baselineView).toContain(
        "metadata.yarramateId is 'system#legacy-uses-shared'",
      )
      expect(baselineView).not.toContain(
        "metadata.yarramateId is 'system#modern-uses-shared'",
      )
      expect(targetView).toContain('    exclude * -> *')
      expect(targetView).toContain(
        "metadata.yarramateId is 'system#modern-uses-shared'",
      )
      expect(targetView).not.toContain(
        "metadata.yarramateId is 'system#legacy-uses-shared'",
      )
      expect(
        JSON.parse(
          readFileSync(join(project, 'likec4.config.json'), 'utf8'),
        ),
      ).toMatchObject({
        name: 'yarramate-system-1-0',
        title: 'System architecture',
      })
      const marker = JSON.parse(
        readFileSync(
          join(project, 'yarramate.generated.json'),
          'utf8',
        ),
      )
      expect(marker).toMatchObject({
        format: 'yarramate/likec4-generated-project/v2',
        project: 'system@1.0',
        mapping: 'system-likec4@1.0',
        views: [
          { id: 'index', projection: 'baseline@1.0' },
          { projection: 'target@1.0' },
          { projection: 'empty@1.0' },
        ],
      })
      expect(Object.keys(marker.inputDigests)).toEqual([
        'architecture.yaml',
        'baseline.projection.yaml',
        'empty.projection.yaml',
        'likec4.mapping.yaml',
        'target.projection.yaml',
        'yarramate.likec4.yaml',
      ])
      const markerSchema = JSON.parse(
        readFileSync(
          join(
            repositoryRoot,
            'schema/yarramate-likec4-generated-project-v2.schema.json',
          ),
          'utf8',
        ),
      )
      const validateMarker = new Ajv2020({ allErrors: true }).compile(
        markerSchema,
      )
      expect(
        validateMarker(marker),
        JSON.stringify(validateMarker.errors ?? []),
      ).toBe(true)

      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        [
          'validate',
          '--json',
          '--no-layout',
          '--file',
          'model.likec4',
          '.',
        ],
        { cwd: project, encoding: 'utf8' },
      )
      expect(
        validation.status,
        `${validation.stderr}\n${validation.stdout}`,
      ).toBe(0)
      expect(JSON.parse(validation.stdout)).toMatchObject({
        valid: true,
        errors: [],
        stats: {
          filteredErrors: 0,
          totalErrors: 0,
        },
      })
      expect(runLikeC4Cli(args, parent)).toEqual({
        exitCode: 0,
        stdout: `Updated LikeC4 project at ${project}\n`,
        stderr: '',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('files project views into sidebar folders via title paths', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-folders-'))
    const project = join(parent, 'generated')
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
  - id: store
    kind: dataObject
    name: Store
relationships:
  - id: service-uses-store
    kind: access
    from: service
    to: store
`,
      )
      writeFileSync(
        join(parent, 'overview.projection.yaml'),
        `format: yarramate/projection/v1
id: overview
version: "1.0"
query:
  documents: [system]
presentation:
  title: Overview
`,
      )
      writeFileSync(
        join(parent, 'bare.projection.yaml'),
        `format: yarramate/projection/v1
id: bare
version: "1.0"
query:
  documents: [system]
`,
      )
      writeFileSync(
        join(parent, 'likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
  - native: system#store
    external: store
    type: concept
  - native: system#service-uses-store
    external: serviceUsesStore
    type: relationship
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: overview.projection.yaml
    folder: Platform
  - id: edge
    projection: bare.projection.yaml
    folder: Platform / Edge
  - id: deployed
    projection: bare.projection.yaml
    folder: Runtime
    deployment:
      nodes:
        - id: prod
          kind: environment
          name: Production
      instances:
        - id: prod-service
          subject: system#service
          node: prod
`,
      )

      const result = runLikeC4Cli(
        [
          'export-project',
          'yarramate.likec4.yaml',
          project,
          'architecture.yaml',
        ],
        parent,
      )
      expect(result).toEqual({
        exitCode: 0,
        stdout: `Wrote LikeC4 project to ${project}\n`,
        stderr: '',
      })
      const model = readFileSync(join(project, 'model.likec4'), 'utf8')
      // A declared presentation title becomes the path's leaf.
      expect(model).toContain(
        "  view index {\n    title 'Platform / Overview'\n",
      )
      // A view without a presentation title still carries the folder,
      // with the view id standing in as the leaf.
      expect(model).toContain(
        "  view edge {\n    title 'Platform / Edge / edge'\n",
      )
      // The deployment branch files the same way.
      expect(model).toContain(
        "  deployment view deployed {\n    title 'Runtime / deployed'\n",
      )

      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        [
          'validate',
          '--json',
          '--no-layout',
          '--file',
          'model.likec4',
          '.',
        ],
        { cwd: project, encoding: 'utf8' },
      )
      expect(
        validation.status,
        `${validation.stderr}\n${validation.stdout}`,
      ).toBe(0)

      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: overview.projection.yaml
    folder: "Platform /"
`,
      )
      const rejected = runLikeC4Cli(
        ['check', 'yarramate.likec4.yaml', 'architecture.yaml'],
        parent,
      )
      expect(rejected.exitCode).toBe(1)
      expect(rejected.stdout).toContain('YM201')
      expect(rejected.stdout).toContain('/views/0/folder')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('resolves project references from the project document, not the CWD', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-portable-'),
    )
    const model = join(parent, 'model')
    const foreign = join(parent, 'elsewhere')
    const project = join(parent, 'generated')
    try {
      mkdirSync(join(model, 'projections'), { recursive: true })
      mkdirSync(join(model, 'integrations'), { recursive: true })
      mkdirSync(foreign)
      writeFileSync(
        join(model, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
      )
      writeFileSync(
        join(model, 'workspace.yaml'),
        `format: yarramate/workspace/v1
id: system
documents: [architecture.yaml]
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      )
      writeFileSync(
        join(model, 'projections/system.yaml'),
        `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        join(model, 'integrations/likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      )
      writeFileSync(
        join(model, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: integrations/likec4.mapping.yaml
views:
  - projection: projections/system.yaml
`,
      )

      const checked = runLikeC4Cli(
        [
          'check',
          join(model, 'yarramate.likec4.yaml'),
          join(model, 'workspace.yaml'),
        ],
        foreign,
      )
      expect(checked).toEqual({
        exitCode: 0,
        stdout: 'Checked LikeC4 project system@1.0: no errors\n',
        stderr: '',
      })
      const machine = runLikeC4Cli(
        [
          'check',
          join(model, 'yarramate.likec4.yaml'),
          '--json',
          join(model, 'workspace.yaml'),
        ],
        foreign,
      )
      expect(machine.exitCode).toBe(0)
      expect(JSON.parse(machine.stdout)).toEqual({
        format: 'yarramate/likec4-check-result/v1',
        ok: true,
        diagnostics: [],
      })
      const materialized = runLikeC4Cli(
        [
          'export-project',
          join(model, 'yarramate.likec4.yaml'),
          project,
          join(model, 'workspace.yaml'),
        ],
        foreign,
      )
      expect(materialized).toEqual({
        exitCode: 0,
        stdout: `Wrote LikeC4 project to ${project}\n`,
        stderr: '',
      })
      expect(
        readFileSync(join(project, 'model.likec4'), 'utf8'),
      ).toContain("service = applicationComponent 'Service'")
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it(
    'materializes the repository starter pack as independent views',
    { timeout: 20_000 },
    () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-starter-pack-'),
    )
    const project = join(parent, 'generated')
    try {
      const result = runLikeC4Cli(
        [
          'export-project',
          '.yarramate/likec4-project.yaml',
          project,
          '.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(0)
      const model = readFileSync(join(project, 'model.likec4'), 'utf8')
      expect(model.match(/^  (?:dynamic )?view /gm)).toHaveLength(22)
      expect(model).not.toMatch(/^    include \*$/gm)
      expect(model).toContain('view index')
      expect(model).not.toContain('view starter-landscape')
      expect(model).toContain('view starter-motivation')
      expect(model).toContain('view starter-strategy')
      expect(model).toContain('view product-journeys')
      expect(model).toContain('view starter-business-operation')
      expect(model).toContain('view starter-application-cooperation')
      expect(model).toContain('view starter-information-structure')
      expect(model).toContain('view starter-technology-deployment')
      expect(model).toContain('view starter-implementation-roadmap')
      expect(model).toContain('view engine-components')
      expect(model).toContain('view seven-verb-surface')
      expect(model).toContain('view product-context')
      expect(model).toContain('view state-foundation')
      expect(model).toContain('dynamic view compiler-pipeline')
      expect(model).toContain(
        "  view index {\n    title '1 · Orientation / Architecture landscape'\n",
      )
      expect(model).toContain(
        "  dynamic view compiler-pipeline {\n    title '3 · Engine internals / Current engine'\n",
      )
      expect(model).toContain(
        "view starter-technology-deployment {\n" +
          "    title '4 · ArchiMate viewpoints / Technology and deployment'\n" +
          "    description 'Technology structure, behavior, services, networks, and deployed artifacts.'\n" +
          '    include consumerHost, consumerPackage, engineCli, engineGraphifyEvidenceAdapter, executeShippedBinaries, likec4ExportAdapter, localWebBrowser, mcpAdapter, nodejsRuntime, npmPackage, packageConsumerTests, productDesignSolutionBeforeBuild, productDiscoverProjectArchitecture, productStableCli, renderVisualSessionPage, visualBrowser, visualRuntime',
      )
      const marker = JSON.parse(
        readFileSync(
          join(project, 'yarramate.generated.json'),
          'utf8',
        ),
      )
      expect(marker.views).toHaveLength(22)
      expect(marker.views[0]).toEqual({
        id: 'index',
        projection: 'starter-landscape@1.0',
      })
      expect(marker.views.filter(({ projection }: {
        projection: string
      }) => projection.startsWith('starter-')).map(({ projection }: {
        projection: string
      }) => projection)).toEqual([
        'starter-landscape@1.0',
        'starter-motivation@1.0',
        'starter-strategy@1.0',
        'starter-business-operation@1.0',
        'starter-application-cooperation@1.0',
        'starter-information-structure@1.0',
        'starter-technology-deployment@1.0',
        'starter-implementation-roadmap@1.0',
      ])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('renders ordered dynamic steps from projected relationship subjects', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-dynamic-'),
    )
    const definition = join(parent, 'project.yaml')
    const project = join(parent, 'generated')
    try {
      mkdirSync(join(parent, '.yarramate/integrations/likec4'), {
        recursive: true,
      })
      mkdirSync(join(parent, '.yarramate/projections'), {
        recursive: true,
      })
      for (const reference of [
        '.yarramate/integrations/likec4/subject-mapping.yaml',
        '.yarramate/integrations/likec4/kind-mapping.yaml',
        '.yarramate/projections/product-journeys.yaml',
        '.yarramate/projections/current-engine.yaml',
      ]) {
        copyFileSync(
          join(repositoryRoot, reference),
          join(parent, reference),
        )
      }
      writeFileSync(
        definition,
        `format: yarramate/likec4-project/v1
id: journey-flow
version: "1.0"
title: Journey flow
mapping: .yarramate/integrations/likec4/subject-mapping.yaml
kindMapping: .yarramate/integrations/likec4/kind-mapping.yaml
views:
  - id: discovery-flow
    projection: .yarramate/projections/product-journeys.yaml
    dynamic:
      steps:
        - relationship: yarramate-product#evidence-separation-supports-discovery
          title: constrains discovery
        - relationship: yarramate-product#discovery-supports-context
          title: produces shared context
  - id: engine-deployment
    projection: .yarramate/projections/current-engine.yaml
    deployment:
      nodes:
        - id: production
          kind: environment
          name: Production
        - id: application-zone
          kind: zone
          name: Application zone
          parent: production
        - id: compiler-host
          kind: host
          name: Compiler host
          parent: application-zone
      instances:
        - id: compiler-instance
          subject: yarramate-engine#compiler
          node: compiler-host
        - id: cli-instance
          subject: yarramate-engine#cli
          node: compiler-host
`,
      )
      const result = runLikeC4Cli(
        [
          'export-project',
          definition,
          project,
          '.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const model = readFileSync(join(project, 'model.likec4'), 'utf8')
      expect(model).toContain(
        "dynamic view discovery-flow {\n" +
          "    title 'Product journeys'\n" +
          "    description 'Existing-project discovery and architecture-first design converge on one native, Git-reviewed lifecycle.'\n" +
          "    productEvidenceIntentSeparation -> productDiscoverProjectArchitecture 'constrains discovery' {\n" +
          "      description 'Discovery may propose declared architecture from evidence, but evidence never becomes accepted intent without Git review.'\n" +
          "    }\n" +
          "    productDiscoverProjectArchitecture -> productSharedArchitectureContext 'produces shared context'\n" +
          '  }',
      )
      expect(model).toContain(
        "deployment {\n" +
          "  environment production 'Production' {\n" +
          "    zone application-zone 'Application zone' {\n" +
          "      host compiler-host 'Compiler host' {\n" +
          '        cli-instance = instanceOf engineCli\n' +
          '        compiler-instance = instanceOf compiler\n' +
          '      }\n' +
          '    }\n' +
          '  }\n' +
          '}',
      )
      expect(model).toContain(
        "deployment view engine-deployment {\n" +
          "    title 'Current engine'\n" +
          "    description 'Currently operative compiler and CLI architecture.'\n" +
          '    include production.**\n' +
          '    autoLayout LeftRight\n' +
          '  }',
      )
      const validation = spawnSync(
        join(repositoryRoot, 'node_modules/.bin/likec4'),
        ['validate', '--no-layout', project],
        { cwd: repositoryRoot, encoding: 'utf8' },
      )
      expect(validation.status, validation.stderr).toBe(0)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects duplicate rendered view identities in a project definition', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-duplicate-view-'),
    )
    const definition = join(parent, 'project.yaml')
    try {
      copyFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        ),
        join(parent, 'governed-change.likec4-mapping.yaml'),
      )
      copyFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.projection.yaml',
        ),
        join(parent, 'governed-change.projection.yaml'),
      )
      writeFileSync(
        definition,
        `format: yarramate/likec4-project/v1
id: duplicate-view
version: "1.0"
title: Duplicate view
mapping: governed-change.likec4-mapping.yaml
views:
  - id: index
    projection: governed-change.projection.yaml
  - id: index
    projection: governed-change.projection.yaml
`,
      )

      const result = runLikeC4Cli(
        [
          'check',
          definition,
          '--json',
          'test/fixtures/valid/governed-change.workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YMLC107',
            message: 'LikeC4 view identity "index" is duplicated',
            path: definition,
            pointer: '/views/1/id',
            line: 9,
            column: 9,
          },
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports a missing project projection at its authored reference', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-missing-projection-'),
    )
    const definition = join(parent, 'project.yaml')
    try {
      copyFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        ),
        join(parent, 'governed-change.likec4-mapping.yaml'),
      )
      writeFileSync(
        definition,
        `format: yarramate/likec4-project/v1
id: missing-projection
version: "1.0"
title: Missing projection
mapping: governed-change.likec4-mapping.yaml
views:
  - projection: missing-projection.yaml
`,
      )

      const result = runLikeC4Cli(
        [
          'check',
          definition,
          '--json',
          'test/fixtures/valid/governed-change.workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result).toEqual({
        exitCode: 1,
        stdout:
          '{\n' +
          '  "format": "yarramate/likec4-check-result/v1",\n' +
          '  "ok": false,\n' +
          '  "diagnostics": [\n' +
          '    {\n' +
          '      "severity": "error",\n' +
          '      "code": "YMLC110",\n' +
          '      "message": "LikeC4 project projection \\"missing-projection.yaml\\" does not exist",\n' +
          `      "path": ${JSON.stringify(definition)},\n` +
          '      "pointer": "/views/0/projection",\n' +
          '      "line": 7,\n' +
          '      "column": 17\n' +
          '    }\n' +
          '  ]\n' +
          '}\n',
        stderr: '',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects deployment identities duplicated across project views', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-duplicate-deployment-'),
    )
    const definition = join(parent, 'project.yaml')
    try {
      copyFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.likec4-mapping.yaml',
        ),
        join(parent, 'governed-change.likec4-mapping.yaml'),
      )
      copyFileSync(
        join(
          repositoryRoot,
          'test/fixtures/valid/governed-change.projection.yaml',
        ),
        join(parent, 'governed-change.projection.yaml'),
      )
      writeFileSync(
        definition,
        `format: yarramate/likec4-project/v1
id: duplicate-deployment
version: "1.0"
title: Duplicate deployment
mapping: governed-change.likec4-mapping.yaml
views:
  - id: first
    projection: governed-change.projection.yaml
    deployment:
      nodes:
        - id: production
          kind: environment
          name: Production
      instances:
        - id: governed-change
          subject: governed-change#product-owner
          node: production
  - id: second
    projection: governed-change.projection.yaml
    deployment:
      nodes:
        - id: production
          kind: environment
          name: Production copy
      instances:
        - id: governed-change-copy
          subject: governed-change#product-owner
          node: production
`,
      )

      const result = runLikeC4Cli(
        [
          'check',
          definition,
          '--json',
          'test/fixtures/valid/governed-change.workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YMLC109',
            message: 'Deployment identity "production" is duplicated',
            path: definition,
            pointer: '/views/1/deployment/nodes/0/id',
            line: 22,
            column: 15,
          },
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('safely regenerates a project carrying its matching marker', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-update-'))
    const project = join(parent, 'governed-change')
    const args = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    try {
      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)
      writeFileSync(join(project, 'review-notes.md'), 'preserve me\n')

      const result = runLikeC4Cli(args, repositoryRoot)

      expect(result).toEqual({
        exitCode: 0,
        stdout: `Updated LikeC4 project at ${project}\n`,
        stderr: '',
      })
      expect(readFileSync(join(project, 'review-notes.md'), 'utf8')).toBe(
        'preserve me\n',
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('safely re-exports after the project definition gains a projection', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-grown-project-'),
    )
    const project = join(parent, 'generated')
    const args = [
      'export-project',
      'yarramate.likec4.yaml',
      project,
      'architecture.yaml',
    ]
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'first.projection.yaml'),
        `format: yarramate/projection/v1
id: first
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        join(parent, 'likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: first.projection.yaml
`,
      )
      expect(runLikeC4Cli(args, parent)).toEqual({
        exitCode: 0,
        stdout: `Wrote LikeC4 project to ${project}\n`,
        stderr: '',
      })

      writeFileSync(
        join(parent, 'second.projection.yaml'),
        `format: yarramate/projection/v1
id: second
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.1"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: first.projection.yaml
  - projection: second.projection.yaml
`,
      )

      expect(runLikeC4Cli(args, parent)).toEqual({
        exitCode: 0,
        stdout: `Updated LikeC4 project at ${project}\n`,
        stderr: '',
      })
      expect(
        readFileSync(join(project, 'model.likec4'), 'utf8'),
      ).toContain('view second')
      expect(
        JSON.parse(
          readFileSync(
            join(project, 'yarramate.generated.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({
        project: 'system@1.1',
        views: [
          { id: 'index', projection: 'first@1.0' },
          { projection: 'second@1.0' },
        ],
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports generated-output freshness without writing anything', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-likec4-check-'))
    const project = join(parent, 'generated')
    const exportArgs = [
      'export-project',
      'yarramate.likec4.yaml',
      project,
      'architecture.yaml',
    ]
    const checkArgs = ['export-project', '--check', ...exportArgs.slice(1)]
    try {
      writeFileSync(
        join(parent, 'architecture.yaml'),
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
      )
      writeFileSync(
        join(parent, 'first.projection.yaml'),
        `format: yarramate/projection/v1
id: first
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        join(parent, 'likec4.mapping.yaml'),
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.0"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: first.projection.yaml
`,
      )

      expect(runLikeC4Cli(checkArgs, parent)).toEqual({
        exitCode: 1,
        stdout: 'Generated LikeC4 output: absent\n',
        stderr: '',
      })
      expect(existsSync(project)).toBe(false)

      expect(runLikeC4Cli(exportArgs, parent).exitCode).toBe(0)
      expect(runLikeC4Cli(checkArgs, parent)).toEqual({
        exitCode: 0,
        stdout: 'Generated LikeC4 output: fresh\n',
        stderr: '',
      })

      writeFileSync(
        join(parent, 'second.projection.yaml'),
        `format: yarramate/projection/v1
id: second
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        join(parent, 'yarramate.likec4.yaml'),
        `format: yarramate/likec4-project/v1
id: system
version: "1.1"
title: System architecture
mapping: likec4.mapping.yaml
views:
  - id: index
    projection: first.projection.yaml
  - projection: second.projection.yaml
`,
      )
      const before = readFileSync(join(project, 'model.likec4'), 'utf8')

      expect(runLikeC4Cli(checkArgs, parent)).toEqual({
        exitCode: 1,
        stdout:
          'Generated LikeC4 output: stale\n' +
          'Reason:\n' +
          '- input added: second.projection.yaml\n' +
          '- input changed: yarramate.likec4.yaml\n' +
          '- model source changed\n' +
          'Safe to regenerate: yes\n',
        stderr: '',
      })
      expect(readFileSync(join(project, 'model.likec4'), 'utf8')).toBe(
        before,
      )

      expect(runLikeC4Cli(exportArgs, parent).exitCode).toBe(0)
      expect(runLikeC4Cli(checkArgs, parent)).toEqual({
        exitCode: 0,
        stdout: 'Generated LikeC4 output: fresh\n',
        stderr: '',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports a hand-edited generated file as modified in --check', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-check-modified-'),
    )
    const project = join(parent, 'governed-change')
    const exportArgs = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    const checkArgs = ['export-project', '--check', ...exportArgs.slice(1)]
    try {
      expect(runLikeC4Cli(exportArgs, repositoryRoot).exitCode).toBe(0)
      expect(runLikeC4Cli(checkArgs, repositoryRoot)).toEqual({
        exitCode: 0,
        stdout: 'Generated LikeC4 output: fresh\n',
        stderr: '',
      })
      const modelPath = join(project, 'model.likec4')
      writeFileSync(
        modelPath,
        `${readFileSync(modelPath, 'utf8')}// edited\n`,
      )

      expect(runLikeC4Cli(checkArgs, repositoryRoot)).toEqual({
        exitCode: 1,
        stdout:
          'Generated LikeC4 output: modified\n' +
          'Reason:\n' +
          `- generated file changed: ${modelPath}\n` +
          'Safe to regenerate: no\n',
        stderr: '',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports a marker predating input digests as stale in --check', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-check-legacy-'),
    )
    const project = join(parent, 'governed-change')
    const exportArgs = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    const checkArgs = ['export-project', '--check', ...exportArgs.slice(1)]
    try {
      expect(runLikeC4Cli(exportArgs, repositoryRoot).exitCode).toBe(0)
      const markerPath = join(project, 'yarramate.generated.json')
      const { inputDigests, ...legacyMarker } = JSON.parse(
        readFileSync(markerPath, 'utf8'),
      ) as Record<string, unknown>
      expect(inputDigests).toBeDefined()
      writeFileSync(markerPath, `${JSON.stringify(legacyMarker, null, 2)}\n`)

      expect(runLikeC4Cli(checkArgs, repositoryRoot)).toEqual({
        exitCode: 1,
        stdout:
          'Generated LikeC4 output: stale\n' +
          'Reason:\n' +
          '- marker predates input digests\n' +
          'Safe to regenerate: yes\n',
        stderr: '',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('atomically replaces each owned file during regeneration', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-atomic-update-'),
    )
    const project = join(parent, 'generated')
    const document = join(parent, 'system.yaml')
    const projection = join(parent, 'system.projection.yaml')
    const mapping = join(parent, 'system.mapping.yaml')
    const args = [
      'export-project',
      projection,
      mapping,
      project,
      document,
    ]
    const writeDocument = (name: string) =>
      writeFileSync(
        document,
        `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: ${name}
relationships: []
`,
      )
    try {
      writeDocument('Original service')
      writeFileSync(
        projection,
        `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      )
      writeFileSync(
        mapping,
        `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      )
      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)
      const model = join(project, 'model.likec4')
      const priorModel = join(parent, 'prior-model.likec4')
      linkSync(model, priorModel)
      writeDocument('Updated service')

      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)

      expect(readFileSync(model, 'utf8')).toContain(
        "service = applicationComponent 'Updated service'",
      )
      expect(readFileSync(priorModel, 'utf8')).toContain(
        "service = applicationComponent 'Original service'",
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a generated file changed since the marker', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-drift-'),
    )
    const project = join(parent, 'governed-change')
    const args = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    try {
      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)
      const modelPath = join(project, 'model.likec4')
      writeFileSync(modelPath, `${readFileSync(modelPath, 'utf8')}// edited\n`)

      const result = runLikeC4Cli(args, repositoryRoot)

      expect(result).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Generated project file has changed: ${modelPath}\n`,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses regeneration when the ownership marker is malformed', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-malformed-marker-'),
    )
    const project = join(parent, 'governed-change')
    const args = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    try {
      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)
      writeFileSync(
        join(project, 'yarramate.generated.json'),
        JSON.stringify({
          format: 'yarramate/likec4-generated-project/v1',
          projection: 'governed-change@1.0',
          mapping: 'governed-change-likec4@1.0',
          files: [],
        }),
      )

      const result = runLikeC4Cli(args, repositoryRoot)

      expect(result).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Output directory exists but is not a YarraMate-generated project: ${project}\n`,
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses regeneration through a symlinked generated file', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-symlink-'),
    )
    const project = join(parent, 'governed-change')
    const outside = join(parent, 'outside.likec4')
    const args = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    try {
      expect(runLikeC4Cli(args, repositoryRoot).exitCode).toBe(0)
      writeFileSync(outside, 'do not replace\n')
      rmSync(join(project, 'model.likec4'))
      symlinkSync(outside, join(project, 'model.likec4'))

      const result = runLikeC4Cli(args, repositoryRoot)

      expect(result).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Generated project contains an unsafe file: ${join(project, 'model.likec4')}\n`,
      })
      expect(readFileSync(outside, 'utf8')).toBe('do not replace\n')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses an existing directory that is not YarraMate-generated', () => {
    const project = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-existing-'),
    )
    const args = [
      'export-project',
      'test/fixtures/valid/governed-change.projection.yaml',
      'test/fixtures/valid/governed-change.likec4-mapping.yaml',
      project,
      'test/fixtures/valid/governed-change.workspace.yaml',
    ]
    try {
      const result = runLikeC4Cli(args, repositoryRoot)

      expect(result).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Output directory exists but is not a YarraMate-generated project: ${project}\n`,
      })
      expect(
        runLikeC4Cli(
          ['export-project', '--check', ...args.slice(1)],
          repositoryRoot,
        ),
      ).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Output directory exists but is not a YarraMate-generated project: ${project}\n`,
      })
      const occupied = join(project, 'occupied')
      writeFileSync(occupied, 'not a directory\n')
      expect(
        runLikeC4Cli(
          [...args.slice(0, 3), occupied, ...args.slice(4)],
          repositoryRoot,
        ),
      ).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: `Output directory already exists: ${occupied}\n`,
      })
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  it('materializes extension kinds through an explicit kind mapping', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-profiled-'),
    )
    const project = join(parent, 'export-path')
    try {
      const result = runLikeC4Cli(
        [
          'export-project',
          '.yarramate/projections/likec4-export-path.yaml',
          '.yarramate/integrations/likec4/subject-mapping.yaml',
          project,
          '--kinds',
          '.yarramate/integrations/likec4/kind-mapping.yaml',
          '.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(0)
      const model = readFileSync(join(project, 'model.likec4'), 'utf8')
      expect(model).toContain(
        "likec4ExportSource = artifact 'src/adapters/likec4-export.ts'",
      )
      expect(model).toContain(
        "yarramateKind 'yarramate/development@1.0#repository-file'",
      )
      expect(
        JSON.parse(
          readFileSync(
            join(project, 'yarramate.generated.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({
        kindMapping: 'yarramate-development-likec4@1.0',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects extension kinds not supported by the bundled specification before writing', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-unsupported-'),
    )
    const project = join(parent, 'export-path')
    try {
      const result = runLikeC4Cli(
        [
          'export-project',
          '.yarramate/projections/likec4-export-path.yaml',
          '.yarramate/integrations/likec4/subject-mapping.yaml',
          project,
          '.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        format: 'yarramate/likec4-diagnostic-result/v1',
        diagnostics: [
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic relationship kind "yarramate/development@1.0#implements" resolves to unsupported bundled LikeC4 kind "implements"',
            subject: 'yarramate-engine#likec4-adapter-provides-export',
            path: '.yarramate/architecture/engine.yaml',
            pointer: '/relationships/125',
            line: 1348,
            column: 5,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic relationship kind "yarramate/development@1.0#implements" resolves to unsupported bundled LikeC4 kind "implements"',
            subject: 'yarramate-engine#likec4-adapter-provides-check',
            path: '.yarramate/architecture/engine.yaml',
            pointer: '/relationships/126',
            line: 1352,
            column: 5,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-export-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/21/kind',
            line: 96,
            column: 11,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-prepare-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/24/kind',
            line: 108,
            column: 11,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-project-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/25/kind',
            line: 112,
            column: 11,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-project-definition-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/26/kind',
            line: 116,
            column: 11,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-project-schema-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/53/kind',
            line: 229,
            column: 11,
          },
          {
            severity: 'error',
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "repository-file"',
            subject: 'yarramate-repository#likec4-generated-project-v2-schema-source',
            path: '.yarramate/architecture/repository.yaml',
            pointer: '/concepts/54/kind',
            line: 233,
            column: 11,
          },
        ],
      })
      expect(existsSync(project)).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects kind mappings targeting undeclared bundled kinds', () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'yarramate-likec4-unknown-kind-'),
    )
    const project = join(parent, 'export-path')
    const kinds = join(parent, 'kinds.yaml')
    writeFileSync(
      kinds,
      `format: yarramate/likec4-kind-mapping/v1
id: unsupported-target
version: "1.0"
conceptKinds:
  - native: yarramate/development@1.0#repository-file
    external: customBox
relationshipKinds: []
`,
    )
    try {
      const result = runLikeC4Cli(
        [
          'export-project',
          '.yarramate/projections/likec4-export-path.yaml',
          '.yarramate/integrations/likec4/subject-mapping.yaml',
          project,
          '--kinds',
          kinds,
          '.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'YMLC104',
            message:
              'Semantic concept kind "yarramate/development@1.0#repository-file" resolves to unsupported bundled LikeC4 kind "customBox"',
          }),
        ]),
      })
      expect(existsSync(project)).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
