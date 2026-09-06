import { describe, expect, it } from 'vitest'
import { parseVisualBrowserInput } from '../src/adapters/visual/protocol.js'

// The browser's `layout.save` is validated against the event schema before
// the session server touches it. The sidecar could hold fold state since
// #473 and both hosts would write it, but the payload definition admitted
// positions alone, so a browser that sent its folds would have been refused
// (YMVS109) and none ever did. The payload now names the sidecar's own
// definitions for folds and routes (ADR 0147), so what the browser may send
// and what the file may hold are one shape.
const save = (payload: Record<string, unknown>) =>
  parseVisualBrowserInput({ type: 'layout.save', lastAcknowledgedSequence: 0, payload })

describe('layout.save from the browser', () => {
  it('still accepts positions alone', () => {
    expect(save({ projectionId: 'apps', positions: { checkout: { x: 1, y: 2 } } }).ok).toBe(true)
  })

  it('accepts the fold state and the routes beside the positions', () => {
    const parsed = save({
      projectionId: 'apps',
      positions: { checkout: { x: 1, y: 2 }, ledger: { x: 300, y: 2 } },
      folded: ['checkout'],
      unfolded: [],
      routes: {
        'checkout-serves-ledger': {
          points: [{ x: 86, y: 2 }, { x: 150, y: 2 }, { x: 150, y: 60 }, { x: 215, y: 60 }],
          labelAt: 64,
        },
      },
    })
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true)
  })

  it('refuses a route the sidecar could not hold', () => {
    expect(
      save({
        projectionId: 'apps',
        positions: { checkout: { x: 1, y: 2 } },
        routes: { e: { points: [{ x: 0, y: 0 }], labelAt: null } },
      }).ok,
    ).toBe(false)
  })
})
