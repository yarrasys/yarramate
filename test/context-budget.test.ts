import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

const contextArgs = (budget?: string) => [
  'context',
  'test/fixtures/valid/current-capabilities.projection.yaml',
  'test/fixtures/valid/lifecycle-status.yaml',
  ...(budget === undefined ? [] : ['--budget', budget]),
]

describe('budgeted context rendering', () => {
  it('renders the compact ladder within a generous budget', () => {
    const result = runCli(contextArgs('4000'), repositoryRoot)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('context current-capabilities@1.0')
    expect(result.stdout).toContain('subjects: ')
    expect(result.stdout).not.toContain('"format"')
    expect(result.stdout).not.toContain('omitted')
  })

  it('announces every omission under a tiny budget instead of truncating silently', () => {
    const result = runCli(contextArgs('30'), repositoryRoot)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[budget 30:')
    expect(result.stdout).toContain('omitted')
    expect(result.stdout).toContain('raise --budget')
  })

  it('keeps output within roughly the requested budget', () => {
    const result = runCli(contextArgs('100'), repositoryRoot)

    expect(result.exitCode).toBe(0)
    expect(Math.ceil(result.stdout.length / 4)).toBeLessThanOrEqual(160)
  })

  it('is deterministic across invocations', () => {
    const first = runCli(contextArgs('200'), repositoryRoot)
    const second = runCli(contextArgs('200'), repositoryRoot)

    expect(second).toEqual(first)
  })

  it('leaves JSON output untouched when no budget is given', () => {
    const result = runCli(contextArgs(), repositoryRoot)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: 'yarramate/projection-result/v1',
    })
  })

  it('rejects non-positive or malformed budgets', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      const result = runCli(contextArgs(bad), repositoryRoot)
      expect(result.exitCode, bad).toBe(2)
      expect(result.stderr).toContain('Usage:')
    }
  })

  it('supports --budget on ad-hoc subject context', () => {
    const result = runCli(
      [
        'context',
        '--subject',
        'checkout#approval-api',
        'test/fixtures/valid/minimal.yaml',
        '--budget',
        '300',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('context ad-hoc-context@0.0')
    expect(result.stdout).toContain('-realization->')
  })
})
