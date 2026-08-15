import type React from 'react'
import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, ElementDefinition } from 'cytoscape'
import elk from 'cytoscape-elk'
import type {
  CanvasGraph,
  CanvasNode,
  CanvasEdge,
} from '../graph-projection.js'

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
// `elements().remove()`). Size nodes explicitly instead, precomputed once per node
// via canvas text measurement and passed through as plain numeric node data - the
// `'data(labelWidth)'` / `'data(labelHeight)'` mappers below never re-measure text
// during rendering or layout, so they carry none of that risk.
const LABEL_FONT = '12px Helvetica Neue, Helvetica, Arial, sans-serif'
const LABEL_LINE_HEIGHT = 15
const LABEL_MAX_TEXT_WIDTH = 150
const LABEL_MIN_WIDTH = 40
const measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')

// ELK layout options: extends base layout with elk-specific config not in cytoscape's types
interface ElkLayoutOptions extends Record<string, unknown> {
  name: 'elk'
  elk: {
    algorithm: 'layered' | string
    'elk.direction': 'DOWN' | 'UP' | 'LEFT' | 'RIGHT'
    [key: string]: unknown
  }
}

// Shared by the full-graph layout effect and the visible-subgraph relayout
// that runs on view switch, so both always agree on algorithm/direction.
function buildLayoutConfig(direction: 'top-down' | 'left-right'): ElkLayoutOptions {
  return {
    name: 'elk',
    elk: {
      algorithm: 'layered',
      'elk.direction': direction === 'top-down' ? 'DOWN' : 'LEFT',
    },
  }
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
      width: 'data(labelWidth)',
      height: 'data(labelHeight)',
      padding: '8px',
      label: 'data(label)',
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
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#999999',
      label: 'data(label)',
      'font-size': 10,
      'text-background-color': '#FFFFFF',
      'text-background-padding': '2px',
      'text-background-opacity': 0.8,
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

// Greedy word-wrap a label at LABEL_MAX_TEXT_WIDTH (mirroring cytoscape's own
// 'text-wrap': 'wrap' behavior) and return the resulting box size. Computed once per
// node in `graphToElements`, not from within a cytoscape style function - see the
// `LABEL_FONT` comment above for why.
function wrappedLabelSize(label: string): { labelWidth: number; labelHeight: number } {
  if (measureCtx === null || label === '') {
    return { labelWidth: LABEL_MIN_WIDTH, labelHeight: LABEL_LINE_HEIGHT }
  }

  measureCtx.font = LABEL_FONT
  const spaceWidth = measureCtx.measureText(' ').width
  let lineCount = 1
  let currentLineWidth = 0
  let maxLineWidth = 0

  for (const word of label.split(/\s+/)) {
    const wordWidth = measureCtx.measureText(word).width
    const candidateWidth =
      currentLineWidth === 0 ? wordWidth : currentLineWidth + spaceWidth + wordWidth
    if (candidateWidth > LABEL_MAX_TEXT_WIDTH && currentLineWidth > 0) {
      maxLineWidth = Math.max(maxLineWidth, currentLineWidth)
      lineCount += 1
      currentLineWidth = wordWidth
    } else {
      currentLineWidth = candidateWidth
    }
  }
  maxLineWidth = Math.max(maxLineWidth, currentLineWidth)

  return {
    labelWidth: Math.max(LABEL_MIN_WIDTH, Math.min(maxLineWidth, LABEL_MAX_TEXT_WIDTH)),
    labelHeight: lineCount * LABEL_LINE_HEIGHT,
  }
}

// Convert CanvasGraph nodes and edges to cytoscape ElementDefinition format
function graphToElements(graph: CanvasGraph): ElementDefinition[] {
  const nodeElements = graph.nodes.map(
    (node): ElementDefinition => ({
      data: {
        id: node.id,
        label: node.name,
        kind: node.kind,
        kindLabel: node.kindLabel,
        layer: node.layer,
        status: node.status,
        ...wrappedLabelSize(node.name),
      },
      group: 'nodes',
    })
  )

  const edgeElements = graph.edges.map(
    (edge): ElementDefinition => ({
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.name ?? edge.kindLabel,
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
    .layout(buildLayoutConfig(direction) as unknown as cytoscape.LayoutOptions)
    .run()
}

interface GraphCanvasProps {
  readonly graph: CanvasGraph
  readonly selectedId: string | null
  readonly onSelect: (id: string, type: 'node' | 'edge') => void
  readonly matchedIds: readonly string[] | null
  readonly quickFilterText: string
  readonly direction: 'top-down' | 'left-right'
  readonly activeViewId: string
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
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)
  // True until the sync effect below has run once; the mount effect already
  // populates initial elements, so that first sync run only needs to trigger
  // layout, not redundantly remove and re-add the elements it just created.
  const isInitialSyncRef = useRef(true)
  // Tracks the view active on the previous render, and whether a fit is
  // pending because of it. `navigate()` updates `activeViewId` synchronously
  // but `filter()` round-trips through the server, so a view switch's
  // matched set can land on a later render than the id change itself -
  // fitting eagerly on the id change would fit to the *previous* view's
  // still-current matchedIds. Narrower quick-filter typing or a chat-driven
  // structural filter over the same view leaves this alone, so pan/zoom
  // don't jump under the reviewer mid-type.
  const activeViewIdRef = useRef(activeViewId)
  const pendingViewFitRef = useRef(false)

  // Keep onSelectRef up-to-date so tap handlers always call the latest prop
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Mount effect: create cytoscape instance once on mount, wire tap handlers,
  // cleanup on unmount. Intentionally NOT keyed on `graph` - recreating the
  // instance on every graph update would discard pan/zoom/viewport state.
  // Reads `graph` only for the initial element set; the effect below (keyed
  // on `graph`) keeps elements in sync on every subsequent change in place.
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

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // Update elements and layout whenever graph changes
  useEffect(() => {
    if (!cyRef.current) return

    if (isInitialSyncRef.current) {
      isInitialSyncRef.current = false
    } else {
      const elements = graphToElements(graph)
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
    }

    const layout = cyRef.current.layout(
      buildLayoutConfig(direction) as unknown as cytoscape.LayoutOptions
    )
    layout.run()
  }, [graph, direction])

  // Update selection highlight when selectedId or graph changes
  useEffect(() => {
    if (!cyRef.current) return

    // Clear previous selection class from all elements
    cyRef.current.elements().removeClass('selected')

    // Apply selection class to the matching element
    if (selectedId) {
      const element = cyRef.current.getElementById(selectedId)
      if (element.nonempty()) {
        element.addClass('selected')
      }
    }
  }, [selectedId, graph])

  // Arms a pending fit whenever the active view changes. Declared before the
  // filter-apply effect below - same-phase effects commit in source order,
  // so a view switch whose filter result lands in the very same render
  // (e.g. clearing back to "All") is still armed in time for that commit.
  useEffect(() => {
    if (activeViewId === activeViewIdRef.current) return
    activeViewIdRef.current = activeViewId
    pendingViewFitRef.current = true
  }, [activeViewId])

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
