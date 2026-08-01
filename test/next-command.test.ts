import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

// The build-ordering core (buildNextSubjects) survives the 0.7.0 clean
// break behind `ask --next`; these tests pin its ordering, coverage, and
// cycle semantics through that surface.
const document =
  'format: yarramate/v1\n' +
  'id: main\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: session-adapter\n' +
  '    kind: applicationService\n' +
  '    name: Session adapter\n' +
  '    status: planned\n' +
  '  - id: query-service\n' +
  '    kind: applicationService\n' +
  '    name: Query service\n' +
  '    status: planned\n' +
  '  - id: panel\n' +
  '    kind: applicationService\n' +
  '    name: Control panel\n' +
  '    status: planned\n' +
  '  - id: git-adapter\n' +
  '    kind: applicationService\n' +
  '    name: Git adapter\n' +
  '    status: planned\n' +
  '  - id: platform\n' +
  '    kind: applicationService\n' +
  '    name: Existing platform\n' +
  '    status: current\n' +
  'relationships:\n' +
  '  - id: adapter-serves-query\n' +
  '    kind: serving\n' +
  '    from: session-adapter\n' +
  '    to: query-service\n' +
  '  - id: adapter-serves-panel\n' +
  '    kind: serving\n' +
  '    from: session-adapter\n' +
  '    to: panel\n' +
  '  - id: query-serves-panel\n' +
  '    kind: serving\n' +
  '    from: query-service\n' +
  '    to: panel\n' +
  '  - id: panel-serves-platform\n' +
  '    kind: serving\n' +
  '    from: panel\n' +
  '    to: platform\n' +
  '  - id: panel-associates-git\n' +
  '    kind: association\n' +
  '    from: panel\n' +
  '    to: git-adapter\n'

const manifest = (evidence: readonly string[]) =>
  'format: yarramate/workspace/v1\n' +
  'id: next-fixture\n' +
  'documents:\n' +
  '  - architecture/main.yaml\n' +
  'profiles: []\n' +
  'projections: []\n' +
  'adapterMappings: []\n' +
  (evidence.length === 0
    ? 'evidence: []\n'
    : `evidence:\n${evidence.map((path) => `  - ${path}`).join('\n')}\n`)

const evidence =
  'format: yarramate/evidence/v1\n' +
  'id: repository-scan\n' +
  'version: "1.0"\n' +
  'provider: import-audit\n' +
  'observations:\n' +
  '  - subject: main#session-adapter\n' +
  '    result: confirmed\n' +
  '    evidence:\n' +
  '      uri: repo:src/session-adapter.ts\n' +
  '  - claim: main#adapter-serves-query\n' +
  '    result: contradicted\n' +
  '    evidence:\n' +
  '      uri: repo:src/query-service.ts\n' +
  '      message: no import of the session adapter\n'

describe('ask --next build ordering', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-next-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('orders planned subjects prerequisites-first with evidence coverage', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(join(workspace, 'scan.evidence.yaml'), evidence, 'utf8')

    const result = runCli(['ask', 'workspace.yaml', '--next'], workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const lines = result.stdout.split('\n')
    expect(lines[0]).toBe(
      'Planned subjects in workspace next-fixture (dependency order):',
    )
    const order = lines
      .slice(1)
      .map((line) => line.trim().split(/\s{2,}/)[0])
      .filter((id) => id !== undefined && id !== '')
    expect(order).toEqual([
      'main#git-adapter',
      'main#session-adapter',
      'main#query-service',
      'main#panel',
    ])
    expect(result.stdout).toContain(
      '<- required by main#panel, main#query-service; 2 observations (1 confirmed, 1 contradicted)',
    )
    expect(result.stdout).toMatch(/main#git-adapter\s+no evidence/)
    expect(result.stdout).not.toContain('main#platform')
  })

  it('emits a schema-valid machine report', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(join(workspace, 'scan.evidence.yaml'), evidence, 'utf8')

    const result = runCli(
      ['ask', 'workspace.yaml', '--next', '--json'],
      workspace,
    )

    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      format: string
      workspace: string
      mode: string
      subjects: readonly {
        id: string
        dependsOn: readonly string[]
        requiredBy: readonly string[]
        evidence: { observations: number; contradicted: number }
        cycle?: true
      }[]
    }
    expect(payload.format).toBe('yarramate/ask-result/v1')
    expect(payload.workspace).toBe('next-fixture')
    expect(payload.mode).toBe('next')
    expect(payload.subjects.map(({ id }) => id)).toEqual([
      'main#git-adapter',
      'main#session-adapter',
      'main#query-service',
      'main#panel',
    ])
    const panel = payload.subjects.find(({ id }) => id === 'main#panel')!
    expect(panel.dependsOn).toEqual([
      'main#query-service',
      'main#session-adapter',
    ])
    expect(panel.requiredBy).toEqual([])
    const adapter = payload.subjects.find(
      ({ id }) => id === 'main#session-adapter',
    )!
    expect(adapter.requiredBy).toEqual(['main#panel', 'main#query-service'])
    expect(adapter.evidence).toMatchObject({
      observations: 2,
      confirmed: 1,
      contradicted: 1,
    })
    const queryService = payload.subjects.find(
      ({ id }) => id === 'main#query-service',
    )!
    expect(queryService.evidence).toMatchObject({
      observations: 1,
      contradicted: 1,
    })
  })

  it('reports an empty workspace when nothing is planned', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      document.replaceAll('status: planned', 'status: current'),
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest([]), 'utf8')

    const result = runCli(['ask', 'workspace.yaml', '--next'], workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'No planned subjects in workspace next-fixture.\n',
    )
  })

  it('appends dependency cycles sorted and marked', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: alpha\n' +
        '    kind: applicationService\n' +
        '    name: Alpha\n' +
        '    status: planned\n' +
        '  - id: beta\n' +
        '    kind: applicationService\n' +
        '    name: Beta\n' +
        '    status: planned\n' +
        'relationships:\n' +
        '  - id: alpha-serves-beta\n' +
        '    kind: serving\n' +
        '    from: alpha\n' +
        '    to: beta\n' +
        '  - id: beta-serves-alpha\n' +
        '    kind: serving\n' +
        '    from: beta\n' +
        '    to: alpha\n',
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest([]), 'utf8')

    const result = runCli(
      ['ask', 'workspace.yaml', '--next', '--json'],
      workspace,
    )

    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      subjects: readonly { id: string; cycle?: true }[]
    }
    expect(payload.subjects.map(({ id }) => id)).toEqual([
      'main#alpha',
      'main#beta',
    ])
    expect(payload.subjects.every(({ cycle }) => cycle === true)).toBe(true)

    const human = runCli(['ask', 'workspace.yaml', '--next'], workspace)
    expect(human.stdout).toContain('dependency cycle')
  })
})
