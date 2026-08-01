import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

// The budgeted digest ladder survives the clean break behind the ask
// slice's --budget mode; same fixtures, same guarantees.
describe('budgeted slice rendering', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-budget-'))
    mkdirSync(join(workspace, 'architecture'))
    for (const [source, target] of [
      ['test/fixtures/valid/lifecycle-status.yaml', 'architecture/lifecycle.yaml'],
      ['test/fixtures/valid/minimal.yaml', 'architecture/minimal.yaml'],
      [
        'test/fixtures/valid/current-capabilities.projection.yaml',
        'capabilities.projection.yaml',
      ],
    ] as const) {
      copyFileSync(join(repositoryRoot, source), join(workspace, target))
    }
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: budget-fixture\n' +
        'documents:\n' +
        '  - architecture/lifecycle.yaml\n' +
        'profiles: []\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'minimal-workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: minimal-fixture\n' +
        'documents:\n' +
        '  - architecture/minimal.yaml\n' +
        'profiles: []\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  const askArgs = (budget?: string) => [
    'ask',
    'workspace.yaml',
    'capabilities.projection.yaml',
    ...(budget === undefined ? [] : ['--budget', budget]),
  ]

  it('renders the compact ladder within a generous budget', () => {
    const result = runCli(askArgs('4000'), workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('context current-capabilities@1.0')
    expect(result.stdout).toContain('subjects: ')
    expect(result.stdout).not.toContain('"format"')
    expect(result.stdout).not.toContain('omitted')
  })

  it('announces every omission under a tiny budget instead of truncating silently', () => {
    const result = runCli(askArgs('30'), workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[budget 30:')
    expect(result.stdout).toContain('omitted')
    expect(result.stdout).toContain('raise --budget')
  })

  it('keeps output within roughly the requested budget', () => {
    const result = runCli(askArgs('100'), workspace)

    expect(result.exitCode).toBe(0)
    expect(Math.ceil(result.stdout.length / 4)).toBeLessThanOrEqual(160)
  })

  it('is deterministic across invocations', () => {
    const first = runCli(askArgs('200'), workspace)
    const second = runCli(askArgs('200'), workspace)

    expect(second).toEqual(first)
  })

  it('leaves the JSON envelope untouched when no budget is given', () => {
    const result = runCli([...askArgs(), '--json'], workspace)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: 'yarramate/ask-result/v1',
      mode: 'slice',
      result: { format: 'yarramate/projection-result/v1' },
    })
  })

  it('rejects non-positive or malformed budgets', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      const result = runCli(askArgs(bad), workspace)
      expect(result.exitCode, bad).toBe(2)
      expect(result.stderr).toContain('Usage:')
    }
  })

  it('supports --budget on a subject slice', () => {
    const result = runCli(
      [
        'ask',
        'minimal-workspace.yaml',
        'checkout#approval-api',
        '--budget',
        '300',
      ],
      workspace,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('context ask-slice@0.0')
    expect(result.stdout).toContain('-realization->')
  })
})
