import cytoscape from 'cytoscape'
import { describe, expect, it, vi } from 'vitest'
import { applyFilter, fitToVisible } from '../src/visual-app/graph-canvas.js'

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
})

describe('fitToVisible', () => {
  it('fits to only the currently visible elements, not the whole graph', () => {
    const cy = buildCy()
    applyFilter(cy, ['node1', 'node2'], '')
    const fitSpy = vi.spyOn(cy, 'fit')

    fitToVisible(cy)

    expect(fitSpy).toHaveBeenCalledTimes(1)
    const call = fitSpy.mock.calls[0]!
    const visibleCollection = call[0]
    const padding = call[1]
    expect(
      (visibleCollection as cytoscape.CollectionReturnValue)
        .map((ele) => ele.id())
        .sort()
    ).toEqual(['edge1', 'node1', 'node2'])
    expect(padding).toBe(20)
  })

  it('is a safe no-op when nothing is visible', () => {
    const cy = buildCy()
    applyFilter(cy, [], '')
    expect(() => fitToVisible(cy)).not.toThrow()
  })
})
