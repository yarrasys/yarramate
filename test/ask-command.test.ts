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

// A small planned/current model with states and a build dependency: the
// realization from the UI to the service makes the UI the prerequisite,
// so the backlog must order it first.
const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Today
  - id: target
    kind: target
    name: Target
    after: baseline
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
  - id: todo-ui
    kind: applicationComponent
    name: Todo UI
    status: planned
    description: The browser client.
    presentIn: [target]
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
  - id: ui-realizes-service
    kind: realization
    from: todo-ui
    to: todo-service
`

const manifest = `format: yarramate/workspace/v1
id: ask-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

describe('ask command', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-ask-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('orients with verdict, open-question count, and dependency-ordered backlog', () => {
    const result = runCli(['ask', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Workspace ask-fixture: check ok')
    expect(result.stdout).toContain('Design interview:')
    expect(result.stdout).toContain('Backlog — planned, dependency order:')
    const ui = result.stdout.indexOf('main#todo-ui')
    const service = result.stdout.indexOf('main#todo-service')
    expect(ui).toBeGreaterThan(-1)
    expect(service).toBeGreaterThan(ui)
    expect(result.stdout).toContain('--subjects')
  })

  it('emits a deterministic, schema-valid orientation envelope', () => {
    const first = runCli(['ask', 'workspace.yaml', '--json'], workspace)
    const second = runCli(['ask', 'workspace.yaml', '--json'], workspace)
    expect(first.exitCode).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    const payload = JSON.parse(first.stdout) as {
      format: string
      mode: string
      ok: boolean
      design: { open: number }
      backlog: { planned: readonly { id: string }[] }
    }
    expect(payload.format).toBe('yarramate/ask-result/v1')
    expect(payload.mode).toBe('orientation')
    expect(payload.ok).toBe(true)
    expect(payload.design.open).toBeGreaterThan(0)
    expect(payload.backlog.planned.map(({ id }) => id)).toEqual([
      'main#todo-ui',
      'main#todo-service',
    ])
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('lists the filterable roster', () => {
    const all = runCli(['ask', 'workspace.yaml', '--subjects'], workspace)
    expect(all.exitCode).toBe(0)
    expect(all.stdout).toContain('3 of 3')
    expect(all.stdout).toContain('main#user')
    expect(all.stdout).toContain('The person capturing todos.')

    const planned = runCli(
      ['ask', 'workspace.yaml', '--subjects', '--status', 'planned', '--json'],
      workspace,
    )
    const plannedPayload = JSON.parse(planned.stdout) as {
      subjects: readonly { id: string }[]
      total: number
    }
    expect(plannedPayload.total).toBe(3)
    expect(plannedPayload.subjects.map(({ id }) => id)).toEqual([
      'main#todo-service',
      'main#todo-ui',
    ])
    expect(validateAsk(plannedPayload)).toBe(true)

    const actors = runCli(
      ['ask', 'workspace.yaml', '--subjects', '--kind', 'actor', '--json'],
      workspace,
    )
    expect(
      (JSON.parse(actors.stdout) as { subjects: readonly { id: string }[] })
        .subjects,
    ).toEqual([
      expect.objectContaining({ id: 'main#user' }),
    ])
  })

  it('seeds a slice from free text and renders the brief', () => {
    const result = runCli(['ask', 'workspace.yaml', 'todo'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Slice for "todo"')
    expect(result.stdout).toContain('Todo service')

    const narrow = runCli(
      ['ask', 'workspace.yaml', 'capturing', '--json'],
      workspace,
    )
    const payload = JSON.parse(narrow.stdout) as {
      mode: string
      addressing: string
      seeds: readonly string[]
      matched: number
    }
    expect(payload.mode).toBe('slice')
    expect(payload.addressing).toBe('free-text')
    expect(payload.seeds).toEqual(['main#user'])
    expect(payload.matched).toBe(1)
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('treats exact subject ids as precise addressing', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', 'main#user', '--json'],
      workspace,
    )
    const payload = JSON.parse(result.stdout) as {
      addressing: string
      seeds: readonly string[]
    }
    expect(payload.addressing).toBe('subjects')
    expect(payload.seeds).toEqual(['main#user'])
  })

  it('evaluates a projection file as precise addressing', () => {
    writeFileSync(
      join(workspace, 'services.projection.yaml'),
      `format: yarramate/projection/v1
id: services
version: "1.0"
query:
  subjects: [main#todo-service]
  relationships: connected
presentation:
  title: Services
`,
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', 'services.projection.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      addressing: string
      result: { projection: string }
    }
    expect(payload.addressing).toBe('projection')
    expect(payload.result.projection).toBe('services@1.0')
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('fails loudly when no concepts match, pointing at the roster', () => {
    const result = runCli(['ask', 'workspace.yaml', 'zebra'], workspace)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No concepts match "zebra"')
    expect(result.stderr).toContain('--subjects')
  })

  it('orders planned work across the whole workspace with --next', () => {
    const result = runCli(['ask', 'workspace.yaml', '--next'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'Planned subjects in workspace ask-fixture (dependency order):',
    )
    const ui = result.stdout.indexOf('main#todo-ui')
    const service = result.stdout.indexOf('main#todo-service')
    expect(service).toBeGreaterThan(ui)
    expect(result.stdout).toContain('no evidence')
  })

  it('reports the full open-questions report with --open', () => {
    const result = runCli(['ask', 'workspace.yaml', '--open'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Catalogue core-enrichment@')
    expect(result.stdout).toContain('OPEN')

    const json = runCli(['ask', 'workspace.yaml', '--open', '--json'], workspace)
    const payload = JSON.parse(json.stdout) as {
      mode: string
      report: { format: string; workspace: string }
    }
    expect(payload.mode).toBe('open')
    expect(payload.report.format).toBe('yarramate/interrogation-report/v1')
    expect(payload.report.workspace).toBe('ask-fixture')
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('compares architecture states with --compare', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--compare', 'main#baseline', 'main#target'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'States main#baseline -> main#target: 2 added, 0 removed, 3 retained',
    )
    expect(result.stdout).toContain('main#todo-ui')

    const missing = runCli(
      ['ask', 'workspace.yaml', '--compare', 'main#baseline', 'main#nope'],
      workspace,
    )
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain('does not exist')
  })

  it('composes slice, open questions, and drift with --advise', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--advise', 'todo'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Advise on: todo — workspace ask-fixture')
    expect(result.stdout).toContain('== Model slice ==')
    expect(result.stdout).toContain('Todo service')
    expect(result.stdout).toContain('== Open questions touching this slice ==')
    expect(result.stdout).toContain('outcome-missing')
    expect(result.stdout).toContain('== Evidence drift ==')
    expect(result.stdout).toContain('no evidence declared')

    const json = runCli(
      ['ask', 'workspace.yaml', '--advise', 'todo', '--json'],
      workspace,
    )
    const payload = JSON.parse(json.stdout) as {
      mode: string
      topic: string
      openQuestions: readonly { id: string }[]
    }
    expect(payload.mode).toBe('advice')
    expect(payload.topic).toBe('todo')
    expect(
      payload.openQuestions.some(({ id }) => id === 'outcome-missing'),
    ).toBe(true)
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('answers cleanly on the enriched repository self-model', () => {
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--json'],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      ok: boolean
      design: { open: number }
    }
    expect(payload.ok).toBe(true)
    expect(payload.design.open).toBe(0)
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(['ask', 'architecture/main.yaml'], workspace)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'ask requires an explicit workspace manifest',
    )
  })

  it('rejects contradictory option combinations with usage', () => {
    for (const args of [
      ['ask'],
      ['ask', 'workspace.yaml', '--next', 'todo'],
      ['ask', 'workspace.yaml', '--subjects', '--next'],
      ['ask', 'workspace.yaml', '--advise'],
      ['ask', 'workspace.yaml', 'todo', '--budget', '100', '--json'],
      ['ask', 'workspace.yaml', '--kind', 'actor'],
      ['ask', 'workspace.yaml', '--wave', 'motivation'],
    ]) {
      const result = runCli(args, workspace)
      expect(result.exitCode, args.join(' ')).toBe(2)
      expect(result.stderr, args.join(' ')).toContain('Usage:')
    }
  })
})
