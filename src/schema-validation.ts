import type { ValidateFunction } from 'ajv'

/**
 * Defers compiling a JSON Schema until something actually validates against
 * it, then reuses the compiled validator forever.
 *
 * Ten validators used to be constructed and compiled at MODULE SCOPE, so
 * importing the package paid for every one of them whether or not a caller
 * ever validated anything. Measured on the published 1.15.1 dist: ten
 * `Ajv.compile` calls costing **123.7ms, 80% of the barrel's entire import
 * time**, and one more on the `yarramate/interrogation` subpath, which is the
 * entry we tell Workers consumers to prefer. That is not an abstract cost:
 * Cloudflare Workers budget STARTUP CPU separately from request CPU and refuse
 * a Worker that exceeds it, so an adopter's deploy was rejected outright
 * (error 10021) by work no request had asked for.
 *
 * Deferring moves that cost to first use, where the budget is seconds rather
 * than milliseconds, and a caller pays only for the schemas it actually
 * touches - a consumer that compiles a workspace no longer pays for the
 * evidence, adapter-mapping and core-contract validators it never calls.
 *
 * The accessor is a function rather than a getter so the deferral is visible
 * at every call site: `validateDocument()(value)` reads as "get the validator,
 * then use it", and `validateDocument().errors` cannot accidentally be read
 * off a validator that was never run. Ajv attaches `errors` to the validator
 * itself, so the two must come from the same object.
 *
 * `test/schema-validation-laziness.test.ts` asserts that importing the package
 * compiles NOTHING, and fails on the next module-scope validator anyone adds.
 */
export const lazyValidator = <T = unknown>(
  compile: () => ValidateFunction<T>,
): (() => ValidateFunction<T>) => {
  let compiled: ValidateFunction<T> | undefined
  return () => (compiled ??= compile())
}
