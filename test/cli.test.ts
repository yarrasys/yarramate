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
import { deriveInitId, runCli } from '../src/cli.js'
import { compileWorkspace } from '../src/compiler.js'
import { serializeSemanticGraph } from '../src/graph.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const Ajv2020 = Ajv2020Module.default

// Several read tests wrap loose fixture documents in a workspace
// manifest because every 0.7.0 read verb requires one.
const fixtureWorkspace = (
  documents: readonly string[],
  profiles: readonly string[] = [],
): string => {
  const directory = mkdtempSync(join(tmpdir(), 'yarramate-fixture-ws-'))
  mkdirSync(join(directory, 'architecture'))
  if (profiles.length > 0) mkdirSync(join(directory, 'profiles'))
  const list = (paths: readonly string[]) =>
    paths.map((path) => `  - ${path}`).join('\n')
  const documentPaths = documents.map((source, index) => {
    const target = `architecture/document-${index}.yaml`
    writeFileSync(
      join(directory, target),
      readFileSync(join(repositoryRoot, source), 'utf8'),
      'utf8',
    )
    return target
  })
  const profilePaths = profiles.map((source, index) => {
    const target = `profiles/profile-${index}.yaml`
    writeFileSync(
      join(directory, target),
      readFileSync(join(repositoryRoot, source), 'utf8'),
      'utf8',
    )
    return target
  })
  writeFileSync(
    join(directory, 'workspace.yaml'),
    'format: yarramate/workspace/v1\n' +
      'id: fixture\n' +
      `documents:\n${list(documentPaths)}\n` +
      (profilePaths.length === 0
        ? 'profiles: []\n'
        : `profiles:\n${list(profilePaths)}\n`) +
      'projections: []\n' +
      'adapterMappings: []\n' +
      'evidence: []\n',
    'utf8',
  )
  return directory
}

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

  it.each(['--version', '-v'])(
    'prints the package version for %s',
    (argument) => {
      const { version } = JSON.parse(
        readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
      ) as { version: string }
      const result = runCli([argument], repositoryRoot)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(`yarramate ${version}\n`)
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

  // The compiler used to throw on any source composing to null, so `check`
  // reported a bare `TypeError` on stderr and wrote NOTHING to stdout. The
  // exit code was already 2, so CI failed honestly; what a machine consumer
  // got was an empty stdout and `Unexpected end of JSON input` from its own
  // parser, with no code, no path and no line to act on. A crash has to stay
  // inside the result schema like every other refusal.
  it('reports a document composing to nothing as a diagnostic, not a crash', () => {
    const schema = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'schema/yarramate-check-result.schema.json'),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const result = runCli(
      ['check', 'test/fixtures/invalid/comment-only-document.yaml', '--json'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout)
    expect(validate(parsed), JSON.stringify(validate.errors ?? [])).toBe(true)
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'YM201',
        path: 'test/fixtures/invalid/comment-only-document.yaml',
      }),
    )
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
        '      "column": 11,\n' +
        '      "subjects": [\n' +
        '        "mystery"\n' +
        '      ]\n' +
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
    const directory = fixtureWorkspace(['test/fixtures/valid/minimal.yaml'])
    try {
      const result = runCli(['export', 'graph', 'workspace.yaml'], directory)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(
        result.stdout.startsWith('{\n  "format": "yarramate/graph/v2"'),
      ).toBe(true)
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
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('serializes byte-identical graph JSON regardless of source order', () => {
    // Canonical-graph-serialization is a library guarantee; the CLI
    // surface orders documents by the workspace manifest.
    const sources = [
      'test/fixtures/valid/minimal.yaml',
      'test/fixtures/valid/strategy.yaml',
    ].map((path) => ({
      path,
      source: readFileSync(join(repositoryRoot, path), 'utf8'),
    }))
    const forward = compileWorkspace(sources)
    const reverse = compileWorkspace([...sources].reverse())

    expect(forward.ok).toBe(true)
    expect(reverse.ok).toBe(true)
    if (forward.ok && reverse.ok) {
      expect(serializeSemanticGraph(reverse.graph)).toBe(
        serializeSemanticGraph(forward.graph),
      )
    }
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

  it('renders a projection slice as deterministic JSON through ask', () => {
    const directory = fixtureWorkspace([
      'test/fixtures/valid/lifecycle-status.yaml',
    ])
    try {
      writeFileSync(
        join(directory, 'capabilities.projection.yaml'),
        readFileSync(
          join(
            repositoryRoot,
            'test/fixtures/valid/current-capabilities.projection.yaml',
          ),
          'utf8',
        ),
        'utf8',
      )
      const result = runCli(
        [
          'ask',
          'workspace.yaml',
          'capabilities.projection.yaml',
          '--json',
        ],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toMatchObject({
        format: 'yarramate/ask-result/v1',
        mode: 'slice',
        addressing: 'projection',
        result: {
          format: 'yarramate/projection-result/v1',
          projection: 'current-capabilities@1.0',
          subjects: [
            {
              id: 'current-capability',
              type: 'concept',
            },
          ],
        },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('renders extension kinds through their semantic parents', () => {
    const directory = fixtureWorkspace(
      ['test/fixtures/valid/platform-document.yaml'],
      ['test/fixtures/valid/platform-profile.yaml'],
    )
    try {
      writeFileSync(
        join(directory, 'actors.projection.yaml'),
        readFileSync(
          join(
            repositoryRoot,
            'test/fixtures/valid/platform-actors.projection.yaml',
          ),
          'utf8',
        ),
        'utf8',
      )
      const result = runCli(
        ['ask', 'workspace.yaml', 'actors.projection.yaml', '--json'],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).result.subjects).toEqual([
        { id: 'delivery', type: 'concept' },
        { id: 'team', type: 'concept' },
        {
          id: 'team-owns-delivery',
          type: 'relationship',
        },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('compares two architecture states through ask', () => {
    const directory = fixtureWorkspace([
      'test/fixtures/valid/architecture-states.yaml',
    ])
    try {
      const result = runCli(
        [
          'ask',
          'workspace.yaml',
          '--compare',
          'baseline',
          'target',
          '--json',
        ],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        format: 'yarramate/ask-result/v1',
        mode: 'compare',
        comparison: {
          format: 'yarramate/state-comparison/v1',
          from: 'baseline',
          to: 'target',
          added: [
            { id: 'modern', type: 'concept' },
            {
              id: 'shared-serves-modern',
              type: 'relationship',
            },
          ],
          removed: [
            { id: 'legacy', type: 'concept' },
            {
              id: 'shared-serves-legacy',
              type: 'relationship',
            },
          ],
          retained: [{ id: 'shared', type: 'concept' }],
        },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('emits read failures conforming to the diagnostic schema', () => {
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
    const directory = fixtureWorkspace([
      'test/fixtures/invalid/unknown-concept-kind.yaml',
    ])
    try {
      const result = runCli(
        ['ask', 'workspace.yaml', '--subjects', '--json'],
        directory,
      )

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).format).toBe(
        'yarramate/diagnostic-result/v1',
      )
      expect(
        validate(JSON.parse(result.stdout)),
        JSON.stringify(validate.errors ?? []),
      ).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('renders the same semantic projection as Markdown for reviewers', () => {
    const directory = fixtureWorkspace([
      'test/fixtures/valid/lifecycle-status.yaml',
    ])
    try {
      writeFileSync(
        join(directory, 'capabilities.projection.yaml'),
        readFileSync(
          join(
            repositoryRoot,
            'test/fixtures/valid/current-capabilities.projection.yaml',
          ),
          'utf8',
        ),
        'utf8',
      )
      const result = runCli(
        [
          'export',
          'markdown',
          'capabilities.projection.yaml',
          'workspace.yaml',
        ],
        directory,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('# Current capabilities\n')
      expect(result.stdout).toContain(
        '- Current capability (`current-capability`)',
      )
      expect(result.stdout).not.toContain('Planned goal')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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
        subjectsWithoutEvidence: 1,
        staleAttestations: 0,
        unsupportedAbsences: 0,
        unconfirmedAttestations: 0,
        expectationsCompared: 0,
        expectationsWithoutObservation: 0,
      },
      unobservedSubjects: ['order-service'],
      notes: [
        'Artifact coverage was not assessed: the workspace manifest declares no coverage scope.',
      ],
      findings: [
        {
          target: {
            type: 'subject',
            id: 'customer',
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

  it('accepts --json on reconcile as a no-op with identical output', () => {
    // Bare reconcile already emits JSON; the flag exists so a harness
    // adding --json to every verb never hits exit 2 (#275).
    const bare = runCli(
      [
        'reconcile',
        'test/fixtures/journeys/discovery/.yarramate/workspace.yaml',
      ],
      repositoryRoot,
    )
    const flagged = runCli(
      [
        'reconcile',
        'test/fixtures/journeys/discovery/.yarramate/workspace.yaml',
        '--json',
      ],
      repositoryRoot,
    )

    expect(flagged.exitCode).toBe(0)
    expect(flagged).toEqual(bare)

    expect(
      runCli(
        [
          'reconcile',
          '--json',
          'test/fixtures/journeys/discovery/.yarramate/workspace.yaml',
        ],
        repositoryRoot,
      ),
    ).toEqual(bare)
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
        subjectsWithoutEvidence: 0,
        staleAttestations: 0,
        unsupportedAbsences: 0,
        unconfirmedAttestations: 0,
        expectationsCompared: 0,
        expectationsWithoutObservation: 0,
      },
      notes: [
        'Artifact coverage was not assessed: the workspace manifest declares no coverage scope.',
      ],
      findings: [
        {
          target: {
            type: 'subject',
            id: 'billing',
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
            id: 'payment-api-writes-ledger',
          },
          asserted: {
            from: 'payment-api',
            to: 'ledger',
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
      const created = runCli(['init', 'my-product'], directory)

      expect(created).toEqual({
        exitCode: 0,
        stdout:
          'Created my-product/.yarramate/architecture/main.yaml and my-product/.yarramate/workspace.yaml\n' +
          'Created my-product/AGENTS.md with the YarraMate pointer\n' +
          'Created my-product/CLAUDE.md with the YarraMate pointer\n',
        stderr: '',
      })
      expect(
        readFileSync(join(directory, 'my-product/AGENTS.md'), 'utf8'),
      ).toContain('## YarraMate architecture')
      expect(
        readFileSync(join(directory, 'my-product/CLAUDE.md'), 'utf8'),
      ).toContain('## YarraMate architecture')
      expect(
        readFileSync(
          join(directory, 'my-product/.yarramate/architecture/main.yaml'),
          'utf8',
        ),
      ).toBe(
        'format: yarramate/v1\n' +
          'id: my-product\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts: []\n' +
          'relationships: []\n',
      )
      expect(
        existsSync(
          join(directory, 'my-product/.yarramate/architecture/main.yaml'),
        ),
      ).toBe(true)
      expect(
        readFileSync(
          join(directory, 'my-product/.yarramate/workspace.yaml'),
          'utf8',
        ),
      ).toBe(
        'format: yarramate/workspace/v1\n' +
          'id: my-product\n' +
          'documents:\n' +
          '  - architecture/*.yaml\n' +
          'profiles: []\n' +
          'projections: []\n' +
          'adapterMappings: []\n' +
          'evidence: []\n',
      )

      expect(runCli(['init', 'my-product'], directory)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr:
          'my-product/.yarramate/architecture/main.yaml and my-product/.yarramate/workspace.yaml already exist; nothing was changed\n',
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('derives the ids from the cwd basename when initializing "."', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-init-dot-'))
    try {
      const cwd = join(directory, 'acme-app')
      mkdirSync(cwd)
      expect(runCli(['init', '.'], cwd).exitCode).toBe(0)
      expect(
        readFileSync(join(cwd, '.yarramate/workspace.yaml'), 'utf8'),
      ).toContain('id: acme-app\n')
      expect(
        readFileSync(join(cwd, '.yarramate/architecture/main.yaml'), 'utf8'),
      ).toContain('id: acme-app\n')
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('slugifies an unruly directory name and falls back to main', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-init-slug-'))
    try {
      expect(runCli(['init', 'My Product!'], directory).exitCode).toBe(0)
      expect(
        readFileSync(
          join(directory, 'My Product!/.yarramate/workspace.yaml'),
          'utf8',
        ),
      ).toContain('id: my-product\n')

      expect(runCli(['init', '!!!'], directory).exitCode).toBe(0)
      expect(
        readFileSync(join(directory, '!!!/.yarramate/workspace.yaml'), 'utf8'),
      ).toContain('id: main\n')
      expect(
        readFileSync(
          join(directory, '!!!/.yarramate/architecture/main.yaml'),
          'utf8',
        ),
      ).toContain('id: main\n')
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('slugifies basenames to the shared id grammar or falls back', () => {
    // Every derived id must satisfy the pattern the document and
    // workspace schemas share: ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
    expect(deriveInitId('/work/my-product')).toBe('my-product')
    expect(deriveInitId('/work/My Product!')).toBe('my-product')
    expect(deriveInitId('/work/My__Product--2')).toBe('my-product-2')
    expect(deriveInitId('/work/.hidden')).toBe('hidden')
    expect(deriveInitId('/work/YarraMate.CLI')).toBe('yarramate-cli')
    // Nothing usable: all symbols, dots, or a digit-led slug.
    expect(deriveInitId('/work/!!!')).toBe('main')
    expect(deriveInitId('/')).toBe('main')
    expect(deriveInitId('/work/2048')).toBe('main')
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
        ['export', 'graph', '.yarramate/workspace.yaml'],
        directory,
      )
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).documents).toEqual([
        {
          id: deriveInitId(directory),
          source: '.yarramate/architecture/main.yaml',
        },
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
          'ask',
          '.yarramate/workspace.yaml',
          '.yarramate/projections/current.yaml',
          '--json',
        ],
        directory,
      )
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).result.subjects).toEqual([
        expect.objectContaining({ id: 'current-capability' }),
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
          '  - subject: missing\n' +
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

})

