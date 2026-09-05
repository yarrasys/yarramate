/**
 * A kind identity is `<profile>#<local id>`, and its label is that local id.
 *
 * This lives apart from `graph-projection.ts` because the browser needs it,
 * and the projection imports the compiler, which loads Ajv and two schemas at
 * module scope. That is importable from a browser now (#252) and was not
 * before; it is still a lot of bundle for one label.
 */
export const kindLabelOf = (kind: string): string => kind.slice(kind.lastIndexOf('#') + 1)

/**
 * A kind as a READER should see it on a select or a fact row: the display name
 * the profile authored, then the id the document will actually carry.
 *
 * Both halves, deliberately (Nabeel, 2026-09-05). The properties panel edits
 * the document, so an architect needs the exact token that lands in the YAML;
 * a consultant reading the same panel needs to know what `mule-api` means. The
 * palette can afford the name alone because nothing there is being written.
 *
 * NEVER the value of a select. The value stays the bare label, because that is
 * what the staged operation carries and `apply` refuses a qualified identity as
 * an unknown kind (YM401).
 *
 * Falls back to the label alone where the profile authored no name, which is
 * every core kind, and where it authored one identical to the id, which would
 * otherwise read `dataObject (dataObject)`.
 */
export const kindOptionText = (option: {
  readonly label: string
  readonly name?: string
}): string =>
  option.name === undefined || option.name === option.label
    ? option.label
    : `${option.name} (${option.label})`
