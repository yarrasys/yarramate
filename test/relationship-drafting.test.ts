import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import {
  connectableKinds,
  draftRelationship,
  proposeRelationshipId,
} from '../src/relationship-drafting.js'
import { applyOperations } from '../src/apply-command.js'
import { stringify } from 'yaml'
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
  - id: settle
    kind: applicationFunction
    name: Settle
  - id: ledger
    kind: dataObject
    name: Ledger
relationships:
  - id: orders-serving-billing
    kind: serving
    from: orders
    to: billing
`

const graphOf = (source: string): CanvasGraph => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return projectGraphForCanvas(result.graph, result.profileContext)
}

const graph = graphOf(DOCUMENT)

describe('connectableKinds', () => {
  it('offers what the table permits, sorted, with association always present', () => {
    const kinds = connectableKinds(graph, 'orders', 'settle')

    expect(kinds).toContain('assignment')
    expect(kinds).toContain('association')
    expect([...kinds]).toEqual([...kinds].sort())
  })

  it('is empty for an endpoint the graph does not hold', () => {
    expect(connectableKinds(graph, 'orders', 'absent')).toEqual([])
    expect(connectableKinds(graph, 'absent', 'orders')).toEqual([])
  })

  it('reads the core kind, not the authored one', () => {
    // A profile kind has no row in the table; its core ancestor does. Without
    // this the palette would be empty for every model that uses a profile.
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'architecture/profile.yaml',
        source: `format: yarramate/profile/v1
id: yarramate/development
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds: []
`,
      },
      {
        path: 'architecture/main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/development@1.0
concepts:
  - id: orders
    kind: microservice
    name: Orders
  - id: settle
    kind: applicationFunction
    name: Settle
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const derived = projectGraphForCanvas(result.graph, result.profileContext)

    expect(
      derived.nodes.find((node) => node.id === 'orders')?.kindLabel,
    ).toBe('microservice')
    expect(connectableKinds(derived, 'orders', 'settle')).toContain(
      'assignment',
    )
  })
})

describe('proposeRelationshipId', () => {
  it('reads as the sentence the relationship makes', () => {
    expect(proposeRelationshipId(graph, 'orders', 'assignment', 'settle')).toBe(
      'orders-assignment-settle',
    )
  })

  it('steps past an id already taken', () => {
    // `orders-serving-billing` is already in the document.
    expect(proposeRelationshipId(graph, 'orders', 'serving', 'billing')).toBe(
      'orders-serving-billing-2',
    )
  })

  it('produces an id the document schema accepts', () => {
    const pattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
    for (const kind of connectableKinds(graph, 'orders', 'settle')) {
      expect(
        proposeRelationshipId(graph, 'orders', kind, 'settle'),
      ).toMatch(pattern)
    }
  })
})

describe('draftRelationship', () => {
  it('refuses a kind the table does not permit, whatever the caller believes', () => {
    // Not filtered by a palette first: the guarantee has to hold for any
    // caller, not only a careful one.
    expect(draftRelationship(graph, 'settle', 'composition', 'orders')).toBeNull()
  })

  it('writes into the source subject document', () => {
    const operation = draftRelationship(graph, 'orders', 'assignment', 'settle')
    expect(operation).toMatchObject({
      op: 'add-relationship',
      document: 'architecture/main.yaml',
      relationship: { kind: 'assignment', from: 'orders', to: 'settle' },
    })
  })

  /**
   * The property the whole connection tool rests on, driven all the way
   * through: whatever the palette offers is drafted, applied, and compiled.
   * Anything the editor could produce therefore already has a passing `check`
   * behind it.
   */
  it('produces a relationship that applies and compiles, for every kind offered', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['orders', 'settle'],
      ['orders', 'billing'],
      ['settle', 'ledger'],
      ['orders', 'ledger'],
    ]
    let drafted = 0

    for (const [from, to] of pairs) {
      for (const kind of connectableKinds(graph, from, to)) {
        const operation = draftRelationship(graph, from, kind, to)
        expect(operation, `${from} -${kind}-> ${to}`).not.toBeNull()
        if (operation === null) continue
        drafted += 1

        // No filesystem anywhere: `applyOperations` is pure since ADR 0100, so
        // the workspace is stated directly and this stays a test about what a
        // draft compiles to.
        const outcome = applyOperations({
          workspace: {
            id: 'drafting',
            documents: ['architecture/main.yaml'],
            profiles: [],
            projections: [],
            adapterMappings: [],
            evidence: [],
            contracts: [],
          },
          sources: [{ path: 'architecture/main.yaml', source: DOCUMENT }],
          operations: {
            path: 'changeset.yaml',
            source: stringify({
              format: 'yarramate/operations/v1',
              operations: [operation],
            }),
          },
          manifestDirectory: '.yarramate',
        })

        expect(
          outcome.ok ? [] : outcome.diagnostics.map((d) => d.code),
          `${from} -${kind}-> ${to} did not apply`,
        ).toEqual([])
      }
    }

    // Not passing by drafting nothing. A floor rather than the exact count,
    // which is a property of the ArchiMate table and not of this test.
    expect(drafted).toBeGreaterThan(12)
  })
})
