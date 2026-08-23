import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const askSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-ask-result.schema.json'),
    'utf8',
  ),
) as object
const validateAsk = new Ajv2020({ allErrors: true }).compile(askSchema)

// A dense hub: one seed with 14 direct neighbours across every
// materiality rank the brief ladder knows — one motivation concept,
// two planned, nine current-or-unstatused, two retired — so the
// default cap of 12 drops exactly the two retired spokes (ADR 0070).
const spokes: readonly (readonly [id: string, extra: string])[] = [
  ['goal-focus', '    kind: goal\n    name: Stay focused\n'],
  [
    'planned-a',
    '    kind: applicationComponent\n    name: Planned A\n    status: planned\n',
  ],
  [
    'planned-b',
    '    kind: applicationComponent\n    name: Planned B\n    status: planned\n',
  ],
  ...(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const).map(
    (suffix) =>
      [
        `current-${suffix}`,
        `    kind: applicationComponent\n    name: Current ${suffix.toUpperCase()}\n    status: current\n`,
      ] as const,
  ),
  ['loose-note', '    kind: applicationFunction\n    name: Loose note\n'],
  [
    'retired-a',
    '    kind: applicationComponent\n    name: Retired A\n    status: retired\n',
  ],
  [
    'retired-b',
    '    kind: applicationComponent\n    name: Retired B\n    status: retired\n',
  ],
]

const denseDocument =
  `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: hub
    kind: applicationService
    name: Hub service
    status: current
    description: The dense centre every spoke touches.
` +
  spokes.map(([id, extra]) => `  - id: ${id}\n${extra}`).join('') +
  'relationships:\n' +
  spokes
    .map(
      ([id]) =>
        `  - id: hub-${id}\n    kind: association\n    from: hub\n    to: ${id}\n`,
    )
    .join('')

const manifest = `format: yarramate/workspace/v1
id: dense-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

const keptByDefault = [
  'goal-focus',
  'planned-a',
  'planned-b',
  'current-a',
  'current-b',
  'current-c',
  'current-d',
  'current-e',
  'current-f',
  'current-g',
  'current-h',
  'loose-note',
]

interface SlicePayload {
  readonly mode: string
  readonly seeds: readonly string[]
  readonly neighbourhood?: {
    readonly cap: number
    readonly kept: number
    readonly omitted: number
    readonly omittedBySeed: readonly {
      readonly seed: string
      readonly omitted: number
    }[]
  }
  readonly result: {
    readonly subjects: readonly { readonly id: string; readonly type: string }[]
  }
}

const conceptIds = (payload: SlicePayload): readonly string[] =>
  payload.result.subjects
    .filter(({ type }) => type === 'concept')
    .map(({ id }) => id)
    .sort()

describe('ask neighbour cap', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-neighbours-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      denseDocument,
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('caps a hub slice at 12 materiality-ordered neighbours and announces the omission', () => {
    const result = runCli(['ask', 'workspace.yaml', 'hub'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      '[neighbours 12: 2 of 14 neighbours omitted — ' +
        'raise --neighbours or pass --neighbours 0 for the full neighbourhood]',
    )
    // The retired spokes rank last, so they are the two dropped.
    expect(result.stdout).not.toContain('Retired A')
    expect(result.stdout).not.toContain('Retired B')
    expect(result.stdout).toContain('Stay focused')
  })

  it('reports the omission additively in the JSON envelope, deterministically', () => {
    const first = runCli(
      ['ask', 'workspace.yaml', 'hub', '--json'],
      workspace,
    )
    const second = runCli(
      ['ask', 'workspace.yaml', 'hub', '--json'],
      workspace,
    )
    expect(first.exitCode).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    const payload = JSON.parse(first.stdout) as SlicePayload
    expect(payload.mode).toBe('slice')
    expect(payload.neighbourhood).toEqual({
      cap: 12,
      kept: 12,
      omitted: 2,
      omittedBySeed: [{ seed: 'hub', omitted: 2 }],
    })
    expect(conceptIds(payload)).toEqual(
      ['hub', ...keptByDefault].sort(),
    )
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('keeps motivation, then planned, then current under a tighter --neighbours', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', 'hub', '--neighbours', '5', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SlicePayload
    expect(payload.neighbourhood).toEqual({
      cap: 5,
      kept: 5,
      omitted: 9,
      omittedBySeed: [{ seed: 'hub', omitted: 9 }],
    })
    // Rank order: the goal (motivation), both planned, then current in
    // id order — the brief's budget ladder applied to neighbours.
    expect(conceptIds(payload)).toEqual(
      [
        'hub',
        'goal-focus',
        'planned-a',
        'planned-b',
        'current-a',
        'current-b',
      ].sort(),
    )
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('lifts the cap with --neighbours 0 and stays silent', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', 'hub', '--neighbours', '0', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SlicePayload
    expect(payload.neighbourhood).toBeUndefined()
    expect(conceptIds(payload)).toHaveLength(15)
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)

    const human = runCli(
      ['ask', 'workspace.yaml', 'hub', '--neighbours', '0'],
      workspace,
    )
    expect(human.stdout).not.toContain('[neighbours')
    expect(human.stdout).toContain('Retired A')
  })

  it('says nothing when the neighbourhood fits under the cap', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', 'goal-focus', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SlicePayload
    expect(payload.neighbourhood).toBeUndefined()
    expect(conceptIds(payload)).toEqual(['goal-focus', 'hub'])
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('caps the --advise slice the same way and says so in the composition', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--advise', 'hub'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('== Model slice ==')
    expect(result.stdout).toContain('[neighbours 12: 2 of 14 neighbours omitted')

    const json = runCli(
      ['ask', 'workspace.yaml', '--advise', 'hub', '--json'],
      workspace,
    )
    const payload = JSON.parse(json.stdout) as SlicePayload
    expect(payload.mode).toBe('advice')
    expect(payload.neighbourhood).toEqual({
      cap: 12,
      kept: 12,
      omitted: 2,
      omittedBySeed: [{ seed: 'hub', omitted: 2 }],
    })
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('leaves projection addressing uncapped and rejects --neighbours there', () => {
    writeFileSync(
      join(workspace, 'dense.projection.yaml'),
      `format: yarramate/projection/v1
id: dense
version: "1.0"
query:
  subjects: [hub]
  relationships: connected
presentation:
  title: Dense
`,
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', 'dense.projection.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SlicePayload
    expect(payload.neighbourhood).toBeUndefined()
    expect(conceptIds(payload)).toHaveLength(15)

    const rejected = runCli(
      [
        'ask',
        'workspace.yaml',
        'dense.projection.yaml',
        '--neighbours',
        '5',
      ],
      workspace,
    )
    expect(rejected.exitCode).toBe(2)
    expect(rejected.stderr).toContain('--neighbours applies to seeded slices')
  })

  it('leaves non-expanding modes untouched', () => {
    const roster = runCli(['ask', 'workspace.yaml', '--subjects'], workspace)
    expect(roster.exitCode).toBe(0)
    expect(roster.stdout).toContain('15 of 15')
    expect(roster.stdout).toContain('retired-b')

    const orientation = runCli(['ask', 'workspace.yaml'], workspace)
    expect(orientation.exitCode).toBe(0)
    expect(orientation.stdout).not.toContain('[neighbours')
  })

  it('rejects --neighbours wherever there is no seeded expansion to cap', () => {
    for (const args of [
      ['ask', 'workspace.yaml', '--neighbours', '5'],
      ['ask', 'workspace.yaml', '--subjects', '--neighbours', '5'],
      ['ask', 'workspace.yaml', '--next', '--neighbours', '5'],
      ['ask', 'workspace.yaml', '--where', 'hub', '--neighbours', '5'],
      ['ask', 'workspace.yaml', 'hub', '--neighbours', 'abc'],
      ['ask', 'workspace.yaml', 'hub', '--neighbours', '-3'],
      ['ask', 'workspace.yaml', 'hub', '--neighbours', '5', '--neighbours', '6'],
      ['ask', 'workspace.yaml', 'hub', '--neighbours'],
    ]) {
      const result = runCli(args, workspace)
      expect(result.exitCode, args.join(' ')).toBe(2)
      expect(result.stderr, args.join(' ')).toContain('Usage:')
    }
  })

  // Review slices share the seeded 1-hop expansion, so a changed hub is
  // announced with the same honesty (ADR 0065 meets ADR 0070).
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'fixture',
        GIT_AUTHOR_EMAIL: 'fixture@test',
        GIT_COMMITTER_NAME: 'fixture',
        GIT_COMMITTER_EMAIL: 'fixture@test',
      },
    })

  it('caps the changed-range review slice around a changed hub', () => {
    git(workspace, 'init', '-q')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-q', '-m', 'base')
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      denseDocument.replace(
        'description: The dense centre every spoke touches.',
        'description: The dense centre every spoke still touches.',
      ),
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SlicePayload
    expect(payload.seeds).toEqual(['hub'])
    expect(payload.neighbourhood).toEqual({
      cap: 12,
      kept: 12,
      omitted: 2,
      omittedBySeed: [{ seed: 'hub', omitted: 2 }],
    })
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)

    const human = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD'],
      workspace,
    )
    expect(human.stdout).toContain('[neighbours 12: 2 of 14 neighbours omitted')
  })
})
