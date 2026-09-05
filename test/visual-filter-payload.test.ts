import { describe, expect, it } from 'vitest'
import { parseVisualBrowserInput } from '../src/adapters/visual/protocol.js'
import type { VisualBrowserInput } from '../src/adapters/visual/protocol-contract.js'

// The TypeScript payload and the WIRE SCHEMA are two declarations of one shape,
// and nothing made them agree. `nesting` was added to `VisualFilterQueryPayload`
// in 1.21.0 and not to `filterQueryPayload` in the event schema, which is
// `additionalProperties: false` — so every filter carrying it was refused with
// YMVS109 and the standalone editor showed "The workspace did not compile".
//
// It survived three releases and two browser passes because the ApertureX
// harness mounts the lib and never goes through this validation: their host is
// a different path, and a pass on one says nothing about the other.
//
// Found by opening the standalone editor, which is the only place this path
// runs. These tests go through `parseVisualBrowserInput`, which is what the
// session server actually calls.

const filter = (payload: unknown): unknown => ({
  type: 'filter.query',
  lastAcknowledgedSequence: 0,
  payload,
})

describe('the filter a browser sends', () => {
  it('accepts a bare query, as it always did', () => {
    expect(parseVisualBrowserInput(filter({ query: {} })).ok).toBe(true)
  })

  it('accepts the nesting the canvas is drawing with', () => {
    const parsed = parseVisualBrowserInput(
      filter({ query: { instances: ['sys-api'] }, nesting: ['composition', 'assignment'] }),
    )
    expect(parsed.ok).toBe(true)
  })

  it('accepts either nesting kind on its own', () => {
    for (const nesting of [['composition'], ['assignment']]) {
      expect(parseVisualBrowserInput(filter({ query: {}, nesting })).ok).toBe(true)
    }
  })

  it('still refuses a field nobody declared', () => {
    // The point of `additionalProperties: false` survives: this is not a
    // licence for anything to ride along on the payload.
    expect(parseVisualBrowserInput(filter({ query: {}, invented: true })).ok).toBe(
      false,
    )
  })

  it('refuses a nesting kind that is not one', () => {
    expect(
      parseVisualBrowserInput(filter({ query: {}, nesting: ['realisation'] })).ok,
    ).toBe(false)
  })

  it('refuses a repeated nesting kind', () => {
    expect(
      parseVisualBrowserInput(
        filter({ query: {}, nesting: ['composition', 'composition'] }),
      ).ok,
    ).toBe(false)
  })

  it('accepts what the browser actually composes for focus-instance', () => {
    // The exact shape `App.tsx` sends for "Focus on this instance", typed as
    // the contract declares it, so the two declarations are compared rather
    // than described.
    const composed: VisualBrowserInput = {
      type: 'filter.query',
      lastAcknowledgedSequence: 0,
      payload: {
        query: { instances: ['patron-checkin-xapi'], relationships: 'between' },
        nesting: ['composition', 'assignment'],
      },
    }
    expect(parseVisualBrowserInput(composed).ok).toBe(true)
  })
})
