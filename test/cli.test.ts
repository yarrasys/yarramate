import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const Ajv2020 = Ajv2020Module.default

describe('YarraMate CLI', () => {
  it.each(['--help', '-h', 'help'])(
    'prints usage successfully for %s',
    (argument) => {
      const result = runCli([argument], repositoryRoot)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    },
  )

  it('emits check results conforming to the normative result schema', () => {
    const schema = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'schema/yarramate-check-result.schema.json'),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const success = runCli(
      [
        'check',
        'test/fixtures/valid/minimal.yaml',
        '--json',
      ],
      repositoryRoot,
    )
    const failure = runCli(
      [
        'check',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
        '--json',
      ],
      repositoryRoot,
    )

    expect(
      validate(JSON.parse(success.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
    expect(JSON.parse(success.stdout)).toMatchObject({
      counted: {
        documents: 1,
        concepts: 2,
        relationships: 1,
        states: 0,
      },
    })
    expect(
      validate(JSON.parse(failure.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('emits deterministic machine-readable diagnostics and a failing exit code', () => {
    const result = runCli(
      [
        'check',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
        '--json',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 1,
      stdout:
        '{\n' +
        '  "format": "yarramate/check-result/v1",\n' +
        '  "ok": false,\n' +
        '  "diagnostics": [\n' +
        '    {\n' +
        '      "severity": "error",\n' +
        '      "code": "YM401",\n' +
        '      "message": "Unknown concept kind \\"mysteryKind\\" in profile \\"yarramate/core@0.1\\"",\n' +
        '      "path": "test/fixtures/invalid/unknown-concept-kind.yaml",\n' +
        '      "pointer": "/concepts/0/kind",\n' +
        '      "line": 6,\n' +
        '      "column": 11\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
      stderr: '',
    })
  })

  it('reports successful checks without emitting a compiled artifact', () => {
    const result = runCli(
      ['check', 'test/fixtures/valid/minimal.yaml'],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        'Checked 1 document (2 concepts, 1 relationship, 0 states): no errors\n',
      stderr: '',
    })
  })

  it('emits the normative graph v2 interchange document', () => {
    const result = runCli(
      ['compile', 'test/fixtures/valid/minimal.yaml'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.startsWith('{\n  "format": "yarramate/graph/v2"')).toBe(
      true,
    )
    expect(result.stdout.endsWith('}\n')).toBe(true)
    expect(JSON.parse(result.stdout)).toMatchObject({
      profiles: ['yarramate/core@0.1'],
      claims: expect.arrayContaining([
        expect.objectContaining({
          predicate: 'yarramate/concept/kind',
          object: { value: 'yarramate/core@0.1#capability' },
        }),
      ]),
    })
  })

  it('emits byte-identical graph JSON regardless of source order', () => {
    const first = 'test/fixtures/valid/minimal.yaml'
    const second = 'test/fixtures/valid/strategy.yaml'
    const forward = runCli(['compile', first, second], repositoryRoot)
    const reverse = runCli(['compile', second, first], repositoryRoot)

    expect(forward.exitCode).toBe(0)
    expect(reverse).toEqual(forward)
  })

  it('loads explicit profile files with documents in one check', () => {
    const result = runCli(
      [
        'check',
        'test/fixtures/valid/platform-profile.yaml',
        'test/fixtures/valid/platform-document.yaml',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        'Checked 1 document and 1 profile (2 concepts, 1 relationship, 0 states): no errors\n',
      stderr: '',
    })
  })

  it('checks optional adapter mappings against the compiled workspace', () => {
    const result = runCli(
      [
        'check',
        'test/fixtures/valid/minimal.yaml',
        'test/fixtures/valid/likec4-adapter-mapping.yaml',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        'Checked 1 document and 1 adapter mapping (2 concepts, 1 relationship, 0 states): no errors\n',
      stderr: '',
    })
  })

  it('checks adapter mapping identity across the whole CLI workspace', () => {
    const result = runCli(
      [
        'check',
        'test/fixtures/valid/minimal.yaml',
        'test/fixtures/valid/likec4-adapter-mapping.yaml',
        'test/fixtures/valid/likec4-adapter-mapping.yaml',
        '--json',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'YM605',
        message:
          'Adapter mapping "likec4-checkout@1.0" is declared more than once',
      }),
    )
  })

  it('orders adapter mapping load diagnostics independently of source order', () => {
    const document = 'test/fixtures/valid/minimal.yaml'
    const first =
      'test/fixtures/invalid/adapter-mapping-missing-adapter.yaml'
    const second =
      'test/fixtures/invalid/adapter-mapping-unknown-field.yaml'
    const forward = runCli(
      ['check', document, first, second, '--json'],
      repositoryRoot,
    )
    const reverse = runCli(
      ['check', document, second, first, '--json'],
      repositoryRoot,
    )

    expect(forward.exitCode).toBe(1)
    expect(reverse).toEqual(forward)
  })

  it('renders semantic projection context as deterministic JSON', () => {
    const result = runCli(
      [
        'context',
        'test/fixtures/valid/current-capabilities.projection.yaml',
        'test/fixtures/valid/lifecycle-status.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: 'yarramate/projection-result/v1',
      projection: 'current-capabilities@1.0',
      subjects: [
        {
          id: 'lifecycle#current-capability',
          type: 'concept',
        },
      ],
    })
  })

  it('renders extension kinds through their semantic parents', () => {
    const result = runCli(
      [
        'context',
        'test/fixtures/valid/platform-actors.projection.yaml',
        'test/fixtures/valid/platform-profile.yaml',
        'test/fixtures/valid/platform-document.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).subjects).toEqual([
      { id: 'platform#delivery', type: 'concept' },
      { id: 'platform#team', type: 'concept' },
      {
        id: 'platform#team-owns-delivery',
        type: 'relationship',
      },
    ])
  })

  it('compares two architecture states as deterministic JSON', () => {
    const result = runCli(
      [
        'compare',
        'roadmap#baseline',
        'roadmap#target',
        'test/fixtures/valid/architecture-states.yaml',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        `${JSON.stringify(
          {
            format: 'yarramate/state-comparison/v1',
            from: 'roadmap#baseline',
            to: 'roadmap#target',
            added: [
              { id: 'roadmap#modern', type: 'concept' },
              {
                id: 'roadmap#shared-serves-modern',
                type: 'relationship',
              },
            ],
            removed: [
              { id: 'roadmap#legacy', type: 'concept' },
              {
                id: 'roadmap#shared-serves-legacy',
                type: 'relationship',
              },
            ],
            retained: [
              { id: 'roadmap#shared', type: 'concept' },
            ],
          },
          null,
          2,
        )}\n`,
      stderr: '',
    })
  })

  it('versions machine-readable diagnostics for semantic commands', () => {
    const projectionFailure = runCli(
      [
        'context',
        'test/fixtures/valid/current-capabilities.projection.yaml',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
      ],
      repositoryRoot,
    )
    const evidenceFailure = runCli(
      [
        'evidence',
        'test/fixtures/valid/repository-evidence.yaml',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
      ],
      repositoryRoot,
    )

    expect(JSON.parse(projectionFailure.stdout).format).toBe(
      'yarramate/diagnostic-result/v1',
    )
    expect(JSON.parse(evidenceFailure.stdout).format).toBe(
      'yarramate/diagnostic-result/v1',
    )
  })

  it('emits semantic command failures conforming to the diagnostic schema', () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-diagnostic-result.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const result = runCli(
      [
        'context',
        'test/fixtures/valid/current-capabilities.projection.yaml',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
      ],
      repositoryRoot,
    )

    expect(
      validate(JSON.parse(result.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('renders the same semantic projection as Markdown for reviewers', () => {
    const result = runCli(
      [
        'view',
        'test/fixtures/valid/current-capabilities.projection.yaml',
        'test/fixtures/valid/lifecycle-status.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('# Current capabilities\n')
    expect(result.stdout).toContain(
      '- Current capability (`lifecycle#current-capability`)',
    )
    expect(result.stdout).not.toContain('Planned goal')
  })

  it('renders a deterministic evidence report over compiled sources', () => {
    const result = runCli(
      [
        'evidence',
        'test/fixtures/valid/repository-evidence.yaml',
        'test/fixtures/valid/minimal.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: 'yarramate/evidence-report/v1',
      evidence: 'checkout-repository@1.0',
      summary: {
        confirmed: 1,
        contradicted: 1,
        unknown: 0,
        notObserved: 0,
      },
    })
  })

  it('reconciles workspace evidence into deterministic unresolved findings', () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-reconciliation-report.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const result = runCli(
      [
        'reconcile',
        'test/fixtures/journeys/discovery/.yarramate/workspace.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout)
    expect(
      validate(report),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
    expect(report).toEqual({
      format: 'yarramate/reconciliation-report/v1',
      workspace: 'orders-discovery',
      summary: {
        evidenceDocuments: 1,
        observations: 4,
        confirmed: 3,
        findings: 1,
        contradicted: 1,
        unknown: 0,
        notObserved: 0,
      },
      findings: [
        {
          target: {
            type: 'subject',
            id: 'orders-project#customer',
          },
          result: 'contradicted',
          provider: 'repository-inspection',
          evidenceDocument: 'orders-repository@1.0',
          evidence: {
            uri: 'repo:test/fixtures/journeys/discovery/src/customer.ts',
            message: 'No customer integration was observed in the repository',
          },
        },
      ],
    })
  })

  it('renders the asserted relationship inside contradicted claim findings', () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-reconciliation-report.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const result = runCli(
      ['reconcile', 'test/fixtures/valid/payments.workspace.yaml'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout)
    expect(
      validate(report),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
    expect(report).toEqual({
      format: 'yarramate/reconciliation-report/v1',
      workspace: 'payments',
      summary: {
        evidenceDocuments: 1,
        observations: 3,
        confirmed: 1,
        findings: 2,
        contradicted: 2,
        unknown: 0,
        notObserved: 0,
      },
      findings: [
        {
          target: {
            type: 'subject',
            id: 'payments#billing',
          },
          result: 'contradicted',
          provider: 'repository-inspection',
          evidenceDocument: 'payments-repository@1.0',
          evidence: {
            uri: 'repo:src/billing.ts',
            message: 'No billing service was observed in the repository',
          },
        },
        {
          target: {
            type: 'claim',
            id: 'payments#payment-api-writes-ledger',
          },
          asserted: {
            from: 'payments#payment-api',
            to: 'payments#ledger',
            kind: 'yarramate/core@0.1#access',
            name: 'Records payments',
          },
          result: 'contradicted',
          provider: 'repository-inspection',
          evidenceDocument: 'payments-repository@1.0',
          evidence: {
            uri: 'repo:src/payments.ts',
            message: 'Payment API writes to the billing store, not the ledger',
          },
        },
      ],
    })
  })

  it('initializes a minimal native workspace without overwriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-init-'))
    try {
      const created = runCli(['init', '.'], directory)

      expect(created).toEqual({
        exitCode: 0,
        stdout:
          'Created .yarramate/architecture/main.yaml and .yarramate/workspace.yaml\n' +
          'Created AGENTS.md with the YarraMate pointer\n' +
          'Created CLAUDE.md with the YarraMate pointer\n',
        stderr: '',
      })
      expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toContain(
        '## YarraMate architecture',
      )
      expect(readFileSync(join(directory, 'CLAUDE.md'), 'utf8')).toContain(
        '## YarraMate architecture',
      )
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toBe(
        'format: yarramate/v1\n' +
          'id: main\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts: []\n' +
          'relationships: []\n',
      )
      expect(existsSync(join(directory, '.yarramate/architecture/main.yaml'))).toBe(true)
      expect(
        readFileSync(join(directory, '.yarramate/workspace.yaml'), 'utf8'),
      ).toBe(
        'format: yarramate/workspace/v1\n' +
          'id: main\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'evidence: []\n',
      )

      expect(runCli(['init', '.'], directory)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr:
          '.yarramate/architecture/main.yaml and .yarramate/workspace.yaml already exist; nothing was changed\n',
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('extends an existing AGENTS.md once and never duplicates the pointer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-agents-'))
    try {
      writeFileSync(
        join(directory, 'AGENTS.md'),
        '# Project agents guide\n\nExisting instructions.\n',
      )

      const created = runCli(['init', '.'], directory)
      expect(created.exitCode).toBe(0)
      expect(created.stdout).toContain(
        'Extended AGENTS.md with the YarraMate pointer',
      )
      expect(created.stdout).toContain(
        'Created CLAUDE.md with the YarraMate pointer',
      )
      const extended = readFileSync(join(directory, 'AGENTS.md'), 'utf8')
      expect(extended.startsWith('# Project agents guide\n')).toBe(true)
      expect(extended).toContain('Existing instructions.')
      expect(extended).toContain('## YarraMate architecture')

      rmSync(join(directory, '.yarramate'), { recursive: true })
      const again = runCli(['init', '.'], directory)
      expect(again.exitCode).toBe(0)
      expect(again.stdout).toContain(
        'AGENTS.md already declares the YarraMate pointer',
      )
      expect(again.stdout).toContain(
        'CLAUDE.md already declares the YarraMate pointer',
      )
      for (const pointerFile of ['AGENTS.md', 'CLAUDE.md']) {
        expect(
          readFileSync(join(directory, pointerFile), 'utf8').match(
            /## YarraMate architecture/g,
          ),
        ).toHaveLength(1)
      }
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('skips both pointer files when initialized with --no-pointer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-nopointer-'))
    try {
      const created = runCli(['init', '.', '--no-pointer'], directory)
      expect(created).toEqual({
        exitCode: 0,
        stdout:
          'Created .yarramate/architecture/main.yaml and .yarramate/workspace.yaml\n',
        stderr: '',
      })
      expect(existsSync(join(directory, 'AGENTS.md'))).toBe(false)
      expect(existsSync(join(directory, 'CLAUDE.md'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('checks documents selected by an explicit workspace manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n',
        'utf8',
      )

      expect(
        runCli(['check', '.yarramate/workspace.yaml'], directory),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Checked 1 document (0 concepts, 0 relationships, 0 states): no errors\n',
        stderr: '',
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('compiles documents selected by an explicit workspace manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n',
        'utf8',
      )

      const result = runCli(
        ['compile', '.yarramate/workspace.yaml'],
        directory,
      )
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).documents).toEqual([
        { id: 'main', source: '.yarramate/architecture/main.yaml' },
      ])
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('evaluates a projection over an explicit workspace manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      mkdirSync(join(directory, '.yarramate/architecture'), { recursive: true })
      mkdirSync(join(directory, '.yarramate/projections'), { recursive: true })
      writeFileSync(
        join(directory, '.yarramate/architecture/lifecycle.yaml'),
        readFileSync(
          join(
            repositoryRoot,
            'test/fixtures/valid/lifecycle-status.yaml',
          ),
          'utf8',
        ),
        'utf8',
      )
      writeFileSync(
        join(directory, '.yarramate/projections/current.yaml'),
        readFileSync(
          join(
            repositoryRoot,
            'test/fixtures/valid/current-capabilities.projection.yaml',
          ),
          'utf8',
        ),
        'utf8',
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections:\n' +
          '  - projections/*.yaml\n' +
          'adapterMappings: []\n',
        'utf8',
      )

      const result = runCli(
        [
          'context',
          '.yarramate/projections/current.yaml',
          '.yarramate/workspace.yaml',
        ],
        directory,
      )
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).subjects).toEqual([
        expect.objectContaining({ id: 'lifecycle#current-capability' }),
      ])
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('checks projection documents declared by a workspace manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/projections'), { recursive: true })
      writeFileSync(
        join(directory, '.yarramate/projections/invalid.yaml'),
        'format: yarramate/projection/v1\n' +
          'id: invalid\n' +
          'version: "1.0"\n' +
          'query: {}\n' +
          'metadata: {}\n',
        'utf8',
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections:\n' +
          '  - projections/*.yaml\n' +
          'adapterMappings: []\n',
        'utf8',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'YM201',
          path: '.yarramate/projections/invalid.yaml',
          pointer: '/metadata',
        }),
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('checks Core contract manifests declared by a workspace manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-contract-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/contracts'), { recursive: true })
      writeFileSync(
        join(directory, '.yarramate/contracts/core.yaml'),
        `format: yarramate/core-contract/v1
id: core
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
metadata: {}
`,
        'utf8',
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'contracts:\n' +
          '  - contracts/*.yaml\n',
        'utf8',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'YM201',
          path: '.yarramate/contracts/core.yaml',
          pointer: '/metadata',
        }),
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('checks a Core contract against its declared package surface', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-contract-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/contracts'), { recursive: true })
      mkdirSync(join(directory, 'schema'))
      writeFileSync(
        join(directory, 'schema/document.json'),
        JSON.stringify({
          properties: {
            format: { const: 'yarramate/v1' },
          },
        }),
      )
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          exports: {
            './schema/document': './schema/wrong.json',
          },
          bin: {
            yarramate: 'dist/cli.js',
          },
        }),
      )
      writeFileSync(
        join(directory, '.yarramate/contracts/core.yaml'),
        `format: yarramate/core-contract/v1
id: core
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
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'contracts:\n' +
          '  - contracts/*.yaml\n',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toEqual([
        expect.objectContaining({
          code: 'YMC202',
          path: '.yarramate/contracts/core.yaml',
          pointer: '/formats/0/packageExport',
        }),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a non-object package manifest without surface cascades', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-contract-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/contracts'), { recursive: true })
      mkdirSync(join(directory, 'schema'))
      writeFileSync(
        join(directory, 'schema/document.json'),
        JSON.stringify({
          properties: {
            format: { const: 'yarramate/v1' },
          },
        }),
      )
      writeFileSync(join(directory, 'package.json'), '[]\n')
      writeFileSync(
        join(directory, '.yarramate/contracts/core.yaml'),
        `format: yarramate/core-contract/v1
id: core
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
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'contracts:\n' +
          '  - contracts/*.yaml\n',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toEqual([
        {
          severity: 'error',
          code: 'YMC205',
          message:
            'Package manifest "package.json" is not a valid JSON object',
          path: '.yarramate/contracts/core.yaml',
          pointer: '/packageManifest',
          line: 4,
          column: 18,
        },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('checks normative schema validity for a Core contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-contract-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/contracts'), { recursive: true })
      mkdirSync(join(directory, 'schema'))
      writeFileSync(
        join(directory, 'schema/document.json'),
        JSON.stringify({
          type: 42,
          properties: {
            format: { const: 'yarramate/v1' },
          },
        }),
      )
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          exports: {
            './schema/document': './schema/document.json',
          },
          bin: {
            yarramate: 'dist/cli.js',
          },
        }),
      )
      writeFileSync(
        join(directory, '.yarramate/contracts/core.yaml'),
        `format: yarramate/core-contract/v1
id: core
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
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'contracts:\n' +
          '  - contracts/*.yaml\n',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toEqual([
        expect.objectContaining({
          code: 'YMC208',
          path: '.yarramate/contracts/core.yaml',
          pointer: '/formats/0/schema',
        }),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('checks evidence declared by a workspace manifest against its graph', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      mkdirSync(join(directory, '.yarramate/evidence'), { recursive: true })
      writeFileSync(
        join(directory, '.yarramate/evidence/repository.yaml'),
        'format: yarramate/evidence/v1\n' +
          'id: repository\n' +
          'version: "1.0"\n' +
          'provider: repository-audit\n' +
          'observations:\n' +
          '  - subject: main#missing\n' +
          '    result: unknown\n' +
          '    evidence:\n' +
          '      uri: repo:missing\n',
        'utf8',
      )
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: test-workspace\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'evidence:\n' +
          '  - evidence/*.yaml\n',
        'utf8',
      )

      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--json'],
        directory,
      )
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'YM801',
          path: '.yarramate/evidence/repository.yaml',
        }),
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('adds a validated concept to a native document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-add-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)

      expect(
        runCli(
          [
            'add',
            '.yarramate/architecture/main.yaml',
            '--id',
            'native-compilation',
            '--kind',
            'capability',
            '--name',
            'Native compilation',
            '--status',
            'current',
          ],
          directory,
        ),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Added concept "native-compilation" to .yarramate/architecture/main.yaml\n',
        stderr: '',
      })

      expect(
        runCli(['check', '.yarramate/architecture/main.yaml'], directory).exitCode,
      ).toBe(0)
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toContain(
        'concepts:\n' +
          '  - id: native-compilation\n' +
          '    kind: capability\n' +
          '    name: Native compilation\n' +
          '    status: current\n',
      )
      const beforeRejectedEdit = readFileSync(
        join(directory, '.yarramate/architecture/main.yaml'),
        'utf8',
      )
      expect(
        runCli(
          [
            'add',
            '.yarramate/architecture/main.yaml',
            '--id',
            'native-compilation',
            '--kind',
            'goal',
            '--name',
            'Duplicate',
          ],
          directory,
        ).exitCode,
      ).toBe(1)
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toBe(beforeRejectedEdit)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('authors state presence for concepts and relationships', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'yarramate-state-authoring-'),
    )
    try {
      mkdirSync(join(directory, '.yarramate/architecture'), { recursive: true })
      const documentPath = join(directory, '.yarramate/architecture/roadmap.yaml')
      writeFileSync(
        documentPath,
        `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
states:
  - id: target
    kind: target
    name: Target
concepts:
  - id: shared
    kind: applicationComponent
    name: Shared
relationships: []
`,
      )

      expect(
        runCli(
          [
            'add',
            '.yarramate/architecture/roadmap.yaml',
            '--id',
            'modern',
            '--kind',
            'applicationComponent',
            '--name',
            'Modern',
            '--present-in',
            'target',
          ],
          directory,
        ).exitCode,
      ).toBe(0)
      expect(
        runCli(
          [
            'connect',
            '.yarramate/architecture/roadmap.yaml',
            '--id',
            'shared-serves-modern',
            '--kind',
            'serving',
            '--from',
            'shared',
            '--to',
            'modern',
            '--present-in',
            'target',
          ],
          directory,
        ).exitCode,
      ).toBe(0)

      const authored = readFileSync(documentPath, 'utf8')
      expect(authored).toContain(
        '    presentIn:\n' +
          '      - target\n',
      )
      expect(runCli(['check', '.yarramate/architecture/roadmap.yaml'], directory))
        .toMatchObject({ exitCode: 0 })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('adds ownership, constraints, and references through the stable CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-add-semantics-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      for (const [id, kind, name] of [
        ['payments-team', 'businessActor', 'Payments team'],
        ['australia-only', 'constraint', 'Australia only'],
      ] as const) {
        expect(
          runCli(
            [
              'add',
              '.yarramate/architecture/main.yaml',
              '--id',
              id,
              '--kind',
              kind,
              '--name',
              name,
            ],
            directory,
          ).exitCode,
        ).toBe(0)
      }

      const result = runCli(
        [
          'add',
          '.yarramate/architecture/main.yaml',
          '--id',
          'customer-data',
          '--kind',
          'dataObject',
          '--name',
          'Customer data',
          '--owner',
          'payments-team',
          '--constraint',
          'residency=australia-only',
          '--reference',
          'policy-source=australia-only',
        ],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toContain(
        '    owner: payments-team\n' +
          '    constraints:\n' +
          '      - id: residency\n' +
          '        ref: australia-only\n' +
          '    references:\n' +
          '      - id: policy-source\n' +
          '        ref: australia-only\n',
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('connects concepts only when the resulting document is valid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-connect-'))
    try {
      expect(runCli(['init', '.'], directory).exitCode).toBe(0)
      for (const [id, name] of [
        ['architecture-engine', 'Architecture engine'],
        ['compiled-graph', 'Compiled graph'],
      ] as const) {
        expect(
          runCli(
            [
              'add',
              '.yarramate/architecture/main.yaml',
              '--id',
              id,
              '--kind',
              id === 'compiled-graph' ? 'artifact' : 'applicationComponent',
              '--name',
              name,
            ],
            directory,
          ).exitCode,
        ).toBe(0)
      }

      expect(
        runCli(
          [
            'connect',
            '.yarramate/architecture/main.yaml',
            '--id',
            'engine-produces-graph',
            '--kind',
            'realization',
            '--from',
            'architecture-engine',
            '--to',
            'compiled-graph',
            '--description',
            'The engine realizes the canonical compiled representation.',
            '--reference',
            'rationale-source=architecture-engine',
            '--status',
            'current',
          ],
          directory,
        ),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Added relationship "engine-produces-graph" to .yarramate/architecture/main.yaml\n',
        stderr: '',
      })
      expect(
        runCli(['check', '.yarramate/architecture/main.yaml'], directory).exitCode,
      ).toBe(0)
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toContain(
        'relationships:\n' +
          '  - id: engine-produces-graph\n' +
          '    kind: realization\n' +
          '    from: architecture-engine\n' +
          '    to: compiled-graph\n' +
          '    description: The engine realizes the canonical compiled representation.\n' +
          '    status: current\n' +
          '    references:\n' +
          '      - id: rationale-source\n' +
          '        ref: architecture-engine\n',
      )

      const beforeRejectedEdit = readFileSync(
        join(directory, '.yarramate/architecture/main.yaml'),
        'utf8',
      )
      const rejected = runCli(
        [
          'connect',
          '.yarramate/architecture/main.yaml',
          '--id',
          'invalid-reference',
          '--kind',
          'association',
          '--from',
          'missing',
          '--to',
          'compiled-graph',
        ],
        directory,
      )
      expect(rejected.exitCode).toBe(1)
      expect(rejected.stdout).toContain('YM302')
      expect(
        readFileSync(join(directory, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toBe(beforeRejectedEdit)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('validates edits with explicit profile sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-profile-add-'))
    try {
      const profileSource = readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/platform-profile.yaml'),
        'utf8',
      )
      const documentSource = readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/platform-document.yaml'),
        'utf8',
      )
      const profilePath = join(
        directory,
        '.yarramate/profiles/platform.yaml',
      )
      const documentPath = join(
        directory,
        '.yarramate/architecture/platform.yaml',
      )
      mkdirSync(join(directory, '.yarramate/profiles'), { recursive: true })
      mkdirSync(join(directory, '.yarramate/architecture'), {
        recursive: true,
      })
      writeFileSync(profilePath, profileSource, 'utf8')
      writeFileSync(documentPath, documentSource, 'utf8')
      writeFileSync(
        join(directory, '.yarramate/workspace.yaml'),
        'format: yarramate/workspace/v1\n' +
          'id: platform\n' +
          'documents:\n' +
          '  - architecture/platform.yaml\n' +
          'profiles:\n' +
          '  - profiles/platform.yaml\n' +
          'projections: []\n' +
          'adapterMappings: []\n',
        'utf8',
      )

      const result = runCli(
        [
          'add',
          '.yarramate/architecture/platform.yaml',
          '--id',
          'secondary-team',
          '--kind',
          'platform-team',
          '--name',
          'Secondary team',
          '--source',
          '.yarramate/workspace.yaml',
        ],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(readFileSync(documentPath, 'utf8')).toContain(
        'kind: platform-team',
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})

describe('ad-hoc bounded context', () => {
  it('evaluates a connected neighbourhood without an authored projection', () => {
    const result = runCli(
      [
        'context',
        '--subject',
        'checkout#approval-api',
        'test/fixtures/valid/minimal.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as {
      projection: string
      subjects: readonly { id: string }[]
    }
    expect(payload.projection).toBe('ad-hoc-context@0.0')
    expect(payload.subjects.map(({ id }) => id)).toEqual([
      'checkout#api-realizes-approval',
      'checkout#approval-api',
      'checkout#approve-order',
    ])
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-projection-result.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    expect(
      validate(JSON.parse(result.stdout)),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('rejects subjects that are not globally qualified', () => {
    const result = runCli(
      [
        'context',
        '--subject',
        'approval-api',
        'test/fixtures/valid/minimal.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('globally qualified')
  })

  it('fails loudly on unknown subject identities', () => {
    const result = runCli(
      [
        'context',
        '--subject',
        'checkout#does-not-exist',
        'test/fixtures/valid/minimal.yaml',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(
      'Unknown subject identity: checkout#does-not-exist',
    )
  })

  it('requires at least one source after the subjects', () => {
    const result = runCli(
      ['context', '--subject', 'checkout#approval-api'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })
})
