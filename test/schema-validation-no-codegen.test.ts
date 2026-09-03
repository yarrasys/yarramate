import AjvDraft7Module from 'ajv'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

/**
 * The package must never generate code: not at import, not at first use, not
 * ever.
 *
 * This assertion has now been wrong twice, in opposite directions, and the
 * history is the reason it is written the way it is.
 *
 * - 1.15.2 deferred Ajv compilation to first use to save startup CPU. Ajv
 *   compiles by calling `new Function`, and `workerd` permits code generation
 *   during module evaluation but FORBIDS it at request time, so every request
 *   that validated anything threw `EvalError`. The guard then in place
 *   asserted "zero compiles at import" and PASSED on that build, because
 *   zero-at-import is also what a correct precompiled build looks like.
 * - 1.15.3 moved compilation back to import and the guard became "after
 *   import, nothing compiles further". True, and still not the end: the
 *   codegen merely happened somewhere permitted, and it cost startup CPU on a
 *   platform that budgets it separately. An adopter's deploy measured 439ms
 *   against a 400ms line.
 *
 * 1.16.0 precompiles the validators at build time, so there is no compile step
 * left to put anywhere. That makes the property checkable in its strongest
 * form, and it is no longer a proxy for anything: count zero, everywhere.
 */
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const ajvModule = AjvDraft7Module as unknown as {
  default?: typeof AjvDraft7Module
} & typeof AjvDraft7Module
const AjvDraft7 = ajvModule.default ?? ajvModule

/**
 * The prototype that OWNS `compile`, found by walking up rather than assumed
 * to be `Ajv2020.prototype`. `Ajv2020` and the draft-07 `Ajv` are different
 * classes inheriting it from one base, so a spy on either class's own
 * prototype sees only the variant this package happens to use - measured, the
 * narrow patch point saw 0 of a draft-07 compile where this one sees it.
 */
const ownerOf = (constructor: { prototype: object }): object => {
  let proto: object | null = constructor.prototype
  while (proto !== null && !Object.hasOwn(proto, 'compile')) {
    proto = Object.getPrototypeOf(proto) as object | null
  }
  if (proto === null) throw new Error('no prototype in the chain owns compile')
  return proto
}

const compileOwner = (() => {
  const owner = ownerOf(Ajv2020)
  // One spy sees every variant only while the variants SHARE this prototype.
  // If an `ajv` upgrade splits them, a single patch point would quietly watch
  // half the package and this test would go on passing - which is this whole
  // episode's shape, one level down. Refuse to load instead.
  if (ownerOf(AjvDraft7) !== owner) {
    throw new Error(
      'Ajv2020 and the draft-07 Ajv no longer inherit `compile` from the same ' +
        'prototype, so one spy cannot see both. Patch each owner separately ' +
        'before trusting this test again.',
    )
  }
  return owner as { compile: (...args: unknown[]) => unknown }
})()

const MINIMAL = `format: yarramate/v1
id: minimal
profile: yarramate/core@0.1
concepts:
  - id: thing
    kind: applicationComponent
    name: Thing
relationships: []
`

describe('the package never generates code', () => {
  it('compiles no schema at import, and none while being used', async () => {
    const original = compileOwner.compile
    let compiles = 0
    compileOwner.compile = function patched(
      this: unknown,
      ...args: unknown[]
    ) {
      compiles += 1
      return original.apply(this, args)
    }
    try {
      const loaded = await import('../src/index.js')
      const atImport = compiles

      loaded.compileWorkspace([{ path: 'minimal.yaml', source: MINIMAL }])
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
        'Importing the package compiled a schema. Validators are precompiled ' +
          'by `pnpm generate:validators`; something is compiling at runtime ' +
          'again, which costs Cloudflare startup CPU.',
      ).toBe(0)
      expect(
        compiles,
        'Using the package compiled a schema. That call generates code, and ' +
          'Cloudflare workerd throws EvalError for code generation inside a ' +
          'request. Precompile it instead.',
      ).toBe(0)
    } finally {
      compileOwner.compile = original
    }
  })

  it('still actually validates, so zero is not the count of a package that checks nothing', async () => {
    // The other half, and the half that makes the first assertion mean
    // something: deleting every validator would also compile nothing.
    // CONTRIBUTING's second rule - the honest question is not "is the count
    // zero" but "was anything asked".
    const { compileWorkspace } = await import('../src/index.js')

    const unknownKind = compileWorkspace([
      {
        path: 'bad.yaml',
        source: MINIMAL.replace('applicationComponent', 'notAKind'),
      },
    ])
    expect(unknownKind.ok).toBe(false)
    if (!unknownKind.ok) {
      expect(unknownKind.diagnostics[0]?.code).toBe('YM401')
    }

    const notAMapping = compileWorkspace([
      { path: 'empty.yaml', source: '# parked\n' },
    ])
    expect(notAMapping.ok).toBe(false)
    if (!notAMapping.ok) {
      // Straight from the precompiled document schema.
      expect(notAMapping.diagnostics[0]?.code).toBe('YM201')
    }

    expect(
      compileWorkspace([{ path: 'good.yaml', source: MINIMAL }]).ok,
    ).toBe(true)
  })
})
