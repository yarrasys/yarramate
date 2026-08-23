/**
 * What a view nests, kept in a module that imports nothing.
 *
 * These live apart from `projection.ts` because the browser needs the value,
 * not only the type, and `projection.ts` reaches for `node:module` to load
 * Ajv. A value import of it from `src/visual-app` therefore pulls
 * `createRequire` into the browser bundle, where it is not a function and the
 * whole app fails to mount (ADR 0101 introduced the constant; this is where it
 * belongs). `projection.ts` re-exports both, so nothing else has to know.
 */
export type NestingKind = 'composition' | 'assignment'

/** What a view nests when it does not say: the behaviour that shipped. */
export const DEFAULT_NESTING: readonly NestingKind[] = ['composition']
