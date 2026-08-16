import type React from 'react'
import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, ElementDefinition, NodeCollection } from 'cytoscape'
import elk from 'cytoscape-elk'
import type {
  CanvasGraph,
  CanvasNode,
  CanvasEdge,
} from '../graph-projection.js'
import type {
  VisualLayoutPositions,
  VisualLayoutSavePayload,
} from '../adapters/visual/protocol-contract.js'

// Register elk extension once at module load, guarded against re-registration
let elkRegistered = false
if (!elkRegistered) {
  cytoscape.use(elk)
  elkRegistered = true
}

// Layer → color palette from approved ArchiMate mockups (6 of 8 union values used)
const LAYER_COLORS = {
  motivation: { fill: '#CCCCFF', border: '#8F8FE0' },
  strategy: { fill: '#F5DEAA', border: '#C9A355' },
  business: { fill: '#FFFF99', border: '#C9C355' },
  application: { fill: '#CCFFFF', border: '#4FB8B8' },
  technology: { fill: '#CCFFCC', border: '#5FAE5F' },
  implementation: { fill: '#FFE0E0', border: '#D89999' },
} as const satisfies Record<
  'motivation' | 'strategy' | 'business' | 'application' | 'technology' | 'implementation',
  { readonly fill: string; readonly border: string }
>

// Default neutral style for uncolored layers (physical, composite, or null)
const DEFAULT_FILL = '#F0F0F0'
const DEFAULT_BORDER = '#999999'

// `width: 'label'` / `height: 'label'` are deprecated in cytoscape.js (and, at this
// graph's scale with wrapped text, crash inside cytoscape's style-hint pool during
// `elements().remove()`). Every node gets the same fixed box regardless of label
// length - wrapped text that doesn't fit the box simply overflows it, the standard
// tradeoff diagram tools make for uniform node sizing.
const NODE_WIDTH = 170
const NODE_HEIGHT = 50
const LABEL_MAX_TEXT_WIDTH = 150

// Edge labels are free-floating text at a route midpoint with no box to sit
// in, so they wrap narrower than node labels - a tall, narrow label intrudes
// on far fewer neighbours than a wide, flat one.
const EDGE_LABEL_MAX_TEXT_WIDTH = 110

// Cytoscape's `text-wrap: 'wrap'` only breaks lines on whitespace (or an
// explicit zero-width space - `separatorRegex` in cytoscape's own text-layout
// code matches `[\s\u200b]+`). Identifiers with no whitespace - repo-relative
// file paths, dotted schema names, hyphenated ids - have no break opportunity
// at all, so instead of wrapping at `text-max-width` they render as one
// unbroken line that overflows the fixed node box into neighboring nodes.
// Inserting a zero-width space after each path/word separator gives the wrap
// engine somewhere to break without changing a single visible character, so
// it stays a rendering-only concern - the underlying `label`/`name` used for
// quick-filter substring matching is never touched.
const WRAP_POINT = '\u200b'
function withWrapPoints(text: string): string {
  return text.replace(/([/._-])/g, `$1${WRAP_POINT}`)
}

// ELK layout options: extends base layout with elk-specific config not in
// cytoscape's types. `nodeLayoutOptions` is cytoscape-elk's only per-node hook
// (`makeNode` calls it for every node and assigns the result to that node's
// ELK `layoutOptions`). `elk.direction` is optional because the `force`
// backend (elk's `stress` algorithm) ignores direction entirely - only
// `layered` sets it.
interface ElkLayoutOptions extends Record<string, unknown> {
  name: 'elk'
  elk: {
    algorithm: string
    'elk.direction'?: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT'
    [key: string]: unknown
  }
  nodeLayoutOptions?: (node: cytoscape.NodeSingular) => Record<string, unknown> | undefined
}

// cytoscape draws a compound parent's box itself - cytoscape-elk only feeds
// positions back for leaf nodes (`nodes.filter((n) => !n.isParent())`), so the
// container rectangle is its children's bounding box grown by cytoscape's own
// `padding`. ELK independently reserves `elk.padding` around each child cluster
// when spacing siblings apart. If cytoscape's padding is the larger of the two,
// every container is drawn wider than the room ELK left for it and neighbouring
// boxes close up until they touch - so the two numbers must stay equal.
const CONTAINER_PADDING = 30

// Extra room ELK leaves above the children that cytoscape does not draw into,
// giving the container's own label - rendered outside the box by
// `text-valign: top` - somewhere to sit that isn't the box above it.
const CONTAINER_LABEL_GAP = 22

// Spacing, shared by the root graph and every compound container.
//
// ELK's defaults are ~20px throughout, which is too tight for 170x50 nodes
// carrying wrapped labels, and it does not account for edge labels at all:
// cytoscape-elk's `makeEdge` sends only id/source/target, never `labels[]`, so
// ELK reserves no midpoint space for the relationship text cytoscape then
// draws there. The between-layer gap therefore has to cover the edge label as
// well as the edge.
//
// A graph's layout options govern only that graph's own children, and
// cytoscape-elk sets them on the root graph alone, so each container is laid
// out as a separate child graph that would otherwise fall back to those ~20px
// defaults - measured: nodes inside a container sat 18px apart while their
// siblings outside sat 58px apart. Handing the same spacing to every parent
// through `nodeLayoutOptions` closes that gap. (`elk.hierarchyHandling:
// INCLUDE_CHILDREN` does not: measured on the 289-node graph it left the
// in-container gap at the default and widened the layout from 28.5k to 35k px.
// Direction is deliberately not passed down - ELK ignores it on child graphs,
// verified by identical container boxes for DOWN and RIGHT.)
const ELK_SPACING: Record<string, unknown> = {
  // Between siblings in the same layer.
  'elk.spacing.nodeNode': 60,
  // Across layers - the axis edge labels are drawn on.
  'elk.layered.spacing.nodeNodeBetweenLayers': 100,
  // Keep routed edges off the node boxes they pass.
  'elk.spacing.edgeNode': 30,
  'elk.layered.spacing.edgeNodeBetweenLayers': 30,
  // Keep parallel edges apart so their labels do not stack.
  'elk.spacing.edgeEdge': 20,
  'elk.layered.spacing.edgeEdgeBetweenLayers': 20,
  // Disconnected subgraphs read as separate clusters, not one mass.
  'elk.spacing.componentComponent': 80,
  'elk.padding': `[top=${CONTAINER_PADDING + CONTAINER_LABEL_GAP},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
}

// FNV-1a hash: deterministically convert a seed string to a signed int32.
// ELK's `org.eclipse.elk.randomSeed` is INT-typed; handed a non-numeric string
// (like `'default'` from SAVE_SEED) it silently ignores the option, so the
// wire-format string seed has to become an integer before it reaches elk.
//
// `Math.imul` is the exact int32 multiply - a plain `hash * 16777619` overflows
// the 53-bit mantissa once `hash` passes 2^29 and starts rounding, which is
// still deterministic but is no longer FNV-1a. Same string always hashes to the
// same int32, across reloads and machines.
function seedToInt32(seed: string): number {
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  }
  return hash | 0
}

// Shared by the full-graph layout effect and the visible-subgraph relayout
// that runs on view switch, so both always agree on algorithm/direction.
//
// Three backends, chosen by headless measurement on this repo's own 258-node
// graph:
// - `layered` - elk's `layered` algorithm, today's default directional
//   (org-chart style) layout. Seed has no measurable effect on crossing
//   minimization on this repo's graph and is silently ignored.
// - `radial` - cytoscape's own built-in `concentric`, not elk's `radial`
//   algorithm (measured unusable on this graph: a tree algorithm, 17.5k
//   overlapping node pairs). Concentric filters compound parents itself
//   (`eles.nodes().not(':parent')`), so parents wrap their children instead
//   of being concentric-positioned themselves - measured 0 parent overlaps.
//   Not elk-based, so no seed support.
// - `force` - elk's `stress` algorithm, first pass only. Seed deterministically
//   changes the initial random placement; measured to be the only backend where
//   randomSeed visibly alters final positions. The `sporeOverlap` overlap-removal
//   second pass is Task 3's business: it needs this first pass to have finished
//   before it can run.
//
// `elk.direction` is ignored by every elk algorithm except `layered`
// (verified: identical container boxes for DOWN and RIGHT on `stress`), so
// only `layered` reads `direction`.
export function buildLayoutConfig(
  layout: 'layered' | 'radial' | 'force',
  direction: 'top-down' | 'left-right',
  seed?: string
): cytoscape.LayoutOptions {
  if (layout === 'radial') {
    return {
      name: 'concentric',
      avoidOverlap: true,
      spacingFactor: 1.4,
      animate: false,
      nodeDimensionsIncludeLabels: false,
    }
  }
  if (layout === 'force') {
    const config: ElkLayoutOptions = {
      name: 'elk',
      elk: {
        algorithm: 'stress',
        'org.eclipse.elk.stress.desiredEdgeLength': 320,
      },
    }
    if (seed !== undefined) {
      config.elk['elk.randomSeed'] = seedToInt32(seed)
    }
    return config as unknown as cytoscape.LayoutOptions
  }
  // layered: no seed wiring (seed has no measurable effect on crossing
  // minimization in this repo's graph; measured via headless elk on a
  // 10-node asymmetric crossing-prone fixture)
  const elk: ElkLayoutOptions['elk'] = {
    algorithm: 'layered',
    'elk.direction': direction === 'top-down' ? 'DOWN' : 'LEFT',
    ...ELK_SPACING,
  }
  const config: ElkLayoutOptions = {
    name: 'elk',
    elk,
    nodeLayoutOptions: (node) => (node.isParent() ? ELK_SPACING : undefined),
  }
  return config as unknown as cytoscape.LayoutOptions
}

// Build the cytoscape stylesheet with base node style, layer-specific overrides,
// edge style, and selected-state highlight class.
// Stylesheet entries match StylesheetStyle shape (selector + style properties)
const STYLESHEET: cytoscape.StylesheetJsonBlock[] = [
  {
    selector: 'node',
    style: {
      'background-color': DEFAULT_FILL,
      'border-color': DEFAULT_BORDER,
      'border-width': 2,
      shape: 'roundrectangle',
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      padding: '8px',
      label: 'data(wrapLabel)',
      'font-size': 12,
      'text-wrap': 'wrap',
      'text-max-width': `${LABEL_MAX_TEXT_WIDTH}px`,
      'text-halign': 'center',
      'text-valign': 'center',
      color: '#333333',
    },
  },
  {
    selector: 'node[layer = "motivation"]',
    style: {
      'background-color': LAYER_COLORS.motivation.fill,
      'border-color': LAYER_COLORS.motivation.border,
    },
  },
  {
    selector: 'node[layer = "strategy"]',
    style: {
      'background-color': LAYER_COLORS.strategy.fill,
      'border-color': LAYER_COLORS.strategy.border,
    },
  },
  {
    selector: 'node[layer = "business"]',
    style: {
      'background-color': LAYER_COLORS.business.fill,
      'border-color': LAYER_COLORS.business.border,
    },
  },
  {
    selector: 'node[layer = "application"]',
    style: {
      'background-color': LAYER_COLORS.application.fill,
      'border-color': LAYER_COLORS.application.border,
    },
  },
  {
    selector: 'node[layer = "technology"]',
    style: {
      'background-color': LAYER_COLORS.technology.fill,
      'border-color': LAYER_COLORS.technology.border,
    },
  },
  {
    selector: 'node[layer = "implementation"]',
    style: {
      'background-color': LAYER_COLORS.implementation.fill,
      'border-color': LAYER_COLORS.implementation.border,
    },
  },
  {
    // Compound container (see resolveCompositionParents below): keeps its own
    // layer fill/border from the rules above but at low opacity with a dashed
    // border, so its ArchiMate type stays legible while still reading as a
    // grouping box rather than a plain node. The label is drawn above the box
    // entirely, in the `CONTAINER_LABEL_GAP` band ELK reserves but cytoscape
    // does not draw into, so it clears both the children and its own border.
    selector: 'node:parent',
    style: {
      shape: 'roundrectangle',
      'background-opacity': 0.25,
      'border-width': 2,
      'border-style': 'dashed',
      padding: `${CONTAINER_PADDING}px`,
      label: 'data(wrapLabel)',
      'font-size': 13,
      'font-weight': 'bold',
      'text-halign': 'center',
      'text-valign': 'top',
      'text-margin-y': -8,
      color: '#333333',
    },
  },
  {
    selector: 'node.selected',
    style: {
      'border-color': '#FF6B6B',
      'border-width': 4,
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': '#999999',
      width: 1.5,
      'curve-style': 'round-taxi',
      'taxi-radius': 25,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#999999',
      label: 'data(wrapLabel)',
      'font-size': 10,
      // ELK reserves no space for edge text (cytoscape-elk's `makeEdge` never
      // emits `labels[]`), so a long relationship name renders as one wide
      // banner across the midpoint and collides with whatever else routes
      // through there. Wrapping caps how far that text can reach sideways.
      'text-wrap': 'wrap',
      'text-max-width': `${EDGE_LABEL_MAX_TEXT_WIDTH}px`,
      'text-background-color': '#FFFFFF',
      'text-background-padding': '3px',
      // Fully opaque: labels that still overlap occlude cleanly instead of
      // interleaving into unreadable text.
      'text-background-opacity': 1,
    },
  },
  {
    selector: 'edge.selected',
    style: {
      'line-color': '#FF6B6B',
      'target-arrow-color': '#FF6B6B',
      width: 2.5,
    },
  },
]

// Composition expresses exclusive whole-part structure (ADR 0004: a workspace
// cannot claim both composition and aggregation over the same ordered pair),
// which maps 1:1 onto cytoscape's compound `parent` field - the container is
// the relationship's `from`, the nested child its `to`. Aggregation is
// deliberately excluded: it allows a part to belong to multiple wholes at
// once, which a single `parent` field can't represent, so it stays a normal
// rendered edge like every other relationship kind. Composition edges that
// are consumed into nesting are never also drawn as a line.
const COMPOSITION_RELATIONSHIP_KIND = 'yarramate/core@0.1#composition'

// The compiler's YM501 rule only rejects the same (from, to) pair declaring
// both composition and aggregation - it does not reject two different
// composition relationships naming the same `to`, which cytoscape's
// single-parent field can't represent either. Nor does anything upstream
// reject a composition chain that loops back on itself, which cytoscape's
// compound nesting must be acyclic to render. Both are real modeling
// anomalies this layer surfaces rather than silently resolving: affected
// subjects are left unnested (ordinary top-level nodes) and every
// composition edge naming them stays drawn as a regular edge, so the
// conflicting claims stay visible on the canvas instead of one silently
// winning.
function resolveCompositionParents(edges: readonly CanvasEdge[]): {
  readonly parentOf: ReadonlyMap<string, string>
  readonly consumedEdgeIds: ReadonlySet<string>
} {
  const compositionEdges = edges.filter((edge) => edge.kind === COMPOSITION_RELATIONSHIP_KIND)

  const claimsByChild = new Map<string, CanvasEdge[]>()
  for (const edge of compositionEdges) {
    const claims = claimsByChild.get(edge.to)
    if (claims === undefined) {
      claimsByChild.set(edge.to, [edge])
    } else {
      claims.push(edge)
    }
  }

  const parentOf = new Map<string, string>()
  for (const [child, claims] of claimsByChild) {
    if (claims.length === 1) {
      parentOf.set(child, claims[0]!.from)
    } else {
      console.warn(
        `Composition conflict: "${child}" is claimed as a part by ${claims.length} different wholes (${claims.map((claim) => claim.from).join(', ')}) - rendering it unnested; every claim stays drawn as a regular edge.`
      )
    }
  }

  // Walk each child's parent chain; a ancestor id revisited before the chain
  // runs out marks a cycle. Only the cycle itself is unnested, not whatever
  // leads into it - a straight-line ancestor of a cycle is still validly
  // nested under its own (non-cyclic) parent.
  const cycleMembers = new Set<string>()
  for (const start of parentOf.keys()) {
    const path: string[] = []
    const indexInPath = new Map<string, number>()
    let current: string | undefined = start
    while (current !== undefined) {
      const seenAt = indexInPath.get(current)
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cycleMembers.add(id)
        break
      }
      indexInPath.set(current, path.length)
      path.push(current)
      current = parentOf.get(current)
    }
  }
  if (cycleMembers.size > 0) {
    console.warn(`Composition cycle detected among: ${[...cycleMembers].join(', ')} - rendering them unnested.`)
    for (const id of cycleMembers) parentOf.delete(id)
  }

  const consumedEdgeIds = new Set<string>()
  for (const edge of compositionEdges) {
    if (parentOf.get(edge.to) === edge.from) consumedEdgeIds.add(edge.id)
  }

  return { parentOf, consumedEdgeIds }
}

// Convert CanvasGraph nodes and edges to cytoscape ElementDefinition format
function graphToElements(graph: CanvasGraph): ElementDefinition[] {
  const { parentOf, consumedEdgeIds } = resolveCompositionParents(graph.edges)

  const nodeElements = graph.nodes.map((node): ElementDefinition => {
    const parent = parentOf.get(node.id)
    return {
      data: {
        id: node.id,
        label: node.name,
        wrapLabel: withWrapPoints(node.name),
        kind: node.kind,
        kindLabel: node.kindLabel,
        layer: node.layer,
        status: node.status,
        // `parent` is cytoscape's live nesting pointer and `applyFilter` moves
        // it as views come and go, so the model's own claim is kept alongside
        // it under a key cytoscape does not interpret. Without this the
        // canonical parent would be unrecoverable after the first detach.
        ...(parent === undefined ? {} : { parent, compositionParent: parent }),
      },
      group: 'nodes',
    }
  })

  const edgeElements = graph.edges
    .filter((edge) => !consumedEdgeIds.has(edge.id))
    .map(
      (edge): ElementDefinition => ({
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          label: edge.name ?? edge.kindLabel,
          wrapLabel: withWrapPoints(edge.name ?? edge.kindLabel),
        },
        group: 'edges',
      })
    )

  return [...nodeElements, ...edgeElements]
}

// Recompute which elements cytoscape shows from the structural (server-matched)
// `matchedIds` filter and the client-side `quickFilterText` narrowing, then
// hide/show elements in one pass. `matchedIds === null` means "no structural
// filter" (all nodes eligible); an empty/whitespace `quickFilterText` means "no
// quick-filter narrowing". An edge is visible iff both its endpoints are
// visible nodes - an edge's own label never keeps it visible independently.
// Binary hide/show only, mirroring the "no partial/dimmed state" principle
// used for selection highlighting below - never CSS opacity/dimming.
//
// Quick-filter narrows by substring match (case-insensitive) against a node's
// own id, name (`data('label')`), or kind label (`data('kindLabel')`) - the
// design doc's "name/id substring", extended to the kind label so filtering by
// e.g. "applicationComponent" also works.
export function applyFilter(
  cy: Core,
  matchedIds: readonly string[] | null,
  quickFilterText: string
): void {
  const trimmedQuickFilter = quickFilterText.trim().toLowerCase()
  const baseNodeIds = matchedIds === null ? cy.nodes().map((node) => node.id()) : matchedIds

  const nodeMatchesQuickFilter = (id: string): boolean => {
    if (id.toLowerCase().includes(trimmedQuickFilter)) return true
    const node = cy.getElementById(id)
    const label = node.data('label')
    if (typeof label === 'string' && label.toLowerCase().includes(trimmedQuickFilter)) return true
    const kindLabel = node.data('kindLabel')
    return typeof kindLabel === 'string' && kindLabel.toLowerCase().includes(trimmedQuickFilter)
  }

  const visibleNodeIds = new Set(
    trimmedQuickFilter === ''
      ? baseNodeIds
      : baseNodeIds.filter(nodeMatchesQuickFilter)
  )

  // A compound child that matches the filter needs its container(s) shown
  // too, or it renders as a stray top-level node instead of the nested part
  // the model claims it is - pull in every visible node's ancestor chain.
  // The walk follows the model's own `compositionParent` claim rather than
  // cytoscape's live `parent`, because a node detached by an earlier filter
  // pass has no live parent left to walk.
  const canonicalParentOf = (id: string): string | undefined => {
    const claimed = cy.getElementById(id).data('compositionParent')
    return typeof claimed === 'string' ? claimed : undefined
  }
  for (const id of [...visibleNodeIds]) {
    const seen = new Set<string>([id])
    let ancestor = canonicalParentOf(id)
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor)
      visibleNodeIds.add(ancestor)
      ancestor = canonicalParentOf(ancestor)
    }
  }

  // Containment is a rendering device, so it only holds while both ends of the
  // claim are on screen. cytoscape derives a compound parent's position from
  // its children, and a hidden child keeps the coordinates the last full-graph
  // layout gave it - so a container whose parts are all filtered out gets
  // dragged back to its old position the instant a scoped layout places it,
  // stranding it thousands of pixels from the view it belongs to. Detaching
  // hidden children leaves the whole as an ordinary node, which the layout can
  // place; re-attaching restores the nesting when the parts come back.
  // Decisions are read from canonical data and collected before any `move`,
  // since moving re-creates elements and invalidates live parent lookups.
  const reparents: { readonly node: string; readonly parent: string | null }[] = []
  for (const node of cy.nodes()) {
    const canonical = canonicalParentOf(node.id())
    if (canonical === undefined) continue
    const desired = visibleNodeIds.has(node.id()) && visibleNodeIds.has(canonical) ? canonical : null
    const current = node.parent().nonempty() ? node.parent().first().id() : null
    if (current !== desired) reparents.push({ node: node.id(), parent: desired })
  }
  // `move` carries data and classes across but drops inline style, so it has to
  // land before the display pass below rather than after it.
  for (const { node, parent } of reparents) cy.getElementById(node).move({ parent })

  const visibleIds = new Set<string>(visibleNodeIds)
  for (const edge of cy.edges()) {
    const source = edge.data('source') as string
    const target = edge.data('target') as string
    if (visibleNodeIds.has(source) && visibleNodeIds.has(target)) {
      visibleIds.add(edge.id())
    }
  }

  cy.elements().style('display', 'none')
  cy.elements()
    .filter((ele) => visibleIds.has(ele.id()))
    .style('display', 'element')
}

// Positions come from the last full-graph layout, which packs every node
// (including ones a view hides) into one shared coordinate space. Reusing
// those positions for a disjoint visible subset leaves it scattered across
// the old full-graph span - relaying out just the visible collection gives
// each view a fresh, compact layout instead. cytoscape-elk's own `fit: true`
// default re-frames the viewport to the result, so no separate fit call is
// needed; `layout()` is a no-op on an empty visible collection, so callers
// never need to guard against "the new view matched nothing".
export function relayoutVisible(cy: Core, direction: 'top-down' | 'left-right'): void {
  cy.elements(':visible')
    .layout(buildLayoutConfig('layered', direction))
    .run()
}

// `dragfree` fires once per drag (unlike `position`, which fires on every
// intermediate frame), so it is the natural trigger for a layout save - but a
// reviewer repositioning several nodes in quick succession should still
// coalesce into one save carrying the final layout, not one write per node.
export const DRAG_SAVE_DEBOUNCE_MS = 500

// Whole-sidecar snapshot of every node's current position, keyed by subject
// id. `layout.save` always writes the full map, never a partial patch, so
// the server's `yarramate/visual-layout/v1` document stays self-consistent
// with whatever the canvas showed at save time.
export function buildPositionMap(nodes: NodeCollection): VisualLayoutPositions {
  const positions: Record<string, { readonly x: number; readonly y: number }> = {}
  nodes.forEach((node) => {
    const { x, y } = node.position()
    positions[node.id()] = { x, y }
  })
  return positions
}

// Pins every node the sidecar names to its saved position; a node the
// sidecar doesn't mention keeps wherever the layout run that just finished
// placed it. Runs after layout completes - there is no per-node "leave this
// one alone" hook in `nodeLayoutOptions`, so overriding the finished result
// is the only way to keep a subset fixed while ELK freely places the rest.
export function applySavedPositions(cy: Core, saved: VisualLayoutPositions | undefined): void {
  if (saved === undefined) return
  cy.nodes().forEach((node) => {
    const position = saved[node.id()]
    if (position !== undefined) node.position(position)
  })
}

export interface DragSaveHandle {
  /** Cancels a queued save without unbinding the drag listener. */
  readonly cancelPending: () => void
  /** Unbinds the drag listener and cancels any queued save. */
  readonly dispose: () => void
}

// Wires cytoscape's `dragfree` to a debounced whole-layout save. `getActiveViewId`
// and `onSaveLayout` are read through indirection functions (rather than closed
// over directly) so the component can keep this registration alive for its
// whole lifetime while still always saving against the current view and
// calling the current prop.
export function registerDragSave(
  cy: Core,
  getActiveViewId: () => string,
  onSaveLayout: (payload: VisualLayoutSavePayload) => void,
): DragSaveHandle {
  let timer: NodeJS.Timeout | null = null
  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const handler = () => {
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      const projectionId = getActiveViewId()
      // The unfiltered pseudo-view is not a saved projection; the server
      // rejects a save aimed at it.
      if (projectionId === '') return
      onSaveLayout({ projectionId, positions: buildPositionMap(cy.nodes()) })
    }, DRAG_SAVE_DEBOUNCE_MS)
  }
  cy.on('dragfree', 'node', handler)
  return {
    cancelPending,
    dispose: () => {
      cy.off('dragfree', 'node', handler)
      cancelPending()
    },
  }
}

interface GraphCanvasProps {
  readonly graph: CanvasGraph
  readonly selectedId: string | null
  readonly onSelect: (id: string, type: 'node' | 'edge') => void
  readonly matchedIds: readonly string[] | null
  readonly quickFilterText: string
  readonly direction: 'top-down' | 'left-right'
  readonly activeViewId: string
  /** Saved layout for the active view, or undefined when it has none yet. */
  readonly savedPositions: VisualLayoutPositions | undefined
  readonly onSaveLayout: (payload: VisualLayoutSavePayload) => void
}

/**
 * GraphCanvas: renders a CanvasGraph using cytoscape with elk hierarchical layout.
 *
 * - Creates a cytoscape instance once on mount, destroys it on unmount
 * - Updates elements and reruns layout whenever the graph reference changes
 * - Applies layer-based coloring via the ArchiMate palette
 * - Wires node/edge tap handlers to call onSelect(id, type)
 * - Reflects selectedId prop as a visual highlight class on the matching element
 */
export function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  matchedIds,
  quickFilterText,
  direction,
  activeViewId,
  savedPositions,
  onSaveLayout,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)
  const isInitialSyncRef = useRef(true)
  const activeViewIdRef = useRef(activeViewId)
  const directionRef = useRef(direction)
  const pendingViewFitRef = useRef(false)
  // Keep latest onSaveLayout and savedPositions for the drag-save handler
  const onSaveLayoutRef = useRef(onSaveLayout)
  const savedPositionsRef = useRef(savedPositions)
  const dragSaveHandleRef = useRef<DragSaveHandle | null>(null)

  // Keep onSelectRef up-to-date so tap handlers always call the latest prop
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Keep onSaveLayoutRef up-to-date for the drag-save handler
  useEffect(() => {
    onSaveLayoutRef.current = onSaveLayout
  }, [onSaveLayout])

  // Keep savedPositionsRef up-to-date for the layoutstop handler
  useEffect(() => {
    savedPositionsRef.current = savedPositions
  }, [savedPositions])

  // Cancel pending drag-save when the active view changes, so a queued save
  // never lands against a different view's sidecar. Also cleared on unmount.
  useEffect(() => {
    dragSaveHandleRef.current?.cancelPending()
  }, [activeViewId])

  // Mount effect: create cytoscape instance once on mount, wire tap and
  // layoutstop handlers, setup drag-save, cleanup on unmount.
  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      elements: graphToElements(graph),
      style: STYLESHEET,
      wheelSensitivity: 0.1,
      layout: { name: 'null' },
    })

    cyRef.current = cy

    // Tap handler for nodes
    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id()
      onSelectRef.current(nodeId, 'node')
    })

    // Tap handler for edges
    cy.on('tap', 'edge', (evt) => {
      const edgeId = evt.target.id()
      onSelectRef.current(edgeId, 'edge')
    })

    // Drag-end → debounced layout save with full position snapshot
    dragSaveHandleRef.current = registerDragSave(
      cy,
      () => activeViewIdRef.current,
      (payload) => onSaveLayoutRef.current(payload),
    )

    // After each layout run completes, pin nodes to their saved positions
    cy.on('layoutstop', () => {
      applySavedPositions(cy, savedPositionsRef.current)
    })

    return () => {
      dragSaveHandleRef.current?.dispose()
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // Update elements whenever the graph itself changes, laying out with the
  // current direction. Deliberately NOT keyed on `direction` - a full
  // remove/re-add + unscoped layout over every element (not just what's
  // currently visible) on every direction toggle would blow away the
  // filtered/view-scoped canvas and reintroduce the sprawl a view switch
  // once had. Direction-only changes are handled by the pending-fit effect
  // below, which reruns `relayoutVisible` scoped to what's actually shown.
  useEffect(() => {
    if (!cyRef.current) return

    if (isInitialSyncRef.current) {
      isInitialSyncRef.current = false
    } else {
      const elements = graphToElements(graph)
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
    }

    const layout = cyRef.current.layout(buildLayoutConfig('layered', direction))
    layout.run()
  }, [graph])

  // Update selection highlight when selectedId or graph changes
  useEffect(() => {
    if (!cyRef.current) return

    cyRef.current.elements().removeClass('selected')

    if (selectedId) {
      const element = cyRef.current.getElementById(selectedId)
      if (element.nonempty()) {
        element.addClass('selected')
      }
    }
  }, [selectedId, graph])

  // Arms a pending fit whenever the active view or layout direction
  // changes. Declared before the filter-apply effect below - same-phase
  // effects commit in source order, so a view switch whose filter result
  // lands in the very same render (e.g. clearing back to "All") is still
  // armed in time for that commit.
  useEffect(() => {
    const viewChanged = activeViewId !== activeViewIdRef.current
    const directionChanged = direction !== directionRef.current
    if (!viewChanged && !directionChanged) return
    activeViewIdRef.current = activeViewId
    directionRef.current = direction
    pendingViewFitRef.current = true
  }, [activeViewId, direction])

  // Apply structural filter (matchedIds) and quick-filter narrowing, then,
  // only once a pending view-switch relayout is armed and its filter result
  // has actually landed, rerun layout scoped to whatever is visible now -
  // see `relayoutVisible` for why a fresh layout (not just a re-fit) is
  // needed here.
  useEffect(() => {
    if (!cyRef.current) return
    applyFilter(cyRef.current, matchedIds, quickFilterText)
    if (pendingViewFitRef.current) {
      pendingViewFitRef.current = false
      relayoutVisible(cyRef.current, direction)
    }
  }, [matchedIds, quickFilterText, graph, direction])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
