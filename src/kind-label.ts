/**
 * A kind identity is `<profile>#<local id>`, and its label is that local id.
 *
 * This lives apart from `graph-projection.ts` because the browser needs it,
 * and the projection imports the compiler, which loads Ajv and two schemas at
 * module scope. That is importable from a browser now (#252) and was not
 * before; it is still a lot of bundle for one label.
 */
export const kindLabelOf = (kind: string): string => kind.slice(kind.lastIndexOf('#') + 1)
