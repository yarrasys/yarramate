/**
 * What a view nests, kept in a module that imports nothing.
 *
 * These live apart from `projection.ts` because the browser needs the value,
 * not only the type. `projection.ts` used to reach for `node:module` to load
 * Ajv, so importing it from `src/visual-app` shipped `createRequire` into the
 * bundle, where it is not a function and the whole app failed to mount. That
 * import is static now (#252) and the bundle survives it - but it still drags
 * Ajv and the projection schema in for one constant, so the split earns its
 * place on weight rather than on breakage (ADR 0101 introduced the constant;
 * this is where it belongs). `projection.ts` re-exports both.
 */
export type NestingKind = 'composition' | 'assignment'

/** What a view nests when it does not say: the behaviour that shipped. */
export const DEFAULT_NESTING: readonly NestingKind[] = ['composition']
