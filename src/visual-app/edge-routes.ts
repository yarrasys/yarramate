/**
 * Drawing ELK's routes with cytoscape's own edge machinery (ADR 0147).
 *
 * cytoscape has no "here is the polyline" style. What it has is `segments`:
 * interior points stated as a weight along the line between the two endpoints
 * and a signed distance off it, plus manual endpoints as px offsets from each
 * node's centre. A route in absolute coordinates is projected onto that frame
 * here, so the drawn edge is ELK's to the pixel, and so it stays attached when
 * the whole graph is translated (relative geometry) while going visibly wrong
 * when one endpoint alone is moved - which is why a moved endpoint gives its
 * edges back to the stylesheet.
 */
import type cytoscape from 'cytoscape'
import type { Core, EdgeCollection, EdgeSingular, NodeSingular } from 'cytoscape'
import type { ElkPlacement, ElkRoute } from './elk-layout.js'
import type {
  VisualLayoutPositions,
  VisualLayoutRoutes,
} from '../adapters/visual/protocol-contract.js'

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Every property a route sets. Cleared by name, never by a bare
 * `removeStyle()`: `applyFilter` hides elements through a `display` bypass,
 * and a bare clear would un-hide every filtered edge along with the route.
 */
export const ROUTE_STYLE_PROPERTIES = [
  'curve-style',
  'edge-distances',
  'source-endpoint',
  'target-endpoint',
  'segment-weights',
  'segment-distances',
  'source-text-offset',
] as const

const px = (value: number): string => `${Math.round(value * 10) / 10}px`

/**
 * The cytoscape style for one route (pure). `points` runs source to target in
 * absolute coordinates, ELK's start and end points included; the two node
 * centres are where the endpoints' offsets are measured from. `labelAt` is
 * the label's arc position from the source end, and 0 when there is no label -
 * the text itself is the stylesheet's, so a label toggle repaints without
 * touching a single bypass.
 */
export function routeStyle(
  points: readonly Point[],
  sourceCentre: Point,
  targetCentre: Point,
  labelAt: number | null,
): Record<string, string | number> {
  const start = points[0]
  const end = points[points.length - 1]
  if (start === undefined || end === undefined) return {}
  const inner = points.slice(1, -1)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  // cytoscape's own normal: `(-dy, dx) / length`, the direction a positive
  // `segment-distance` moves a point.
  const nx = -dy / length
  const ny = dx / length
  const weights: string[] = []
  const distances: string[] = []
  for (const point of inner) {
    const vx = point.x - start.x
    const vy = point.y - start.y
    weights.push(((vx * dx + vy * dy) / (length * length)).toFixed(4))
    distances.push((vx * nx + vy * ny).toFixed(2))
  }
  const style: Record<string, string | number> = {
    // Square corners, the same as layered's `taxi`: rounded bends were tried
    // and read as edges swerving where they meet a container's border.
    'curve-style': inner.length > 0 ? 'segments' : 'straight',
    // Weights and distances measured against the manual endpoints, not the
    // node centres or cytoscape's own intersections.
    'edge-distances': 'endpoints',
    'source-endpoint': `${px(start.x - sourceCentre.x)} ${px(start.y - sourceCentre.y)}`,
    'target-endpoint': `${px(end.x - targetCentre.x)} ${px(end.y - targetCentre.y)}`,
    'source-text-offset': labelAt === null ? 0 : Math.round(labelAt),
  }
  if (inner.length > 0) {
    style['segment-weights'] = weights.join(' ')
    style['segment-distances'] = distances.join(' ')
  }
  return style
}

const EPSILON = 1e-6

/**
 * Whether a node still sits where ELK put it. A leaf is compared to its
 * placed centre; a container is placed when every leaf inside it is, since
 * its own box is derived from theirs. A saved position or a drag breaks the
 * equality, and an edge with a moved end is not drawn on a route computed
 * for the end's old place.
 */
export function placedByElk(node: NodeSingular, placement: ElkPlacement): boolean {
  if (node.isParent()) {
    const leaves = node.descendants().filter((member) => !member.isParent())
    return (
      leaves.length > 0 &&
      leaves.every((leaf) => placedByElk(leaf as NodeSingular, placement))
    )
  }
  const placed = placement.nodes.get(node.id())
  if (placed === undefined) return false
  const position = node.position()
  return Math.abs(position.x - placed.x) < EPSILON && Math.abs(position.y - placed.y) < EPSILON
}

/**
 * Draws every route in the placement whose edge is present and eligible, and
 * returns how many it drew. Eligibility is the caller's: the canvas passes
 * "both ends still where ELK put them".
 */
export function applyEdgeRoutes(
  cy: Core,
  placement: ElkPlacement,
  eligible: (edge: EdgeSingular) => boolean,
): number {
  let applied = 0
  cy.startBatch()
  try {
    for (const [id, route] of placement.edges) {
      const edge = cy.getElementById(id)
      if (edge.empty() || !edge.isEdge() || !eligible(edge)) continue
      edge.style(
        routeStyle(
          route.points,
          edge.source().position(),
          edge.target().position(),
          route.labelAt,
        ) as unknown as cytoscape.Css.Edge,
      )
      // The route itself, kept on the edge so a drag-save can write it beside
      // the positions it was computed for (ADR 0147).
      edge.scratch(ROUTE_SCRATCH, route)
      edge.addClass('routed')
      applied += 1
    }
  } finally {
    cy.endBatch()
  }
  return applied
}

/** Gives the edges back to the stylesheet's own drawing. */
export function clearEdgeRoutes(edges: EdgeCollection): void {
  edges.removeClass('routed')
  edges.removeStyle(ROUTE_STYLE_PROPERTIES.join(' '))
  // `removeScratch` is cytoscape's, absent from its type declarations.
  ;(edges as unknown as { removeScratch(namespace: string): void }).removeScratch(ROUTE_SCRATCH)
}

const ROUTE_SCRATCH = '_route'

/**
 * The routes currently drawn, keyed by relationship id, in the shape the
 * layout sidecar keeps (ADR 0147). Only routed edges appear: an edge a moved
 * endpoint handed back to the stylesheet has no route worth saving, which is
 * exactly what lets a saved layout keep every other edge's route.
 */
export function buildRouteMap(edges: EdgeCollection): VisualLayoutRoutes {
  const routes: Record<string, VisualLayoutRoutes[string]> = {}
  edges.forEach((edge) => {
    if (!edge.hasClass('routed')) return
    const route = edge.scratch(ROUTE_SCRATCH) as ElkRoute | undefined
    if (route === undefined) return
    routes[edge.id()] = {
      points: route.points.map((point) => ({ x: point.x, y: point.y })),
      labelAt: route.labelAt,
    }
  })
  return routes
}

/**
 * Draws the routes a saved layout kept, on every edge that is not already
 * routed and whose two ends still sit where the saved positions say. The
 * saved positions are the placement those routes were computed for, so the
 * same eligibility ELK's own routes get applies verbatim; an end the reader
 * has since moved leaves its edges on the stylesheet's straight line.
 */
export function applySavedRoutes(
  cy: Core,
  routes: VisualLayoutRoutes,
  positions: VisualLayoutPositions,
): number {
  const placement: ElkPlacement = {
    nodes: new Map(Object.entries(positions).map(([id, at]) => [id, { x: at.x, y: at.y }])),
    edges: new Map(
      Object.entries(routes).map(([id, route]) => [
        id,
        { points: route.points.map((point) => ({ x: point.x, y: point.y })), labelAt: route.labelAt },
      ]),
    ),
  }
  return applyEdgeRoutes(
    cy,
    placement,
    (edge) =>
      !edge.hasClass('routed') &&
      placedByElk(edge.source(), placement) &&
      placedByElk(edge.target(), placement),
  )
}

/**
 * A drag moves one end of every edge on the dragged node, and the routes those
 * edges carried were computed for where the node was. The node's ancestors
 * lose theirs too - a moved member resizes the box around it, and an edge
 * ending on that box's border ends somewhere else now - and so do its
 * descendants, which moved with it. Bound to `dragfree`, not `position`: a
 * fold translates the whole graph through `position`, and a route survives a
 * translation intact.
 */
export function registerRouteInvalidation(cy: Core): () => void {
  const handler = (event: cytoscape.EventObject): void => {
    const node = event.target as NodeSingular
    const moved = node.union(node.ancestors()).union(node.descendants())
    clearEdgeRoutes(moved.connectedEdges('.routed'))
  }
  cy.on('dragfree', 'node', handler)
  return () => {
    cy.off('dragfree', 'node', handler)
  }
}
