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

/**
 * Readings for the extension kinds the package ships (ADR 0159), keyed by
 * their full identity: a profile's subkind of one of these reads the same,
 * which `readingKindOf` resolves through the lineage.
 */
export const EXTENSION_READING: Readonly<Record<string, string>> = {
  'yarramate/policy@0.2#responsible': 'is responsible for',
  'yarramate/policy@0.2#consulted': 'is consulted on',
  'yarramate/policy@0.2#informed': 'is informed of',
}

/**
 * The kind whose reading an edge speaks: the most specific member of the
 * lineage (ancestor-first) that has a reading of its own, else the core kind.
 */
export const readingKindOf = (
  lineage: readonly string[] | undefined,
  coreKind: string,
): string => {
  if (lineage !== undefined) {
    for (let index = lineage.length - 1; index >= 0; index -= 1) {
      const member = lineage[index]!
      if (EXTENSION_READING[member] !== undefined) return member
    }
  }
  return coreKind
}

/**
 * Readings that depend on the SOURCE kind as well as the relationship
 * (ADR 0160): a risk "threatens" what it influences, where anything else
 * "influences" it; an assumption "bears on" what it associates. Keyed by
 * the source kind's identity, then the relationship's core kind, and
 * resolved through the source's lineage so a profile's subkind of `risk`
 * threatens too.
 */
export const SOURCE_CONTEXTUAL_READING: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  'yarramate/policy@0.3#risk': { influence: 'threatens' },
  'yarramate/policy@0.3#assumption': { association: 'bears on' },
}

/**
 * Readings that depend on the TARGET kind: a work package, deliverable,
 * constraint or decision "mitigates" the risk it influences. Consulted
 * after the source table, so a risk that influences another risk still
 * "threatens" it.
 */
export const TARGET_CONTEXTUAL_READING: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  'yarramate/policy@0.3#risk': { influence: 'mitigates' },
}

const lookupContextual = (
  table: Readonly<Record<string, Readonly<Record<string, string>>>>,
  lineage: readonly string[] | undefined,
  coreKind: string,
): string | undefined => {
  if (lineage === undefined) return undefined
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const phrase = table[lineage[index]!]?.[coreKind]
    if (phrase !== undefined) return phrase
  }
  return undefined
}

/**
 * The reading an edge speaks when its endpoints decide it, or undefined
 * when the relationship kind alone does (the tables above are consulted
 * source first). `coreKind` is the relationship's core kind label.
 */
export const contextualReading = (
  sourceLineage: readonly string[] | undefined,
  targetLineage: readonly string[] | undefined,
  coreKind: string,
): string | undefined =>
  lookupContextual(SOURCE_CONTEXTUAL_READING, sourceLineage, coreKind) ??
  lookupContextual(TARGET_CONTEXTUAL_READING, targetLineage, coreKind)

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
export const relationshipReading = (kind: string, reversed = false): string =>
  (reversed ? REVERSED_READING[kind] : undefined) ??
  EXTENSION_READING[kind] ??
  RELATIONSHIP_READING[kind] ??
  humanizeKind(kind)
