import type { CanvasGraph } from '../graph-projection.js'

/**
 * The subjects a "Focus on this" narrows the canvas to (#407).
 *
 * Returns the node ids only, to be sent as a projection query of
 * `{ subjects, relationships: 'between' }`. The edges are left to the server's
 * projection evaluator rather than selected here, so there is one
 * implementation of "which edges belong in a slice" and not a second one in
 * the browser that could disagree with it.
 *
 * `between` rather than `connected` on purpose: `connected` would expand again
 * from every subject in the list, turning one hop into two.
 *
 * **One hop, undirected, and deliberately not configurable.** On a connected
 * integration model "everything reachable" is the whole canvas, so a
 * transitive focus would be the most inviting menu item and the one that does
 * nothing. One hop is bounded by the subject's degree, predictable, and
 * verifiable by eye.
 *
 * **Relationships only.** A referenced subject — `constraints[].ref`,
 * `references[].ref` — is NOT a neighbour (#409). A relationship is an
 * assertion about structure the ArchiMate table governs and `check` validates;
 * a reference is a pointer to a shared subject, and a heavily shared
 * constraint would drag in every concept referencing it, which is the
 * unbounded expansion one hop exists to prevent. The cost is recorded on #409
 * and is sharper on a canvas than in prose: a brief says "constrained by X"
 * while a filtered-out node leaves nothing behind, so focus shows structure
 * and not the answers hanging off it.
 */
export const focusNeighbourhood = (
  graph: CanvasGraph,
  subjectId: string,
): readonly string[] => {
  if (!graph.nodes.some(({ id }) => id === subjectId)) return []
  const subjects = new Set<string>([subjectId])
  for (const edge of graph.edges) {
    if (edge.from === subjectId) subjects.add(edge.to)
    else if (edge.to === subjectId) subjects.add(edge.from)
  }
  return [...subjects]
}

/**
 * Focusing a relationship shows its two endpoints (#407). Not their own
 * neighbourhoods: the subject of the focus is the edge, and expanding both
 * ends would be two overlapping subject-focuses wearing one name.
 *
 * With `relationships: 'between'` this draws every relationship between those
 * two subjects, which is the one focused edge except where the model declares
 * more than one. Naming the single edge instead would need a query that can
 * enumerate relationships, which a projection does not do, and drawing two
 * subjects while hiding a declared edge between them would be a picture the
 * model contradicts.
 */
export const focusRelationshipNeighbourhood = (
  graph: CanvasGraph,
  relationshipId: string,
): readonly string[] => {
  const edge = graph.edges.find(({ id }) => id === relationshipId)
  return edge === undefined ? [] : [edge.from, edge.to]
}
