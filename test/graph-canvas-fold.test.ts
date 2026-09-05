import { describe, expect, it } from 'vitest'
import { graphToElements } from '../src/visual-app/graph-canvas.js'
import type { CanvasEdge, CanvasGraph, CanvasNode } from '../src/graph-projection.js'

// #473 item 1.6, headless through `graphToElements`. The canvas rules that
// have to hold whatever the renderer does with them:
//
//   - a folded box KEEPS its node and gains what it stands for
//   - members are HIDDEN, never removed (review F4) - the guard at the bottom
//   - edges into a shut box lift onto it, merged and counted
//   - the open-questions badge SUMS what is inside

/** What `graphToElements` returns, structurally. */
interface Element {
  readonly group?: string
  readonly classes?: string
  readonly data: Record<string, unknown>
}

const ASSIGNMENT = 'yarramate/core@0.1#assignment'
const SERVING = 'yarramate/core@0.1#serving'

const node = (id: string, coreKindLabel: string): CanvasNode =>
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
    name: id,
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

// One application holding an interface and a behaviour, one outside consumer,
// and a second application, so a lift has somewhere to land.
const graph: CanvasGraph = {
  nodes: [
    node('app', 'applicationComponent'),
    node('iface', 'applicationInterface'),
    node('fn', 'applicationFunction'),
    node('outside', 'applicationComponent'),
  ],
  edges: [
    edge('e-iface', ASSIGNMENT, 'app', 'iface'),
    edge('e-fn', ASSIGNMENT, 'app', 'fn'),
    edge('r1', SERVING, 'iface', 'outside'),
    edge('r2', SERVING, 'fn', 'outside'),
  ],
} as unknown as CanvasGraph

const elementsFor = (
  folded: readonly string[],
  openQuestions: ReadonlyMap<string, number> = new Map(),
) =>
  graphToElements(graph, ['composition', 'assignment'], openQuestions, {
    folded: new Set(folded),
  })

const nodeData = (elements: ReturnType<typeof elementsFor>, id: string) =>
  elements.find((el: Element) => el.group === 'nodes' && el.data.id === id)

describe('#473: a folded box on the canvas', () => {
  it('keeps its own node and says what it stands for', () => {
    const app = nodeData(elementsFor(['app']), 'app')
    expect(app).toBeDefined()
    expect(app!.classes).toBe('folded')
    expect(app!.data.insideCount).toBe(2)
    expect([...(app!.data.insideIds as string[])].sort()).toEqual(['fn', 'iface'])
  })

  it('keeps its members as elements, so a fold can be undone', () => {
    // Review F4, and the reason the whole design hides rather than removes:
    // the members carry the positions a `layout.save` is for.
    const elements = elementsFor(['app'])
    for (const id of ['iface', 'fn']) {
      expect(nodeData(elements, id), `${id} must survive a fold`).toBeDefined()
    }
  })

  it('carries no folded class and no chip when nothing is folded', () => {
    const app = nodeData(elementsFor([]), 'app')
    expect(app!.classes).toBeUndefined()
    // `insideCount` is still reported: the box knows what it holds whether or
    // not it is shut. The STYLESHEET draws the chip only on `.folded`.
    expect(app!.data.insideCount).toBe(2)
  })

  it('sums the open questions of everything inside it', () => {
    // An open question inside a shut box is still open, and a reader who
    // cannot see the member must still see that something in there is unasked.
    const counts = new Map([
      ['app', 1],
      ['iface', 2],
      ['fn', 4],
    ])
    expect(nodeData(elementsFor([], counts), 'app')!.data.openQuestions).toBe(1)
    expect(nodeData(elementsFor(['app'], counts), 'app')!.data.openQuestions).toBe(7)
  })
})

describe('#473: lifted edges', () => {
  const lifted = (folded: readonly string[]) =>
    elementsFor(folded).filter(
      (el: Element) => el.group === 'edges' && el.data.lifted === true,
    )

  it('merges the edges leaving a shut box into one, with a count', () => {
    // Two members serve the same outside consumer. The reader should see one
    // line labelled twice over, not two lines to count.
    const edges = lifted(['app'])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.data.source).toBe('app')
    expect(edges[0]!.data.target).toBe('outside')
    expect(edges[0]!.data.liftedCount).toBe(2)
    expect([...(edges[0]!.data.relationshipIds as string[])].sort()).toEqual([
      'r1',
      'r2',
    ])
  })

  it('labels a lifted edge with its kind and multiplicity', () => {
    expect(lifted(['app'])[0]!.data.label).toBe('serving ×2')
  })

  it('drops the multiplicity when it stands for one relationship', () => {
    const single = {
      ...graph,
      edges: graph.edges.filter((e) => e.id !== 'r2'),
    } as CanvasGraph
    const edges = graphToElements(single, ['composition', 'assignment'], new Map(), {
      folded: new Set(['app']),
    }).filter((el: Element) => el.data.lifted === true)
    expect(edges[0]!.data.label).toBe('serving')
  })

  it('lifts nothing when nothing is folded', () => {
    expect(lifted([])).toHaveLength(0)
  })

  it('keeps the ORIGINAL edges in the element list', () => {
    // They are hidden by the visibility pass, not removed, for the same reason
    // the nodes are: opening the box must have nothing to rebuild.
    const ids = elementsFor(['app']).map((el: Element) => el.data.id)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
  })

  it('gives a lifted edge a synthetic id nothing in the model can collide with', () => {
    // `lift:` ids are never saved and never reach a document, so they must be
    // recognisable as synthetic at a glance.
    expect(String(lifted(['app'])[0]!.data.id)).toMatch(/^lift:/)
  })
})
