import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  applyDecorations,
  applyFilter,
  buildStylesheet,
  filteredSubjectCount,
  fitVisible,
  graphToElements,
  modelPositionOf,
  relayoutVisible,
} from '../src/visual-app/graph-canvas.js'
import type {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
} from '../src/graph-projection.js'

// A small headless cytoscape instance (no container/DOM needed for hide/show
// and data queries) - mirrors the shape graphToElements produces, without
// exercising the full component.
const buildCy = () =>
  cytoscape({
    // Headless cytoscape (no `container`) defaults `styleEnabled` to false when
    // there is no `document`/`window`, which silently no-ops `.hide()`/`.show()`.
    // `applyFilter` relies on real visibility toggling, so force it on here.
    styleEnabled: true,
    elements: [
      { data: { id: 'node1', label: 'Checkout Service', kindLabel: 'applicationComponent' }, group: 'nodes' },
      { data: { id: 'node2', label: 'Payments Gateway', kindLabel: 'applicationComponent' }, group: 'nodes' },
      { data: { id: 'node3', label: 'Order Fulfillment', kindLabel: 'businessProcess' }, group: 'nodes' },
      {
        data: { id: 'edge1', source: 'node1', target: 'node2', label: 'calls' },
        group: 'edges',
      },
      {
        data: { id: 'edge2', source: 'node2', target: 'node3', label: 'notifies' },
        group: 'edges',
      },
    ],
  })

const visibleIds = (cy: cytoscape.Core): readonly string[] =>
  cy
    .elements()
    .filter((ele) => ele.visible())
    .map((ele) => ele.id())
    .sort()

describe('applyFilter', () => {
  it('shows everything when there is no structural filter and no quick-filter text', () => {
    const cy = buildCy()
    applyFilter(cy, null, '')
    expect(visibleIds(cy)).toEqual(['edge1', 'edge2', 'node1', 'node2', 'node3'])
  })

  it('narrows by name substring, case-insensitively', () => {
    const cy = buildCy()
    applyFilter(cy, null, 'checkout')
    expect(visibleIds(cy)).toEqual(['node1'])
  })

  it('narrows by kind-label substring', () => {
    const cy = buildCy()
    applyFilter(cy, null, 'businessProcess')
    expect(visibleIds(cy)).toEqual(['node3'])
  })

  it('narrows by id substring', () => {
    const cy = buildCy()
    applyFilter(cy, null, 'node2')
    expect(visibleIds(cy)).toEqual(['node2'])
  })

  it('keeps an edge visible only when both endpoints pass the quick-filter', () => {
    const cy = buildCy()
    applyFilter(cy, null, 'applicationComponent')
    // node1 and node2 both match kindLabel; the edge between them survives.
    // node3 does not match, so edge2 (node2 -> node3) is hidden.
    expect(visibleIds(cy)).toEqual(['edge1', 'node1', 'node2'])
  })

  it('intersects matchedIds (structural filter) with quick-filter narrowing', () => {
    const cy = buildCy()
    applyFilter(cy, ['node1', 'node2'], 'gateway')
    expect(visibleIds(cy)).toEqual(['node2'])
  })

  it('an edge label match never keeps it visible if an endpoint is hidden', () => {
    const cy = buildCy()
    applyFilter(cy, ['node1'], '')
    // Only node1 is structurally matched; edge1 needs node2 too, so it's hidden
    // even though matchedIds says nothing about edge1's own label.
    expect(visibleIds(cy)).toEqual(['node1'])
  })

  // Composition claims render as cytoscape compound nesting, and cytoscape
  // derives a parent's position from its children - so a container left
  // parenting only hidden children is dragged back to their stale full-graph
  // coordinates instead of being placed by the scoped layout.
  const buildNestedCy = () =>
    cytoscape({
      styleEnabled: true,
      elements: [
        { data: { id: 'container', label: 'Control Panel' }, group: 'nodes' },
        {
          data: { id: 'partA', label: 'Query Service', parent: 'container', compositionParent: 'container' },
          group: 'nodes',
        },
        {
          data: { id: 'partB', label: 'Session Adapter', parent: 'container', compositionParent: 'container' },
          group: 'nodes',
        },
        { data: { id: 'outsider', label: 'Runner Daemon' }, group: 'nodes' },
      ],
    })

  const parentOf = (cy: cytoscape.Core, id: string): string | null => {
    const parent = cy.getElementById(id).parent()
    return parent.nonempty() ? parent.first().id() : null
  }

  it('detaches a container from its children when the filter hides all of them', () => {
    const cy = buildNestedCy()
    applyFilter(cy, ['container', 'outsider'], '')
    expect(visibleIds(cy)).toEqual(['container', 'outsider'])
    expect(cy.getElementById('container').isParent()).toBe(false)
    expect(parentOf(cy, 'partA')).toBeNull()
  })

  it('restores nesting when the hidden parts come back', () => {
    const cy = buildNestedCy()
    applyFilter(cy, ['container'], '')
    expect(cy.getElementById('container').isParent()).toBe(false)

    applyFilter(cy, null, '')
    expect(parentOf(cy, 'partA')).toEqual('container')
    expect(parentOf(cy, 'partB')).toEqual('container')
  })

  it('keeps only the visible parts nested when a container is partly filtered', () => {
    const cy = buildNestedCy()
    applyFilter(cy, ['partA'], '')
    // partA pulls its container in through the ancestor walk; partB stays out.
    expect(visibleIds(cy)).toEqual(['container', 'partA'])
    expect(parentOf(cy, 'partA')).toEqual('container')
    expect(parentOf(cy, 'partB')).toBeNull()
  })

  it('pulls in a container through the canonical claim after a detach', () => {
    const cy = buildNestedCy()
    // Detach first, so the ancestor walk has no live `parent` left to follow
    // and must fall back on the model's own claim.
    applyFilter(cy, ['outsider'], '')
    applyFilter(cy, ['partA'], '')
    expect(visibleIds(cy)).toEqual(['container', 'partA'])
    expect(parentOf(cy, 'partA')).toEqual('container')
  })
})

// Explicit positions and a `preset` initial layout (cytoscape otherwise
// auto-runs a `grid` layout on init, discarding them) so moved-vs-untouched
// is observable, not masked by every node already starting at (0, 0).
const buildPositionedCy = () =>
  cytoscape({
    styleEnabled: true,
    layout: { name: 'preset' },
    elements: [
      { data: { id: 'node1' }, position: { x: 500, y: 500 }, group: 'nodes' },
      { data: { id: 'node2' }, position: { x: 600, y: 500 }, group: 'nodes' },
      { data: { id: 'node3' }, position: { x: 9999, y: 9999 }, group: 'nodes' },
      {
        data: { id: 'edge1', source: 'node1', target: 'node2', label: 'calls' },
        group: 'edges',
      },
    ],
  })

describe('relayoutVisible', () => {
  it('repositions only the currently visible elements, leaving hidden ones untouched', async () => {
    const cy = buildPositionedCy()
    applyFilter(cy, ['node1', 'node2'], '')
    const hiddenBefore = { ...cy.getElementById('node3').position() }
    const visibleBefore = { ...cy.getElementById('node1').position() }
    const settled = new Promise<void>((resolve) => cy.one('layoutstop', () => resolve()))

    relayoutVisible(cy, 'top-down')
    await settled

    expect(cy.getElementById('node3').position()).toEqual(hiddenBefore)
    expect(cy.getElementById('node1').position()).not.toEqual(visibleBefore)
  })

  it('is a safe no-op when nothing is visible', () => {
    const cy = buildPositionedCy()
    applyFilter(cy, [], '')
    expect(() => relayoutVisible(cy, 'top-down')).not.toThrow()
  })
})

/**
 * The refit a quick-filter keystroke earns (#307). A keystroke changes
 * visibility only, so the survivors keep their layout (and dragged) positions
 * but can sit anywhere in the old framing: off-viewport, or a few pixels tall
 * under a register-scale fit, either way indistinguishable from an empty
 * canvas. `fitVisible` re-frames the viewport around them without moving a
 * single node, which is what makes it safe to run on every keystroke where
 * `relayoutVisible` is not.
 */
describe('fitVisible', () => {
  it('re-frames the viewport around the visible set without moving any node', () => {
    const cy = buildPositionedCy()
    applyFilter(cy, ['node1', 'node2'], '')
    // A viewport the reviewer (or a stale fit) left standing.
    cy.zoom(0.5)
    cy.pan({ x: 100, y: 100 })
    const before = cy.nodes().map((node) => ({ ...node.position() }))

    expect(fitVisible(cy)).toBe(true)

    const untouched =
      cy.zoom() === 0.5 && cy.pan().x === 100 && cy.pan().y === 100
    expect(untouched, 'the viewport was re-framed').toBe(false)
    cy.nodes().forEach((node, at) => {
      expect(node.position(), node.id()).toEqual(before[at])
    })
  })

  it('declines to frame nothing, and leaves the viewport alone saying so', () => {
    const cy = buildPositionedCy()
    applyFilter(cy, [], '')
    cy.zoom(0.5)
    cy.pan({ x: 100, y: 100 })

    expect(fitVisible(cy)).toBe(false)
    expect(cy.zoom()).toBe(0.5)
    expect(cy.pan()).toEqual({ x: 100, y: 100 })
  })
})

/**
 * The shell's empty-state honesty (#307): the same narrowing `applyFilter`
 * performs, restated over render data so "nothing matches" is computable with
 * no canvas mounted. Zero here must be exactly a blank canvas there, so the
 * two are asserted against each other on the shared fixture.
 */
describe('filteredSubjectCount', () => {
  const subjects = [
    { id: 'node1', name: 'Checkout Service', kindLabel: 'applicationComponent' },
    { id: 'node2', name: 'Payments Gateway', kindLabel: 'applicationComponent' },
    { id: 'node3', name: 'Order Fulfillment', kindLabel: 'businessProcess' },
  ]

  it('counts every subject with no narrowing standing', () => {
    expect(filteredSubjectCount(subjects, null, '')).toBe(3)
  })

  it('narrows by name, id and kind label, case-insensitively', () => {
    expect(filteredSubjectCount(subjects, null, 'CHECKOUT')).toBe(1)
    expect(filteredSubjectCount(subjects, null, 'node2')).toBe(1)
    expect(filteredSubjectCount(subjects, null, 'applicationComponent')).toBe(2)
  })

  it('intersects the structural match set with the quick filter', () => {
    expect(filteredSubjectCount(subjects, ['node1', 'node2'], 'gateway')).toBe(1)
  })

  it('counts no subject for a match set naming only relationships', () => {
    // A view's match set may name relationships; none of them draws a node.
    expect(filteredSubjectCount(subjects, ['checkout-serves-teller'], '')).toBe(0)
  })

  it('finds the field report subject by id, whatever the case typed', () => {
    // The ApertureX soak typed CEP and cep over "cep-salesforce"; the
    // predicate matched all along - the blanking came from elsewhere - and
    // this pins that it stays true.
    const register = [
      { id: 'cep-salesforce', name: 'CEP (Salesforce)', kindLabel: 'applicationComponent' },
    ]
    expect(filteredSubjectCount(register, null, 'CEP')).toBe(1)
    expect(filteredSubjectCount(register, null, 'cep')).toBe(1)
  })

  it('agrees with applyFilter about emptiness in every direction', () => {
    const narrowings: readonly (readonly [readonly string[] | null, string])[] = [
      [null, 'cep'],
      [null, 'checkout'],
      [['node1', 'node2'], 'fulfil'],
      [['node1', 'node2'], 'gateway'],
      [[], ''],
    ]
    for (const [matched, text] of narrowings) {
      const cy = buildCy()
      applyFilter(cy, matched, text)
      const canvasBlank =
        cy.nodes().filter((node) => node.visible()).length === 0
      expect(
        filteredSubjectCount(subjects, matched, text) === 0,
        `matched=${JSON.stringify(matched)} text=${JSON.stringify(text)}`,
      ).toBe(canvasBlank)
    }
  })
})

// What the canvas DRAWS, which is the model graph narrowed by the matched set,
// not the model graph. Every test that asserted on the model graph passed while
// this was broken: the graph was right, and the reviewer saw nothing.
describe('a subject the model has just gained', () => {
  /** The graph after a commit landed a new subject, as a `model` frame carries it. */
  const cyAfterCommit = () => {
    const cy = buildCy()
    cy.add({
      data: {
        id: 'payment-gateway',
        label: 'Payment Gateway',
        kindLabel: 'applicationComponent',
      },
      group: 'nodes',
    })
    return cy
  }

  it('is hidden by a matched set resolved before it existed', () => {
    // The defect, stated as the canvas states it. `matchedIds` was resolved
    // against the graph as it was; nothing re-asked; the new subject is not in
    // it, so it is drawn nowhere despite the commit having landed.
    const cy = cyAfterCommit()
    applyFilter(cy, ['node1', 'node2'], '')

    expect(cy.getElementById('payment-gateway').visible()).toBe(false)
    expect(visibleIds(cy)).not.toContain('payment-gateway')
  })

  it('is drawn once the matched set is asked for again', () => {
    const cy = cyAfterCommit()
    applyFilter(cy, ['node1', 'node2', 'payment-gateway'], '')

    expect(cy.getElementById('payment-gateway').visible()).toBe(true)
  })

  it('is drawn with no structural filter standing at all', () => {
    // Unfiltered is the one case the defect never reached: `null` means draw
    // everything, and a new subject joins by existing.
    const cy = cyAfterCommit()
    applyFilter(cy, null, '')

    expect(cy.getElementById('payment-gateway').visible()).toBe(true)
  })
})

/**
 * Where a palette drop lands (#295): the container's own coordinates, undone
 * through whatever pan and zoom are standing, give the model position under
 * the pointer. Pure arithmetic, so it is stated without a canvas to drop on.
 */
describe('modelPositionOf', () => {
  it('is the identity under no pan and unit zoom', () => {
    expect(modelPositionOf({ x: 120, y: 80 }, { x: 0, y: 0 }, 1)).toEqual({
      x: 120,
      y: 80,
    })
  })

  it('undoes the standing pan and zoom', () => {
    // A canvas panned to (50, -20) and zoomed to 2 draws model (35, 50) at
    // rendered (120, 80): the drop must give back the model point.
    expect(modelPositionOf({ x: 120, y: 80 }, { x: 50, y: -20 }, 2)).toEqual({
      x: 35,
      y: 50,
    })
  })
})

/**
 * Two relationships between the same endpoints (#306). The projection delivers
 * both and cytoscape keeps both as elements, but taxi routing is deterministic
 * from the endpoints alone: parallel edges drew exactly on top of each other
 * and read as one line, with only the topmost tappable. Members of a parallel
 * pair now carry the `parallel` class, whose bezier curve style cytoscape
 * separates automatically - so both are visible and individually selectable.
 */
describe('parallel relationships between the same pair', () => {
  const node = (id: string): CanvasNode =>
    ({
      id,
      localId: id,
      document: 'main.yaml',
      kind: 'yarramate/core@0.1#applicationComponent',
      kindLabel: 'applicationComponent',
      coreKindLabel: 'applicationComponent',
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
    }) as unknown as CanvasNode

  const edge = (
    id: string,
    kind: string,
    from: string,
    to: string,
  ): CanvasEdge =>
    ({
      id,
      localId: id,
      document: 'main.yaml',
      kind: `yarramate/core@0.1#${kind}`,
      kindLabel: kind,
      coreKindLabel: kind,
      from,
      to,
      name: null,
      description: null,
      mode: null,
      content: null,
      status: null,
      references: [],
      presentIn: [],
    }) as unknown as CanvasEdge

  const graph: CanvasGraph = {
    nodes: [node('a'), node('b'), node('c')],
    edges: [
      // Same direction, different kinds - the ICWA register case.
      edge('e1', 'flow', 'a', 'b'),
      edge('e2', 'association', 'a', 'b'),
      // Opposite directions: an a->b over a b->a occludes just the same.
      edge('e3', 'flow', 'b', 'c'),
      edge('e4', 'access', 'c', 'b'),
      // A single edge stays exactly as it was.
      edge('e5', 'flow', 'a', 'c'),
    ],
  }

  const elements = graphToElements(graph, [], new Map())
  const elementById = new Map(
    elements.map((element) => [element.data.id, element]),
  )

  it('keeps every parallel edge as its own element', () => {
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) {
      expect(elementById.get(id), id).toBeDefined()
    }
  })

  it('marks members of a parallel pair, in either direction, and no single edge', () => {
    expect(elementById.get('e1')?.classes).toBe('parallel')
    expect(elementById.get('e2')?.classes).toBe('parallel')
    expect(elementById.get('e3')?.classes).toBe('parallel')
    expect(elementById.get('e4')?.classes).toBe('parallel')
    expect(elementById.get('e5')?.classes).toBeUndefined()
  })

  it('resolves parallel edges to a curve style cytoscape separates', () => {
    // The real stylesheet against the real elements, headless: parallel
    // members leave `round-taxi` for `bezier` with a nonzero step, which is
    // the mechanism that fans them apart; a single edge keeps `round-taxi`.
    const cy = cytoscape({
      styleEnabled: true,
      elements,
      style: buildStylesheet(false, false, false, false),
    })
    expect(cy.edges().length).toBe(5)
    expect(cy.$id('e1').style('curve-style')).toBe('bezier')
    expect(cy.$id('e2').style('curve-style')).toBe('bezier')
    expect(cy.$id('e4').style('curve-style')).toBe('bezier')
    expect(cy.$id('e1').style('control-point-step-size')).toBe('40px')
    expect(cy.$id('e5').style('curve-style')).toBe('round-taxi')
  })

  it('does not count an edge consumed into nesting as a parallel member', () => {
    const nested: CanvasGraph = {
      nodes: [node('a'), node('b')],
      edges: [
        edge('c1', 'composition', 'a', 'b'),
        edge('e1', 'flow', 'a', 'b'),
      ],
    }
    const drawn = graphToElements(nested, ['composition'], new Map())
    const ids = drawn.map((element) => element.data.id)
    // The composition is consumed into the compound box, so the flow is the
    // only line between the pair and keeps its ordinary routing.
    expect(ids).not.toContain('c1')
    expect(
      drawn.find((element) => element.data.id === 'e1')?.classes,
    ).toBeUndefined()
  })
})

/**
 * The host's marks (#314, ADR 0119): the viewer renders per-subject
 * decorations it is handed and never computes them - comparison semantics
 * stay on the host's side of the seam. The mechanism is the faults
 * mechanism: classes toggled by id, styled by the stylesheet, where a fault
 * outranks a decoration by declaration order.
 */
describe('applyDecorations', () => {
  it("marks the named node and the named edge with their mark's class", () => {
    const cy = buildCy()
    applyDecorations(cy, {
      node1: 'added',
      node3: 'removed',
      edge1: 'changed',
    })

    expect(cy.$id('node1').hasClass('deco-added')).toBe(true)
    expect(cy.$id('node3').hasClass('deco-removed')).toBe(true)
    expect(cy.$id('edge1').hasClass('deco-changed')).toBe(true)
    // Marks name subjects, never neighbours.
    expect(cy.$id('node2').classes()).toEqual([])
    expect(cy.$id('edge2').classes()).toEqual([])
  })

  it('replaces the marks wholesale on the next map, the empty one included', () => {
    const cy = buildCy()
    applyDecorations(cy, { node1: 'added', edge1: 'changed' })
    applyDecorations(cy, { node1: 'changed' })

    // The second map is the whole picture: node1 carries only its new mark,
    // and edge1's - absent from the map - is gone rather than remembered.
    expect(cy.$id('node1').hasClass('deco-changed')).toBe(true)
    expect(cy.$id('node1').hasClass('deco-added')).toBe(false)
    expect(cy.$id('edge1').classes()).toEqual([])

    applyDecorations(cy, {})
    expect(cy.$id('node1').classes()).toEqual([])
  })

  it('leaves an unknown id silently inert', () => {
    // The host may be describing subjects this model has not gained yet (or
    // has already lost) - a mark with nothing to land on marks nothing and
    // raises nothing.
    const cy = buildCy()
    expect(() =>
      applyDecorations(cy, { 'app.gone': 'added', node1: 'changed' }),
    ).not.toThrow()

    expect(cy.$id('node1').hasClass('deco-changed')).toBe(true)
    expect(cy.elements('.deco-added').length).toBe(0)
  })

  it('never disturbs the fault mark, which outranks it', () => {
    // The real stylesheet against real elements, headless. Cytoscape
    // resolves style by declaration order alone, and the fault rule is
    // declared after the decoration rules: a subject both decorated and
    // refused reads as refused - the failure red stays faults' own.
    const cy = cytoscape({
      styleEnabled: true,
      elements: [
        { data: { id: 'a' }, group: 'nodes' },
        { data: { id: 'b' }, group: 'nodes' },
        { data: { id: 'c', source: 'a', target: 'b' }, group: 'edges' },
        { data: { id: 'd' }, group: 'nodes' },
      ],
      style: buildStylesheet(false, false, false, false),
    })
    cy.$id('a').addClass('faulted')
    cy.$id('b').addClass('faulted')
    cy.$id('c').addClass('faulted')
    applyDecorations(cy, { b: 'added', c: 'changed', d: 'added' })

    // applyDecorations left every faulted class standing...
    expect(cy.$id('b').hasClass('faulted')).toBe(true)
    expect(cy.$id('c').hasClass('faulted')).toBe(true)
    // ...and the fault's colour wins wherever both marks land: the
    // decorated-and-faulted node and edge render exactly as purely faulted
    // ones do, while a purely decorated node renders differently.
    expect(cy.$id('b').style('border-color')).toBe(
      cy.$id('a').style('border-color'),
    )
    expect(cy.$id('d').style('border-color')).not.toBe(
      cy.$id('a').style('border-color'),
    )
    expect(cy.$id('c').style('line-color')).toBe('rgb(163,64,58)')
  })

  it("renders each mark's own treatment: eucalyptus, quiet dash, ochre", () => {
    const cy = cytoscape({
      styleEnabled: true,
      elements: [
        { data: { id: 'a' }, group: 'nodes' },
        { data: { id: 'b' }, group: 'nodes' },
        { data: { id: 'c' }, group: 'nodes' },
        { data: { id: 'ab', source: 'a', target: 'b' }, group: 'edges' },
        { data: { id: 'bc', source: 'b', target: 'c' }, group: 'edges' },
      ],
      style: buildStylesheet(false, false, false, false),
    })
    applyDecorations(cy, {
      a: 'added',
      b: 'removed',
      c: 'changed',
      ab: 'removed',
      bc: 'added',
    })

    expect(cy.$id('a').style('border-color')).toBe('rgb(65,111,101)')
    expect(cy.$id('b').style('border-color')).toBe('rgb(103,112,116)')
    // Removed is the one mark that dashes: an outline of an absence.
    expect(cy.$id('b').style('border-style')).toBe('dashed')
    expect(cy.$id('c').style('border-color')).toBe('rgb(140,77,24)')
    expect(cy.$id('ab').style('line-color')).toBe('rgb(103,112,116)')
    expect(cy.$id('ab').style('line-style')).toBe('dashed')
    expect(cy.$id('bc').style('line-color')).toBe('rgb(65,111,101)')
    // A mark never repaints what it did not name.
    expect(cy.$id('a').style('border-style')).toBe('solid')
  })
})
