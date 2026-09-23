import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import { canvasSceneInput, resolveCanvasScene } from '../src/canvas-scene.js'
import { applyFilter, graphToElements } from '../src/visual-app/graph-canvas.js'
import type { CanvasEdge, CanvasGraph, CanvasNode } from '../src/graph-projection.js'
import type { NestingKind } from '../src/nesting.js'

// #577. The canvas and a host drawing its picture elsewhere must read one set
// of decisions. The canvas builds its scene input back off cytoscape elements;
// a host builds it with `canvasSceneInput` from the graph. The parity cases
// below hold those two paths to the same answer on every combination that
// has a rule of its own: nesting, a fold, lifted edges, a relationship-level
// selection, the quick filter.

const ASSIGNMENT = 'yarramate/core@0.1#assignment'
const COMPOSITION = 'yarramate/core@0.1#composition'
const SERVING = 'yarramate/core@0.1#serving'
const FLOW = 'yarramate/core@0.1#flow'

const node = (id: string, coreKindLabel: string, name = `${id} name`): CanvasNode =>
  ({
    id,
    localId: id,
    document: 'main.yaml',
    kind: `acme/p@1.0#${id}-kind`,
    kindLabel: `${id}-kind`,
    coreKindLabel,
    portKinds: [],
    layer: null,
    aspect: null,
    name,
    description: null,
    aka: [],
    status: null,
    owner: null,
    attestations: [],
    references: [],
  }) as unknown as CanvasNode

const edge = (id: string, kind: string, from: string, to: string): CanvasEdge =>
  ({
    id,
    localId: id,
    document: 'main.yaml',
    kind,
    kindLabel: kind.split('#')[1]!,
    coreKindLabel: kind.split('#')[1]!,
    from,
    to,
    name: null,
    description: null,
    mode: null,
    content: null,
    status: null,
    references: [],
  }) as unknown as CanvasEdge

// `app` holds an interface and a function (assignment), `platform` holds a
// component (composition). `flow-in` runs from `app` to its own function, so
// it is implied by the nesting. Three serving edges cross boxes, so folding
// `app` lifts two of them onto it.
const graph: CanvasGraph = {
  nodes: [
    node('app', 'applicationComponent'),
    node('iface', 'applicationInterface'),
    node('fn', 'applicationFunction'),
    // Named apart from its id and kind, so a quick filter on 'portal' can only
    // match it by name.
    node('outside', 'applicationComponent', 'Customer portal'),
    node('platform', 'applicationComponent'),
    node('part', 'applicationComponent'),
  ],
  edges: [
    edge('e-iface', ASSIGNMENT, 'app', 'iface'),
    edge('e-fn', ASSIGNMENT, 'app', 'fn'),
    edge('e-part', COMPOSITION, 'platform', 'part'),
    edge('flow-in', FLOW, 'app', 'fn'),
    edge('r1', SERVING, 'iface', 'outside'),
    edge('r2', SERVING, 'fn', 'outside'),
    edge('r3', SERVING, 'outside', 'part'),
  ],
} as unknown as CanvasGraph

const nesting: readonly NestingKind[] = ['composition', 'assignment']

/** What the canvas shows after `applyFilter`, read off cytoscape. */
const canvasReading = (
  folded: ReadonlySet<string>,
  matchedIds: readonly string[] | null,
  filter: string,
) => {
  const cy = cytoscape({
    styleEnabled: true,
    elements: graphToElements(graph, nesting, new Map(), { folded }),
  })
  applyFilter(cy, matchedIds, filter)
  const parentOf = new Map<string, string>()
  cy.nodes().forEach((n) => {
    if (n.parent().nonempty()) parentOf.set(n.id(), n.parent().first().id())
  })
  return {
    visibleNodeIds: new Set(cy.nodes().filter((n) => n.visible()).map((n) => n.id())),
    visibleEdgeIds: new Set(cy.edges().filter((e) => e.visible()).map((e) => e.id())),
    parentOf,
    insideCount: new Map(cy.nodes('.folded').map((n) => [n.id(), n.data('insideCount') as number])),
    liftedCount: new Map(cy.edges('.lifted').map((e) => [e.id(), e.data('liftedCount') as number])),
  }
}

const hostReading = (
  folded: ReadonlySet<string>,
  matchedIds: readonly string[] | null,
  filter: string,
) => resolveCanvasScene(canvasSceneInput(graph, nesting, { folded }), matchedIds, filter)

describe('resolveCanvasScene', () => {
  const cases: readonly [string, readonly string[], readonly string[] | null, string][] = [
    ['the whole model, nothing folded', [], null, ''],
    ['the whole model, app folded', ['app'], null, ''],
    ['a view of one box member and its consumer', [], ['fn', 'outside', 'r2'], ''],
    ['a view with app folded, one serving edge selected', ['app'], ['app', 'iface', 'fn', 'outside', 'r1'], ''],
    ['a view with no relationships selected', [], ['iface', 'fn', 'outside', 'part'], ''],
    ['the quick filter hides a member', [], ['app', 'iface', 'fn', 'outside', 'r1', 'r2'], 'iface'],
    ['the quick filter over a folded box', ['app'], null, 'outside'],
    ['the quick filter matches by name alone', [], null, 'portal'],
  ]

  it.each(cases)('the canvas and a host read the same scene: %s', (_name, folded, matched, filter) => {
    const canvas = canvasReading(new Set(folded), matched, filter)
    const host = hostReading(new Set(folded), matched, filter)
    expect(host.visibleNodeIds).toEqual(canvas.visibleNodeIds)
    expect(host.visibleEdgeIds).toEqual(canvas.visibleEdgeIds)
    expect(host.parentOf).toEqual(canvas.parentOf)
    expect(host.insideCount).toEqual(canvas.insideCount)
    expect(host.liftedCount).toEqual(canvas.liftedCount)
  })

  it('pulls in the box a matched member sits in, and says it is context', () => {
    const scene = hostReading(new Set(), ['fn', 'outside', 'r2'], '')
    expect([...scene.visibleNodeIds].sort()).toEqual(['app', 'fn', 'outside'])
    expect([...scene.contextNodeIds]).toEqual(['app'])
    expect(scene.parentOf.get('fn')).toBe('app')
    expect([...scene.visibleEdgeIds]).toEqual(['r2'])
  })

  it('hides what a folded box holds and draws the box as a leaf (#473)', () => {
    const scene = hostReading(new Set(['app']), null, '')
    expect(scene.visibleNodeIds.has('app')).toBe(true)
    expect(scene.visibleNodeIds.has('iface')).toBe(false)
    expect(scene.visibleNodeIds.has('fn')).toBe(false)
    expect(scene.parentOf.has('iface')).toBe(false)
    expect(scene.insideCount.get('app')).toBe(2)
    // The canvas agrees, read off cytoscape.
    expect(canvasReading(new Set(['app']), null, '').visibleNodeIds.has('fn')).toBe(false)
  })

  it('matches the quick filter on a subject\'s name', () => {
    expect([...hostReading(new Set(), null, 'portal').visibleNodeIds]).toEqual(['outside'])
  })

  it('never draws an edge between a box and its own member', () => {
    const scene = hostReading(new Set(), null, '')
    expect(scene.impliedEdgeIds.has('flow-in')).toBe(true)
    expect(scene.visibleEdgeIds.has('flow-in')).toBe(false)
  })

  it('counts a lifted edge against what the view selected (#584)', () => {
    const lifted = 'lift:app|outside|' + SERVING
    expect(hostReading(new Set(['app']), null, '').liftedCount.get(lifted)).toBe(2)
    const scene = hostReading(new Set(['app']), ['app', 'iface', 'fn', 'outside', 'r1'], '')
    expect(scene.liftedCount.get(lifted)).toBe(1)
    expect(scene.visibleEdgeIds.has(lifted)).toBe(true)
  })

  it('names what a saved layout keeps: the view and its boxes, whatever the filter hides (#578)', () => {
    const scene = hostReading(new Set(), ['fn', 'outside', 'r2'], 'outside')
    expect([...scene.visibleNodeIds]).toEqual(['outside'])
    expect([...(scene.viewNodeIds ?? [])].sort()).toEqual(['app', 'fn', 'outside'])
    expect(hostReading(new Set(), null, '').viewNodeIds).toBeNull()
  })
})
