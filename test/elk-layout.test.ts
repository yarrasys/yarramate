import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  CONTAINER_PADDING,
  arcPosition,
  buildElkGraph,
  edgeLabelSize,
  edgeLabelText,
  layoutWithElk,
  readElkLayout,
  rootLayoutOptions,
  spacingFor,
} from '../src/visual-app/elk-layout.js'
import type { ElkNode } from 'elkjs/lib/elk.bundled.js'
import { LAYOUT_MODES } from '../src/layout-mode.js'

// Two boxes with a member each, one loose subject, and three relationships:
// an unnamed serving, a named flow, and an association from the application
// layer up to the business layer. Sized like production (170x50).
const buildFixture = () =>
  cytoscape({
    styleEnabled: true,
    style: [{ selector: 'node', style: { width: 170, height: 50 } }],
    layout: { name: 'null' },
    elements: [
      { data: { id: 'app', layer: 'application' }, group: 'nodes' as const },
      { data: { id: 'fn', layer: 'application', parent: 'app' }, group: 'nodes' as const },
      { data: { id: 'infra', layer: 'technology' }, group: 'nodes' as const },
      { data: { id: 'node', layer: 'technology', parent: 'infra' }, group: 'nodes' as const },
      { data: { id: 'actor', layer: 'business' }, group: 'nodes' as const },
      { data: { id: 'grp', layer: 'composite' }, group: 'nodes' as const },
      {
        data: { id: 'serves', source: 'node', target: 'fn', name: null, kindLabel: 'serving', coreKindLabel: 'serving' },
        group: 'edges' as const,
      },
      {
        data: { id: 'flows', source: 'fn', target: 'actor', name: 'greeting', kindLabel: 'flow', coreKindLabel: 'flow' },
        group: 'edges' as const,
      },
      {
        data: { id: 'assoc', source: 'app', target: 'actor', name: null, kindLabel: 'association', coreKindLabel: 'association' },
        group: 'edges' as const,
      },
    ],
  })

const edgeOf = (graph: ElkNode, id: string) => {
  const edge = (graph.edges ?? []).find((candidate) => candidate.id === id)
  if (edge === undefined) throw new Error(`no edge ${id}`)
  return edge
}
const nodeOf = (graph: ElkNode, id: string): ElkNode => {
  const walk = (node: ElkNode): ElkNode | undefined => {
    if (node.id === id) return node
    for (const child of node.children ?? []) {
      const found = walk(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  const found = walk(graph)
  if (found === undefined) throw new Error(`no node ${id}`)
  return found
}

describe('rootLayoutOptions', () => {
  it('asks layered for exactly what shipped, under the qualified aspect-ratio key', () => {
    const options = rootLayoutOptions('top-down', 'layered')
    expect(options['elk.algorithm']).toBe('layered')
    expect(options['elk.aspectRatio']).toBe('2.5')
    expect(options['elk.spacing.edgeEdge']).toBe('20')
    for (const key of [
      'elk.hierarchyHandling',
      'elk.edgeRouting',
      'elk.edgeLabels.inline',
      'elk.partitioning.activate',
      'elk.layered.considerModelOrder.strategy',
    ]) {
      expect(options).not.toHaveProperty(key)
    }
  })

  it('asks a routed mode to route around nodes and reserve label room', () => {
    for (const mode of ['routed', 'served-by', 'bands'] as const) {
      const options = rootLayoutOptions('top-down', mode)
      expect(options['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN')
      expect(options['elk.edgeRouting']).toBe('ORTHOGONAL')
      expect(options['elk.edgeLabels.inline']).toBe('true')
      expect(options['elk.spacing.edgeEdge']).toBe('30')
      expect(options['elk.layered.spacing.edgeEdgeBetweenLayers']).toBe('20')
    }
  })

  // Measured: `EDGE_LENGTH` post-compaction throws inside ELK on a nested
  // graph. Pinned as an absence.
  it('never asks for post-compaction, in any mode', () => {
    for (const mode of LAYOUT_MODES) {
      for (const key of Object.keys(rootLayoutOptions('top-down', mode))) {
        expect(key).not.toContain('postCompaction')
      }
    }
  })

  it('activates partitioning for bands alone', () => {
    expect(rootLayoutOptions('top-down', 'bands')['elk.partitioning.activate']).toBe('true')
    for (const mode of ['layered', 'routed', 'served-by'] as const) {
      expect(rootLayoutOptions('top-down', mode)).not.toHaveProperty('elk.partitioning.activate')
    }
  })

  it('pads a container the same amount cytoscape draws, plus the label gap on top', () => {
    expect(spacingFor('layered')['elk.padding']).toBe(
      `[top=${CONTAINER_PADDING + 22},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
    )
  })
})

describe('edgeLabelText', () => {
  it('says the name when there is one, whatever the mode or the toggle', () => {
    for (const mode of LAYOUT_MODES) {
      expect(edgeLabelText({ name: 'greeting', coreKindLabel: 'flow' }, mode, true)).toBe('greeting')
      expect(edgeLabelText({ name: 'greeting', coreKindLabel: 'flow' }, mode, false)).toBe('greeting')
    }
  })

  it("reads an unnamed core kind in the layout's voice", () => {
    expect(edgeLabelText({ coreKindLabel: 'serving', kindLabel: 'serving' }, 'routed', true)).toBe('serves')
    expect(edgeLabelText({ coreKindLabel: 'serving', kindLabel: 'serving' }, 'served-by', true)).toBe('served by')
    expect(edgeLabelText({ coreKindLabel: 'serving', kindLabel: 'serving' }, 'bands', true)).toBe('served by')
    expect(edgeLabelText({ coreKindLabel: 'access', kindLabel: 'access' }, 'served-by', true)).toBe('accesses')
  })

  it('spells an extension kind out from its own name, in the active voice', () => {
    expect(edgeLabelText({ coreKindLabel: 'realization', kindLabel: 'deploys-to' }, 'served-by', true)).toBe(
      'deploys to',
    )
  })

  it('says nothing for an unnamed edge with kind labels off', () => {
    expect(edgeLabelText({ coreKindLabel: 'serving', kindLabel: 'serving' }, 'served-by', false)).toBe('')
  })

  it('counts what a lifted edge stands for', () => {
    expect(edgeLabelText({ coreKindLabel: 'access', kindLabel: 'access', liftedCount: 3 }, 'routed', true)).toBe(
      'accesses ×3',
    )
    expect(edgeLabelText({ coreKindLabel: 'access', kindLabel: 'access', liftedCount: 1 }, 'routed', true)).toBe(
      'accesses',
    )
  })
})

describe('edgeLabelSize', () => {
  it('sizes to the text and caps at the wrap width, growing a line per wrap', () => {
    expect(edgeLabelSize('serves')).toEqual({ width: 42, height: 16 })
    const long = edgeLabelSize('a relationship name long enough to wrap twice over')
    expect(long.width).toBe(110)
    expect(long.height).toBeGreaterThan(16)
  })
})

describe('buildElkGraph', () => {
  it('sizes leaves, nests members under their box, and leaves the box unsized', () => {
    const { graph } = buildElkGraph(buildFixture().elements(), {
      direction: 'top-down',
      mode: 'routed',
      showKindLabels: true,
    })
    const fn = nodeOf(graph, 'fn')
    expect(fn.width).toBe(170)
    expect(fn.height).toBe(50)
    const app = nodeOf(graph, 'app')
    expect(app.children?.map((child) => child.id)).toEqual(['fn'])
    expect(app.width).toBeUndefined()
    expect(app.layoutOptions?.['elk.spacing.nodeNode']).toBe('60')
    expect(graph.children?.map((child) => child.id).sort()).toEqual(['actor', 'app', 'grp', 'infra'])
    expect((graph.edges ?? []).map((edge) => edge.id).sort()).toEqual(['assoc', 'flows', 'serves'])
  })

  it('turns exactly the three upward kinds under served-by, and reports which', () => {
    const routed = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'routed', showKindLabels: true })
    expect(edgeOf(routed.graph, 'serves').sources).toEqual(['node'])
    expect(routed.reversed.size).toBe(0)
    const served = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'served-by', showKindLabels: true })
    expect(edgeOf(served.graph, 'serves').sources).toEqual(['fn'])
    expect(edgeOf(served.graph, 'serves').targets).toEqual(['node'])
    expect(edgeOf(served.graph, 'flows').sources).toEqual(['fn'])
    expect([...served.reversed]).toEqual(['serves'])
  })

  it('reserves a label for the reading in a routed mode, none for layered', () => {
    const routed = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'served-by', showKindLabels: true })
    expect(edgeOf(routed.graph, 'serves').labels?.[0]?.text).toBe('served by')
    expect(edgeOf(routed.graph, 'flows').labels?.[0]?.text).toBe('greeting')
    const layered = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'layered', showKindLabels: true })
    expect(edgeOf(layered.graph, 'serves').labels).toBeUndefined()
  })

  it('reserves no label for an unnamed edge when kind labels are off, and keeps a named one', () => {
    const { graph } = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'routed', showKindLabels: false })
    expect(edgeOf(graph, 'serves').labels).toBeUndefined()
    expect(edgeOf(graph, 'flows').labels?.[0]?.text).toBe('greeting')
  })

  it('bands every node by its layer, a box by its highest member, and a grouping not at all', () => {
    const { graph } = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'bands', showKindLabels: true })
    expect(nodeOf(graph, 'actor').layoutOptions?.['elk.partitioning.partition']).toBe('2')
    expect(nodeOf(graph, 'fn').layoutOptions?.['elk.partitioning.partition']).toBe('3')
    expect(nodeOf(graph, 'app').layoutOptions?.['elk.partitioning.partition']).toBe('3')
    expect(nodeOf(graph, 'infra').layoutOptions?.['elk.partitioning.partition']).toBe('4')
    expect(nodeOf(graph, 'grp').layoutOptions?.['elk.partitioning.partition']).toBeUndefined()
    const routed = buildElkGraph(buildFixture().elements(), { direction: 'top-down', mode: 'routed', showKindLabels: true })
    expect(nodeOf(routed.graph, 'actor').layoutOptions).toBeUndefined()
  })

  it('leaves out an edge whose end is not in the collection', () => {
    const cy = buildFixture()
    const { graph } = buildElkGraph(cy.elements().difference(cy.getElementById('actor')), {
      direction: 'top-down',
      mode: 'routed',
      showKindLabels: true,
    })
    expect((graph.edges ?? []).map((edge) => edge.id)).toEqual(['serves'])
  })
})

describe('readElkLayout', () => {
  // A hand-built answer: a box at (100, 100) holding a leaf at (10, 60)
  // inside it, a loose leaf, and an edge ELK filed under the box.
  const laid: ElkNode = {
    id: 'root',
    children: [
      {
        id: 'box',
        x: 100,
        y: 100,
        width: 250,
        height: 160,
        children: [{ id: 'in', x: 10, y: 60, width: 170, height: 50 }],
        edges: [
          {
            id: 'e',
            sources: ['in'],
            targets: ['out'],
            sections: [
              { id: 's', startPoint: { x: 95, y: 110 }, endPoint: { x: 400, y: 20 }, bendPoints: [{ x: 95, y: 20 }] },
            ],
            labels: [{ text: 'serves', x: 80, y: 40, width: 30, height: 12 }],
          },
        ],
      },
      { id: 'out', x: 500, y: 0, width: 170, height: 50 },
    ],
  }

  it('resolves leaf centres and routes into the root frame, offset by the container', () => {
    const placement = readElkLayout(laid, new Set())
    expect(placement.nodes.get('in')).toEqual({ x: 100 + 10 + 85, y: 100 + 60 + 25 })
    expect(placement.nodes.get('out')).toEqual({ x: 585, y: 25 })
    expect(placement.nodes.has('box')).toBe(false)
    const route = placement.edges.get('e')
    expect(route?.points).toEqual([
      { x: 195, y: 210 },
      { x: 195, y: 120 },
      { x: 500, y: 120 },
    ])
    // The label's centre (95, 46) in the box frame is (195, 146) in the root's:
    // 64px up the first, vertical leg from (195, 210).
    expect(route?.labelAt).toBeCloseTo(64, 5)
  })

  it('turns a reversed route back to run source to target, label position included', () => {
    const placement = readElkLayout(laid, new Set(['e']))
    const route = placement.edges.get('e')
    expect(route?.points[0]).toEqual({ x: 500, y: 120 })
    expect(route?.points[2]).toEqual({ x: 195, y: 210 })
    expect(route?.labelAt).toBeCloseTo(90 + 305 - 64, 5)
  })

  it('honours an edge container ELK names explicitly', () => {
    const moved: ElkNode = {
      ...laid,
      children: laid.children!.map((child) => (child.id === 'box' ? { ...child, edges: [] } : child)),
      edges: [{ ...laid.children![0]!.edges![0]!, container: 'box' }],
    }
    expect(readElkLayout(moved, new Set()).edges.get('e')?.points[0]).toEqual({ x: 195, y: 210 })
  })
})

describe('arcPosition', () => {
  it('measures along the polyline to the nearest point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 50, y: 100 },
    ]
    expect(arcPosition(points, { x: 5, y: 40 })).toBe(40)
    expect(arcPosition(points, { x: 25, y: 95 })).toBe(125)
  })
})

describe('with the engine', () => {
  // The whole reason for the modes, stated once against real ELK: under
  // served-by the served element sits above what serves it, and under bands
  // a business subject sits above an application one whatever the edge says.
  it('places the served element above its server under served-by, below it under routed', async () => {
    const place = async (mode: 'routed' | 'served-by') => {
      const cy = buildFixture()
      const { graph, reversed } = buildElkGraph(cy.elements(), { direction: 'top-down', mode, showKindLabels: true })
      const placement = readElkLayout(await layoutWithElk(graph), reversed)
      return { server: placement.nodes.get('node')!, served: placement.nodes.get('fn')! }
    }
    const routed = await place('routed')
    expect(routed.server.y).toBeLessThan(routed.served.y)
    const served = await place('served-by')
    expect(served.served.y).toBeLessThan(served.server.y)
  })

  it('stacks business above application under bands, against the association', async () => {
    const cy = cytoscape({
      styleEnabled: true,
      style: [{ selector: 'node', style: { width: 170, height: 50 } }],
      layout: { name: 'null' },
      elements: [
        { data: { id: 'app', layer: 'application' }, group: 'nodes' as const },
        { data: { id: 'actor', layer: 'business' }, group: 'nodes' as const },
        { data: { id: 'assoc', source: 'app', target: 'actor', coreKindLabel: 'association' }, group: 'edges' as const },
      ],
    })
    const place = async (mode: 'routed' | 'bands') => {
      const { graph, reversed } = buildElkGraph(cy.elements(), { direction: 'top-down', mode, showKindLabels: true })
      return readElkLayout(await layoutWithElk(graph), reversed).nodes
    }
    const routed = await place('routed')
    expect(routed.get('app')!.y).toBeLessThan(routed.get('actor')!.y)
    const banded = await place('bands')
    expect(banded.get('actor')!.y).toBeLessThan(banded.get('app')!.y)
  })

  it('routes every edge in a routed mode and leaves a label position on the labelled ones', async () => {
    const cy = buildFixture()
    const { graph, reversed } = buildElkGraph(cy.elements(), { direction: 'top-down', mode: 'routed', showKindLabels: true })
    const placement = readElkLayout(await layoutWithElk(graph), reversed)
    expect([...placement.edges.keys()].sort()).toEqual(['assoc', 'flows', 'serves'])
    for (const route of placement.edges.values()) {
      expect(route.points.length).toBeGreaterThanOrEqual(2)
      expect(route.labelAt).not.toBeNull()
    }
  })
})
