import { describe, expect, it } from 'vitest'
import {
  focusNeighbourhood,
  focusRelationshipNeighbourhood,
} from '../src/visual-app/focus-neighbourhood.js'
import { contextMenuFor } from '../src/visual-app/context-menu-model.js'
import type { CanvasGraph } from '../src/graph-projection.js'

// "Focus on this" (#407): narrow the canvas to a subject and everything one
// hop from it. One hop is the whole design decision - on a connected
// integration model "everything reachable" is the whole canvas, so the most
// inviting menu item would be the one that does nothing.

const node = (id: string) =>
  ({
    id,
    localId: id,
    document: 'a.yaml',
    kind: 'yarramate/core@0.1#applicationComponent',
    kindLabel: 'applicationComponent',
    coreKindLabel: 'applicationComponent',
    portKinds: [],
    layer: 'application',
    aspect: 'active-structure',
    name: id,
    description: null,
    aka: [],
    status: null,
    owner: null,
    folder: null,
    distinctFrom: [],
    supersedes: [],
    constraints: [],
    references: [],
    presentIn: [],
    attestations: [],
  }) as unknown as CanvasGraph['nodes'][number]

const edge = (id: string, from: string, to: string) =>
  ({
    id,
    localId: id,
    document: 'a.yaml',
    from,
    to,
    kind: 'yarramate/core@0.1#serving',
    kindLabel: 'serving',
    coreKindLabel: 'serving',
    name: null,
    description: null,
    presentIn: [],
  }) as unknown as CanvasGraph['edges'][number]

//   far ── b ── seed ── c ── d
//                \_____/          (b and c also serve each other)
const GRAPH: CanvasGraph = {
  nodes: ['seed', 'b', 'c', 'd', 'far', 'lonely'].map(node),
  edges: [
    edge('seed-b', 'seed', 'b'),
    edge('c-seed', 'c', 'seed'),
    edge('b-c', 'b', 'c'),
    edge('c-d', 'c', 'd'),
    edge('far-b', 'far', 'b'),
  ],
}

describe('focus narrows to one hop, undirected', () => {
  it('keeps the subject and its immediate neighbours', () => {
    expect([...focusNeighbourhood(GRAPH, 'seed')].sort()).toEqual([
      'b',
      'c',
      'seed',
    ])
  })

  it('follows an edge in either direction', () => {
    // `seed-b` points away from the seed and `c-seed` points at it; a
    // neighbourhood that respected direction would drop one of them.
    const kept = focusNeighbourhood(GRAPH, 'seed')
    expect(kept).toContain('b')
    expect(kept).toContain('c')
  })

  it('does not reach two hops', () => {
    // `d` and `far` are each one hop from a neighbour and two from the seed.
    // This is the assertion the whole feature turns on.
    const kept = focusNeighbourhood(GRAPH, 'seed')
    expect(kept).not.toContain('d')
    expect(kept).not.toContain('far')
  })

  it('leaves an unconnected subject on its own rather than empty', () => {
    // A subject with no edges focuses to itself. Narrowing to nothing would
    // blank the canvas and read as a bug.
    expect(focusNeighbourhood(GRAPH, 'lonely')).toEqual(['lonely'])
  })

  it('yields nothing for a subject the canvas does not hold', () => {
    expect(focusNeighbourhood(GRAPH, 'absent')).toEqual([])
  })

  it('names subjects only, leaving edge selection to the projection', () => {
    // The query is `relationships: 'between'`, so the server picks the edges.
    // Selecting them here would be a second implementation of "which edges
    // belong in a slice" that could disagree with the first.
    expect(focusNeighbourhood(GRAPH, 'seed')).not.toContain('seed-b')
  })
})

describe('focusing a relationship shows its endpoints', () => {
  it('keeps both ends and expands neither', () => {
    expect([...focusRelationshipNeighbourhood(GRAPH, 'c-d')].sort()).toEqual([
      'c',
      'd',
    ])
  })

  it('yields nothing for an edge the canvas does not hold', () => {
    expect(focusRelationshipNeighbourhood(GRAPH, 'absent')).toEqual([])
  })
})

// The menu is data, not closures, so what it offers is assertable directly.
const menuContext = (overrides: Record<string, unknown> = {}) =>
  ({
    graph: GRAPH,
    relationshipKinds: [],
    activeViewId: '',
    filtered: false,
    membership: null,
    ...overrides,
  }) as Parameters<typeof contextMenuFor>[1]

describe('focus is offered as a view operation', () => {
  it('names the intent for a subject', () => {
    const groups = contextMenuFor(
      { kind: 'subject', id: 'seed' },
      menuContext(),
    )
    const view = groups.find((group) => group.key === 'view')
    expect(view?.scope).toBe('view')
    expect(view?.items[0]?.intent).toEqual({
      type: 'subject.focus',
      id: 'seed',
    })
  })

  it('names the intent for a relationship', () => {
    const groups = contextMenuFor(
      { kind: 'relationship', id: 'seed-b' },
      menuContext(),
    )
    expect(groups.find((group) => group.key === 'view')?.items[0]?.intent).toEqual(
      { type: 'relationship.focus', id: 'seed-b' },
    )
  })

  it('offers the way out from the focused thing once anything is narrowing', () => {
    // Focus is most often cleared from the thing it focused. Making the
    // reviewer find blank canvas to escape would be the second exit this
    // feature exists not to add.
    const labels = (filtered: boolean) =>
      contextMenuFor({ kind: 'subject', id: 'seed' }, menuContext({ filtered }))
        .find((group) => group.key === 'view')
        ?.items.map((item) => item.label)
    expect(labels(false)).toEqual(['Focus on this'])
    expect(labels(true)).toEqual(['Focus on this', 'Show all subjects'])
  })

  it('survives a read-only menu, because it stages nothing', () => {
    const groups = contextMenuFor(
      { kind: 'subject', id: 'seed' },
      menuContext({ readOnly: true }),
    )
    expect(
      groups.flatMap((group) => group.items.map((item) => item.intent.type)),
    ).toContain('subject.focus')
  })
})
