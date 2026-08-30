/**
 * Whether an edge's two ends are nested one inside the other (#439, ADR 0139).
 *
 * Composition maps onto cytoscape's compound `parent`, so a pair that also
 * carries any OTHER relationship produces an edge from a container to its own
 * child. ELK cannot lay that out: measured on a five-concept model, the
 * container and its child render and every unrelated node loses its geometry.
 *
 * Its own module rather than a helper inside `graph-canvas.tsx`, following
 * `subject-filter.ts`: the canvas is type-checked with JSX and a test that
 * imports it is not, so pure rules live where a test can reach them.
 */
export function spansNesting(
  from: string,
  to: string,
  parentOf: ReadonlyMap<string, string>,
): boolean {
  const climbs = (start: string, target: string): boolean => {
    // `resolveNestingParents` already refuses to nest a composition cycle, so
    // a cycle should be unreachable here. Guarded anyway: the cost of being
    // wrong is a frozen canvas rather than a bad picture.
    const seen = new Set<string>()
    let at = parentOf.get(start)
    while (at !== undefined && !seen.has(at)) {
      if (at === target) return true
      seen.add(at)
      at = parentOf.get(at)
    }
    return false
  }
  return climbs(from, to) || climbs(to, from)
}
