import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  type WorkspaceSource,
} from '../src/index.js'

// #460: two wires naming one triple both minted, so one relationship became two
// relationship claims. Reported by the ApertureX session against 1.16.0 and
// 1.17.0, from their own pack test.
//
// The rule under test (ADR 0141): an edge with an owner carries its owner's
// wiring id; an edge with only guests carries the id of its triple. A wire
// whose `from` is `self` owns the edge because the edge leaves that instance; a
// wire whose `from` is a slot is a guest naming somebody else's edge.
//
// The assertion that matters most is the one about ids that must NOT move:
// almost every wire in existence is a group of one, and a group of one is not a
// collision.

const profile = `format: yarramate/profile/v1
id: aperturex/consulting
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: app-kind
    name: App
    parent: yarramate/core@0.1#applicationComponent
  - id: mapping-kind
    name: Mapping
    parent: yarramate/core@0.1#applicationFunction
relationshipKinds: []
`

// The app wires `mapping --access--> payload`, a GUEST wire: its `from` is a
// slot, so it names an edge leaving the mapping rather than leaving the app.
// The mapping wires `self --access--> source`, which is the OWNER of the same
// edge whenever both land on one object.
const patterns = `format: yarramate/pattern/v1
id: consulting
version: "1.0"
patterns:
  - kind: aperturex/consulting@1.0#app-kind
    parts:
      mapping:
        kind: aperturex/consulting@1.0#mapping-kind
      payload:
        kind: yarramate/core@0.1#dataObject
    wiring:
      - from: self
        kind: yarramate/core@0.1#assignment
        to: mapping
      - from: mapping
        kind: yarramate/core@0.1#access
        to: payload
  - kind: aperturex/consulting@1.0#mapping-kind
    parts:
      source:
        kind: yarramate/core@0.1#dataObject
    wiring:
      - from: self
        kind: yarramate/core@0.1#access
        to: source
`

const sourcesFor = (document: string): readonly WorkspaceSource[] => [
  { path: 'profiles/consulting.yaml', source: profile },
  { path: 'patterns/consulting.yaml', source: patterns },
  { path: 'architecture/main.yaml', source: document },
]

const accessEdges = (document: string) => {
  const result = compileWorkspaceWithProfileContext(sourcesFor(document))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.code).join())
  return result.graph.claims
    .filter(
      (claim) =>
        claim.predicate === 'yarramate/core@0.1#access' &&
        'ref' in claim.object &&
        claim.object.ref === 'shared-payload',
    )
    .map((claim) => claim.id)
    .sort()
}

describe('#460: two wires naming one triple mint one claim', () => {
  it('mints once where an owner and a guest name the same triple', () => {
    // The reported shape. Before this, both wires minted:
    // `app-mapping-access-payload` AND `map-x-access-source`.
    expect(
      accessEdges(`format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
  - id: app
    kind: app-kind
    name: App
    parts:
      mapping: map-x
      payload: shared-payload
relationships: []
`),
    ).toEqual(['map-x-access-source'])
  })

  it('keeps the OWNER id, so nothing moves for a workspace that compiles today', () => {
    // The surviving id is the mapping's own ADR 0123 id, unchanged from what
    // it would be with no app in the workspace at all. Asserted as an equality
    // between the two workspaces rather than as a literal, so the claim "the
    // guest changes nothing" is what is actually tested.
    const withoutGuest = accessEdges(`format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
relationships: []
`)
    // The guest is declared FIRST on purpose, so it is the wire collected
    // first. An implementation that took whichever wire it met first would
    // answer `app-mapping-access-payload` here and pass a fixture that put the
    // owner first.
    const withGuest = accessEdges(`format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: app
    kind: app-kind
    name: App
    parts:
      mapping: map-x
      payload: shared-payload
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
relationships: []
`)
    expect(withoutGuest).toEqual(['map-x-access-source'])
    expect(withGuest).toEqual(withoutGuest)
  })

  it('falls back to the triple where every wire is a guest', () => {
    // Two apps sharing one GREENFIELD mapping. The owner's wire never fires,
    // because `map-x` binds nothing and an unbound slot wires nothing, so
    // there is no ADR 0123 id to prefer and no basis to pick between the two
    // guests. Measured on 1.17.0 this produced two claims.
    expect(
      accessEdges(`format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
  - id: app1
    kind: app-kind
    name: App one
    parts:
      mapping: map-x
      payload: shared-payload
  - id: app2
    kind: app-kind
    name: App two
    parts:
      mapping: map-x
      payload: shared-payload
relationships: []
`),
    ).toEqual(['map-x-access-shared-payload'])
  })

  it('holds that id steady as further guests arrive', () => {
    // The property that sank picking a winner by sorting the guests: a third
    // app whose id sorts before the others must not move the surviving id.
    const two = `format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
  - id: app1
    kind: app-kind
    name: App one
    parts:
      mapping: map-x
      payload: shared-payload
  - id: app2
    kind: app-kind
    name: App two
    parts:
      mapping: map-x
      payload: shared-payload
relationships: []
`
    const three = two.replace(
      'relationships: []',
      `  - id: aaa-app
    kind: app-kind
    name: Earlier app
    parts:
      mapping: map-x
      payload: shared-payload
relationships: []`,
    )
    expect(accessEdges(three)).toEqual(accessEdges(two))
  })

  it('does not depend on the order the instances are written in', () => {
    const appFirst = `format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: app
    kind: app-kind
    name: App
    parts:
      mapping: map-x
      payload: shared-payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
  - id: shared-payload
    kind: dataObject
    name: Shared payload
relationships: []
`
    const mappingFirst = `format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
  - id: app
    kind: app-kind
    name: App
    parts:
      mapping: map-x
      payload: shared-payload
relationships: []
`
    expect(accessEdges(appFirst)).toEqual(accessEdges(mappingFirst))
    expect(accessEdges(appFirst)).toEqual(['map-x-access-source'])
  })

  it('still lets an authored edge satisfy both wires and mint nothing', () => {
    // The adopter's own control case, which is why their reference project
    // never met the defect: an authored relationship satisfies every wire that
    // names it, so nothing is minted and the authored id is what survives.
    expect(
      accessEdges(`format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: shared-payload
    kind: dataObject
    name: Shared payload
  - id: map-x
    kind: mapping-kind
    name: Map X
    parts:
      source: shared-payload
  - id: app
    kind: app-kind
    name: App
    parts:
      mapping: map-x
      payload: shared-payload
relationships:
  - id: authored-access
    kind: access
    from: map-x
    to: shared-payload
`),
    ).toEqual(['authored-access'])
  })
})

describe('#460: a group of one is not a collision', () => {
  // The regression this rule could most easily cause, and it is not
  // hypothetical: applying ownership without this exception renamed
  // `sys-api-component-composition-interface` in the existing suite.
  //
  // A wire between two SLOTS of one pattern has no `self` endpoint and so no
  // owner, but nothing is competing with it. Its ADR 0123 id must survive
  // untouched, or every such edge in every workspace is renamed - and ADR
  // 0123's own worked examples are of exactly this shape.
  const slotToSlot = `format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: aperturex/consulting@1.0#app-kind
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
      interface:
        kind: yarramate/core@0.1#applicationInterface
    wiring:
      - from: component
        kind: yarramate/core@0.1#composition
        to: interface
`

  it('keeps the ADR 0123 id of a slot-to-slot wire with no owner', () => {
    const result = compileWorkspaceWithProfileContext([
      { path: 'profiles/consulting.yaml', source: profile },
      { path: 'patterns/api-led.yaml', source: slotToSlot },
      {
        path: 'architecture/main.yaml',
        source: `format: yarramate/v1
id: main
profile: aperturex/consulting@1.0
concepts:
  - id: sys-api
    kind: app-kind
    name: System API
    parts:
      component: sys-component
      interface: sys-interface
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.graph.claims
        .filter(
          (claim) => claim.predicate === 'yarramate/core@0.1#composition',
        )
        .map((claim) => claim.id),
      // The instance id, the source slot, the core kind, the target slot -
      // ADR 0123's derivation, untouched.
    ).toEqual(['sys-api-component-composition-interface'])
  })
})
