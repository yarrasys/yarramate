/**
 * How a relationship reads as prose, kept in a module that imports nothing.
 *
 * One table for the brief and the canvas (ADR 0147). The brief has said
 * "System API serves Process API" since it existed, and an edge label reading
 * `serving` beside it was the same fact in a different voice. Every phrase
 * here is spoken from the SOURCE: "a serves b".
 *
 * A canvas that layers the served element above what serves it reads the same
 * edge from the other end, "b served by a", so the three kinds that turn for
 * layering (`LAYERING_REVERSED_KINDS` in `./layout-mode.ts`) also carry a
 * passive reading. Nothing else does: "b accessed by a" is not how anyone
 * reads an access.
 */
export const RELATIONSHIP_READING: Readonly<Record<string, string>> = {
  serving: 'serves',
  access: 'accesses',
  realization: 'realizes',
  composition: 'comprises',
  aggregation: 'aggregates',
  assignment: 'is assigned to',
  triggering: 'triggers',
  flow: 'flows to',
  specialization: 'specializes',
  influence: 'influences',
  association: 'is associated with',
}

export const REVERSED_READING: Readonly<Record<string, string>> = {
  serving: 'served by',
  realization: 'realized by',
  specialization: 'specialized by',
}

/**
 * `acme/p@1#applicationComponent` reads "application component" and
 * `data-object` reads "data object": the last resort for a kind the table does
 * not know, which is every extension kind.
 */
export const humanizeKind = (kind: string): string => {
  const local = kind.slice(kind.indexOf('#') + 1)
  return local
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('-', ' ')
    .toLowerCase()
}

/**
 * The reading of one relationship kind. `reversed` asks for the passive form
 * and gets it only where one exists; a kind with no passive reading keeps its
 * active one, so a caller can pass the layering's answer straight through.
 */
export const relationshipReading = (coreKind: string, reversed = false): string =>
  (reversed ? REVERSED_READING[coreKind] : undefined) ??
  RELATIONSHIP_READING[coreKind] ??
  humanizeKind(coreKind)
