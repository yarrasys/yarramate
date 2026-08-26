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
  const permitted = [
    ...permittedRelationshipKinds(from.coreKindLabel, to.coreKindLabel),
  ].sort()
  // Between two PATTERN INSTANCES the ports are the narrowing (#268 phase 3,
  // ADR 0124). Two raw groupings permit ten of the eleven kinds, which is no
  // guidance at all, and an edge between two instances is a macro edge -
  // which phase 2 expands only where BOTH patterns port its kind, so an
  // offer wider than the intersection would propose edges that expand into
  // nothing. Where either end has no ports there is no macro grain to speak
  // of, and the table's own answer stands.
  if (from.portKinds.length === 0 || to.portKinds.length === 0) return permitted
  const ported = new Set(to.portKinds)
  const narrowed = permitted.filter(
    (kind) => from.portKinds.includes(kind) && ported.has(kind),
  )
  // A pattern whose ports the table forbids between these two would narrow to
  // nothing, and an empty palette makes the edge undrawable rather than
  // guided. The table's answer is the honest fallback.
  return narrowed.length === 0 ? permitted : narrowed
}

/**
 * An id for a new relationship, unique across the graph.
 *
 * `<from>-<kind>-<to>` reads as the sentence the relationship makes and is
 * already valid: a subject id is lowercase and hyphenated, and every core
 * relationship kind is a single lowercase word. A collision takes a numeric
 * suffix rather than a hash, because the id is authored text a human will read
 * in a diff.
 *
 * `reserved` carries ids the graph does not know yet: a staged-but-uncommitted
 * draft never enters the rendered graph, so without it a second relationship
 * between the same pair re-proposed the identical id and the editor's
 * replace-by-target staging silently swallowed the first (#306). The schema
 * places no uniqueness on the (from, kind, to) triple - parallel relationships
 * with distinct ids compile cleanly - so the id proposal is the only place the
 * collision can be stepped past.
 */
export const proposeRelationshipId = (
  graph: CanvasGraph,
  fromId: string,
  kind: RelationshipKind,
  toId: string,
  reserved: Iterable<string> = [],
): string => {
  const taken = new Set([
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
    ...reserved,
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
 *
 * A caller holding drafts the graph has not landed yet - an editor with a
 * pending changeset - passes their ids as `reserved`, so a second parallel
 * relationship steps to `-2` instead of colliding with the first (#306).
 */
export const draftRelationship = (
  graph: CanvasGraph,
  fromId: string,
  kind: RelationshipKind,
  toId: string,
  reserved: Iterable<string> = [],
): YarramateOperation | null => {
  if (!connectableKinds(graph, fromId, toId).includes(kind)) return null
  const from = graph.nodes.find((node) => node.id === fromId)
  if (from === undefined) return null
  return {
    op: 'add-relationship',
    document: from.document,
    relationship: {
      id: proposeRelationshipId(graph, fromId, kind, toId, reserved),
      kind,
      from: fromId,
      to: toId,
    },
  }
}

/**
 * The ids a pending changeset already claims, for `proposeRelationshipId`'s
 * `reserved` parameter. Every operation that names a subject id reserves it -
 * an update's id is already in the graph and reserving it twice is harmless,
 * while an add's id is exactly the one the graph cannot know yet.
 */
export const stagedSubjectIds = (
  operations: readonly YarramateOperation[],
): readonly string[] =>
  operations.flatMap((op) => {
    // A staged rename claims the id it moves to as well as the one it leaves.
    const renamedTo =
      op.op === 'rename-concept' || op.op === 'rename-relationship'
        ? [op.to]
        : []
    if ('relationship' in op) return [op.relationship.id, ...renamedTo]
    if ('concept' in op) return [op.concept.id, ...renamedTo]
    return renamedTo
  })
