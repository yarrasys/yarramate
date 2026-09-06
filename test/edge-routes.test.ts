import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  ROUTE_STYLE_PROPERTIES,
  applyEdgeRoutes,
  clearEdgeRoutes,
  placedByElk,
  registerRouteInvalidation,
  routeStyle,
} from '../src/visual-app/edge-routes.js'
import type { ElkPlacement, ElkRoute } from '../src/visual-app/elk-layout.js'

// Source centred at (0, 0), target at (300, 0), and an L-shaped route that
// leaves the source's bottom, runs down 100, across, and up into the target:
// the shape every routed edge takes in a top-down layout.
const L_ROUTE = [
  { x: 0, y: 25 },
  { x: 0, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 25 },
]

const buildCanvas = () =>
  cytoscape({
    styleEnabled: true,
    layout: { name: 'preset' },
    style: [
      { selector: 'node', style: { width: 170, height: 50 } },
      { selector: 'edge', style: { 'curve-style': 'round-taxi' } },
    ],
    elements: [
      { data: { id: 'box' }, group: 'nodes' as const },
      { data: { id: 'a', parent: 'box' }, position: { x: 0, y: 0 }, group: 'nodes' as const },
      { data: { id: 'b' }, position: { x: 300, y: 0 }, group: 'nodes' as const },
      { data: { id: 'c' }, position: { x: 600, y: 0 }, group: 'nodes' as const },
      { data: { id: 'ab', source: 'a', target: 'b' }, group: 'edges' as const },
      { data: { id: 'bc', source: 'b', target: 'c' }, group: 'edges' as const },
    ],
  })

const placementOf = (cy: cytoscape.Core, edges: ElkPlacement['edges']): ElkPlacement => ({
  nodes: new Map(
    cy
      .nodes()
      .filter((node) => !node.isParent())
      .map((node) => [node.id(), { ...(node as cytoscape.NodeSingular).position() }] as const),
  ),
  edges,
})

const twoRoutes = (): Map<string, ElkRoute> =>
  new Map<string, ElkRoute>([
    ['ab', { points: L_ROUTE, labelAt: 40 }],
    [
      'bc',
      {
        points: [
          { x: 385, y: 0 },
          { x: 515, y: 0 },
        ],
        labelAt: null,
      },
    ],
  ])

describe('routeStyle', () => {
  it('projects an L-route onto the endpoint line as segments', () => {
    const style = routeStyle(L_ROUTE, { x: 0, y: 0 }, { x: 300, y: 0 }, 40)
    expect(style['curve-style']).toBe('segments')
    expect(style['edge-distances']).toBe('endpoints')
    // Offsets from each node's centre, not absolute coordinates: both ends
    // leave and arrive 25px below their node's centre, on its bottom border.
    expect(style['source-endpoint']).toBe('0px 25px')
    expect(style['target-endpoint']).toBe('0px 25px')
    // The two bends sit at the start and the end of the endpoint line (weights
    // 0 and 1) and 75px off it on the positive side of cytoscape's normal,
    // which for a rightward line points down the page.
    expect(style['segment-weights']).toBe('0.0000 1.0000')
    expect(style['segment-distances']).toBe('75.00 75.00')
    // Square corners, the same as layered: no radius is asked for.
    expect(style).not.toHaveProperty('segment-radii')
    expect(style).not.toHaveProperty('radius-type')
    expect(style['source-text-offset']).toBe(40)
  })

  it('draws a two-point route straight, with no segments to state', () => {
    const style = routeStyle(
      [
        { x: 85, y: 0 },
        { x: 215, y: 0 },
      ],
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      null,
    )
    expect(style['curve-style']).toBe('straight')
    expect(style).not.toHaveProperty('segment-weights')
    expect(style['source-text-offset']).toBe(0)
  })

  it('signs the distance by the side of the line the bend sits on', () => {
    const above = routeStyle(
      [
        { x: 0, y: -25 },
        { x: 0, y: -100 },
        { x: 300, y: -100 },
        { x: 300, y: -25 },
      ],
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      null,
    )
    expect(above['segment-distances']).toBe('-75.00 -75.00')
  })
})

describe('placedByElk', () => {
  it('holds for a leaf exactly where ELK put it and breaks when it moves', () => {
    const cy = buildCanvas()
    const placement = placementOf(cy, new Map())
    expect(placedByElk(cy.getElementById('b'), placement)).toBe(true)
    cy.getElementById('b').position({ x: 301, y: 0 })
    expect(placedByElk(cy.getElementById('b'), placement)).toBe(false)
  })

  it('holds for a box only while every member is where ELK put it', () => {
    const cy = buildCanvas()
    const placement = placementOf(cy, new Map())
    expect(placedByElk(cy.getElementById('box'), placement)).toBe(true)
    cy.getElementById('a').position({ x: 5, y: 5 })
    expect(placedByElk(cy.getElementById('box'), placement)).toBe(false)
  })

  it('does not hold for a node ELK never placed', () => {
    const cy = buildCanvas()
    expect(placedByElk(cy.getElementById('b'), { nodes: new Map(), edges: new Map() })).toBe(false)
  })
})

describe('applyEdgeRoutes and clearEdgeRoutes', () => {
  it('draws every eligible route and marks the edge routed', () => {
    const cy = buildCanvas()
    const applied = applyEdgeRoutes(cy, placementOf(cy, twoRoutes()), () => true)
    expect(applied).toBe(2)
    expect(cy.getElementById('ab').hasClass('routed')).toBe(true)
    expect(cy.getElementById('ab').style('curve-style')).toBe('segments')
    expect(cy.getElementById('bc').style('curve-style')).toBe('straight')
  })

  it('skips an edge the caller rules out and leaves it on the stylesheet', () => {
    const cy = buildCanvas()
    const applied = applyEdgeRoutes(cy, placementOf(cy, twoRoutes()), (edge) => edge.id() !== 'ab')
    expect(applied).toBe(1)
    expect(cy.getElementById('ab').hasClass('routed')).toBe(false)
    expect(cy.getElementById('ab').style('curve-style')).toBe('round-taxi')
  })

  it('gives a routed edge back to the stylesheet without touching its display', () => {
    const cy = buildCanvas()
    applyEdgeRoutes(cy, placementOf(cy, twoRoutes()), () => true)
    cy.getElementById('ab').style('display', 'none')
    clearEdgeRoutes(cy.edges())
    const edge = cy.getElementById('ab')
    expect(edge.hasClass('routed')).toBe(false)
    expect(edge.style('curve-style')).toBe('round-taxi')
    expect(edge.style('display')).toBe('none')
    // No bypass left behind on any route property: cytoscape keeps a
    // `bypass` flag on each parsed property it holds one for.
    const parsed = edge as unknown as { pstyle(name: string): { bypass?: boolean } | null }
    for (const property of ROUTE_STYLE_PROPERTIES) {
      expect(parsed.pstyle(property)?.bypass ?? false).toBe(false)
    }
  })
})

describe('registerRouteInvalidation', () => {
  // The routes an edge carried were computed for where its node was: a drag
  // hands them back, on the node's own edges, on its box's (a moved member
  // resizes the box), and on nothing else.
  it('clears the dragged node\'s routes and its container\'s, leaving the rest', () => {
    const cy = buildCanvas()
    applyEdgeRoutes(cy, placementOf(cy, twoRoutes()), () => true)
    const unbind = registerRouteInvalidation(cy)
    cy.getElementById('c').emit('dragfree')
    expect(cy.getElementById('bc').hasClass('routed')).toBe(false)
    expect(cy.getElementById('ab').hasClass('routed')).toBe(true)
    unbind()
    cy.getElementById('a').emit('dragfree')
    expect(cy.getElementById('ab').hasClass('routed')).toBe(true)
  })

  it('clears the edges on a box when a member inside it is dragged', () => {
    const cy = buildCanvas()
    cy.add({ data: { id: 'boxc', source: 'box', target: 'c' }, group: 'edges' })
    const routes = twoRoutes()
    routes.set('boxc', { points: [{ x: 85, y: 0 }, { x: 515, y: 0 }], labelAt: null })
    applyEdgeRoutes(cy, placementOf(cy, routes), () => true)
    registerRouteInvalidation(cy)
    cy.getElementById('a').emit('dragfree')
    expect(cy.getElementById('boxc').hasClass('routed')).toBe(false)
    expect(cy.getElementById('bc').hasClass('routed')).toBe(true)
  })
})
