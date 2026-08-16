/**
 * A kind identity is `<profile>#<local id>`, and its label is that local id.
 *
 * This lives apart from `graph-projection.ts` because the browser needs it:
 * the projection imports the compiler, and the compiler reaches for Ajv
 * through `node:module` at load, which a bundle cannot honour.
 */
export const kindLabelOf = (kind: string): string => kind.slice(kind.lastIndexOf('#') + 1)
