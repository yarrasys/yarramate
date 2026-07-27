import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspace,
  loadAdapterMapping,
  validateAdapterMapping,
  validateAdapterMappings,
} from '../src/index.js'

const fixture = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`fixtures/${path}`, import.meta.url)),
    'utf8',
  )

describe('adapter mapping documents', () => {
  it('validates globally qualified native subjects through the public API', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadAdapterMapping({
      path: 'likec4.mapping.yaml',
      source: fixture('valid/likec4-adapter-mapping.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(validateAdapterMapping(compilation.graph, loaded.mapping)).toEqual({
      ok: true,
      mapping: {
        format: 'yarramate/adapter-mapping/v1',
        id: 'likec4-checkout',
        version: '1.0',
        adapter: 'likec4',
        mappings: [
          {
            native: 'checkout#api-realizes-approval',
            external: 'checkout.apiRealizesApproval',
            type: 'relationship',
          },
          {
            native: 'checkout#approval-api',
            external: 'checkout.approvalApi',
            type: 'concept',
          },
        ],
      },
    })
  })

  it('reports an unknown native subject at its authored location', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadAdapterMapping({
      path: 'invalid.mapping.yaml',
      source: fixture('invalid/adapter-mapping-unknown-subject.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(validateAdapterMapping(compilation.graph, loaded.mapping)).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM601',
          message: 'Native subject "checkout#missing" does not exist',
          path: 'invalid.mapping.yaml',
          pointer: '/mappings/0/native',
          line: 6,
          column: 13,
        },
      ],
    })
  })

  it('rejects mapping one native subject more than once', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadAdapterMapping({
      path: 'duplicate.mapping.yaml',
      source:
        'format: yarramate/adapter-mapping/v1\n' +
        'id: duplicate\n' +
        'version: "1.0"\n' +
        'adapter: likec4\n' +
        'mappings:\n' +
        '  - native: checkout#approval-api\n' +
        '    external: checkout.approvalApi\n' +
        '    type: concept\n' +
        '  - native: checkout#approval-api\n' +
        '    external: checkout.approvalApiAlias\n' +
        '    type: concept\n',
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const validation = validateAdapterMapping(
      compilation.graph,
      loaded.mapping,
    )
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM603',
      message:
        'Native subject "checkout#approval-api" is mapped more than once',
      path: 'duplicate.mapping.yaml',
      pointer: '/mappings/1/native',
      line: 9,
      column: 13,
    })
  })

  it('reports a native subject type mismatch at the type field', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadAdapterMapping({
      path: 'type.mapping.yaml',
      source:
        'format: yarramate/adapter-mapping/v1\n' +
        'id: wrong-type\n' +
        'version: "1.0"\n' +
        'adapter: likec4\n' +
        'mappings:\n' +
        '  - native: checkout#approval-api\n' +
        '    external: checkout.approvalApi\n' +
        '    type: relationship\n',
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(validateAdapterMapping(compilation.graph, loaded.mapping)).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM602',
          message:
            'Native subject "checkout#approval-api" is a concept, not a relationship',
          path: 'type.mapping.yaml',
          pointer: '/mappings/0/type',
          line: 8,
          column: 11,
        },
      ],
    })
  })

  it('rejects mapping two native subjects to one external identity', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadAdapterMapping({
      path: 'external-duplicate.mapping.yaml',
      source:
        'format: yarramate/adapter-mapping/v1\n' +
        'id: external-duplicate\n' +
        'version: "1.0"\n' +
        'adapter: likec4\n' +
        'mappings:\n' +
        '  - native: checkout#approval-api\n' +
        '    external: checkout.shared\n' +
        '    type: concept\n' +
        '  - native: checkout#approve-order\n' +
        '    external: checkout.shared\n' +
        '    type: concept\n',
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const validation = validateAdapterMapping(
      compilation.graph,
      loaded.mapping,
    )
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM604',
      message: 'External identity "checkout.shared" is mapped more than once',
      path: 'external-duplicate.mapping.yaml',
      pointer: '/mappings/1/external',
      line: 10,
      column: 15,
    })
  })

  it('links the canonical governed-change model to real LikeC4 concept identities', () => {
    const architecture = readFileSync(
      fileURLToPath(
        new URL(
          '../examples/governed-change/architecture.yaml',
          import.meta.url,
        ),
      ),
      'utf8',
    )
    const mappingSource = readFileSync(
      fileURLToPath(
        new URL(
          '../examples/governed-change/likec4.mapping.yaml',
          import.meta.url,
        ),
      ),
      'utf8',
    )
    const likec4Source = readFileSync(
      fileURLToPath(
        new URL('../examples/governed-change/model.likec4', import.meta.url),
      ),
      'utf8',
    )
    const compilation = compileWorkspace([
      { path: 'architecture.yaml', source: architecture },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadAdapterMapping({
      path: 'likec4.mapping.yaml',
      source: mappingSource,
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(validateAdapterMapping(compilation.graph, loaded.mapping).ok).toBe(
      true,
    )
    const declaredLikec4Concepts = new Set(
      [...likec4Source.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*) = /gm)].map(
        (match) => match[1],
      ),
    )
    expect(loaded.mapping.mappings).toHaveLength(29)
    expect(
      loaded.mapping.mappings.every(({ external }) =>
        declaredLikec4Concepts.has(external),
      ),
    ).toBe(true)
  })

  it('rejects duplicate versioned mapping identities across a workspace', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const first = loadAdapterMapping({
      path: 'first.mapping.yaml',
      source: fixture('valid/likec4-adapter-mapping.yaml'),
    })
    const second = loadAdapterMapping({
      path: 'second.mapping.yaml',
      source: fixture('valid/likec4-adapter-mapping.yaml'),
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const validation = validateAdapterMappings(compilation.graph, [
      first.mapping,
      second.mapping,
    ])
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM605',
      message: 'Adapter mapping "likec4-checkout@1.0" is declared more than once',
      path: 'second.mapping.yaml',
      pointer: '/id',
      line: 2,
      column: 5,
    })
  })

  it('enforces one-to-one identities across mappings for the same adapter', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const source = (id: string, external: string) =>
      'format: yarramate/adapter-mapping/v1\n' +
      `id: ${id}\n` +
      'version: "1.0"\n' +
      'adapter: likec4\n' +
      'mappings:\n' +
      '  - native: checkout#approval-api\n' +
      `    external: ${external}\n` +
      '    type: concept\n'
    const first = loadAdapterMapping({
      path: 'first.mapping.yaml',
      source: source('first', 'checkout.first'),
    })
    const second = loadAdapterMapping({
      path: 'second.mapping.yaml',
      source: source('second', 'checkout.second'),
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const validation = validateAdapterMappings(compilation.graph, [
      second.mapping,
      first.mapping,
    ])
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM603',
      message:
        'Native subject "checkout#approval-api" is mapped more than once for adapter "likec4"',
      path: 'second.mapping.yaml',
      pointer: '/mappings/0/native',
      line: 6,
      column: 13,
    })
  })
})
