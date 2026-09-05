import { describe, expect, it } from 'vitest'
import {
  constraintRowsOf,
  constraintRowLabel,
} from '../src/visual-app/constraint-rows.js'
import type { PatternMembership } from '../src/compiler.js'


// #473 phase 3 item 3.2 (ADR 0145): a bound ruling draws as a row inside its
// holder. The arithmetic only, with no renderer: which rulings become rows, on
// which instances, what that hides, and who is named as having set the rule.

const node = (id: string, coreKindLabel: string, name = id) => ({
  id,
  name,
  coreKindLabel,
})
const edge = (id: string, from: string, to: string) => ({ id, from, to })
const bind = (
  member: string,
  slot: string,
  instance: string,
  wiring: PatternMembership['wiring'] = 'unwired',
): PatternMembership => ({
  member,
  slot,
  instance,
  pattern: 'acme/p@1.0#api',
  wiring,
})

const GRAPH = {
  nodes: [
    node('api', 'applicationComponent', 'System API'),
    node('other-api', 'applicationComponent', 'Other API'),
    node('rate-limit', 'constraint', 'Rate limit'),
    node('retention', 'constraint', 'Retention policy'),
    node('unbound-rule', 'constraint', 'Nobody binds me'),
    node('security', 'businessRole', 'IT Security'),
    node('support', 'businessRole', 'IT Support'),
  ],
  edges: [
    edge('e1', 'security', 'rate-limit'),
    edge('e2', 'support', 'rate-limit'),
    edge('e3', 'security', 'retention'),
    edge('e4', 'api', 'other-api'),
  ],
}

describe('which rulings become rows', () => {
  it('turns a ruling bound in an unwired slot into a row on its holder', () => {
    const result = constraintRowsOf(GRAPH, [bind('rate-limit', 'policy', 'api')])
    expect(result.rowsByInstance.get('api')).toEqual([
      {
        slot: 'policy',
        id: 'rate-limit',
        name: 'Rate limit',
        rulers: ['IT Security', 'IT Support'],
        shared: false,
      },
    ])
  })

  it('hides the ruling as a node and takes its edges with it', () => {
    const result = constraintRowsOf(GRAPH, [bind('rate-limit', 'policy', 'api')])
    expect([...result.hiddenNodeIds]).toEqual(['rate-limit'])
    // The ruler's edges had the ruling as their only landing place.
    expect([...result.hiddenEdgeIds].sort()).toEqual(['e1', 'e2'])
    // An edge between two things that are still boxes is untouched.
    expect(result.hiddenEdgeIds.has('e4')).toBe(false)
  })

  it('leaves a ruling nothing binds as a node', () => {
    const result = constraintRowsOf(GRAPH, [bind('rate-limit', 'policy', 'api')])
    // A requirement with no holder has no box to sit in, so it keeps its own.
    expect(result.hiddenNodeIds.has('unbound-rule')).toBe(false)
  })

  it('draws a shared ruling in every holder, marked', () => {
    const result = constraintRowsOf(GRAPH, [
      bind('rate-limit', 'policy', 'api'),
      bind('rate-limit', 'policy', 'other-api'),
    ])
    expect(result.rowsByInstance.get('api')?.[0]?.shared).toBe(true)
    expect(result.rowsByInstance.get('other-api')?.[0]?.shared).toBe(true)
  })

  it('ignores a slot that is not unwired', () => {
    // `owned` and `context` make a statement about direction that a row cannot
    // carry, and on the reference every bound ruling fills an unwired slot.
    expect(
      constraintRowsOf(GRAPH, [bind('rate-limit', 'policy', 'api', 'owned')])
        .rowsByInstance.size,
    ).toBe(0)
    expect(
      constraintRowsOf(GRAPH, [bind('rate-limit', 'policy', 'api', 'context')])
        .rowsByInstance.size,
    ).toBe(0)
  })

  it('ignores a bound member that is not a ruling', () => {
    expect(
      constraintRowsOf(GRAPH, [bind('other-api', 'backend', 'api')]).rowsByInstance
        .size,
    ).toBe(0)
  })

  it('orders rows by slot, so a redraw does not shuffle them', () => {
    const rows = constraintRowsOf(GRAPH, [
      bind('retention', 'retention', 'api'),
      bind('rate-limit', 'policy', 'api'),
    ]).rowsByInstance.get('api')
    expect(rows?.map(({ slot }) => slot)).toEqual(['policy', 'retention'])
  })

  it('does not name a holder as its own ruler', () => {
    // The holder reaches the ruling through the SLOT, not through an edge. If
    // it also happens to point at it, that is not somebody setting the rule.
    const result = constraintRowsOf(
      {
        ...GRAPH,
        edges: [...GRAPH.edges, edge('e5', 'api', 'rate-limit')],
      },
      [bind('rate-limit', 'policy', 'api')],
    )
    expect(result.rowsByInstance.get('api')?.[0]?.rulers).toEqual([
      'IT Security',
      'IT Support',
    ])
  })

  it('carries no ruler where nothing points at the ruling', () => {
    const result = constraintRowsOf(
      { ...GRAPH, edges: [] },
      [bind('rate-limit', 'policy', 'api')],
    )
    expect(result.rowsByInstance.get('api')?.[0]?.rulers).toEqual([])
  })

  it('draws everything as boxes when the toggle is off', () => {
    const result = constraintRowsOf(
      GRAPH,
      [bind('rate-limit', 'policy', 'api')],
      false,
    )
    expect(result.rowsByInstance.size).toBe(0)
    expect(result.hiddenNodeIds.size).toBe(0)
    expect(result.hiddenEdgeIds.size).toBe(0)
  })

  it('says nothing when the model binds no rulings at all', () => {
    expect(constraintRowsOf(GRAPH, []).rowsByInstance.size).toBe(0)
  })
})

describe('what a row reads as', () => {
  it('names the slot, the ruling and its rulers', () => {
    expect(
      constraintRowLabel({
        slot: 'policy',
        id: 'rate-limit',
        name: 'Rate limit',
        rulers: ['IT Security'],
        shared: false,
      }),
    ).toBe('policy: Rate limit · IT Security')
  })

  it('marks a shared ruling and lists several rulers', () => {
    expect(
      constraintRowLabel({
        slot: 'policy',
        id: 'rate-limit',
        name: 'Rate limit',
        rulers: ['IT Security', 'IT Support'],
        shared: true,
      }),
    ).toBe('policy: Rate limit · IT Security, IT Support (shared)')
  })

  it('drops the separator where there is no ruler to name', () => {
    expect(
      constraintRowLabel({
        slot: 'policy',
        id: 'rate-limit',
        name: 'Rate limit',
        rulers: [],
        shared: false,
      }),
    ).toBe('policy: Rate limit')
  })
})
