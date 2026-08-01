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
    expect(graph.subjects.map(({ id }) => id)).toContain('main#todo-service')

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
    expect(index).toContain('[Todo service](main--todo-service.md)')
    expect(index).toContain('(planned)')
    const brief = readFileSync(
      join(workspace, 'handoff/main--todo-service.md'),
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
      readFileSync(join(workspace, 'handoff/main--todo-service.md'), 'utf8'),
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
})
