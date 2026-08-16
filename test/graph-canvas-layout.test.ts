import cytoscape from 'cytoscape'
import { describe, expect, it, vi } from 'vitest'
import {
  applySavedPositions,
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
