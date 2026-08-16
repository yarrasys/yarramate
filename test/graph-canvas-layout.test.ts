import cytoscape from 'cytoscape'
import { describe, expect, it, vi } from 'vitest'
import {
  applySavedPositions,
  buildLayoutConfig,
  buildPositionMap,
  DRAG_SAVE_DEBOUNCE_MS,
  registerDragSave,
  relayoutVisible,
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

describe('relayoutVisible force second pass', () => {
  it('resolves overlaps a single stress pass leaves, and signals busy state through onWaitingChange', async () => {
    const baseline = buildHubFixture()
    await runLayout(baseline, buildLayoutConfig('force', 'top-down'))
    expect(countOverlappingPairs(baseline)).toBeGreaterThan(0)

    const cy = buildHubFixture()
    const waitingCalls: (string | null)[] = []
    const idle = Promise.withResolvers<void>()
    relayoutVisible(cy, 'force', 'top-down', { current: null }, (waiting) => {
      waitingCalls.push(waiting)
      if (waiting === null) idle.resolve()
    })
    await idle.promise

    expect(waitingCalls[0]).toBe('Laying out...')
    expect(waitingCalls.at(-1)).toBeNull()
    expect(countOverlappingPairs(cy)).toBe(0)
  })

  it('supersedes an in-flight force run instead of stacking a second pass on top', async () => {
    const cy = buildHubFixture()
    const inFlightRef: { current: cytoscape.Layouts | null } = { current: null }
    const waitingCalls: (string | null)[] = []
    // Every `.run()` emits exactly one `layoutstart`, a stopped run included,
    // so this counts layout passes actually started. The superseded run's own
    // `layoutstop` necessarily precedes the winner's (it started first over
    // the same collection), so by the time busy goes idle a stray fourth pass
    // would already have been started and counted - no settling wait needed.
    let started = 0
    cy.on('layoutstart', () => {
      started++
    })

    const idle = Promise.withResolvers<void>()
    const onWaitingChange = (waiting: string | null) => {
      waitingCalls.push(waiting)
      if (waiting === null) idle.resolve()
    }
    relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    // Supersede before the first request's own layoutstop can fire.
    relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    await idle.promise

    // Three passes, and only three: the superseded stress run, the winning
    // stress run, and the winner's single `sporeOverlap` pass. A fourth means
    // the superseded run's `layoutstop` started an overlap pass of its own
    // over a collection the newer request had already claimed.
    expect(started).toBe(3)
    // Nor may that superseded chain flip busy back to idle a second time:
    // exactly one idle transition, however many busy announcements preceded it.
    expect(waitingCalls.filter((w) => w === null)).toHaveLength(1)
    expect(countOverlappingPairs(cy)).toBe(0)
  })

  it('keeps a run superseded during its second pass from reporting idle', async () => {
    const cy = buildHubFixture()
    const inFlightRef: { current: cytoscape.Layouts | null } = { current: null }
    const waitingCalls: (string | null)[] = []

    // Five passes in total, all sequenced by layout events rather than
    // wall-clock waits: request A's stress run, request B's stress run and
    // its `sporeOverlap` pass, then request C's two. C is issued as B's
    // overlap pass starts, so it lands while that pass is in flight - the
    // only way to reach the second pass's own supersede guard. On the real
    // 258-node graph that window is seconds wide and the event loop stays
    // free throughout, so a reviewer's click lands here routinely; on this
    // fixture the pass settles within its own task, so the request has to be
    // issued from `layoutstart` to fall inside it at all.
    const settled = Promise.withResolvers<void>()
    const onWaitingChange = (waiting: string | null) => {
      waitingCalls.push(waiting)
    }
    let started = 0
    cy.on('layoutstart', () => {
      started++
      if (started === 3) relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    })
    let stopped = 0
    cy.on('layoutstop', () => {
      stopped++
      if (stopped === 5) settled.resolve()
    })

    relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    await settled.promise

    expect(started).toBe(5)
    // Only the last request may report idle. An overlap pass whose collection
    // a newer request already claimed must stay silent, or the canvas drops
    // its "Laying out..." notice while a layout is still moving nodes.
    expect(waitingCalls.filter((w) => w === null)).toHaveLength(1)
    expect(waitingCalls.at(-1)).toBeNull()
    expect(countOverlappingPairs(cy)).toBe(0)
  })

  it('retires the busy notice when a layered request supersedes an in-flight force run', async () => {
    const cy = buildHubFixture()
    const inFlightRef: { current: cytoscape.Layouts | null } = { current: null }
    const waitingCalls: (string | null)[] = []
    const onWaitingChange = (waiting: string | null) => {
      waitingCalls.push(waiting)
    }

    // Two passes: the force stress run, stopped where it stands, and the
    // layered run that took the canvas off it. The superseded chain's own
    // handlers are guarded into silence, so if the layered branch does not
    // retire the notice itself nothing ever will and "Laying out..." sticks
    // for the rest of the session.
    const settled = Promise.withResolvers<void>()
    let started = 0
    cy.on('layoutstart', () => {
      started++
    })
    let stopped = 0
    cy.on('layoutstop', () => {
      stopped++
      if (stopped === 2) settled.resolve()
    })

    relayoutVisible(cy, 'force', 'top-down', inFlightRef, onWaitingChange)
    expect(waitingCalls).toEqual(['Laying out...'])
    relayoutVisible(cy, 'layered', 'top-down', inFlightRef, onWaitingChange)
    await settled.promise

    expect(started).toBe(2)
    expect(waitingCalls.at(-1)).toBeNull()
    expect(waitingCalls.filter((w) => w === null)).toHaveLength(1)
    expect(inFlightRef.current).toBeNull()
  })
})
