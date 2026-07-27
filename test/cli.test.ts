import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('YarraMate CLI', () => {
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
      stdout: 'Checked 1 document: no errors\n',
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
      stdout: 'Checked 1 document and 1 profile: no errors\n',
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
      stdout: 'Checked 1 document and 1 adapter mapping: no errors\n',
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

  it('initializes a minimal native workspace without overwriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-init-'))
    try {
      const created = runCli(['init', '.'], directory)

      expect(created).toEqual({
        exitCode: 0,
        stdout: 'Created architecture/main.yaml\n',
        stderr: '',
      })
      expect(
        readFileSync(join(directory, 'architecture/main.yaml'), 'utf8'),
      ).toBe(
        'format: yarramate/v1\n' +
          'id: main\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts: []\n' +
          'relationships: []\n',
      )
      expect(existsSync(join(directory, 'architecture/main.yaml'))).toBe(true)

      expect(runCli(['init', '.'], directory)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: 'architecture/main.yaml already exists; nothing was changed\n',
      })
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
            'architecture/main.yaml',
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
          'Added concept "native-compilation" to architecture/main.yaml\n',
        stderr: '',
      })

      expect(
        runCli(['check', 'architecture/main.yaml'], directory).exitCode,
      ).toBe(0)
      expect(
        readFileSync(join(directory, 'architecture/main.yaml'), 'utf8'),
      ).toContain(
        'concepts:\n' +
          '  - id: native-compilation\n' +
          '    kind: capability\n' +
          '    name: Native compilation\n' +
          '    status: current\n',
      )
      const beforeRejectedEdit = readFileSync(
        join(directory, 'architecture/main.yaml'),
        'utf8',
      )
      expect(
        runCli(
          [
            'add',
            'architecture/main.yaml',
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
        readFileSync(join(directory, 'architecture/main.yaml'), 'utf8'),
      ).toBe(beforeRejectedEdit)
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
              'architecture/main.yaml',
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
            'architecture/main.yaml',
            '--id',
            'engine-produces-graph',
            '--kind',
            'realization',
            '--from',
            'architecture-engine',
            '--to',
            'compiled-graph',
            '--status',
            'current',
          ],
          directory,
        ),
      ).toEqual({
        exitCode: 0,
        stdout:
          'Added relationship "engine-produces-graph" to architecture/main.yaml\n',
        stderr: '',
      })
      expect(
        runCli(['check', 'architecture/main.yaml'], directory).exitCode,
      ).toBe(0)
      expect(
        readFileSync(join(directory, 'architecture/main.yaml'), 'utf8'),
      ).toContain(
        'relationships:\n' +
          '  - id: engine-produces-graph\n' +
          '    kind: realization\n' +
          '    from: architecture-engine\n' +
          '    to: compiled-graph\n' +
          '    status: current\n',
      )

      const beforeRejectedEdit = readFileSync(
        join(directory, 'architecture/main.yaml'),
        'utf8',
      )
      const rejected = runCli(
        [
          'connect',
          'architecture/main.yaml',
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
        readFileSync(join(directory, 'architecture/main.yaml'), 'utf8'),
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
      const profilePath = join(directory, 'platform-profile.yaml')
      const documentPath = join(directory, 'platform-document.yaml')
      writeFileSync(profilePath, profileSource, 'utf8')
      writeFileSync(documentPath, documentSource, 'utf8')

      const result = runCli(
        [
          'add',
          'platform-document.yaml',
          '--id',
          'secondary-team',
          '--kind',
          'platform-team',
          '--name',
          'Secondary team',
          '--source',
          'platform-profile.yaml',
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
