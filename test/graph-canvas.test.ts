import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  applyFilter,
  modelPositionOf,
  relayoutVisible,
} from '../src/visual-app/graph-canvas.js'

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

describe('relayoutVisible', () => {
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

  it('repositions only the currently visible elements, leaving hidden ones untouched', async () => {
    const cy = buildPositionedCy()
    applyFilter(cy, ['node1', 'node2'], '')
    const hiddenBefore = { ...cy.getElementById('node3').position() }
    const visibleBefore = { ...cy.getElementById('node1').position() }
    const settled = new Promise<void>((resolve) => cy.one('layoutstop', () => resolve()))

    relayoutVisible(cy)
    await settled

    expect(cy.getElementById('node3').position()).toEqual(hiddenBefore)
    expect(cy.getElementById('node1').position()).not.toEqual(visibleBefore)
  })

  it('is a safe no-op when nothing is visible', () => {
    const cy = buildPositionedCy()
    applyFilter(cy, [], '')
    expect(() => relayoutVisible(cy)).not.toThrow()
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
