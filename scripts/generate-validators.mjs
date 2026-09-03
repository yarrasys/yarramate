#!/usr/bin/env node
// Compiles every JSON Schema this package validates against into a standalone
// validator module, so the runtime imports plain functions and never compiles
// anything.
//
// Ajv compiles a schema by generating source and calling `new Function`.
// Cloudflare's `workerd` permits code generation during module evaluation and
// FORBIDS it at request time, which is what made 1.15.2 unusable there: it
// deferred compilation to first use, and first use is inside a request. 1.15.3
// moved it back to import, where it is allowed, but that only avoids the
// forbidden context - the codegen still happens, and it costs startup CPU on a
// platform that budgets startup separately (400ms) and refuses a Worker that
// exceeds it.
//
// Precompiling removes the question rather than answering it: there is no
// compile step left to run in the wrong place. Ajv's COMPILER leaves the
// runtime graph; two pure helpers (a deep-equal and a UCS-2 length) are still
// imported from `ajv/dist/runtime`, and that is the honest claim - see
// `hoistRequires` below.
//
// Follows `generate-archimate-relationships.mjs`: `generate()` returns the
// module text and the file is committed, so `test/generated-validators.test.ts`
// keeps it honest by regenerating and comparing byte for byte. A schema edited
// without regenerating fails there rather than shipping a validator that
// checks the old shape.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import standaloneModule from 'ajv/dist/standalone/index.js'

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module
const standaloneCode = standaloneModule.default ?? standaloneModule

const root = new URL('..', import.meta.url)
// A `.ts` file, not `.js`: `tsconfig.build.json` compiles `src/**/*.ts`
// only, so a `.js` module here would never reach `dist/` and the published
// package would import a file that does not exist. `@ts-nocheck` in the
// header keeps generated code out of the typechecker's way, and `tsc` emits
// the declaration. Same shape as `archimate-relationships.generated.ts`.
// TWO modules, not one. Each standalone emission uses its own internal
// identifier namespace (`schema31`, `validate20`, ...), so concatenating two
// of them collides at the first shared name - the build catches it as
// "Identifier `schema31` has already been declared". They have to be separate
// because `discriminator` is an Ajv INSTANCE option and enabling it for the
// other nine would change how their `oneOf` branches compile.
const TARGET = new URL('src/schema-validators.generated.ts', root)
const TARGET_OPERATIONS = new URL(
  'src/schema-validators-operations.generated.ts',
  root,
)

/**
 * Every validator the runtime needs, as `exportName -> schema file`.
 *
 * `operations` sits apart because `discriminator` changes how a schema
 * compiles, so it cannot be emitted from an instance that does not set it -
 * the same reason it kept its own Ajv instance when these were compiled at
 * runtime.
 */
const SHARED = {
  validateDocument: 'yarramate-document',
  validateProfile: 'yarramate-profile',
  validatePattern: 'yarramate-pattern',
  validateWorkspace: 'yarramate-workspace',
  validateProjection: 'yarramate-projection',
  validateEvidence: 'yarramate-evidence',
  validateCoreContract: 'yarramate-core-contract',
  validateAdapterMapping: 'yarramate-adapter-mapping',
  validateCatalogue: 'yarramate-question-catalogue',
}
const DISCRIMINATED = { validateOperations: 'yarramate-operations' }

const schemaPath = (name) => new URL(`schema/${name}.schema.json`, root)
const readSchema = (name) => JSON.parse(readFileSync(schemaPath(name), 'utf8'))

const emit = (entries, options) => {
  const ajv = new Ajv2020({
    ...options,
    code: { source: true, esm: true },
  })
  // Keyed by export name so the emitted `export const` matches what
  // `schema-validation.ts` imports.
  const keys = {}
  for (const [exportName, file] of Object.entries(entries)) {
    ajv.addSchema(readSchema(file), exportName)
    keys[exportName] = exportName
  }
  return standaloneCode(ajv, keys)
}

/**
 * Ajv emits `require("ajv/dist/runtime/...")` for its two runtime helpers even
 * under `esm: true`, which will not load in an ES module and would leave the
 * generated file half CJS. They are hoisted to real static imports here.
 *
 * These two helpers are the ONLY thing the runtime still takes from `ajv`, and
 * both are pure functions - a deep-equal and a UCS-2 string length. The
 * COMPILER, which is the part that generates code, is no longer imported at
 * runtime at all. They are imported rather than vendored so they cannot drift
 * from the Ajv that emitted the validators calling them.
 */
const hoistRequires = (code) => {
  const imported = new Map()
  const rewritten = code.replace(
    /require\("(ajv\/dist\/runtime\/[a-zA-Z0-9_-]+)"\)\.default/g,
    (_match, specifier) => {
      const alias =
        imported.get(specifier) ??
        `ajvRuntime${imported.size}`
      imported.set(specifier, alias)
      return alias
    },
  )
  // The dual-export dance the rest of this package already does for Ajv
  // itself (#252). These helpers are CommonJS, and the two loaders disagree:
  // Node's ESM gives `module.exports` from a default import, so the helper is
  // at `.default`, while vite interop-normalises and puts it at the binding.
  // Hard-coding either one builds cleanly and then throws
  // `func2 is not a function` in the other - which is why this is checked by
  // RUNNING the package under both, not by reading the emitted text.
  const imports = [...imported].flatMap(([specifier, alias]) => [
    `import ${alias}Module from '${specifier}.js'`,
    `const ${alias} = ${alias}Module.default ?? ${alias}Module`,
  ])
  return { imports, rewritten }
}

export const generate = () => {
  // One hash over every schema that feeds the module, so the header says what
  // it was generated from and a reviewer can tell two regenerations apart.
  const hash = createHash('sha256')
  for (const file of Object.values(SHARED).sort()) {
    hash.update(readFileSync(schemaPath(file)))
  }
  const header = [
    '// @ts-nocheck',
    '// GENERATED by scripts/generate-validators.mjs from schema/*.schema.json.',
    '// Do not edit; run `pnpm generate:validators`.',
    '//',
    '// Standalone Ajv validators, so the runtime imports plain functions and',
    '// never generates code. Cloudflare workerd forbids code generation at',
    '// request time and budgets it at startup; there is no compile step here',
    '// to fall foul of either. Ajv\'s COMPILER is a build dependency of this',
    '// file and not a runtime one; the two pure helpers imported below are',
    '// all the runtime still takes from ajv.',
    '//',
    `// schema/ sha256: ${hash.digest('hex')}`,
    '',
  ].join('\n')
  const { imports, rewritten } = hoistRequires(emit(SHARED, { allErrors: true }))
  return [header, ...imports, '', rewritten, ''].join('\n')
}

/** The `discriminator` half, emitted from its own instance into its own module. */
export const generateOperations = () => {
  const hash = createHash('sha256')
    .update(readFileSync(schemaPath(DISCRIMINATED.validateOperations)))
    .digest('hex')
  const { imports, rewritten } = hoistRequires(
    emit(DISCRIMINATED, { allErrors: true, discriminator: true }),
  )
  return [
    [
      '// @ts-nocheck',
      '// GENERATED by scripts/generate-validators.mjs. Do not edit; run',
      '// `pnpm generate:validators`.',
      '//',
      "// The operations schema, emitted from an Ajv instance with `discriminator`",
      '// enabled and so compiled with it. Its own module because each standalone',
      '// emission owns its identifier namespace and two cannot share a file.',
      '//',
      `// schema sha256: ${hash}`,
      '',
    ].join('\n'),
    ...imports,
    '',
    rewritten,
    '',
  ].join('\n')
}

/**
 * The companion declaration. Emitted rather than hand-written so it cannot
 * fall out of step with the validators it describes: adding a schema above
 * updates both files in one run.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = generate()
  writeFileSync(TARGET, text)
  writeFileSync(TARGET_OPERATIONS, generateOperations())
  console.log(
    `wrote ${fileURLToPath(TARGET)} (${(text.length / 1024).toFixed(0)} kB, ` +
      `${Object.keys(SHARED).length + Object.keys(DISCRIMINATED).length} validators)`,
  )
}
