import { describe, expect, it } from 'vitest'
import { faultedSubjects, summarise } from '../src/visual-app/faults.js'
import type { CanvasGraph } from '../src/graph-projection.js'
import type { VisualDiagnostic } from '../src/adapters/visual/protocol-contract.js'

const graph = {
  nodes: [
    { id: 'orders' },
    { id: 'billing' },
  ],
  edges: [{ id: 'orders-serving-billing' }],
} as unknown as CanvasGraph

const diagnostic = (
  code: string,
  subjects?: readonly string[],
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message: `${code} happened`,
  path: 'architecture/main.yaml',
  pointer: '/concepts/0',
  line: 1,
  column: 1,
  ...(subjects === undefined ? {} : { subjects }),
})

describe('summarise', () => {
  it('counts what can be marked and what cannot, separately', () => {
    const summary = summarise(
      [
        diagnostic('YM404', ['orders']),
        diagnostic('YM201'),
        diagnostic('YM701'),
      ],
      graph,
    )

    expect(summary).toEqual({ total: 3, onCanvas: 1, elsewhere: 2 })
  })

  it('counts a subject the view does not draw as not on it', () => {
    // It is real, and this view cannot show it. Calling it "on the diagram"
    // would promise a mark that never appears.
    expect(summarise([diagnostic('YM404', ['absent'])], graph)).toEqual({
      total: 1,
      onCanvas: 0,
      elsewhere: 1,
    })
  })

  it('never reports anything while there is nothing wrong', () => {
    expect(summarise([], graph)).toEqual({
      total: 0,
      onCanvas: 0,
      elsewhere: 0,
    })
  })
})

describe('faultedSubjects', () => {
  it('collects every subject any diagnostic named', () => {
    expect([
      ...faultedSubjects([
        diagnostic('YM404', ['orders', 'billing']),
        diagnostic('YM501', ['orders']),
        diagnostic('YM201'),
      ]),
    ]).toEqual(['orders', 'billing'])
  })

  it('is empty when nothing names a subject', () => {
    expect(faultedSubjects([diagnostic('YM201')]).size).toBe(0)
  })
})
