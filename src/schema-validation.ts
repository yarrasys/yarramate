import Ajv2020Module from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'

// The published dual-export dance every other module here does; see the
// comment in `compiler.ts` for why (#252).
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module

/**
 * Compiles a JSON Schema AT MODULE SCOPE, on an instance shared with every
 * other schema that wants the same options.
 *
 * **Compilation must happen at import, and this is not a preference.** Ajv
 * compiles a schema by generating source and calling `new Function`.
 * Cloudflare's `workerd` permits code generation during module evaluation and
 * FORBIDS it at request time - measured on the real runtime binary:
 *
 * ```
 * {"atStartup":"ALLOWED",
 *  "atRequest":"EvalError: Code generation from strings disallowed for this context"}
 * ```
 *
 * 1.15.2 deferred these compiles to first use to keep startup CPU down, which
 * moved them into the one context that cannot run them: every request that
 * validated anything threw. The startup budget was real, but a package that
 * cannot serve a request is not a fix for it. Deferral is therefore not an
 * option here, and `test/schema-validation-eagerness.test.ts` asserts the
 * opposite of what its predecessor did - that importing the package compiles
 * every validator, so no request has to.
 *
 * The cost is paid down by SHARING one Ajv instance rather than building ten.
 * Each instance compiles the 2020-12 meta-schema again, and that dominates:
 * ten instances cost 81.6ms against 35.0ms for one, a 57% reduction with no
 * change to when anything runs. Sharing is safe here because no schema
 * registers formats and all 39 ship distinct `$id`s, so nothing collides.
 *
 * The real ceiling-lifter is precompiled standalone validators (Ajv's
 * `code: { source: true }`), which remove Ajv from the runtime altogether and
 * satisfy both constraints at once. This is the shape that is correct today.
 */
const sharedAjv = new Ajv2020({ allErrors: true })

/** Compiles on the shared `allErrors` instance. */
export const compileValidator = <T = unknown>(
  schema: object,
): ValidateFunction<T> => sharedAjv.compile<T>(schema)

/**
 * For a schema needing options the shared instance does not carry. Only
 * `apply-command` uses it: `discriminator` changes how a schema compiles, so
 * it cannot ride on an instance that does not set it.
 */
export const compileValidatorWith = <T = unknown>(
  options: ConstructorParameters<typeof Ajv2020>[0],
  schema: object,
): ValidateFunction<T> => new Ajv2020(options).compile<T>(schema)
