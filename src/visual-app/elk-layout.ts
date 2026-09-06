/**
 * The layout engine, spoken to directly (ADR 0147).
 *
 * `cytoscape-elk` used to stand between the canvas and ELK, and it handed ELK
 * only node ids and edge endpoints, applied node positions only, and threw
 * away the routes and label positions ELK computed. Cytoscape's own `round-taxi`
 * then drew a straight orthogonal line through whatever sat between the
 * endpoints: 127 of the 206 drawn edges on the ApertureX reference Landscape
 * cut through a box that was not one of theirs. Building the ELK graph here
 * and reading the whole answer back is what lets a routed mode draw zero.
 *
 * Pure functions apart from `layoutWithElk`: the builder and the reader take
 * and return plain data, so a test can state what ELK is asked and what is
 * made of its answer without a canvas.
 */
import ELKApi from 'elkjs/lib/elk-api.js'
import type {
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkNode,
  ElkPoint,
  LayoutOptions,
} from 'elkjs/lib/elk.bundled.js'
import type { CollectionReturnValue, NodeSingular } from 'cytoscape'
import type { LayoutDirection } from '../layout-direction.js'
import {
  LAYERING_REVERSED_KINDS,
  layerBandOf,
  partitionsByLayer,
  reversesForLayering,
  routesEdges,
  type LayoutMode,
} from '../layout-mode.js'
import { humanizeKind, relationshipReading } from '../relationship-reading.js'

// cytoscape draws a compound parent's box itself: the container rectangle is
// its children's bounding box grown by cytoscape's own `padding`. ELK
// independently reserves `elk.padding` around each child cluster when spacing
// siblings apart. If cytoscape's padding is the larger of the two, every
// container is drawn wider than the room ELK left for it and neighbouring
// boxes close up until they touch - so the two numbers must stay equal.
export const CONTAINER_PADDING = 30

// Extra room ELK leaves above the children that cytoscape does not draw into,
// giving the container's own label - rendered outside the box by
// `text-valign: top` - somewhere to sit that isn't the box above it. An edge
// ELK ends on a container's top border therefore stops 22px above the drawn
// box, in the label band; visible if you look for it, and cheaper than
// teaching two renderers one asymmetric padding.
export const CONTAINER_LABEL_GAP = 22

// Edge labels are free-floating text at a route midpoint with no box to sit
// in, so they wrap narrower than node labels - a tall, narrow label intrudes
// on far fewer neighbours than a wide, flat one.
export const EDGE_LABEL_MAX_TEXT_WIDTH = 110
export const EDGE_LABEL_FONT_SIZE = 10

// The proportion disconnected components pack toward (#308). Subjects with no
// relationships are each their own ELK component, and the packer's row
// breaking (`sqrt(total component area) x aspectRatio`) is what keeps 54 of
// them from drawing as one 172x6942 column. Measured on disconnected 170x50
// subjects at 2.5: 9 -> 672x312 (a 3x3 grid), 54 -> 1672x962, 120 ->
// 2422x1482 - drawn ratios 1.6-2.2, no overlaps - while a connected graph's
// layout is untouched, since packing never reaches a single component.
export const COMPONENT_ASPECT_RATIO = 2.5

// `elk.direction` is read only by `layered`, and the view says which way it
// runs (#274, ADR 0121).
export const ELK_DIRECTION: Readonly<Record<LayoutDirection, 'DOWN' | 'RIGHT'>> = {
  'top-down': 'DOWN',
  'left-right': 'RIGHT',
}

// Spacing, shared by the root graph and every compound container.
//
// ELK's defaults are ~20px throughout, which is too tight for 170x50 nodes
// carrying wrapped labels. A graph's layout options govern only that graph's
// own children, so each container is laid out as a child graph that would
// otherwise fall back to those defaults - measured: nodes inside a container
// sat 18px apart while their siblings outside sat 58px apart. Handing the same
// spacing to every parent closes that gap. Direction is deliberately not
// passed down: ELK ignores it on child graphs.
const BASE_SPACING: LayoutOptions = {
  // Between siblings in the same layer.
  'elk.spacing.nodeNode': '60',
  // Across layers - the axis edge labels are drawn on.
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  // Keep routed edges off the node boxes they pass.
  'elk.spacing.edgeNode': '30',
  'elk.layered.spacing.edgeNodeBetweenLayers': '30',
  // Keep parallel edges apart so their labels do not stack.
  'elk.spacing.edgeEdge': '20',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
  // Disconnected subgraphs read as separate clusters, not one mass.
  'elk.spacing.componentComponent': '80',
  'elk.padding': `[top=${CONTAINER_PADDING + CONTAINER_LABEL_GAP},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
}

/**
 * The spacing a mode asks for. A routed mode draws two labelled edges side by
 * side, and their labels lay over each other unless the lanes are wider than
 * a reading. Measured on the reference Landscape under served-by, labels
 * on another label: 20px 14, 30px 3, 60px 0, at a width cost of 5% for the
 * last step (12,346 to 12,943px); `elk.spacing.labelLabel`, `edgeLabel`, and
 * placing labels beside the edge instead of on it all left the 3 standing.
 * `edgeEdgeBetweenLayers` stays at 20 on purpose: it spaces the horizontal
 * channels between layers, and widening it measured as canvas height (8,020
 * to 11,624px) for no gain against the same overlap.
 */
export const spacingFor = (mode: LayoutMode): LayoutOptions =>
  routesEdges(mode) ? { ...BASE_SPACING, 'elk.spacing.edgeEdge': '60' } : { ...BASE_SPACING }

/**
 * The root graph's options for a mode and a direction.
 *
 * `layered` is the bag that shipped before 1.24, under the qualified
 * `elk.aspectRatio` key now that nothing injects a bare one. The routed modes
 * add hierarchy handling - without `INCLUDE_CHILDREN` ELK lays each container
 * out as a separate graph and cannot route an edge that crosses a container's
 * border - orthogonal routing, inline labels with room reserved, and model
 * order, which keeps siblings in the order they were authored. `bands`
 * activates partitioning; the partitions themselves are set per node.
 *
 * Never `elk.layered.compaction.postCompaction.strategy`: measured with
 * `EDGE_LENGTH` on the reference model, ELK throws "Invalid hitboxes for
 * scanline constraint calculation" on the nested graph.
 */
export const rootLayoutOptions = (direction: LayoutDirection, mode: LayoutMode): LayoutOptions => ({
  'elk.algorithm': 'layered',
  'elk.direction': ELK_DIRECTION[direction],
  // Placement measured across every authored view in this repository (ADR
  // 0121): holding direction DOWN, NETWORK_SIMPLEX against the BRANDES_KOEPF
  // default cut total edge length by a third and narrowed the summed layout
  // by 15%, at a cost of crossings on only the three largest views.
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.aspectRatio': String(COMPONENT_ASPECT_RATIO),
  ...spacingFor(mode),
  ...(routesEdges(mode)
    ? {
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.edgeLabels.inline': 'true',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      }
    : {}),
  ...(partitionsByLayer(mode) ? { 'elk.partitioning.activate': 'true' } : {}),
})

/** The data fields an edge's label is decided from. */
export interface EdgeLabelData {
  readonly name?: string | null
  readonly kindLabel?: string
  readonly coreKindLabel?: string
  readonly liftedCount?: number
}

/**
 * The one place that decides what an edge says (ADR 0147).
 *
 * A named relationship says its name. An unnamed one says its reading -
 * "serves", or "served by" where the mode layers the served element above -
 * unless kind labels are off, in which case the line style and arrowhead
 * carry the kind alone. An extension kind has no reading in the table and is
 * spelled out from its own name ("deploys to" for `deploys-to`), in the active
 * voice whichever way it is layered, because nobody can conjugate a verb they
 * have not seen. A lifted edge stands for several relationships and says how
 * many.
 */
export const edgeLabelText = (
  data: EdgeLabelData,
  mode: LayoutMode,
  showKindLabels: boolean,
): string => {
  if (typeof data.name === 'string' && data.name !== '') return data.name
  if (!showKindLabels) return ''
  const core = data.coreKindLabel ?? ''
  const kind = data.kindLabel ?? core
  const reading =
    kind !== core && kind !== ''
      ? humanizeKind(kind)
      : relationshipReading(core, reversesForLayering(mode) && LAYERING_REVERSED_KINDS.has(core))
  const count = typeof data.liftedCount === 'number' ? data.liftedCount : 0
  return count > 1 ? `${reading} ×${count}` : reading
}

/**
 * How much room ELK reserves for a label: an estimate of what cytoscape will
 * draw at 10px, wrapped at `EDGE_LABEL_MAX_TEXT_WIDTH`. An estimate is enough -
 * the point is that a label has a box of roughly the right size in the layout,
 * where before it had none.
 */
export const edgeLabelSize = (text: string): { readonly width: number; readonly height: number } => {
  const raw = text.length * 5.6 + 8
  const lines = Math.max(1, Math.ceil(raw / EDGE_LABEL_MAX_TEXT_WIDTH))
  return {
    width: Math.min(EDGE_LABEL_MAX_TEXT_WIDTH, Math.round(raw)),
    height: 12 * lines + 4,
  }
}

export interface ElkBuildOptions {
  readonly direction: LayoutDirection
  readonly mode: LayoutMode
  readonly showKindLabels: boolean
}

export interface ElkBuild {
  readonly graph: ElkNode
  /** Edges whose ELK source and target were swapped for layering. */
  readonly reversed: ReadonlySet<string>
}

/**
 * The ELK graph for a cytoscape collection.
 *
 * Leaves carry their drawn size; containers carry their children and the
 * shared spacing, and no size, so ELK sizes them around what they hold. Every
 * edge sits on the root graph - ELK accepts an edge anywhere at or above its
 * endpoints' common ancestor - with its ends swapped where the mode layers the
 * target above the source, and with a label sized for its reading in the
 * routed modes. `layered` sends no labels, which is what it always sent.
 */
export function buildElkGraph(collection: CollectionReturnValue, options: ElkBuildOptions): ElkBuild {
  const { direction, mode, showKindLabels } = options
  const nodes = collection.nodes()
  const included = new Set<string>(nodes.map((node) => node.id()))
  const childrenOf = new Map<string, NodeSingular[]>()
  const roots: NodeSingular[] = []
  nodes.forEach((node) => {
    const parent = node.parent()
    const parentId = parent.nonempty() ? parent.first().id() : null
    if (parentId !== null && included.has(parentId)) {
      const held = childrenOf.get(parentId)
      if (held === undefined) childrenOf.set(parentId, [node])
      else held.push(node)
    } else {
      roots.push(node)
    }
  })

  // A container's band is the highest band any of its members sits in, so a
  // box holding application functions and their data objects lands with the
  // application layer rather than floating unpartitioned above everything.
  const bandOf = (node: NodeSingular): number | undefined => {
    const children = childrenOf.get(node.id())
    if (children === undefined || children.length === 0) {
      return layerBandOf(node.data('layer') as string | null | undefined)
    }
    const bands = children.map(bandOf).filter((band): band is number => band !== undefined)
    return bands.length === 0 ? undefined : Math.min(...bands)
  }

  const spacing = spacingFor(mode)
  const toElk = (node: NodeSingular): ElkNode => {
    const children = childrenOf.get(node.id()) ?? []
    const elk: ElkNode = { id: node.id() }
    if (children.length > 0) {
      elk.children = children.map(toElk)
      elk.layoutOptions = { ...spacing }
    } else {
      const dims = node.layoutDimensions({ nodeDimensionsIncludeLabels: false })
      elk.width = dims.w
      elk.height = dims.h
    }
    if (partitionsByLayer(mode)) {
      const band = bandOf(node)
      if (band !== undefined) {
        elk.layoutOptions = { ...(elk.layoutOptions ?? {}), 'elk.partitioning.partition': String(band) }
      }
    }
    return elk
  }

  const reversed = new Set<string>()
  const edges: ElkExtendedEdge[] = []
  collection.edges().forEach((edge) => {
    const source = edge.source().id()
    const target = edge.target().id()
    if (!included.has(source) || !included.has(target)) return
    const core = String(edge.data('coreKindLabel') ?? '')
    const turned = reversesForLayering(mode) && LAYERING_REVERSED_KINDS.has(core)
    if (turned) reversed.add(edge.id())
    const elk: ElkExtendedEdge = {
      id: edge.id(),
      sources: [turned ? target : source],
      targets: [turned ? source : target],
    }
    if (routesEdges(mode)) {
      const text = edgeLabelText(edge.data() as EdgeLabelData, mode, showKindLabels)
      if (text !== '') elk.labels = [{ text, ...edgeLabelSize(text) }]
    }
    edges.push(elk)
  })

  return {
    graph: {
      id: 'root',
      layoutOptions: rootLayoutOptions(direction, mode),
      children: roots.map(toElk),
      edges,
    },
    reversed,
  }
}

export interface ElkRoute {
  /** The route in absolute coordinates, source end first. */
  readonly points: readonly ElkPoint[]
  /** How far along the route, in px from the source end, the label's centre sits; null for no label. */
  readonly labelAt: number | null
}

export interface ElkPlacement {
  /** Leaf node centres, absolute, keyed by id. */
  readonly nodes: ReadonlyMap<string, ElkPoint>
  readonly edges: ReadonlyMap<string, ElkRoute>
}

/** A section's polyline, moved from its container's frame into the root's. */
export const absoluteSection = (section: ElkEdgeSection, offset: ElkPoint): ElkPoint[] =>
  [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }))

export const polylineLength = (points: readonly ElkPoint[]): number => {
  let length = 0
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  }
  return length
}

/** The arc length from the polyline's start to the point on it nearest `p`. */
export const arcPosition = (points: readonly ElkPoint[], p: ElkPoint): number => {
  let best = Number.POSITIVE_INFINITY
  let at = 0
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length)))
    const distance = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    if (distance < best) {
      best = distance
      at = walked + t * length
    }
    walked += length
  }
  return at
}

/**
 * What ELK placed, in one frame.
 *
 * ELK writes every child's position relative to its parent and every edge's
 * route relative to the edge's container - the graph it was declared in, or
 * the one ELK moved it to (`container`). Both are resolved here to absolute
 * coordinates, and an edge whose ends were swapped for layering is turned
 * back so its route runs source to target the way the arrow does.
 */
export function readElkLayout(laid: ElkNode, reversed: ReadonlySet<string>): ElkPlacement {
  const origins = new Map<string, ElkPoint>([[laid.id, { x: 0, y: 0 }]])
  const centres = new Map<string, ElkPoint>()
  const walk = (node: ElkNode, ox: number, oy: number): void => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0)
      const y = oy + (child.y ?? 0)
      origins.set(child.id, { x, y })
      if ((child.children ?? []).length === 0) {
        centres.set(child.id, { x: x + (child.width ?? 0) / 2, y: y + (child.height ?? 0) / 2 })
      }
      walk(child, x, y)
    }
  }
  walk(laid, 0, 0)

  const routes = new Map<string, ElkRoute>()
  const collect = (node: ElkNode): void => {
    for (const edge of node.edges ?? []) {
      const offset = origins.get(edge.container ?? node.id) ?? { x: 0, y: 0 }
      const section = edge.sections?.[0]
      if (section === undefined) continue
      let points = absoluteSection(section, offset)
      let labelAt: number | null = null
      const label = edge.labels?.[0]
      if (label !== undefined && label.x !== undefined && label.y !== undefined) {
        labelAt = arcPosition(points, {
          x: label.x + offset.x + (label.width ?? 0) / 2,
          y: label.y + offset.y + (label.height ?? 0) / 2,
        })
      }
      if (reversed.has(edge.id)) {
        const total = polylineLength(points)
        points = [...points].reverse()
        if (labelAt !== null) labelAt = total - labelAt
      }
      routes.set(edge.id, { points, labelAt })
    }
    for (const child of node.children ?? []) collect(child)
  }
  collect(laid)

  return { nodes: centres, edges: routes }
}

/**
 * What lays a graph out. The bundled engine runs ELK on the calling thread
 * behind a promise, in the browser and under vitest alike, and it is what
 * every page starts with. A page that can serve a worker file installs an
 * engine over a Web Worker instead (#490), and the canvas never knows which
 * it is talking to: `layoutWithElk` is the one door.
 */
export interface LayoutEngine {
  readonly layout: (graph: ElkNode) => Promise<ElkNode>
  /** Lets go of whatever the engine holds; the bundled one holds nothing. */
  readonly terminate?: () => void
}

/**
 * The worker a page constructs for `workerLayoutEngine`: anything that can be
 * posted to. elk-api installs `onmessage` on it and speaks its own protocol
 * to `elkjs/lib/elk-worker.min.js` at the other end, so a host hands over a
 * `new Worker(url)` of that file and nothing else.
 */
export interface LayoutWorker {
  postMessage(message: unknown): void
}

type ElkConstructor = new (options?: {
  readonly workerFactory?: () => Worker
}) => { layout: (graph: ElkNode) => Promise<ElkNode>; terminateWorker?: () => void }
const constructorOf = (module: unknown): ElkConstructor =>
  ((module as { default?: ElkConstructor }).default ?? module) as ElkConstructor
const WorkerEngine = constructorOf(ELKApi)

// The bundled engine is loaded the first time something asks for it and not
// before: `elk.bundled.js` is 1.6 MB, and a page that installed a worker
// engine before its first layout never needs it. Vite splits the dynamic
// import into a chunk of its own, so the served page ships ELK once, in the
// worker; the library bundle inlines it, so a host still gets one file.
let bundled: Promise<LayoutEngine> | undefined
const bundledEngine = (): Promise<LayoutEngine> =>
  (bundled ??= import('elkjs/lib/elk.bundled.js').then((module) => new (constructorOf(module))()))
let installed: LayoutEngine | undefined

/**
 * An engine that runs ELK in the worker `workerFactory` constructs. The
 * served page installs one over the worker file vite emits beside its other
 * assets (#490); a host mounting the library passes its own factory when its
 * policy lets it serve that file, and leaves the bundled engine otherwise.
 */
export function workerLayoutEngine(workerFactory: () => LayoutWorker): LayoutEngine {
  const api = new WorkerEngine({ workerFactory: () => workerFactory() as unknown as Worker })
  return {
    layout: (graph) => api.layout(graph),
    terminate: () => api.terminateWorker?.(),
  }
}

/**
 * Makes `next` the engine every layout goes through; `undefined` restores the
 * bundled one. Installing never terminates the engine being replaced: the
 * page that made it owns it.
 */
export function installLayoutEngine(next: LayoutEngine | undefined): void {
  installed = next
}

export const layoutWithElk = async (graph: ElkNode): Promise<ElkNode> =>
  (installed ?? (await bundledEngine())).layout(graph)
