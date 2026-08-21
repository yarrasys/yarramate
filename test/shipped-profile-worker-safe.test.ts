import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const forbiddenBuiltin = (module: string) => () => {
  throw new Error(`forbidden Node builtin: ${module}`)
}

describe('shipped policy compiler entrypoint', () => {
  it('loads and resolves the shipped policy without filesystem, path, or URL modules', async () => {
    vi.resetModules()
    vi.doMock('node:fs', forbiddenBuiltin('node:fs'))
    vi.doMock('node:path', forbiddenBuiltin('node:path'))
    vi.doMock('node:url', forbiddenBuiltin('node:url'))

    try {
      // The compiler must be imported after its forbidden builtins are mocked.
      const { compileWorkspaceWithProfileContext } = await import('../src/compiler.js')
      const result = compileWorkspaceWithProfileContext([
        {
          path: 'policy.yaml',
          source: `format: yarramate/v1
id: policy
profile: yarramate/policy@0.1
concepts:
  - id: oauth
    kind: authentication-constraint
    name: OAuth
relationships: []
`,
        },
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.graph.profiles).toEqual([
        'yarramate/core@0.1',
        'yarramate/policy@0.1',
      ])
    } finally {
      vi.doUnmock('node:fs')
      vi.doUnmock('node:path')
      vi.doUnmock('node:url')
      vi.resetModules()
    }
  })

  it('keeps the static shipped policy byte-for-byte equal to its canonical YAML', async () => {
    const canonical = await readFile(
      new URL('../profiles/yarramate-policy.yaml', import.meta.url),
      'utf8',
    )
    // This import follows the mock-resetting test so it can read the real export.
    const { shippedPolicyIdentity, shippedPolicySource } = await import('../src/shipped-profile.js')

    expect(shippedPolicyIdentity).toBe('yarramate/policy@0.1')
    expect(shippedPolicySource).toBe(canonical)
  })
})
