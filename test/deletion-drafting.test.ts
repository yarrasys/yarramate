import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { deletionBlockers, draftDeletion } from '../src/deletion-drafting.js'
import { applyOperations } from '../src/apply-command.js'
import type { CanvasGraph } from '../src/graph-projection.js'

const DOCUMENT = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: orders
    kind: applicationComponent
    name: Orders
  - id: billing
    kind: applicationComponent
    name: Billing
  - id: ledger
    kind: dataObject
    name: Ledger
relationships:
  - id: orders-serving-billing
    kind: serving
    from: orders
    to: billing
  - id: billing-access-ledger
    kind: access
    from: billing
    to: ledger
`

const graphOf = (source: string): CanvasGraph => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return projectGraphForCanvas(result.graph, result.profileContext)
}

const graph = graphOf(DOCUMENT)

const apply = (operations: readonly unknown[], source = DOCUMENT) =>
  applyOperations({
    workspace: {
      id: 'deleting',
      documents: ['architecture/main.yaml'],
      profiles: [],
      projections: [],
      adapterMappings: [],
      evidence: [],
      contracts: [],
    },
    sources: [{ path: 'architecture/main.yaml', source }],
    operations: {
      path: 'changeset.yaml',
      source: stringify({
        format: 'yarramate/operations/v1',
        operations,
      }),
    },
    manifestDirectory: '.yarramate',
  })

describe('draftDeletion', () => {
  it('is empty for an id the graph does not hold', () => {
    expect(draftDeletion(graph, 'absent')).toEqual([])
  })

  it('removes a relationship on its own', () => {
    expect(draftDeletion(graph, 'orders-serving-billing')).toEqual([
      {
        op: 'delete-relationship',
        document: 'architecture/main.yaml',
        relationship: { id: 'orders-serving-billing' },
      },
    ])
  })

  it('takes every relationship naming a subject along with it', () => {
    // Without this the delete is simply refused: `apply` will not remove a
    // subject something still references.
    const operations = draftDeletion(graph, 'billing')

    expect(operations.map((operation) => operation.op)).toEqual([
      'delete-relationship',
      'delete-relationship',
      'delete-concept',
    ])
  })

  /**
   * The property: what the canvas composes actually lands. ADR 0069 evaluates
   * integrity against the post-batch state, which is what lets a subject and
   * its relationships go together at all.
   */
  it('composes a batch that applies and leaves a workspace that compiles', () => {
    const outcome = apply(draftDeletion(graph, 'billing'))

    expect(outcome.ok ? [] : outcome.diagnostics.map((d) => d.code)).toEqual([])
    if (!outcome.ok) return

    const after = graphOf(outcome.sources[0]!.source)
    expect(after.nodes.map((node) => node.id).sort()).toEqual([
      'ledger',
      'orders',
    ])
    expect(after.edges).toEqual([])
  })

  it('deletes every subject in turn without leaving a workspace that fails', () => {
    for (const node of graph.nodes) {
      const outcome = apply(draftDeletion(graph, node.id))
      expect(
        outcome.ok ? [] : outcome.diagnostics.map((d) => d.code),
        `deleting ${node.id}`,
      ).toEqual([])
      if (!outcome.ok) continue
      const after = graphOf(outcome.sources[0]!.source)
      expect(after.nodes.map((candidate) => candidate.id)).not.toContain(
        node.id,
      )
    }
  })
})

describe('deletionBlockers', () => {
  it('finds nothing when only relationships hold the subject', () => {
    // Those go in the same batch, so they are not blockers.
    expect(deletionBlockers(graph, 'billing')).toEqual([])
  })

  it('names the subject and the field that would still refuse it', () => {
    const held = graphOf(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: alice
    kind: businessActor
    name: Alice
  - id: orders
    kind: applicationComponent
    name: Orders
    owner: alice
relationships: []
`)

    expect(deletionBlockers(held, 'alice')).toEqual([
      { by: 'orders', field: 'owner' },
    ])
  })

  it('a blocked deletion is refused by apply, which is the real gate', () => {
    // The blocker list is a warning the canvas can show; it is not the rule.
    const source = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: alice
    kind: businessActor
    name: Alice
  - id: orders
    kind: applicationComponent
    name: Orders
    owner: alice
relationships: []
`
    const held = graphOf(source)
    const outcome = apply(draftDeletion(held, 'alice'), source)

    expect(outcome.ok).toBe(false)
  })
})
