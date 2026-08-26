import cytoscape from 'cytoscape'
import { describe, expect, it, vi } from 'vitest'
import {
  applySavedPositions,
  buildLayoutConfig,
  buildPositionMap,
  buildStylesheet,
  DRAG_SAVE_DEBOUNCE_MS,
  effectiveSavedPositions,
  registerDragSave,
  relayoutVisible,
  savedLayoutInForce,
} from '../src/visual-app/graph-canvas.js'
import { ASPECT_SHAPES, RELATIONSHIP_NOTATION } from '../src/notation/archimate.js'
import type {
  VisualLayoutPositions,
  VisualLayoutSavePayload,
} from '../src/adapters/visual/protocol-contract.js'

// Headless cytoscape defaults to the `grid` layout, which discards authored
// positions; these tests are about positions, so every instance pins `preset`.
const canvasWith = (positions: readonly (readonly [string, number, number])[]) =>
  cytoscape({
    styleEnabled: true,
    layout: { name: 'preset' },
    elements: positions.map(([id, x, y]) => ({
      data: { id },
      position: { x, y },
      group: 'nodes' as const,
    })),
  })

describe('layout drag-save and position pinning', () => {
  it('buildPositionMap captures all node positions keyed by id', () => {
    const cy = canvasWith([
      ['node1', 100, 200],
      ['node2', 300, 400],
    ])
    expect(buildPositionMap(cy.nodes())).toEqual({
      node1: { x: 100, y: 200 },
      node2: { x: 300, y: 400 },
    })
  })

  it('applySavedPositions overrides only nodes present in the saved map', () => {
    const cy = canvasWith([
      ['node1', 1, 1],
      ['node2', 2, 2],
    ])
    const saved: VisualLayoutPositions = { node1: { x: 100, y: 100 } }

    applySavedPositions(cy, saved)

    expect(cy.getElementById('node1').position()).toEqual({ x: 100, y: 100 })
    expect(cy.getElementById('node2').position()).toEqual({ x: 2, y: 2 })
  })

  it('applySavedPositions is a no-op when passed undefined', () => {
    const cy = canvasWith([['node1', 1, 1]])

    applySavedPositions(cy, undefined)

    expect(cy.getElementById('node1').position()).toEqual({ x: 1, y: 1 })
  })

  it('leaves a hidden node alone: a sidecar entry for an undrawn subject is inert (#273)', () => {
    const cy = canvasWith([
      ['drawn', 1, 1],
      ['hidden', 2, 2],
    ])
    // What `applyFilter` does to a node the active view does not draw.
    cy.getElementById('hidden').style('display', 'none')
    const saved: VisualLayoutPositions = {
      drawn: { x: 100, y: 100 },
      hidden: { x: 900, y: 2900 },
    }

    applySavedPositions(cy, saved)

    expect(cy.getElementById('drawn').position()).toEqual({ x: 100, y: 100 })
    // Not planted at the sidecar's whole-model coordinate.
    expect(cy.getElementById('hidden').position()).toEqual({ x: 2, y: 2 })
  })

  it('discard unpins: a discarded view yields nothing to pin, so a fresh layout stands (#273)', () => {
    const cy = canvasWith([['node1', 1, 1]])
    const saved: VisualLayoutPositions = { node1: { x: 100, y: 100 } }
    const discarded = new Set(['view1'])

    applySavedPositions(cy, effectiveSavedPositions(saved, 'view1', discarded))
    expect(cy.getElementById('node1').position()).toEqual({ x: 1, y: 1 })

    // Another view's discard does not reach this one.
    applySavedPositions(cy, effectiveSavedPositions(saved, 'view2', discarded))
    expect(cy.getElementById('node1').position()).toEqual({ x: 100, y: 100 })
  })

  it('coalesces a burst of drags into one save carrying every node position', () => {
    vi.useFakeTimers()
    const cy = canvasWith([
      ['node1', 10, 20],
      ['node2', 30, 40],
    ])
    let saved: VisualLayoutSavePayload | null = null
    const onSaveLayout = vi.fn((payload: VisualLayoutSavePayload) => {
      saved = payload
    })
    const handle = registerDragSave(cy, () => 'view1', onSaveLayout)

    cy.getElementById('node1').emit('dragfree')
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS - 1)
    cy.getElementById('node2').emit('dragfree')
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS - 1)

    expect(onSaveLayout).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(onSaveLayout).toHaveBeenCalledOnce()
    expect(saved).toEqual({
      projectionId: 'view1',
      positions: { node1: { x: 10, y: 20 }, node2: { x: 30, y: 40 } },
    })

    handle.dispose()
    vi.useRealTimers()
  })

  it('skips the save when the active view is the unfiltered pseudo-view', () => {
    vi.useFakeTimers()
    const cy = canvasWith([['node1', 10, 20]])
    const onSaveLayout = vi.fn()
    const handle = registerDragSave(cy, () => '', onSaveLayout)

    cy.getElementById('node1').emit('dragfree')
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS)

    expect(onSaveLayout).not.toHaveBeenCalled()

    handle.dispose()
    vi.useRealTimers()
  })

  it('cancelPending drops a queued save but keeps the handler bound', () => {
    vi.useFakeTimers()
    const cy = canvasWith([['node1', 10, 20]])
    const onSaveLayout = vi.fn()
    const handle = registerDragSave(cy, () => 'view1', onSaveLayout)

    cy.getElementById('node1').emit('dragfree')
    handle.cancelPending()
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS)

    expect(onSaveLayout).not.toHaveBeenCalled()

    // Still armed: the next drag saves normally.
    cy.getElementById('node1').emit('dragfree')
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS)

    expect(onSaveLayout).toHaveBeenCalledOnce()

    handle.dispose()
    vi.useRealTimers()
  })

  it('dispose unbinds the handler so later drags never save', () => {
    vi.useFakeTimers()
    const cy = canvasWith([['node1', 10, 20]])
    const onSaveLayout = vi.fn()
    const handle = registerDragSave(cy, () => 'view1', onSaveLayout)

    handle.dispose()
    cy.getElementById('node1').emit('dragfree')
    vi.advanceTimersByTime(DRAG_SAVE_DEBOUNCE_MS)

    expect(onSaveLayout).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})

// The standing indicator's one question (#273): does the active view's
// sidecar pin anything the view draws? Derived from the view's match set,
// the same base `applyFilter` starts from, so it is answerable with no
// canvas mounted.
describe('savedLayoutInForce', () => {
  const graphNodeIds = ['a', 'b', 'c']

  it('is false when the view has no sidecar', () => {
    expect(savedLayoutInForce(undefined, graphNodeIds, ['a'])).toBe(false)
  })

  it('is true when the sidecar names a subject the view draws', () => {
    expect(
      savedLayoutInForce({ a: { x: 0, y: 0 } }, graphNodeIds, ['a', 'b']),
    ).toBe(true)
  })

  it('is false when the sidecar names only subjects the view does not draw', () => {
    // The stale-sidecar case: positions survive for subjects the view no
    // longer selects, and every one of them is inert - nothing is in force.
    expect(
      savedLayoutInForce({ c: { x: 0, y: 0 } }, graphNodeIds, ['a', 'b']),
    ).toBe(false)
  })

  it('measures against the whole graph when no structural filter stands', () => {
    expect(
      savedLayoutInForce({ c: { x: 0, y: 0 } }, graphNodeIds, null),
    ).toBe(true)
  })
})

// Fixed node size (matching production's NODE_WIDTH/NODE_HEIGHT) so bounding-
// box overlap checks below are meaningful instead of comparing cytoscape's
// zero-size headless default boxes.
const LAYOUT_FIXTURE_STYLE: cytoscape.StylesheetJsonBlock[] = [
  { selector: 'node', style: { width: 170, height: 50 } },
]

// A small cycle - every node has exactly two neighbours - so each backend's
// spacing/overlap behavior is exercised without a compound parent muddying
// the bounding-box check (a parent legitimately overlaps its own children).
const buildLayoutFixture = () =>
  cytoscape({
    styleEnabled: true,
    style: LAYOUT_FIXTURE_STYLE,
    layout: { name: 'null' },
    elements: [
      { data: { id: 'a' }, group: 'nodes' as const },
      { data: { id: 'b' }, group: 'nodes' as const },
      { data: { id: 'c' }, group: 'nodes' as const },
      { data: { id: 'd' }, group: 'nodes' as const },
      { data: { id: 'e' }, group: 'nodes' as const },
      { data: { id: 'f' }, group: 'nodes' as const },
      { data: { id: 'ab', source: 'a', target: 'b' }, group: 'edges' as const },
      { data: { id: 'bc', source: 'b', target: 'c' }, group: 'edges' as const },
      { data: { id: 'cd', source: 'c', target: 'd' }, group: 'edges' as const },
      { data: { id: 'de', source: 'd', target: 'e' }, group: 'edges' as const },
      { data: { id: 'ef', source: 'e', target: 'f' }, group: 'edges' as const },
      { data: { id: 'fa', source: 'f', target: 'a' }, group: 'edges' as const },
    ],
  })

// A hub with many leaves at the same graph distance from it and from each
// other: a `stress` pass places them equidistant from the hub on a circle
// too small for `desiredEdgeLength: 320`'s worth of leaves to fit without
// their fixed-size boxes overlapping their neighbours on that circle. This
// is what makes the fixture actually exercise the second `sporeOverlap`
// pass below, instead of a topology small enough to never overlap.
const buildHubFixture = () =>
  cytoscape({
    styleEnabled: true,
    style: LAYOUT_FIXTURE_STYLE,
    layout: { name: 'null' },
    elements: [
      { data: { id: 'hub' }, group: 'nodes' as const },
      ...Array.from({ length: 16 }, (_, i) => ({
        data: { id: `leaf${i}` },
        group: 'nodes' as const,
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        data: { id: `edge${i}`, source: 'hub', target: `leaf${i}` },
        group: 'edges' as const,
      })),
    ],
  })

// elk-backed layouts (layered, force) resolve asynchronously; the built-in
// concentric layout (radial) resolves synchronously but still fires
// `layoutstop`, so one helper covers all three.
const runLayout = (cy: cytoscape.Core, options: cytoscape.LayoutOptions): Promise<void> =>
  new Promise((resolve) => {
    cy.one('layoutstop', () => resolve())
    cy.layout(options).run()
  })

const countOverlappingPairs = (cy: cytoscape.Core): number => {
  const boxes = cy.nodes().map((node) => node.boundingBox())
  let overlaps = 0
  boxes.forEach((a, i) => {
    boxes.slice(i + 1).forEach((b) => {
      if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) {
        overlaps++
      }
    })
  })
  return overlaps
}

describe('buildLayoutConfig', () => {
  it('lays out with zero overlapping node bounding boxes', async () => {
    const cy = buildLayoutFixture()
    await runLayout(cy, buildLayoutConfig())
    expect(countOverlappingPairs(cy)).toBe(0)
  })

  // ArchiMate's layer bands only read top-down, so the canvas lays out DOWN
  // and takes no direction to be told otherwise. `presentation.direction`
  // survives in the projection format for the LikeC4 export, which draws no
  // bands, and this config is deliberately blind to it.
  it('lays out DOWN, and takes nothing that could say otherwise', () => {
    const config = buildLayoutConfig() as unknown as { elk: Record<string, unknown> }
    expect(config.elk['elk.direction']).toBe('DOWN')
    expect(buildLayoutConfig.length).toBe(0)
  })

  // `layered` is the only backend, so a layout run is one synchronous elk
  // pass. Nothing can still be in flight when the next request arrives, which
  // is what retired the busy notice, the two-pass chain and the in-flight
  // guard that `force` needed.
  it('relayouts the visible subgraph in one synchronous pass', () => {
    const cy = buildHubFixture()
    relayoutVisible(cy)
    expect(buildPositionMap(cy.nodes()).size ?? Object.keys(buildPositionMap(cy.nodes())).length)
      .toBeGreaterThan(0)
  })
})


describe('buildStylesheet ArchiMate notation', () => {
  const edgeRule = (
    sheet: cytoscape.StylesheetJsonBlock[],
    coreKindLabel: string,
  ): cytoscape.Css.Edge => {
    const rule = sheet.find(
      (block): block is cytoscape.StylesheetStyle =>
        'style' in block && block.selector === `edge[coreKindLabel = "${coreKindLabel}"]`,
    )
    if (rule === undefined) {
      throw new Error(`missing archimate edge rule for coreKindLabel "${coreKindLabel}"`)
    }
    return rule.style as cytoscape.Css.Edge
  }

  it('renders a realization edge as a dotted line with a hollow target triangle', () => {
    const style = edgeRule(buildStylesheet(false, false, false, true), 'realization')
    expect(style['line-style']).toBe('dotted')
    expect(style['source-arrow-shape']).toBe('none')
    expect(style['target-arrow-shape']).toBe('triangle')
    expect(style['target-arrow-fill']).toBe('hollow')
  })

  it('resolves a derived development kind to its core lineage style via coreKindLabel, not kindLabel', () => {
    const sheet = buildStylesheet(false, false, false, true)
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: sheet,
      elements: [
        { data: { id: 'a' }, group: 'nodes' },
        { data: { id: 'b' }, group: 'nodes' },
        {
          data: { id: 'core-edge', source: 'a', target: 'b', coreKindLabel: 'realization', kindLabel: 'realization' },
          group: 'edges',
        },
        {
          // Simulates a `yarramate/development@1.0#implements` edge after
          // graph-projection.ts resolves its lineage: kindLabel stays
          // "implements", but coreKindLabel collapses onto "realization".
          data: { id: 'derived-edge', source: 'a', target: 'b', coreKindLabel: 'realization', kindLabel: 'implements' },
          group: 'edges',
        },
      ],
    })
    const core = cy.getElementById('core-edge')
    const derived = cy.getElementById('derived-edge')
    for (const prop of ['line-style', 'source-arrow-shape', 'target-arrow-shape', 'target-arrow-fill'] as const) {
      expect(derived.css(prop)).toEqual(core.css(prop))
    }
    expect(derived.css('line-style')).toBe('dotted')
    expect(derived.css('target-arrow-shape')).toBe('triangle')
    expect(derived.css('target-arrow-fill')).toBe('hollow')
  })

  // A compound container is an ordinary concept node that acquired children
  // (graphToElements sets `parent` from composition claims), so it carries the
  // same `aspect`, `layer`, and `kindLabel` as any leaf of its kind. That is
  // what makes the cascade order load-bearing: the per-aspect rules are
  // appended after `node:parent`, so an unscoped `node[aspect = "..."]` would
  // hand a container whatever shape its own kind implies and silently undo the
  // grouping-box presentation. Asserted through resolved style on real
  // elements rather than by reading the selector string, because the selector
  // being right is not the same claim as the cascade landing right.
  describe('compound containers', () => {
    const containerGraph = () => {
      const node = (id: string, parent?: string) => ({
        group: 'nodes' as const,
        data: {
          id,
          parent,
          label: id,
          wrapLabel: id,
          kindLabel: 'applicationComponent',
          aspect: 'active-structure',
          layer: 'application',
          status: null,
          hasAttestations: false,
          owner: null,
          ownerInitials: null,
        },
      })
      return cytoscape({
        headless: true,
        styleEnabled: true,
        style: buildStylesheet(true, true, true, true),
        elements: [node('container'), node('child', 'container'), node('leaf')],
      })
    }

    it('keeps the grouping-box shape a leaf of the same aspect does not get', () => {
      const cy = containerGraph()
      const container = cy.getElementById('container')
      const leaf = cy.getElementById('leaf')
      expect(container.isParent()).toBe(true)
      expect(container.css('shape')).toBe('roundrectangle')
      expect(container.css('border-style')).toBe('dashed')
      // Same aspect, no children: this is the rule the container must not take.
      expect(leaf.css('shape')).toBe('rectangle')
      expect(leaf.css('border-style')).toBe('solid')
    })

    it('draws its own kind glyph at full strength despite the faded fill', () => {
      const cy = containerGraph()
      const container = cy.getElementById('container')
      const leaf = cy.getElementById('leaf')
      // The glyph reaches a parent exactly as it reaches a leaf: same data,
      // same badge layer, and cytoscape has no compound-node carve-out in its
      // image drawing.
      expect(container.css('background-image')).toEqual(leaf.css('background-image'))
      expect(String(container.css('background-image'))).toMatch(/^data:image\/svg\+xml/)
      // The faded fill is the container's alone and never reaches the glyph,
      // which is why no `background-image-opacity` is pinned here.
      expect(container.numericStyle('background-opacity')).toBe(0.25)
      // One entry per image layer, so a container's single glyph reads as [1]
      // with nothing pinned - the same value the leaf resolves to.
      expect(container.numericStyle('background-image-opacity')).toEqual([1])
      expect(leaf.numericStyle('background-image-opacity')).toEqual([1])
    })
  })

  // There is no longer a notation to switch off, so the shape and arrow rules
  // are not a mode the stylesheet can be built without. A build that dropped
  // them would draw every kind as an undifferentiated box and every
  // relationship with the same line, which is what this asserts cannot happen.
  it('always carries the ArchiMate shape and arrow rules', () => {
    const sheet = buildStylesheet(true, true, true, true)
    expect(sheet.filter((block) => block.selector.startsWith('node[aspect')))
      .toHaveLength(Object.keys(ASPECT_SHAPES).length)
    expect(sheet.filter((block) => block.selector.startsWith('edge[coreKindLabel')))
      .toHaveLength(RELATIONSHIP_NOTATION.length)

    const bare = buildStylesheet(false, false, false, true)
    expect(bare.filter((block) => block.selector.startsWith('node[aspect')))
      .toHaveLength(Object.keys(ASPECT_SHAPES).length)
  })
})
