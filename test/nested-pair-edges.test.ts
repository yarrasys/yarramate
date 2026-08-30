import { describe, expect, it } from 'vitest'
import { spansNesting } from '../src/visual-app/nesting-span.js'

// #439, field-reported by an adopter and reproduced here from a five-concept
// model. Composition maps onto cytoscape's compound `parent`, so a pair that
// also carries ANY other relationship produces an edge from a container to
// its own child. ELK cannot lay that out: the container and its child render
// and every unrelated node loses its geometry.
//
// Measured on the minimal case, 1600x1000 viewport, painted-alpha samples at
// stride 4 over the top canvas layer:
//
//   composition + realization   543 painted, 124x64   <- collapse
//   composition alone        10,612 painted, 832x452  <- healthy
//   composition + serving       543 painted, 124x64   <- identical collapse
//
// The third line is why this is about NESTING and not about realization: any
// edge between an ancestor and its descendant does it.

const parents = (...pairs: readonly (readonly [string, string])[]) =>
  new Map(pairs.map(([child, parent]) => [child, parent]))

describe('an edge that spans a nesting boundary', () => {
  const nested = parents(['orders-api', 'orders-app'])

  it('is found when it runs from container to child', () => {
    expect(spansNesting('orders-app', 'orders-api', nested)).toBe(true)
  })

  it('is found when it runs from child to container', () => {
    // Direction is irrelevant: ELK is handed the same degenerate pair either
    // way, and a model may legitimately declare the edge in either direction.
    expect(spansNesting('orders-api', 'orders-app', nested)).toBe(true)
  })

  it('is found across more than one level', () => {
    const deep = parents(
      ['endpoint', 'orders-api'],
      ['orders-api', 'orders-app'],
    )
    expect(spansNesting('orders-app', 'endpoint', deep)).toBe(true)
  })
})

describe('an ordinary edge is left alone', () => {
  const nested = parents(
    ['orders-api', 'orders-app'],
    ['billing-api', 'billing-app'],
  )

  it('between two unrelated top-level subjects', () => {
    expect(spansNesting('billing-app', 'customers', nested)).toBe(false)
  })

  it('between siblings under different containers', () => {
    // The case the fix must not over-reach into: two nested subjects with an
    // edge between them are ordinary, and withholding it from the layout
    // would lose real routing.
    expect(spansNesting('orders-api', 'billing-api', nested)).toBe(false)
  })

  it('between a container and someone else"s child', () => {
    expect(spansNesting('orders-app', 'billing-api', nested)).toBe(false)
  })

  it('when nothing is nested at all', () => {
    expect(spansNesting('a', 'b', new Map())).toBe(false)
  })
})

describe('a cycle in the parent chain terminates', () => {
  it('does not hang, and reports no spanning', () => {
    // `resolveNestingParents` already refuses to nest a composition cycle, so
    // this should be unreachable. It is guarded anyway because the cost of
    // being wrong is a frozen canvas rather than a bad picture.
    const cyclic = parents(['a', 'b'], ['b', 'a'])
    expect(spansNesting('a', 'c', cyclic)).toBe(false)
  })

  it('still reports a real ancestor inside a cycle', () => {
    const cyclic = parents(['a', 'b'], ['b', 'a'])
    expect(spansNesting('a', 'b', cyclic)).toBe(true)
  })
})
