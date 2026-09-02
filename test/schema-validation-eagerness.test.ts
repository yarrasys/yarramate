import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

/**
 * Every JSON Schema must be compiled BY THE TIME THE IMPORT FINISHES, so that
 * no request ever has to compile one.
 *
 * This test asserts the exact opposite of the one it replaces, and the reason
 * is worth keeping. Ajv compiles a schema by generating source and calling
 * `new Function`. Cloudflare's `workerd` permits code generation during module
 * evaluation and FORBIDS it at request time. Measured on the runtime binary:
 *
 * ```
 * {"atStartup":"ALLOWED",
 *  "atRequest":"EvalError: Code generation from strings disallowed for this context"}
 * ```
 *
 * 1.15.2 deferred compilation to first use to cut startup CPU, which moved it
 * into the one context that cannot run it. Every request that validated
 * anything threw `EvalError`, across 143 of an adopter's integration tests.
 *
 * The predecessor test asserted "zero compiles at import" and passed on that
 * broken build, because zero-at-import is ALSO what a correct precompiled
 * build looks like. It even carried a second assertion against the
 * validates-nothing trap. Both were true and the package was still unusable:
 * the property under test was necessary and not sufficient, and no test that
 * runs only in Node can see the difference, because Node permits code
 * generation everywhere and cannot fail the way workerd does.
 *
 * So this checks the property that DOES discriminate, and can be checked
 * anywhere: after import, exercising the package compiles nothing further.
 * A validator built lazily fails here on the first call that needs it.
 */
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module

const MINIMAL = `format: yarramate/v1
id: minimal
profile: yarramate/core@0.1
concepts:
  - id: thing
    kind: applicationComponent
    name: Thing
relationships: []
`

let compiledAtImport = 0
let instances = 0

describe('schema validators are compiled at import, never at request time', () => {
  it('compiles nothing further once the package has been imported', async () => {
    const original = Ajv2020.prototype.compile
    const originalDefault = ajv2020Module.default
    let compiles = 0
    // Counting CONSTRUCTIONS as well as compiles, so the second test can ask
    // whether the instances were shared. Patched before the dynamic import
    // below, which is the first time this file's module graph loads Ajv.
    class Counting extends (Ajv2020 as unknown as {
      new (...a: unknown[]): Record<string, unknown>
    }) {
      constructor(...args: unknown[]) {
        super(...args)
        instances += 1
      }
    }
    ajv2020Module.default = Counting as unknown as typeof Ajv2020
    Ajv2020.prototype.compile = function patched(
      this: unknown,
      ...args: unknown[]
    ) {
      compiles += 1
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    } as typeof Ajv2020.prototype.compile
    try {
      const loaded = await import('../src/index.js')
      const atImport = compiles
      compiledAtImport = compiles

      // Every published entry point that validates something, exercised in the
      // order a host would: compile, then apply. `workerd` would refuse each
      // of these if it were the one doing the compiling.
      loaded.compileWorkspace([{ path: 'minimal.yaml', source: MINIMAL }])
      loaded.compileWorkspace([{ path: 'again.yaml', source: MINIMAL }])
      loaded.applyOperations({
        workspace: {
          id: 'minimal',
          documents: ['minimal.yaml'],
          profiles: [],
          patterns: [],
          projections: [],
          adapterMappings: [],
          evidence: [],
          contracts: [],
        },
        sources: [{ path: 'minimal.yaml', source: MINIMAL }],
        operations: {
          path: 'ops.json',
          source: JSON.stringify({
            format: 'yarramate/operations/v1',
            operations: [
              {
                op: 'update-concept',
                document: 'minimal.yaml',
                concept: { id: 'thing', description: 'touched' },
              },
            ],
          }),
        },
        manifestDirectory: '',
      })

      expect(
        atImport,
        'Importing the package compiled no schemas, which means they are ' +
          'being compiled later. Cloudflare workerd forbids code generation ' +
          'at request time, so a deferred validator throws there.',
      ).toBeGreaterThan(0)
      expect(
        compiles - atImport,
        'Using the package compiled a schema that the import did not. That ' +
          'validator is built lazily and will throw EvalError inside a ' +
          'Cloudflare Worker request. Compile it at module scope via ' +
          '`compileValidator` in src/schema-validation.ts.',
      ).toBe(0)
    } finally {
      Ajv2020.prototype.compile = original
      ajv2020Module.default = originalDefault
    }
  })

  it('shares one Ajv instance across the schemas that take the same options', () => {
    // Ten instances each recompile the 2020-12 meta-schema, and that is what
    // made eager compilation expensive enough that 1.15.2 reached for
    // laziness: 81.6ms for ten against 35.0ms for one. Sharing is what makes
    // compiling at import affordable, so it is pinned rather than left to
    // drift back.
    //
    // Asserted as a RELATIONSHIP rather than a count, because a count would
    // pin today's number of schemas and break on the next one. With an
    // instance per schema the two are equal; with sharing, instances are far
    // fewer than compiles.
    expect(instances).toBeGreaterThan(0)
    expect(
      instances,
      `Compiled ${compiledAtImport} schemas across ${instances} Ajv ` +
        `instances. Each instance recompiles the 2020-12 meta-schema, so ` +
        `one per schema is the expensive shape; share via ` +
        `\`compileValidator\` in src/schema-validation.ts.`,
    ).toBeLessThan(compiledAtImport)
  })
})
