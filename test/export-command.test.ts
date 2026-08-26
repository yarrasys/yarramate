import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
    description: The person capturing todos.
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
    description: Stores and serves todo items.
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
`

const manifest = `format: yarramate/workspace/v1
id: export-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

const projection = `format: yarramate/projection/v1
id: everything
version: "1.0"
query:
  relationships: connected
presentation:
  title: Everything
`

describe('export command', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-export-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'everything.yaml'), projection, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('exports the canonical graph to stdout and to a file', () => {
    const stdout = runCli(['export', 'graph', 'workspace.yaml'], workspace)
    expect(stdout.exitCode).toBe(0)
    const graph = JSON.parse(stdout.stdout) as {
      format: string
      subjects: readonly { id: string }[]
    }
    expect(graph.format).toBe('yarramate/graph/v2')
    expect(graph.subjects.map(({ id }) => id)).toContain('todo-service')

    const filed = runCli(
      ['export', 'graph', 'workspace.yaml', '--out', 'out/graph.json'],
      workspace,
    )
    expect(filed.exitCode).toBe(0)
    expect(filed.stdout).toBe('Wrote graph to out/graph.json\n')
    expect(readFileSync(join(workspace, 'out/graph.json'), 'utf8')).toBe(
      stdout.stdout,
    )
  })

  it('exports a workbook, and refuses without a destination', () => {
    // Bytes have nowhere sensible to go on stdout, so `--out` is required
    // rather than optional as it is for markdown.
    const missing = runCli(
      ['export', 'xlsx', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(missing.exitCode).toBe(2)

    const result = runCli(
      [
        'export',
        'xlsx',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'out/model.xlsx',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Wrote workbook to out/model.xlsx\n')

    const bytes = readFileSync(join(workspace, 'out/model.xlsx'))
    // A zip, and one an unzip implementation would accept: the local file
    // header signature, then a central directory at the end.
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b]))
    expect(bytes.includes(Buffer.from('xl/workbook.xml'))).toBe(true)
    expect(bytes.includes(Buffer.from('~Baseline'))).toBe(true)
    // The workbook is the model, so a subject's name is in there verbatim.
    expect(bytes.includes(Buffer.from('Todo service'))).toBe(true)
  })

  it('exports projection markdown', () => {
    const result = runCli(
      ['export', 'markdown', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Everything')
    expect(result.stdout).toContain('Todo service')

    const filed = runCli(
      [
        'export',
        'markdown',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'out/everything.md',
      ],
      workspace,
    )
    expect(filed.stdout).toBe('Wrote markdown to out/everything.md\n')
    expect(
      readFileSync(join(workspace, 'out/everything.md'), 'utf8'),
    ).toBe(result.stdout)
  })

  it('exports a deterministic handoff bundle of briefs with an index', () => {
    const result = runCli(
      [
        'export',
        'briefs',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'handoff',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Wrote 2 briefs and INDEX.md to handoff\n')
    const index = readFileSync(join(workspace, 'handoff/INDEX.md'), 'utf8')
    expect(index).toContain('# Briefs — Everything')
    expect(index).toContain('[Todo service](todo-service.md)')
    expect(index).toContain('(planned)')
    const brief = readFileSync(
      join(workspace, 'handoff/todo-service.md'),
      'utf8',
    )
    expect(brief).toContain('Todo service')

    const again = runCli(
      [
        'export',
        'briefs',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'handoff',
      ],
      workspace,
    )
    expect(again.stdout).toBe(result.stdout)
    expect(
      readFileSync(join(workspace, 'handoff/todo-service.md'), 'utf8'),
    ).toBe(brief)
  })

  it('requires --out for briefs', () => {
    const result = runCli(
      ['export', 'briefs', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })

  it('reports a missing adapter entry for likec4 in source checkouts', () => {
    writeFileSync(join(workspace, 'project.yaml'), 'format: x\n', 'utf8')
    const result = runCli(
      ['export', 'likec4', 'project.yaml', 'generated', 'workspace.yaml'],
      workspace,
    )
    // From src/ the compiled sibling adapters/likec4-cli.js does not
    // exist, so delegation reports the entry rather than half-running.
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('yarramate-likec4')
    expect(existsSync(join(workspace, 'generated'))).toBe(false)
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(
      ['export', 'graph', 'architecture/main.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'export requires an explicit workspace manifest',
    )
  })

  it('rejects unknown artifact kinds and stray flags with usage', () => {
    for (const args of [
      ['export'],
      ['export', 'pdf', 'workspace.yaml'],
      ['export', 'graph', 'workspace.yaml', '--budget', '100'],
      ['export', 'graph', 'workspace.yaml', '--json'],
      ['export', 'markdown', 'workspace.yaml'],
    ]) {
      const result = runCli(args, workspace)
      expect(result.exitCode, args.join(' ')).toBe(2)
      expect(result.stderr, args.join(' ')).toContain('Usage:')
    }
  })

  it('renders no Non-goals section when nothing is retired', () => {
    const result = runCli(
      ['export', 'markdown', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('## Non-goals')
  })
})

// First-class non-goals (ADR 0073): a goal, outcome, or requirement
// authored `status: retired` with its rationale in the description is
// the declared non-goal, and both stakeholder exports render it under
// an explicit Non-goals heading instead of burying it.
const nonGoalDocument = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: capture-todos
    kind: requirement
    name: Capture todos
    description: A user records a todo in one step.
  - id: offline-sync
    kind: requirement
    name: Offline sync
    status: retired
    description: Declined for launch; conflict resolution outweighs the value.
  - id: team-boards
    kind: goal
    name: Team boards
    status: retired
    description: Single-user scope holds; collaboration is out.
  - id: files-portable
    kind: principle
    name: Files stay portable
    status: retired
    description: A retired principle is a lifted rule, not declined scope.
  - id: legacy-api
    kind: applicationService
    name: Legacy API
    status: retired
    description: Replaced by the todo service; kept for history.
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
    description: Stores and serves todo items.
relationships:
  - id: service-realizes-capture
    kind: realization
    from: todo-service
    to: capture-todos
`

const livingProjection = `format: yarramate/projection/v1
id: living
version: "1.0"
query:
  excludeStatuses: [retired]
presentation:
  title: Living architecture
`

describe('non-goals in exports (ADR 0073)', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-nongoals-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      nonGoalDocument,
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'everything.yaml'), projection, 'utf8')
    writeFileSync(join(workspace, 'living.yaml'), livingProjection, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('markdown renders retired motivation subjects under Non-goals, deterministically', () => {
    const first = runCli(
      ['export', 'markdown', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(first.exitCode).toBe(0)
    const [inventory, nonGoals] = first.stdout.split('## Non-goals')
    expect(nonGoals).toBeDefined()
    expect(nonGoals).toContain(
      'Offline sync (`offline-sync`) — Declined for launch; ' +
        'conflict resolution outweighs the value.',
    )
    expect(nonGoals).toContain(
      'Team boards (`team-boards`) — Single-user scope holds; ' +
        'collaboration is out.',
    )
    // The Concepts inventory keeps the declared non-goals: relationship
    // endpoints must still resolve against the concept list.
    expect(inventory).toContain('Offline sync')
    // Non-motivation retired subjects and retired principles are
    // history or lifted rules, never non-goals.
    expect(nonGoals).not.toContain('Legacy API')
    expect(nonGoals).not.toContain('Files stay portable')
    const second = runCli(
      ['export', 'markdown', 'everything.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(second.stdout).toBe(first.stdout)
  })

  it('excludeStatuses still suppresses retired subjects entirely', () => {
    const result = runCli(
      ['export', 'markdown', 'living.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('## Non-goals')
    expect(result.stdout).not.toContain('Offline sync')
    expect(result.stdout).not.toContain('Team boards')
  })

  it('briefs close with a Non-goals section for declared non-goals', () => {
    const result = runCli(
      [
        'export',
        'briefs',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'handoff',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const declined = readFileSync(
      join(workspace, 'handoff/offline-sync.md'),
      'utf8',
    )
    expect(declined).toContain('## Non-goals')
    expect(declined).toContain(
      'Requirement "Offline sync" is declined: "Declined for launch; ' +
        'conflict resolution outweighs the value."',
    )
    expect(declined).not.toContain('## Why this exists')
    // Live motivation still opens the brief; no Non-goals section
    // appears where nothing in the slice is a declared non-goal.
    const building = readFileSync(
      join(workspace, 'handoff/todo-service.md'),
      'utf8',
    )
    expect(building).toContain('## Why this exists')
    expect(building).toContain('Requirement "Capture todos"')
    expect(building).not.toContain('## Non-goals')
    // A retired principle keeps its motivation reading.
    const principle = readFileSync(
      join(workspace, 'handoff/files-portable.md'),
      'utf8',
    )
    expect(principle).toContain('## Why this exists')
    expect(principle).not.toContain('## Non-goals')
    const again = runCli(
      [
        'export',
        'briefs',
        'everything.yaml',
        'workspace.yaml',
        '--out',
        'handoff',
      ],
      workspace,
    )
    expect(again.stdout).toBe(result.stdout)
    expect(
      readFileSync(join(workspace, 'handoff/offline-sync.md'), 'utf8'),
    ).toBe(declined)
  })
})
