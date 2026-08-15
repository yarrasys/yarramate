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

// ELK layout options: extends base layout with elk-specific config not in cytoscape's types
interface ElkLayoutOptions extends Record<string, unknown> {
  name: 'elk'
  elk: {
    algorithm: 'layered' | string
    'elk.direction': 'DOWN' | 'UP' | 'LEFT' | 'RIGHT'
    [key: string]: unknown
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
      width: 'label',
      height: 'label',
      padding: '8px',
      label: 'data(label)',
      'font-size': 12,
      'text-wrap': 'wrap',
      'text-max-width': '150px',
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

interface GraphCanvasProps {
  readonly graph: CanvasGraph
  readonly selectedId: string | null
  readonly onSelect: (id: string, type: 'node' | 'edge') => void
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
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)

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

    const elements = graphToElements(graph)
    cyRef.current.elements().remove()
    cyRef.current.add(elements)

    const layoutConfig: ElkLayoutOptions = {
      name: 'elk',
      elk: {
        algorithm: 'layered',
        'elk.direction': 'DOWN',
      },
    }

    const layout = cyRef.current.layout(layoutConfig as unknown as cytoscape.LayoutOptions)
    layout.run()
  }, [graph])

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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
