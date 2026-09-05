import { describe, expect, it } from 'vitest'
import {
  canonicalProjection,
  compileWorkspaceWithProfileContext,
  evaluateProjection,
  explainProjection,
  loadProjection,
  type ProjectionDefinition,
  type WorkspaceSource,
} from '../src/index.js'
// Not on the barrel: `check` is its only caller, and it stays that way.
import { projectionReferenceDiagnostics } from '../src/projection.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { graphToElements } from '../src/visual-app/graph-canvas.js'
import type { NestingKind } from '../src/nesting.js'

// The `instances` facet (#473 phase 2, ADR 0144): a view names an instance and
// gets what it holds. The fixture is the api-led cluster the pattern tests use,
// with one addition - `deep-part`, composed off a member rather than off the
// instance - because a closure that only ever goes one level deep cannot tell a
// transitive walk from a single hop.

const profile = `format: yarramate/profile/v1
id: yarrasys/api-led
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

const pattern = `format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
        required: true
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: component
      - from: component
        kind: yarramate/core@0.1#composition
        to: interface
      - from: interface
        kind: yarramate/core@0.1#assignment
        to: service
`

const document = `format: yarramate/v1
id: main
profile: yarrasys/api-led@1.0
concepts:
  - id: sys-api
    kind: api
    name: System API
    parts:
      component: sys-component
      interface: sys-interface
      service: sys-service
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
  - id: deep-part
    kind: applicationComponent
    name: Deep part
  - id: lone-component
    kind: applicationComponent
    name: Lone component
relationships:
  - id: component-holds-deep-part
    kind: composition
    from: sys-component
    to: deep-part
`

const sources: readonly WorkspaceSource[] = [
  { path: 'profiles/api-led.yaml', source: profile },
  { path: 'patterns/api-led.yaml', source: pattern },
  { path: 'architecture/main.yaml', source: document },
]

// This fixture has no workspace document, so subject ids stay unqualified.
const qualify = (local: string) => local
const INSTANCE = qualify('sys-api')

const compiled = () => {
  const result = compileWorkspaceWithProfileContext(sources)
  if (!result.ok) {
    throw new Error(
      `fixture does not compile: ${result.diagnostics
        .map(({ code, message }) => `${code} ${message}`)
        .join('; ')}`,
    )
  }
  return result
}

const projection = (
  query: ProjectionDefinition['query'],
  nesting?: readonly NestingKind[],
): ProjectionDefinition => ({
  format: 'yarramate/projection/v1',
  id: 'instances-probe',
  version: '0.0',
  query,
  ...(nesting === undefined ? {} : { presentation: { nesting } }),
})

const conceptsOf = (
  result: ReturnType<typeof evaluateProjection>,
): readonly string[] =>
  result.subjects
    .filter(({ type }) => type === 'concept')
    .map(({ id }) => id)
    .sort()

describe('the instances facet', () => {
  // The closing assertion of review F3, and the one phase 1 did not have: the
  // projection and the canvas must agree about what is inside a box. They are
  // two callers of `foldTree` over the same model, and if they can disagree
  // then a view drawn folded and the same view exported hold different things.
  // Wrapped one level deeper than it reads: `it.each` spreads its rows as
  // arguments, so a bare `['composition']` arrives as the string.
  it.each<readonly [readonly NestingKind[]]>([
    [['composition']],
    [['composition', 'assignment']],
    [['assignment']],
  ])('selects exactly what the canvas folds, nesting %j', (nesting) => {
    const { graph, profileContext, patternMemberships } = compiled()

    const throughProjection = conceptsOf(
      evaluateProjection(
        graph,
        projection({ instances: [INSTANCE] }, nesting),
        profileContext,
        patternMemberships,
      ),
    )

    const elements = graphToElements(
      projectGraphForCanvas(graph, profileContext),
      nesting,
      new Map(),
      { folded: new Set([INSTANCE]), memberships: patternMemberships },
    )
    const box = elements.find(({ data }) => data['id'] === INSTANCE)
    expect(box, 'the instance draws as a node').toBeDefined()
    const throughCanvas = [
      INSTANCE,
      ...(box!.data['insideIds'] as readonly string[]),
    ].sort()

    expect(throughProjection).toEqual(throughCanvas)
    // Guard against the assertion passing because both sides are the instance
    // alone, which would make it true and worthless.
    expect(throughProjection.length).toBeGreaterThan(1)
  })

  it('walks the closure transitively, not one hop', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const selected = conceptsOf(
      evaluateProjection(
        graph,
        projection({ instances: [INSTANCE] }, ['composition']),
        profileContext,
        patternMemberships,
      ),
    )
    // `deep-part` hangs off a MEMBER, so a single hop from the instance misses
    // it. `lone-component` is a real concept the instance does not hold.
    expect(selected).toContain(qualify('deep-part'))
    expect(selected).not.toContain(qualify('lone-component'))
  })

  it('reads the view\'s own nesting rather than the default', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const under = (nesting: readonly NestingKind[]) =>
      conceptsOf(
        evaluateProjection(
          graph,
          projection({ instances: [INSTANCE] }, nesting),
          profileContext,
          patternMemberships,
        ),
      )
    // `deep-part` is reached through a COMPOSITION off a member. A view that
    // does not nest on composition does not contain it, and the facet has to
    // say so rather than answering for a nesting the author did not write.
    expect(under(['composition'])).toContain(qualify('deep-part'))
    expect(under(['assignment'])).not.toContain(qualify('deep-part'))
  })

  it('unions with subjects rather than intersecting them', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const selected = conceptsOf(
      evaluateProjection(
        graph,
        projection({
          instances: [INSTANCE],
          subjects: [qualify('lone-component')],
        }),
        profileContext,
        patternMemberships,
      ),
    )
    // Intersecting would have produced the empty set: `lone-component` is in no
    // closure, and no closure member is named under `subjects`.
    expect(selected).toContain(qualify('lone-component'))
    expect(selected).toContain(qualify('sys-component'))
  })

  it('narrows the union with every other facet, which still ANDs', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const selected = conceptsOf(
      evaluateProjection(
        graph,
        projection({
          instances: [INSTANCE],
          kinds: ['yarramate/core@0.1#applicationService'],
        }),
        profileContext,
        patternMemberships,
      ),
    )
    expect(selected).toEqual([qualify('sys-service')])
  })

  it('lets exclude take a closure member back out', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const selected = conceptsOf(
      evaluateProjection(
        graph,
        projection({
          instances: [INSTANCE],
          exclude: [qualify('sys-service')],
        }),
        profileContext,
        patternMemberships,
      ),
    )
    expect(selected).not.toContain(qualify('sys-service'))
    expect(selected).toContain(qualify('sys-component'))
  })

  it('keeps every relationship among closure members under connected', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const result = evaluateProjection(
      graph,
      projection({ instances: [INSTANCE], relationships: 'connected' }),
      profileContext,
      patternMemberships,
    )
    const drawn = result.subjects.filter(({ type }) => type === 'relationship')
    // The closure is INITIALLY selected, not expansion-added, so member-to-member
    // edges survive. Under `connected` an expansion-added neighbour's edges to
    // other neighbours are dropped, which is what made a hand-listed instance
    // view lose the edges folding lifts.
    expect(drawn.length).toBeGreaterThan(0)
  })

  it('selects the instance alone when memberships are withheld', () => {
    const { graph, profileContext } = compiled()
    const selected = conceptsOf(
      evaluateProjection(graph, projection({ instances: [INSTANCE] }), profileContext),
    )
    expect(selected).toEqual([INSTANCE])
  })

  it('reports the facet that dropped a subject', () => {
    const { graph, profileContext, patternMemberships } = compiled()
    const dropped = explainProjection(
      graph,
      projection({ instances: [INSTANCE] }),
      profileContext,
      patternMemberships,
    )
    expect(
      dropped.find(({ id }) => id === qualify('lone-component'))?.facet,
    ).toBe('instances')
  })
})

describe('what check refuses', () => {
  const source = { path: 'projections/probe.yaml', source: 'query:\n  instances:\n    - x\n' }
  const instanceIds = new Set([INSTANCE])

  it('refuses an id that names nothing, as YM921', () => {
    const { graph, profileContext } = compiled()
    const codes = projectionReferenceDiagnostics(
      source,
      projection({ instances: ['no-such-thing'] }),
      graph,
      profileContext,
      instanceIds,
    ).map(({ code }) => code)
    expect(codes).toContain('YM921')
    expect(codes).not.toContain('YM922')
  })

  it('refuses a real subject that is not an instance, as YM922', () => {
    const { graph, profileContext } = compiled()
    const diagnostics = projectionReferenceDiagnostics(
      source,
      projection({ instances: [qualify('lone-component')] }),
      graph,
      profileContext,
      instanceIds,
    )
    // The two faults are different mistakes and must not share a message: a
    // typo sends the author to the spelling, a category error to the model.
    expect(diagnostics.map(({ code }) => code)).toEqual(['YM922'])
    expect(diagnostics[0]!.message).toContain('not a pattern instance')
  })

  it('accepts an instance', () => {
    const { graph, profileContext } = compiled()
    expect(
      projectionReferenceDiagnostics(
        source,
        projection({ instances: [INSTANCE] }),
        graph,
        profileContext,
        instanceIds,
      ),
    ).toEqual([])
  })

  it('refuses to answer at all when it was given no instances to check against', () => {
    const { graph, profileContext } = compiled()
    const diagnostics = projectionReferenceDiagnostics(
      source,
      projection({ instances: [INSTANCE] }),
      graph,
      profileContext,
    )
    // Silence here would be #450 again: the facet degrades to the instance
    // alone, which is indistinguishable from a correct small answer.
    expect(diagnostics.map(({ code }) => code)).toEqual(['YM923'])
  })

  it('says nothing about a query that does not use the facet', () => {
    const { graph, profileContext } = compiled()
    expect(
      projectionReferenceDiagnostics(
        source,
        projection({ subjects: [INSTANCE] }),
        graph,
        profileContext,
      ),
    ).toEqual([])
  })
})

describe('the normative schema', () => {
  const load = (query: string) =>
    loadProjection({
      path: 'instances.projection.yaml',
      source: `format: yarramate/projection/v1
id: instances
version: "1.0"
query:
${query}`,
    })

  it('loads a query naming instances', () => {
    expect(load('  instances:\n    - sys-api\n  relationships: between\n').ok).toBe(true)
  })

  it('loads instances beside subjects, because they are one facet', () => {
    expect(load('  instances:\n    - sys-api\n  subjects:\n    - lone-component\n').ok).toBe(true)
  })

  it('refuses an empty list, which asks for nothing', () => {
    expect(load('  instances: []\n').ok).toBe(false)
  })

  it('refuses a repeated id', () => {
    expect(load('  instances:\n    - sys-api\n    - sys-api\n').ok).toBe(false)
  })

  it('refuses a bare string where a list belongs', () => {
    expect(load('  instances: sys-api\n').ok).toBe(false)
  })

  it('canonicalises by sorting, the way subjects does', () => {
    const canonical = canonicalProjection({
      format: 'yarramate/projection/v1',
      id: 'instances',
      version: '1.0',
      query: { instances: ['b-api', 'a-api'] },
    })
    // Two authors who typed the same view in a different order must produce the
    // same bytes, or the digest that pins a projection moves for no reason.
    expect(canonical.query.instances).toEqual(['a-api', 'b-api'])
  })
})
