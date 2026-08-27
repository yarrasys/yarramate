import {
  CORE_CONCEPT_KIND_ORDER,
  PERMITTED_RELATIONSHIP_LETTERS,
  RELATIONSHIP_LETTERS,
  type CoreConceptKindId,
} from './archimate-relationships.generated.js'
import {
  conceptKinds,
  relationshipKinds,
  type Aspect,
  type RelationshipKind,
} from './profile.js'

export type { CoreConceptKindId }

/**
 * The ArchiMate 3.2 relationship table, decoded once at module load.
 *
 * Every query below is a lookup on a pair of core kind ids. Callers holding
 * an extension kind resolve it to its core ancestor first (lineage is
 * ancestor-first, so `lineage[0]` is always the core identity), because the
 * table is defined over ArchiMate's own element types and an extension
 * inherits its parent's row and column (ADR 0097).
 */

const KIND_INDEX = new Map<string, number>(
  CORE_CONCEPT_KIND_ORDER.map((kind, index) => [kind, index]),
)

const LETTER_TO_KIND = new Map<string, RelationshipKind>(
  Object.entries(RELATIONSHIP_LETTERS) as [string, RelationshipKind][],
)

// `from>to` -> permitted relationship kinds. 62 x 62 entries, built eagerly:
// the table is small, the lookup is on every relationship of every compile,
// and an eager build keeps every query a single Map hit.
const PERMITTED = new Map<string, ReadonlySet<RelationshipKind>>()
for (const from of CORE_CONCEPT_KIND_ORDER) {
  const groups = PERMITTED_RELATIONSHIP_LETTERS[from].split(' ')
  for (const [index, to] of CORE_CONCEPT_KIND_ORDER.entries()) {
    const letters = groups[index] ?? '-'
    const kinds = new Set<RelationshipKind>()
    for (const letter of letters) {
      const kind = LETTER_TO_KIND.get(letter)
      if (kind !== undefined) kinds.add(kind)
    }
    PERMITTED.set(`${from}>${to}`, kinds)
  }
}

const EMPTY: ReadonlySet<RelationshipKind> = new Set()

export const isCoreConceptKindId = (id: string): id is CoreConceptKindId =>
  KIND_INDEX.has(id)

/** Relationship kinds ArchiMate permits from `from` to `to`. Never empty for known kinds: every pair permits `association`. */
export const permittedRelationshipKinds = (
  from: CoreConceptKindId,
  to: CoreConceptKindId,
): ReadonlySet<RelationshipKind> => PERMITTED.get(`${from}>${to}`) ?? EMPTY

export const relationshipPermitted = (
  from: CoreConceptKindId,
  kind: RelationshipKind,
  to: CoreConceptKindId,
): boolean => permittedRelationshipKinds(from, to).has(kind)

const JUNCTIONS: ReadonlySet<string> = new Set(['andJunction', 'orJunction'])

const ASPECT_OF = new Map<string, Aspect>(
  conceptKinds.map((kind) => [kind.id, kind.aspect]),
)

/**
 * The aspects a relationship kind is ever permitted to have at one endpoint,
 * across every non-junction pair in the table. This is the coarse shadow of
 * the table that two older surfaces still speak in: YM412's narrow-only rule
 * for extension profiles, and the `ask --kinds` roster. Junction endpoints
 * are excluded because the junction column permits every kind from every
 * source, which would make every aspect a "source" of every relationship.
 */
const endpointAspectCache = new Map<string, ReadonlySet<Aspect>>()
export const matrixEndpointAspects = (
  kind: RelationshipKind,
  endpoint: 'source' | 'target',
): ReadonlySet<Aspect> => {
  const key = `${kind}:${endpoint}`
  const cached = endpointAspectCache.get(key)
  if (cached !== undefined) return cached
  const aspects = new Set<Aspect>()
  for (const from of CORE_CONCEPT_KIND_ORDER) {
    if (JUNCTIONS.has(from)) continue
    for (const to of CORE_CONCEPT_KIND_ORDER) {
      if (JUNCTIONS.has(to)) continue
      if (!relationshipPermitted(from, kind, to)) continue
      const aspect = ASPECT_OF.get(endpoint === 'source' ? from : to)
      if (aspect !== undefined) aspects.add(aspect)
    }
  }
  endpointAspectCache.set(key, aspects)
  return aspects
}

/**
 * Whether the table has a row and column for this kind at all.
 *
 * Every query below answers an ABSENT kind with an empty set, which reads
 * identically to "the table forbids this" - the empty-set conflation, in the
 * one place where mistaking it turns a gate into a false accuser. A caller
 * deciding whether something is forbidden must therefore ask this first, so
 * that "not in the table" resolves toward silence rather than toward blame.
 *
 * Nothing reachable through a profile should fail it: `parent` is required on
 * every declared kind and resolves to a core ancestor, so a lineage head is
 * always a table kind. The predicates exist because that guarantee is another
 * module's to keep, and a gate should not rest on one silently.
 *
 * They are type guards rather than booleans so that a caller holding a bare
 * string reaches the typed queries through the check instead of around it by
 * a cast. The cast is where the hole actually opens: the signatures already
 * refuse an unknown kind, and asserting past them is what lets an absent kind
 * arrive and be read as a forbidden one.
 */
const CORE_CONCEPT_KINDS = new Set<string>(CORE_CONCEPT_KIND_ORDER)
const CORE_RELATIONSHIP_KIND_SET = new Set<string>(relationshipKinds)

export const tableKnowsConceptKind = (
  kind: string,
): kind is CoreConceptKindId => CORE_CONCEPT_KINDS.has(kind)

export const tableKnowsRelationshipKind = (
  kind: string,
): kind is RelationshipKind => CORE_RELATIONSHIP_KIND_SET.has(kind)

/** Kinds that may stand as the source of `kind` into `to`. */
export const sourceKindsPermitting = (
  kind: RelationshipKind,
  to: CoreConceptKindId,
): ReadonlySet<CoreConceptKindId> =>
  new Set(
    CORE_CONCEPT_KIND_ORDER.filter((from) => relationshipPermitted(from, kind, to)),
  )

/** Kinds that may stand as the target of `kind` from `from`. */
export const targetKindsPermitting = (
  kind: RelationshipKind,
  from: CoreConceptKindId,
): ReadonlySet<CoreConceptKindId> =>
  new Set(
    CORE_CONCEPT_KIND_ORDER.filter((to) => relationshipPermitted(from, kind, to)),
  )

/** Every core relationship kind, in the profile's declared order. Re-exported so the matrix's consumers need one import. */
export const CORE_RELATIONSHIP_KINDS: readonly RelationshipKind[] = relationshipKinds
