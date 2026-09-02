import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

/**
 * Importing this package must compile NO JSON Schemas.
 *
 * Ten validators were constructed and compiled at module scope, so an import
 * paid for every one whether or not the caller validated anything. On the
 * published 1.15.1 dist that was ten `Ajv.compile` calls costing 123.7ms,
 * **80% of the barrel's entire import time**, plus one more on the
 * `yarramate/interrogation` subpath - the entry the consumer guide tells
 * Workers users to prefer.
 *
 * That is not a tidiness concern. Cloudflare Workers budget STARTUP CPU
 * separately from request CPU (400ms against 30s) and refuse a Worker that
 * exceeds it, so an adopter's production deploy was rejected outright with
 * error 10021 by work no request had asked for. The package still deployed at
 * 1.15.0 with 569ms of startup, which is how close to the edge this had been
 * sitting.
 *
 * This is `test/export-purity.test.ts`'s idea applied to TIME rather than to
 * dependencies. That test reads the import graph statically and cannot see a
 * module-scope side effect; this one runs the import and watches. The two
 * together are what keep the package importable in a constrained runtime, and
 * this one fails on the next module-scope validator anyone adds.
 */
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module

const countingCompiles = async (
  entry: string,
): Promise<{ atImport: number; afterFirstUse: number }> => {
  const original = Ajv2020.prototype.compile
  let compiles = 0
  // Patched on the prototype rather than by wrapping an instance, because the
  // point is to catch a validator built by code this test never names.
  Ajv2020.prototype.compile = function patched(
    this: unknown,
    ...args: unknown[]
  ) {
    compiles += 1
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof Ajv2020.prototype.compile
  try {
    const loaded = (await import(entry)) as Record<string, unknown>
    const atImport = compiles
    // A cache-busting query would defeat the module registry, so first use is
    // measured on this same instance: whatever it compiles now is what an
    // import was paying for before.
    const compileWorkspace = loaded.compileWorkspace as
      | ((sources: readonly { path: string; source: string }[]) => unknown)
      | undefined
    if (compileWorkspace !== undefined) {
      compileWorkspace([
        {
          path: 'minimal.yaml',
          source: `format: yarramate/v1
id: minimal
profile: yarramate/core@0.1
concepts:
  - id: thing
    kind: applicationComponent
    name: Thing
relationships: []
`,
        },
      ])
    }
    return { atImport, afterFirstUse: compiles }
  } finally {
    Ajv2020.prototype.compile = original
  }
}

describe('schema validation is deferred until first use', () => {
  it('compiles no schemas when the package barrel is imported', async () => {
    const { atImport, afterFirstUse } = await countingCompiles('../src/index.js')

    expect(
      atImport,
      'Importing the barrel compiled a JSON Schema. A validator was built at ' +
        'module scope; wrap it in `lazyValidator` from src/schema-validation.ts.',
    ).toBe(0)
    // The other half of the claim, and the half that makes the first
    // assertion mean something. Without it, deleting every validator would
    // pass: zero compiles at import is also what a package that validates
    // nothing looks like (CONTRIBUTING's second rule).
    expect(
      afterFirstUse,
      'Compiling a workspace should build the validators it needs.',
    ).toBeGreaterThan(0)
  })

  it('compiles no schemas when the interrogation subpath is imported', async () => {
    // The entry `docs/CONSUMING-YARRAMATE.md` points Workers consumers at,
    // and it was paying for the catalogue validator on every import.
    const { atImport } = await countingCompiles('../src/interrogation-entry.js')

    expect(atImport).toBe(0)
  })
})
