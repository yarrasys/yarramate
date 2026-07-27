import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { runGraphifyCli } from '../src/adapters/graphify-cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('YarraMate Graphify adapter CLI', () => {
  it('emits a standard evidence overlay from explicit Graphify node mappings', () => {
    const result = runGraphifyCli(
      [
        'observe',
        'test/fixtures/graphify/graph.json',
        'test/fixtures/graphify/subject-mapping.yaml',
        'test/fixtures/valid/minimal.yaml',
        '--id',
        'minimal-graphify',
        '--version',
        '1.0',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      format: 'yarramate/evidence/v1',
      id: 'minimal-graphify',
      version: '1.0',
      provider: 'graphify',
      observations: [
        {
          subject: 'checkout#approval-api',
          result: 'confirmed',
          evidence: {
            uri: 'graphify:checkout_node',
          },
        },
        {
          subject: 'checkout#approve-order',
          result: 'not-observed',
          evidence: {
            uri: 'graphify:missing_capability',
            message: 'Graphify node "missing_capability" was not observed',
          },
        },
      ],
    })
  })

  it('rejects a mapping owned by another adapter at its authored adapter', () => {
    const result = runGraphifyCli(
      [
        'observe',
        'test/fixtures/graphify/graph.json',
        'test/fixtures/valid/likec4-adapter-mapping.yaml',
        'test/fixtures/valid/minimal.yaml',
        '--id',
        'minimal-graphify',
        '--version',
        '1.0',
      ],
      repositoryRoot,
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      format: 'yarramate/diagnostic-result/v1',
      diagnostics: [
        {
          severity: 'error',
          code: 'YMG101',
          message:
            'Adapter mapping "likec4-checkout@1.0" belongs to "likec4", not "graphify"',
          path: 'test/fixtures/valid/likec4-adapter-mapping.yaml',
          pointer: '/adapter',
          line: 4,
          column: 10,
        },
      ],
    })
  })
})
