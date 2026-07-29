import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

describe('yarramate new projection', () => {
  it('scaffolds a validated projection that context can evaluate directly', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-new-'))
    try {
      const target = join(directory, 'slice.yaml')
      const created = runCli(
        [
          'new',
          'projection',
          target,
          '--id',
          'checkout-slice',
          '--title',
          'Checkout slice',
          '--subject',
          'checkout#approval-api',
          '--relationships',
          'connected',
        ],
        repositoryRoot,
      )

      expect(created.exitCode).toBe(0)
      expect(created.stdout).toContain('Created')
      expect(created.stdout).toContain('checkout-slice@1.0')
      expect(readFileSync(target, 'utf8')).toContain(
        'format: yarramate/projection/v1',
      )

      const evaluated = runCli(
        ['context', target, 'test/fixtures/valid/minimal.yaml'],
        repositoryRoot,
      )
      expect(evaluated.exitCode).toBe(0)
      expect(JSON.parse(evaluated.stdout)).toMatchObject({
        projection: 'checkout-slice@1.0',
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite an existing file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-new-'))
    try {
      const target = join(directory, 'slice.yaml')
      const args = [
        'new',
        'projection',
        target,
        '--id',
        'slice',
        '--document',
        'checkout',
      ]
      expect(runCli(args, repositoryRoot).exitCode).toBe(0)
      const second = runCli(args, repositoryRoot)
      expect(second.exitCode).toBe(2)
      expect(second.stderr).toContain('already exists; nothing was changed')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires at least one selector', () => {
    const result = runCli(
      ['new', 'projection', 'unused.yaml', '--id', 'slice'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('at least one selector')
  })

  it('rejects a composed projection that fails validation before writing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-new-'))
    try {
      const target = join(directory, 'slice.yaml')
      const result = runCli(
        [
          'new',
          'projection',
          target,
          '--id',
          'Bad Id',
          '--document',
          'checkout',
        ],
        repositoryRoot,
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('YM201')
      expect(() => readFileSync(target, 'utf8')).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects unknown families and missing ids with usage', () => {
    expect(
      runCli(['new', 'evidence', 'x.yaml', '--id', 'x'], repositoryRoot)
        .exitCode,
    ).toBe(2)
    expect(
      runCli(
        ['new', 'projection', 'x.yaml', '--document', 'checkout'],
        repositoryRoot,
      ).exitCode,
    ).toBe(2)
  })
})
