import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const statusSchema = JSON.parse(
  JSON.stringify(
    await import('../schema/yarramate-status-result.schema.json', {
      with: { type: 'json' },
    }).then((module) => module.default),
  ),
) as object

describe('YarraMate status command', () => {
  it('reports one orientation summary for the repository workspace', () => {
    const result = runCli(
      ['status', '.yarramate/workspace.yaml', '--json'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as {
      format: string
      workspace: string
      ok: boolean
      check: { ok: boolean; counted?: { concepts: number } }
      reconciliation?: { observations: number; confirmed: number }
      inventory: {
        documents: readonly { id: string; path: string }[]
        states: readonly { id: string; type: string }[]
        projections: readonly { id: string; title?: string }[]
      }
    }
    expect(payload.format).toBe('yarramate/status-result/v1')
    expect(payload.workspace).toBe('yarramate')
    expect(payload.ok).toBe(true)
    expect(payload.check.ok).toBe(true)
    expect(payload.check.counted!.concepts).toBeGreaterThan(0)
    expect(payload.reconciliation!.observations).toBeGreaterThan(0)
    expect(
      payload.inventory.documents.map(({ id }) => id),
    ).toContain('yarramate-product')
    expect(payload.inventory.states.length).toBeGreaterThan(0)
    const productContext = payload.inventory.projections.find(
      ({ id }) => id === 'product-context',
    )
    expect(productContext?.title).toBe('Product context')

    const validate = new Ajv2020({ allErrors: true }).compile(statusSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('renders a human summary by default', () => {
    const result = runCli(
      ['status', '.yarramate/workspace.yaml'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Workspace yarramate: check ok')
    expect(result.stdout).toContain('Reconciliation:')
    expect(result.stdout).toContain('Projections:')
  })

  it('fails with the check verdict when the workspace does not compile', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-status-'))
    try {
      mkdirSync(join(parent, 'architecture'))
      writeFileSync(
        join(parent, 'workspace.yaml'),
        'format: yarramate/workspace/v1\nid: broken\ndocuments:\n  - architecture/*.yaml\nprofiles: []\nprojections: []\nadapterMappings: []\n',
      )
      writeFileSync(
        join(parent, 'architecture', 'broken.yaml'),
        'format: yarramate/v1\nid: broken-doc\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: unknownKind\n    name: A\n',
      )

      const result = runCli(['status', 'workspace.yaml', '--json'], parent)

      expect(result.exitCode).toBe(1)
      const payload = JSON.parse(result.stdout) as {
        ok: boolean
        check: { ok: boolean; diagnostics: readonly { code: string }[] }
      }
      expect(payload.ok).toBe(false)
      expect(payload.check.ok).toBe(false)
      expect(payload.check.diagnostics.length).toBeGreaterThan(0)
      for (const { code } of payload.check.diagnostics) {
        expect(code).toMatch(/^YM[0-9]{3}$/)
      }
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects sources that are not a workspace manifest', () => {
    const result = runCli(
      ['status', '.yarramate/architecture/product.yaml'],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'status requires an explicit workspace manifest',
    )
  })

  it('rejects missing or flag-like arguments with usage', () => {
    expect(runCli(['status'], repositoryRoot).exitCode).toBe(2)
    expect(
      runCli(['status', '--json'], repositoryRoot).exitCode,
    ).toBe(2)
  })
})
