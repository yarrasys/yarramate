import type { CanvasGraph } from './graph-projection.js'
import type { YarramateOperation } from './operations.js'

/**
 * Drafting a deletion, the last of the four motions the write surface has
 * (ADR 0069) and the last the canvas could not make.
 *
 * `apply` refuses to delete a subject anything still references, and evaluates
 * that against the post-batch state, so a subject and the relationships naming
 * it land as one atomic motion when they go together. Composing that batch is
 * the useful part: a reviewer deleting one subject would otherwise have to
 * find every relationship touching it by hand, and a canvas already knows them.
 */

/** A reference that would still hold the subject after its relationships go. */
export interface DeletionBlocker {
  /** The subject doing the referencing. */
  readonly by: string
  /** Which of its fields names the target. */
  readonly field: 'owner' | 'distinctFrom' | 'supersedes' | 'constraint' | 'reference'
}

/**
 * What would still refuse the deletion once every relationship naming the
 * subject is deleted with it.
 *
 * Relationships are absent by construction: they are deleted in the same
 * batch. What remains is the reference kinds a batch cannot resolve on the
 * reviewer's behalf, because removing them changes what another subject says
 * rather than removing something that only existed to join two things.
 */
export const deletionBlockers = (
  graph: CanvasGraph,
  id: string,
): readonly DeletionBlocker[] => {
  const blockers: DeletionBlocker[] = []
  for (const node of graph.nodes) {
    if (node.id === id) continue
    if (node.owner === id) blockers.push({ by: node.id, field: 'owner' })
    if (node.distinctFrom.includes(id)) {
      blockers.push({ by: node.id, field: 'distinctFrom' })
    }
    if (node.supersedes.includes(id)) {
      blockers.push({ by: node.id, field: 'supersedes' })
    }
    if (node.constraints.some((constraint) => constraint.ref === id)) {
      blockers.push({ by: node.id, field: 'constraint' })
    }
    if (node.references.some((reference) => reference.ref === id)) {
      blockers.push({ by: node.id, field: 'reference' })
    }
  }
  return blockers
}

/**
 * The operations that remove a subject, or a relationship, from the model.
 *
 * Deleting a subject takes every relationship naming it along, which is what
 * makes the batch land at all. Each operation names the document the thing was
 * actually authored in, so a relationship stored apart from its endpoints is
 * still spliced out of its own file.
 *
 * Empty when the id is not in the graph. Blockers are NOT consulted here: a
 * caller that wants to warn asks {@link deletionBlockers}, and one that goes
 * ahead anyway is refused by `apply` rather than by a second opinion here.
 */
export const draftDeletion = (
  graph: CanvasGraph,
  id: string,
): readonly YarramateOperation[] => {
  const edge = graph.edges.find((candidate) => candidate.id === id)
  if (edge !== undefined) {
    return [
      {
        op: 'delete-relationship',
        document: edge.document,
        relationship: { id: edge.id },
      },
    ]
  }

  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (node === undefined) return []

  const touching = graph.edges.filter(
    (candidate) => candidate.from === id || candidate.to === id,
  )
  return [
    ...touching.map(
      (candidate): YarramateOperation => ({
        op: 'delete-relationship',
        document: candidate.document,
        relationship: { id: candidate.id },
      }),
    ),
    { op: 'delete-concept', document: node.document, concept: { id: node.id } },
  ]
}

/**
 * What a reviewer is about to do, in a sentence, for the confirmation.
 *
 * Blockers are stated rather than used to disable the confirmation. The list
 * is derived from what a canvas holds, and a canvas does not hold everything
 * that can reference a subject - an evidence overlay is not in the graph - so
 * treating it as authoritative would refuse deletions that would actually
 * land. `apply` is the gate; this is a warning.
 */
export const describeDeletion = (
  graph: CanvasGraph,
  id: string,
): string | null => {
  const edge = graph.edges.find((candidate) => candidate.id === id)
  if (edge !== undefined) {
    return `Delete the ${edge.kindLabel} relationship from "${
      graph.nodes.find((node) => node.id === edge.from)?.name ?? edge.from
    }" to "${
      graph.nodes.find((node) => node.id === edge.to)?.name ?? edge.to
    }"?`
  }

  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (node === undefined) return null

  const touching = graph.edges.filter(
    (candidate) => candidate.from === id || candidate.to === id,
  ).length
  const blockers = deletionBlockers(graph, id)

  const head =
    touching === 0
      ? `Delete "${node.name}"?`
      : `Delete "${node.name}" and the ${touching} ${
          touching === 1 ? 'relationship that names' : 'relationships that name'
        } it?`

  if (blockers.length === 0) return head
  // By name, because the reviewer is reading a diagram of names.
  const named = [
    ...new Set(
      blockers.map(
        (blocker) =>
          graph.nodes.find((candidate) => candidate.id === blocker.by)?.name ??
          blocker.by,
      ),
    ),
  ]
  const shown = named.slice(0, 3)
  const rest = named.length > shown.length ? ' and others' : ''
  return `${head} It is still named by ${shown.join(', ')}${rest}, so this may be refused.`
}
