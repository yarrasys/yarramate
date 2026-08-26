/**
 * Which way a view runs its layers, kept in a module that imports nothing.
 *
 * Here rather than in `projection.ts` for the reason `./nesting.ts` gives: the
 * browser needs the value and not only the type, and `projection.ts` drags Ajv
 * and the projection schema in for one constant. `projection.ts` re-exports
 * both.
 */
export type LayoutDirection = 'top-down' | 'left-right'

/**
 * How a view runs when it does not say. Top-down is the behaviour that
 * shipped, and it is what ArchiMate's layer bands read as (ADR 0121).
 */
export const DEFAULT_DIRECTION: LayoutDirection = 'top-down'
