import type { CanvasGraph } from './graph-projection.js'
import type { YarramateOperation } from './operations.js'
import type { RelationshipKind } from './profile.js'
import {
  isCoreConceptKindId,
  permittedRelationshipKinds,
} from './relationship-matrix.js'

/**
 * Drafting a relationship between two subjects already on a canvas.
 *
 * The point of doing this here rather than in the editor is that an editor
 * offering exactly {@link connectableKinds} cannot draw an edge `check` would
 * refuse with `YM404`, and that guarantee is about the ArchiMate table and the
 * compiler agreeing rather than about any user interface. These functions are
 * pure and hold no React, so the property can be tested by compiling what they
 * produce.
 *
 * Everything here reads the rendered graph, which is what a canvas has, rather
 * than the compiled model, which it does not.
 */

/**
 * The relationship kinds ArchiMate permits from one subject to another, sorted
 * so a palette is stable between renders.
 *
 * Empty when either endpoint is unknown to the graph, or when its kind does not
 * resolve to a core one - an extension kind outside the ArchiMate vocabulary
 * has no row in the table, and guessing a row for it would be inventing
 * permission the compiler never granted. `association` is in every non-empty
 * answer, so a pair the table knows is never a dead end.
 */
export const connectableKinds = (
  graph: CanvasGraph,
  fromId: string,
  toId: string,
): readonly RelationshipKind[] => {
  const from = graph.nodes.find((node) => node.id === fromId)
  const to = graph.nodes.find((node) => node.id === toId)
  if (from === undefined || to === undefined) return []
  // The table is keyed on core kinds, which is why a canvas node carries the
  // core ancestor of the kind it was authored as.
  if (
    !isCoreConceptKindId(from.coreKindLabel) ||
    !isCoreConceptKindId(to.coreKindLabel)
  ) {
    return []
  }
  return [
    ...permittedRelationshipKinds(from.coreKindLabel, to.coreKindLabel),
  ].sort()
}

/**
 * An id for a new relationship, unique across the graph.
 *
 * `<from>-<kind>-<to>` reads as the sentence the relationship makes and is
 * already valid: a subject id is lowercase and hyphenated, and every core
 * relationship kind is a single lowercase word. A collision takes a numeric
 * suffix rather than a hash, because the id is authored text a human will read
 * in a diff.
 */
export const proposeRelationshipId = (
  graph: CanvasGraph,
  fromId: string,
  kind: RelationshipKind,
  toId: string,
): string => {
  const taken = new Set([
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
  ])
  const base = `${fromId}-${kind}-${toId}`
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The operation that lands a drafted relationship, or `null` when the draft is
 * one the table does not permit.
 *
 * Refusing here rather than trusting the caller is what makes the guarantee
 * hold for any caller, not only for an editor that remembered to filter its
 * palette first.
 *
 * The relationship is written into the *source* subject's document. A
 * relationship has to live somewhere, both endpoints are equally defensible,
 * and the source is where a reader looking for what this thing does would go
 * first.
 */
export const draftRelationship = (
  graph: CanvasGraph,
  fromId: string,
  kind: RelationshipKind,
  toId: string,
): YarramateOperation | null => {
  if (!connectableKinds(graph, fromId, toId).includes(kind)) return null
  const from = graph.nodes.find((node) => node.id === fromId)
  if (from === undefined) return null
  return {
    op: 'add-relationship',
    document: from.document,
    relationship: {
      id: proposeRelationshipId(graph, fromId, kind, toId),
      kind,
      from: fromId,
      to: toId,
    },
  }
}
