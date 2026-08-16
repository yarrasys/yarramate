import cytoscape from 'cytoscape'
import { describe, expect, it, vi } from 'vitest'
import {
  applySavedPositions,
  buildLayoutConfig,
  buildPositionMap,
  DRAG_SAVE_DEBOUNCE_MS,
  registerDragSave,
} from '../src/visual-app/graph-canvas.js'
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

// elk-backed layouts (layered, force) resolve asynchronously; the built-in
// concentric layout (radial) resolves synchronously but still fires
// `layoutstop`, so one helper covers all three. This file is compiled under
// both tsconfig.json (lib ES2024) and tsconfig.visual.json (lib ES2022, no
// `Promise.withResolvers`), so it stays on the executor form.
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
  it.each(['layered', 'radial', 'force'] as const)(
    'lays out the %s backend with zero overlapping node bounding boxes',
    async (layout) => {
      const cy = buildLayoutFixture()
      await runLayout(cy, buildLayoutConfig(layout, 'top-down'))
      expect(countOverlappingPairs(cy)).toBe(0)
    }
  )

  it('radial and force configs carry no elk.direction', () => {
    const radial = buildLayoutConfig('radial', 'top-down') as unknown as Record<string, unknown>
    expect(radial).not.toHaveProperty('elk')

    const force = buildLayoutConfig('force', 'top-down') as unknown as {
      elk: Record<string, unknown>
    }
    expect(Object.keys(force.elk)).not.toContain('elk.direction')
  })

  it('force backend with the same seed produces identical positions across two runs', async () => {
    const cyA = buildLayoutFixture()
    const cyB = buildLayoutFixture()
    await runLayout(cyA, buildLayoutConfig('force', 'top-down', 'seed-alpha'))
    await runLayout(cyB, buildLayoutConfig('force', 'top-down', 'seed-alpha'))

    expect(buildPositionMap(cyA.nodes())).toEqual(buildPositionMap(cyB.nodes()))
  })

  it('force backend with different seeds produces different positions', async () => {
    const cyA = buildLayoutFixture()
    const cyB = buildLayoutFixture()
    await runLayout(cyA, buildLayoutConfig('force', 'top-down', 'seed-alpha'))
    await runLayout(cyB, buildLayoutConfig('force', 'top-down', 'seed-beta'))

    expect(buildPositionMap(cyA.nodes())).not.toEqual(buildPositionMap(cyB.nodes()))
  })
})
