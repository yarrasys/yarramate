import { describe, expect, it } from 'vitest'
// Through the published subpath, not the module: this is what a Durable Object
// imports, and an export that resolves but does not work is what a barrel test
// is for.
import {
  foldTree,
  foldGraph,
  liftedEdgeId,
  type FoldEdge,
  type FoldInput,
  type FoldMembership,
  type FoldNode,
} from '../src/adapters/visual-graph-entry.js'

// #473 phase 1. Two questions in one module because they are one question: a
// VIEW says which relationships nest, a PATTERN says which subjects are parts,
// and folding reads the single parent-of map both produce.

const COMPOSITION = 'yarramate/core@0.1#composition'
const ASSIGNMENT = 'yarramate/core@0.1#assignment'
const SERVING = 'yarramate/core@0.1#serving'

const node = (id: string, coreKind: string): FoldNode => ({
  id,
  kind: `acme/p@1.0#${id}-kind`,
  coreKind,
})

const edge = (id: string, kind: string, from: string, to: string): FoldEdge => ({
  id,
  kind,
  from,
  to,
})

const bind = (
  member: string,
  slot: string,
  instance: string,
  wiring?: FoldMembership['wiring'],
): FoldMembership => ({ member, slot, instance, ...(wiring ? { wiring } : {}) })

/** The five-node shape every case below varies: an app and what it holds. */
const FIVE = {
  nodes: [
    node('app', 'applicationComponent'),
    node('iface', 'applicationInterface'),
    node('svc', 'applicationService'),
    node('fn', 'applicationFunction'),
    node('rule', 'constraint'),
  ],
  edges: [] as readonly FoldEdge[],
  memberships: [] as readonly FoldMembership[],
  nesting: ['composition', 'assignment'],
} satisfies FoldInput

const treeOf = (input: Partial<FoldInput>) =>
  foldTree({ ...FIVE, ...input } as FoldInput)

describe('#473: the service rule reads CORE kinds', () => {
  // The rule this replaces tested the PROFILE kind's label, so a profile that
  // named a service `mule-api-operation` nested while a plain
  // `applicationService` beside it did not — one relation drawn two ways
  // depending on what somebody called it.
  const nests = (fromKind: string, toKind: string, toId = 'target') => {
    const tree = treeOf({
      nodes: [node('source', fromKind), node(toId, toKind)],
      edges: [edge('e', ASSIGNMENT, 'source', toId)],
      nesting: ['assignment'],
    })
    return tree.parentOf.get(toId) === 'source'
  }

  it('nests component to function', () => {
    expect(nests('applicationComponent', 'applicationFunction')).toBe(true)
  })

  it('does NOT nest component to service', () => {
    // A service is the promise the layer above consumes; burying it inside the
    // component that implements it inverts what it is for.
    expect(nests('applicationComponent', 'applicationService')).toBe(false)
  })

  it('nests interface to service, because exposure is the opposite relation', () => {
    expect(nests('applicationInterface', 'applicationService')).toBe(true)
  })

  it('nests interface to a service SUBKIND, on its core kind not its label', () => {
    // The case that motivated reading core kinds: this node's authored kind is
    // `mule-api-operation`, whose label ends in neither "Service" nor anything
    // else the old test could have keyed on.
    const tree = foldTree({
      ...FIVE,
      nodes: [
        node('source', 'applicationInterface'),
        { id: 'op', kind: 'aperturex/mule@1.0#mule-api-operation', coreKind: 'applicationService' },
      ],
      edges: [edge('e', ASSIGNMENT, 'source', 'op')],
      nesting: ['assignment'],
    })
    expect(tree.parentOf.get('op')).toBe('source')
  })
})

describe('#473: slot members join the tree, with three exceptions', () => {
  it('nests an exclusive owned member under its instance', () => {
    const tree = treeOf({ memberships: [bind('fn', 'behaviour', 'app', 'owned')] })
    expect(tree.parentOf.get('fn')).toBe('app')
  })

  it('nests an unwired member too', () => {
    // `unwired` means the pattern declares the slot but wires nothing through
    // it. The subject is still a part; nothing about containment changes.
    const tree = treeOf({ memberships: [bind('fn', 'behaviour', 'app', 'unwired')] })
    expect(tree.parentOf.get('fn')).toBe('app')
  })

  it('never nests a CONTEXT member', () => {
    // A context slot names what the instance USES and does not contain — the
    // upstream API it calls, the plane it runs on. Folding those would swallow
    // half the landscape into whichever box referenced it.
    const tree = treeOf({ memberships: [bind('svc', 'upstream', 'app', 'context')] })
    expect(tree.parentOf.has('svc')).toBe(false)
  })

  it('never nests a member bound in TWO instances', () => {
    // Two owners, and a single-parent tree would silently pick one.
    const tree = treeOf({
      nodes: [...FIVE.nodes, node('other-app', 'applicationComponent')],
      memberships: [
        bind('fn', 'behaviour', 'app', 'owned'),
        bind('fn', 'behaviour', 'other-app', 'owned'),
      ],
    })
    expect(tree.parentOf.has('fn')).toBe(false)
  })

  it('never nests a RULING as a node', () => {
    // Review F5. Nesting a rate limit inside the API it constrains draws a
    // policy as though it were machinery, and a ruling is routinely shared.
    const tree = treeOf({ memberships: [bind('rule', 'rate-limit', 'app', 'owned')] })
    expect(tree.parentOf.has('rule')).toBe(false)
  })

  it('catches a ruling by its CORE kind, not by the profile name', () => {
    const tree = foldTree({
      ...FIVE,
      nodes: [
        node('app', 'applicationComponent'),
        { id: 'limit', kind: 'aperturex/consulting@1.0#rate-limit-constraint', coreKind: 'constraint' },
      ],
      memberships: [bind('limit', 'rate-limit', 'app', 'owned')],
    })
    expect(tree.parentOf.has('limit')).toBe(false)
  })

  it('lets the VIEW win where both the view and a slot claim a child', () => {
    // The view is the more specific statement: someone wrote `nesting` and
    // meant it.
    const tree = treeOf({
      nodes: [...FIVE.nodes, node('holder', 'applicationComponent')],
      edges: [edge('e', COMPOSITION, 'holder', 'fn')],
      memberships: [bind('fn', 'behaviour', 'app', 'owned')],
      nesting: ['composition'],
    })
    expect(tree.parentOf.get('fn')).toBe('holder')
  })

  it('ignores a membership naming a subject this view does not carry', () => {
    const tree = treeOf({ memberships: [bind('absent', 'behaviour', 'app', 'owned')] })
    expect(tree.parentOf.has('absent')).toBe(false)
  })
})

describe('#473: anomalies are reported, not resolved', () => {
  it('returns a same-rank conflict instead of picking a winner', () => {
    const tree = treeOf({
      nodes: [node('a', 'applicationComponent'), node('b', 'applicationComponent'), node('child', 'applicationComponent')],
      edges: [
        edge('e1', COMPOSITION, 'a', 'child'),
        edge('e2', COMPOSITION, 'b', 'child'),
      ],
      nesting: ['composition'],
    })
    expect(tree.parentOf.has('child')).toBe(false)
    expect(tree.conflicts).toHaveLength(1)
    expect(tree.conflicts[0]!.child).toBe('child')
    expect(tree.conflicts[0]!.claims.map((c) => c.from).sort()).toEqual(['a', 'b'])
  })

  it('terminates on a cycle and unnests exactly its members', () => {
    // The test exists because a parent-chain walk is the shape that hangs.
    const tree = treeOf({
      nodes: [node('x', 'applicationComponent'), node('y', 'applicationComponent'), node('z', 'applicationComponent')],
      edges: [
        edge('e1', COMPOSITION, 'x', 'y'),
        edge('e2', COMPOSITION, 'y', 'x'),
        edge('e3', COMPOSITION, 'x', 'z'),
      ],
      nesting: ['composition'],
    })
    expect([...tree.cycleMembers].sort()).toEqual(['x', 'y'])
    expect(tree.parentOf.has('x')).toBe(false)
    expect(tree.parentOf.has('y')).toBe(false)
    // A straight-line child of a cycle member is still validly nested.
    expect(tree.parentOf.get('z')).toBe('x')
  })

  it('terminates on a cycle closed by slot membership rather than by an edge', () => {
    // The combined tree can loop where neither half did, which is why the
    // guard runs again after memberships join.
    const tree = treeOf({
      nodes: [node('p', 'applicationComponent'), node('q', 'applicationComponent')],
      edges: [edge('e1', COMPOSITION, 'p', 'q')],
      memberships: [bind('p', 'slot', 'q', 'owned')],
      nesting: ['composition'],
    })
    expect(tree.parentOf.has('p')).toBe(false)
    expect(tree.parentOf.has('q')).toBe(false)
  })
})

describe('#473: foldGraph', () => {
  const graph = {
    nodes: [
      { id: 'app' },
      { id: 'iface' },
      { id: 'fn' },
      { id: 'outside' },
      { id: 'other-app' },
      { id: 'other-iface' },
    ],
    edges: [
      { id: 'r1', kind: SERVING, from: 'iface', to: 'outside' },
      { id: 'r2', kind: SERVING, from: 'fn', to: 'outside' },
      { id: 'r3', kind: SERVING, from: 'iface', to: 'fn' },
      { id: 'r4', kind: SERVING, from: 'other-iface', to: 'iface' },
    ],
  }
  const tree = {
    parentOf: new Map([
      ['iface', 'app'],
      ['fn', 'app'],
      ['other-iface', 'other-app'],
    ]),
  }

  it('keeps the folded instance and drops what is inside it', () => {
    const { nodes } = foldGraph(graph, tree, new Set(['app']))
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'app',
      'other-app',
      'other-iface',
      'outside',
    ])
    const app = nodes.find((n) => n.id === 'app')!
    expect(app.folded).toBe(true)
    expect([...app.insideIds].sort()).toEqual(['fn', 'iface'])
  })

  it('merges lifted edges of one kind between one pair, with a count', () => {
    // Two relationships leave the box for the same target; the reader should
    // see one line labelled twice over, not two lines to count.
    const { edges } = foldGraph(graph, tree, new Set(['app']))
    const lift = edges.find((e) => e.id === liftedEdgeId('app', 'outside', SERVING))
    expect(lift).toBeDefined()
    expect('count' in lift! && lift.count).toBe(2)
    expect('relationshipIds' in lift! && [...lift.relationshipIds].sort()).toEqual(['r1', 'r2'])
  })

  it('drops an edge whose ends fold into the SAME box', () => {
    // Internal to what the box now stands for; a self-loop would say nothing.
    const { edges } = foldGraph(graph, tree, new Set(['app']))
    expect(edges.some((e) => e.id === 'r3')).toBe(false)
    expect(edges.some((e) => e.id === liftedEdgeId('app', 'app', SERVING))).toBe(false)
  })

  it('lifts BOTH ends when both boxes are folded', () => {
    const { edges } = foldGraph(graph, tree, new Set(['app', 'other-app']))
    const lift = edges.find((e) => e.id === liftedEdgeId('other-app', 'app', SERVING))
    expect(lift).toBeDefined()
    expect('count' in lift! && lift.count).toBe(1)
  })

  it('changes nothing when nothing is folded', () => {
    const { nodes, edges } = foldGraph(graph, tree, new Set())
    expect(nodes).toHaveLength(graph.nodes.length)
    expect(edges.map((e) => e.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(nodes.every((n) => !n.folded)).toBe(true)
  })

  it('carries the original edge objects through untouched', () => {
    // A lifted edge is synthetic; an unlifted one must be the SAME object the
    // caller passed, or the canvas loses everything else it carries.
    const { edges } = foldGraph(graph, tree, new Set())
    expect(edges).toEqual(expect.arrayContaining(graph.edges))
  })
})
