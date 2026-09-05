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

  it('refuses a member that already contains its holder, rather than looping and unnesting both', () => {
    // `q` nests inside `p` by an authored composition, and `p`'s slot names `q`
    // as its holder. Placing `p` inside `q` would close a loop.
    //
    // It used to: the membership pass made the cycle and the guard then
    // unnested BOTH, so `q` lost the authored nesting it was entitled to as
    // collateral damage. The rule now refuses the placement instead (#473 phase
    // 3, ADR 0145), so `p` stays outside and `q` keeps its parent. The guard is
    // the backstop rather than the rule, and it still runs.
    const tree = treeOf({
      nodes: [node('p', 'applicationComponent'), node('q', 'applicationComponent')],
      edges: [edge('e1', COMPOSITION, 'p', 'q')],
      memberships: [bind('p', 'slot', 'q', 'owned')],
      nesting: ['composition'],
    })
    expect(tree.parentOf.has('p')).toBe(false)
    expect(tree.parentOf.get('q')).toBe('p')
    expect(tree.cycleMembers).toEqual([])
  })

  it('terminates on holders that hold each other, leaving both outside', () => {
    // Neither can be placed before the other, so the round decides nothing and
    // the loop stops rather than spinning.
    const tree = treeOf({
      nodes: [node('a', 'applicationComponent'), node('b', 'applicationComponent')],
      edges: [],
      memberships: [bind('a', 'slot', 'b', 'owned'), bind('b', 'slot', 'a', 'owned')],
      nesting: ['composition'],
    })
    expect(tree.parentOf.has('a')).toBe(false)
    expect(tree.parentOf.has('b')).toBe(false)
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

describe('#473 phase 3: the one-box fold (ADR 0145)', () => {
  // ADR 0143 kept every shared subject outside, on the reasoning that two
  // owners force a single-parent tree to pick one. That is only true when the
  // owners sit in DIFFERENT boxes. Where both already sit under one box there
  // is nothing to pick, and the old rule left 14 of the reference Landscape's
  // 30 data objects outside the one application whose own parts bound them.
  const COMPONENT = 'applicationComponent'

  it('folds a member its two holders share a box with, into that box', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part-a', COMPONENT),
        node('part-b', COMPONENT),
        node('shared', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('part-a', 'a', 'app', 'owned'),
        bind('part-b', 'b', 'app', 'owned'),
        bind('shared', 's', 'part-a', 'owned'),
        bind('shared', 's', 'part-b', 'owned'),
      ],
      nesting: ['composition'],
    })
    // Both holders sit in `app`, so `app` is where they diverge.
    expect(tree.parentOf.get('part-a')).toBe('app')
    expect(tree.parentOf.get('part-b')).toBe('app')
    expect(tree.parentOf.get('shared')).toBe('app')
  })

  it('folds to the CLIENT rather than the application when the holders share one', () => {
    // The level where the holders diverge, not the outermost box. Unfolding the
    // application one level shows the client; one more shows the member.
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('client', COMPONENT),
        node('call-a', COMPONENT),
        node('call-b', COMPONENT),
        node('spec', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('client', 'c', 'app', 'owned'),
        bind('call-a', 'a', 'client', 'owned'),
        bind('call-b', 'b', 'client', 'owned'),
        bind('spec', 's', 'call-a', 'owned'),
        bind('spec', 's', 'call-b', 'owned'),
      ],
      nesting: ['composition'],
    })
    expect(tree.parentOf.get('spec')).toBe('client')
  })

  it('leaves a member outside when its holders are in different top-level boxes', () => {
    const tree = treeOf({
      nodes: [
        node('app-one', COMPONENT),
        node('app-two', COMPONENT),
        node('crosses', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('crosses', 's', 'app-one', 'owned'),
        bind('crosses', 's', 'app-two', 'owned'),
      ],
      nesting: ['composition'],
    })
    // No one box contains both holders, so there is still a choice to make and
    // the tree still declines to make it.
    expect(tree.parentOf.has('crosses')).toBe(false)
  })

  it('leaves a member outside when one holder is top-level beside the other', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part', COMPONENT),
        node('elsewhere', COMPONENT),
        node('shared', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('part', 'p', 'app', 'owned'),
        bind('shared', 's', 'part', 'owned'),
        bind('shared', 's', 'elsewhere', 'owned'),
      ],
      nesting: ['composition'],
    })
    expect(tree.parentOf.has('shared')).toBe(false)
  })

  it('still refuses a member whose bindings are all context', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part-a', COMPONENT),
        node('part-b', COMPONENT),
        node('used', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('part-a', 'a', 'app', 'owned'),
        bind('part-b', 'b', 'app', 'owned'),
        bind('used', 'u', 'part-a', 'context'),
        bind('used', 'u', 'part-b', 'context'),
      ],
      nesting: ['composition'],
    })
    // A context slot names what an instance USES. Sharing it changes nothing
    // about that, and folding it would swallow the landscape.
    expect(tree.parentOf.has('used')).toBe(false)
  })

  it('folds a member held by context in one place and owned in another', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part-a', COMPONENT),
        node('part-b', COMPONENT),
        node('mixed', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('part-a', 'a', 'app', 'owned'),
        bind('part-b', 'b', 'app', 'owned'),
        bind('mixed', 'm', 'part-a', 'owned'),
        bind('mixed', 'm', 'part-b', 'context'),
      ],
      nesting: ['composition'],
    })
    // One binding holds it out, so it folds; the context holder still counts
    // for WHERE, which is why it lands on `app` and not on `part-a`.
    expect(tree.parentOf.get('mixed')).toBe('app')
  })

  it('still refuses a ruling however many hold it', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part-a', COMPONENT),
        node('part-b', COMPONENT),
        node('policy', 'constraint'),
      ],
      edges: [],
      memberships: [
        bind('part-a', 'a', 'app', 'owned'),
        bind('part-b', 'b', 'app', 'owned'),
        bind('policy', 'p', 'part-a', 'owned'),
        bind('policy', 'p', 'part-b', 'owned'),
      ],
      nesting: ['composition'],
    })
    // A policy is not machinery (review F5). Phase 3 gives it a row instead.
    expect(tree.parentOf.has('policy')).toBe(false)
  })

  it('lands the member on the right ancestor whatever order the holders resolve in', () => {
    // The membership list is deliberately inside-out: `spec`'s holders are
    // themselves members whose parents are decided in the same pass. A single
    // forward pass would measure the ancestor against a tree still missing the
    // levels that separate them.
    const deep = {
      nodes: [
        node('app', COMPONENT),
        node('client', COMPONENT),
        node('call-a', COMPONENT),
        node('call-b', COMPONENT),
        node('spec', 'dataObject'),
      ],
      edges: [],
      nesting: ['composition' as const],
    }
    const inOrder = foldTree({
      ...deep,
      memberships: [
        bind('client', 'c', 'app', 'owned'),
        bind('call-a', 'a', 'client', 'owned'),
        bind('call-b', 'b', 'client', 'owned'),
        bind('spec', 's', 'call-a', 'owned'),
        bind('spec', 's', 'call-b', 'owned'),
      ],
    })
    const reversed = foldTree({
      ...deep,
      memberships: [
        bind('spec', 's', 'call-a', 'owned'),
        bind('spec', 's', 'call-b', 'owned'),
        bind('call-b', 'b', 'client', 'owned'),
        bind('call-a', 'a', 'client', 'owned'),
        bind('client', 'c', 'app', 'owned'),
      ],
    })
    expect(reversed.parentOf.get('spec')).toBe('client')
    expect([...reversed.parentOf.entries()].sort()).toEqual(
      [...inOrder.parentOf.entries()].sort(),
    )
  })

  it('keeps one holder inside another as the answer, rather than reaching past both', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('client', COMPONENT),
        node('shared', 'dataObject'),
      ],
      edges: [],
      memberships: [
        bind('client', 'c', 'app', 'owned'),
        bind('shared', 's', 'app', 'owned'),
        bind('shared', 's', 'client', 'owned'),
      ],
      nesting: ['composition'],
    })
    // `app` already contains `client`, so it IS the lowest box containing both.
    expect(tree.parentOf.get('shared')).toBe('app')
  })

  it('lets a view\'s own nesting keep winning over the slot parents', () => {
    const tree = treeOf({
      nodes: [
        node('app', COMPONENT),
        node('part-a', COMPONENT),
        node('part-b', COMPONENT),
        node('shared', 'dataObject'),
        node('elsewhere', COMPONENT),
      ],
      edges: [edge('e1', COMPOSITION, 'elsewhere', 'shared')],
      memberships: [
        bind('part-a', 'a', 'app', 'owned'),
        bind('part-b', 'b', 'app', 'owned'),
        bind('shared', 's', 'part-a', 'owned'),
        bind('shared', 's', 'part-b', 'owned'),
      ],
      nesting: ['composition'],
    })
    expect(tree.parentOf.get('shared')).toBe('elsewhere')
  })
})
