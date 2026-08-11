import { describe, expect, it } from 'vitest'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  canonicalProjection,
  compileWorkspace,
  compileWorkspaceWithProfileContext,
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
  type ProjectionDefinition,
} from '../src/index.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const Ajv2020 = Ajv2020Module.default

const source = `format: yarramate/v1
id: projection-model
profile: yarramate/core@0.1
concepts:
  - id: platform-team
    kind: businessActor
    name: Platform team
  - id: australia-only
    kind: constraint
    name: Australia only
  - id: first
    kind: capability
    name: First
    status: current
    owner: platform-team
  - id: second
    kind: capability
    name: Second
    status: current
    constraints:
      - id: residency
        ref: australia-only
  - id: future
    kind: goal
    name: Future
    status: planned
relationships:
  - id: first-supports-second
    kind: association
    from: first
    to: second
    status: current
  - id: second-supports-future
    kind: association
    from: second
    to: future
    status: planned
  - id: first-influences-future
    kind: influence
    from: first
    to: future
`

describe('evaluateProjection', () => {
  it('matches extension kinds through resolved semantic parent lineages', () => {
    const compilation = compileWorkspaceWithProfileContext([
      {
        path: 'platform-profile.yaml',
        source: `format: yarramate/profile/v1
id: example/platform
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: platform-team
    name: Platform team
    parent: yarramate/core@0.1#businessActor
relationshipKinds:
  - id: owns
    name: Owns
    parent: yarramate/core@0.1#assignment
    targetAspects: [behavior]
`,
      },
      {
        path: 'platform.yaml',
        source: `format: yarramate/v1
id: platform
profile: example/platform@1.0
concepts:
  - id: team
    kind: platform-team
    name: Platform team
  - id: operate
    kind: businessFunction
    name: Operate platform
relationships:
  - id: team-owns-operation
    kind: owns
    from: team
    to: operate
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const exactResult = evaluateProjection(
      compilation.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'exact-business-ownership',
        version: '1.0',
        query: {
          kinds: ['yarramate/core@0.1#businessActor'],
          relationshipKinds: ['yarramate/core@0.1#assignment'],
          relationships: 'connected',
        },
      },
      compilation.profileContext,
    )
    expect(exactResult.subjects).toEqual([])

    const result = evaluateProjection(
      compilation.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'business-ownership',
        version: '1.0',
        query: {
          kinds: ['yarramate/core@0.1#businessActor'],
          relationshipKinds: ['yarramate/core@0.1#assignment'],
          kindMatching: 'descendants',
          relationships: 'connected',
        },
      },
      compilation.profileContext,
    )

    expect(result.subjects).toEqual([
      { id: 'platform#operate', type: 'concept' },
      { id: 'platform#team', type: 'concept' },
      {
        id: 'platform#team-owns-operation',
        type: 'relationship',
      },
    ])
  })

  it('selects only relationships matching portable qualified kind selectors', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'influences',
      version: '1.0',
      query: {
        relationshipKinds: ['yarramate/core@0.1#influence'],
        relationships: 'between',
      },
    } as ProjectionDefinition)

    expect(
      result.subjects.filter(({ type }) => type === 'relationship'),
    ).toEqual([
      {
        id: 'projection-model#first-influences-future',
        type: 'relationship',
      },
    ])
  })

  it('includes the other endpoint of matching one-hop relationships', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'capability-neighbours',
      version: '1.0',
      query: {
        kinds: ['yarramate/core@0.1#capability'],
        relationshipKinds: ['yarramate/core@0.1#association'],
        relationships: 'connected',
      },
    } as ProjectionDefinition)

    expect(result.subjects).toEqual([
      { id: 'projection-model#first', type: 'concept' },
      {
        id: 'projection-model#first-supports-second',
        type: 'relationship',
      },
      { id: 'projection-model#future', type: 'concept' },
      { id: 'projection-model#second', type: 'concept' },
      {
        id: 'projection-model#second-supports-future',
        type: 'relationship',
      },
    ])
  })

  it('keeps concepts while an unmatched relationship-kind selector selects no relationships', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'portable-relationship-kind',
      version: '1.0',
      query: {
        kinds: ['yarramate/core@0.1#capability'],
        relationshipKinds: ['other/profile@1.0#dependency'],
        relationships: 'connected',
      },
    })

    expect(result.subjects).toEqual([
      { id: 'projection-model#first', type: 'concept' },
      { id: 'projection-model#second', type: 'concept' },
    ])
  })

  it('can exclude concepts isolated from the selected relationships', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'connected-subgraph',
      version: '1.0',
      query: {
        isolatedConcepts: 'exclude',
      },
    } as ProjectionDefinition)

    expect(result.subjects).toEqual([
      { id: 'projection-model#first', type: 'concept' },
      {
        id: 'projection-model#first-influences-future',
        type: 'relationship',
      },
      {
        id: 'projection-model#first-supports-second',
        type: 'relationship',
      },
      { id: 'projection-model#future', type: 'concept' },
      { id: 'projection-model#second', type: 'concept' },
      {
        id: 'projection-model#second-supports-future',
        type: 'relationship',
      },
    ])
  })

  it('loads relationship-kind and connected-endpoint selectors through the normative schema', () => {
    const loaded = loadProjection({
      path: 'connected.projection.yaml',
      source: `format: yarramate/projection/v1
id: connected
version: "1.0"
query:
  relationshipKinds:
    - yarramate/core@0.1#serving
  relationships: connected
  isolatedConcepts: exclude
`,
    })

    expect(loaded).toEqual({
      ok: true,
      projection: {
        format: 'yarramate/projection/v1',
        id: 'connected',
        version: '1.0',
        query: {
          relationshipKinds: ['yarramate/core@0.1#serving'],
          relationships: 'connected',
          isolatedConcepts: 'exclude',
        },
      },
    })
  })

  it('round-trips layer and portable presentation selectors canonically', () => {
    const source = `format: yarramate/projection/v1
id: layered-connected
version: "1.0"
query:
  layers: [application, business]
  relationships: connected
presentation:
  title: Layered context
  description: Application and business concepts
`
    const loaded = loadProjection({
      path: 'layered-connected.projection.yaml',
      source,
    })

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(canonicalProjection(loaded.projection)).toEqual({
      format: 'yarramate/projection/v1',
      id: 'layered-connected',
      version: '1.0',
      query: {
        layers: ['application', 'business'],
        relationships: 'connected',
      },
      presentation: {
        title: 'Layered context',
        description: 'Application and business concepts',
      },
    })
    const reloaded = loadProjection({
      path: 'reloaded.projection.yaml',
      source,
    })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(canonicalProjection(loaded.projection)).toEqual(
      canonicalProjection(reloaded.projection),
    )
  })

  it('rejects unsupported fields', () => {
    for (const source of [
      `format: yarramate/projection/v1
id: invalid-connected
version: "1.0"
query:
  connected: { depth: 1, direction: both }
`,
      `format: yarramate/projection/v1
id: invalid-layout
version: "1.0"
query: {}
presentation:
  layout: force
`,
      `format: yarramate/projection/v1
id: invalid-unknown
version: "1.0"
query:
  layers: [application]
  unexpected: true
`,
    ]) {
      expect(loadProjection({ path: 'invalid.projection.yaml', source }).ok).toBe(
        false,
      )
    }
  })

  it('preserves legacy projection omission semantics through canonical serialization', () => {
    const loaded = loadProjection({
      path: 'legacy.projection.yaml',
      source: `format: yarramate/projection/v1
id: legacy
version: "1.0"
query:
  kinds: [yarramate/core@0.1#capability]
`,
    })

    expect(loaded).toEqual({
      ok: true,
      projection: {
        format: 'yarramate/projection/v1',
        id: 'legacy',
        version: '1.0',
        query: { kinds: ['yarramate/core@0.1#capability'] },
      },
    })
    if (!loaded.ok) return
    expect(canonicalProjection(loaded.projection)).toEqual(loaded.projection)
  })

  it('selects scoped and unscoped subjects in an architecture state', () => {
    const compilation = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
  - id: target
    kind: target
    name: Target
    after: baseline
concepts:
  - id: shared
    kind: applicationComponent
    name: Shared service
  - id: legacy
    kind: applicationComponent
    name: Legacy service
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern service
    presentIn: [target]
relationships:
  - id: modern-uses-shared
    kind: serving
    from: shared
    to: modern
    presentIn: [target]
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'target',
      version: '1.0',
      query: {
        states: ['roadmap#target'],
        relationships: 'between',
      },
    })

    expect(result.subjects).toEqual([
      { id: 'roadmap#modern', type: 'concept' },
      { id: 'roadmap#modern-uses-shared', type: 'relationship' },
      { id: 'roadmap#shared', type: 'concept' },
    ])
  })

  it('does not expand through concepts outside the selected state', () => {
    const compilation = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
  - id: target
    kind: target
    name: Target
    after: baseline
concepts:
  - id: legacy
    kind: applicationComponent
    name: Legacy service
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern service
    presentIn: [target]
relationships:
  - id: modern-replaces-legacy
    kind: serving
    from: modern
    to: legacy
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'target-connected',
      version: '1.0',
      query: {
        subjects: ['roadmap#modern'],
        states: ['roadmap#target'],
        relationships: 'connected',
      },
    })

    expect(result.subjects).toEqual([
      { id: 'roadmap#modern', type: 'concept' },
    ])
  })

  it('treats an unavailable architecture-state selector as portable', () => {
    const compilation = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
concepts:
  - id: shared
    kind: applicationComponent
    name: Shared service
relationships: []
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'future-state',
      version: '1.0',
      query: {
        states: ['other-roadmap#target'],
      },
    })

    expect(result).toMatchObject({
      documents: [],
      subjects: [],
      claims: [],
    })
  })

  it('loads architecture-state selectors through the normative schema', () => {
    const loaded = loadProjection({
      path: 'target.projection.yaml',
      source: `format: yarramate/projection/v1
id: target
version: "1.0"
query:
  states:
    - roadmap#target
`,
    })

    expect(loaded).toEqual({
      ok: true,
      projection: {
        format: 'yarramate/projection/v1',
        id: 'target',
        version: '1.0',
        query: {
          states: ['roadmap#target'],
        },
      },
    })
  })

  it('selects an explicit portable set of globally qualified subjects', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'explicit-context',
      version: '1.0',
      query: {
        subjects: [
          'projection-model#first',
          'projection-model#second',
        ],
        relationships: 'between',
      },
    } as ProjectionDefinition)

    expect(result.subjects).toEqual([
      { id: 'projection-model#first', type: 'concept' },
      { id: 'projection-model#first-supports-second', type: 'relationship' },
      { id: 'projection-model#second', type: 'concept' },
    ])
  })

  it('selects concepts by globally qualified owner', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(
      compilation.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'platform-owned',
        version: '1.0',
        query: {
          owners: ['projection-model#platform-team'],
          relationships: 'none',
        },
      } as ProjectionDefinition,
    )

    expect(result.subjects).toEqual([
      { id: 'projection-model#first', type: 'concept' },
    ])
  })

  it('selects concepts requiring a globally qualified constraint', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(
      compilation.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'residency-constrained',
        version: '1.0',
        query: {
          constraints: ['projection-model#australia-only'],
          relationships: 'none',
        },
      } as ProjectionDefinition,
    )

    expect(result.subjects).toEqual([
      { id: 'projection-model#second', type: 'concept' },
    ])
  })

  it('allows portable selectors with no workspace match', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'other-workspace-team',
      version: '1.0',
      query: {
        owners: ['other-workspace#payments-team'],
      },
    })

    expect(result).toMatchObject({
      documents: [],
      subjects: [],
      claims: [],
    })
  })

  it('serializes identically after presentation key reordering', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const first = loadProjection({
      path: 'first.projection.yaml',
      source:
        'format: yarramate/projection/v1\n' +
        'id: reordered\n' +
        'version: "1.0"\n' +
        'query: {}\n' +
        'presentation:\n' +
        '  title: Reordered\n' +
        '  description: Stable output\n' +
        '  layout: layered\n' +
        '  direction: top-down\n' +
        '  seed: stable-layout\n' +
        '  showLifecycle: true\n' +
        '  showEvidence: false\n' +
        '  showOwnership: true\n',
    })
    const second = loadProjection({
      path: 'second.projection.yaml',
      source:
        'presentation:\n' +
        '  showOwnership: true\n' +
        '  seed: stable-layout\n' +
        '  description: Stable output\n' +
        '  showEvidence: false\n' +
        '  direction: top-down\n' +
        '  title: Reordered\n' +
        '  showLifecycle: true\n' +
        '  layout: layered\n' +
        'query: {}\n' +
        'version: "1.0"\n' +
        'id: reordered\n' +
        'format: yarramate/projection/v1\n',
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(
      JSON.stringify(
        evaluateProjection(compilation.graph, first.projection),
      ),
    ).toBe(
      JSON.stringify(
        evaluateProjection(compilation.graph, second.projection),
      ),
    )
  })

  it('keeps portable presentation metadata out of projection membership', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const definition: ProjectionDefinition = {
      format: 'yarramate/projection/v1',
      id: 'presentation-isolation',
      version: '1.0',
      query: {
        kinds: ['yarramate/core@0.1#capability'],
        relationships: 'connected',
      },
    }

    const plain = evaluateProjection(compilation.graph, definition)
    const presented = evaluateProjection(compilation.graph, {
      ...definition,
      presentation: {
        title: 'Capabilities',
        description: 'Current capability context',
        layout: 'radial',
        direction: 'top-down',
        seed: 'capabilities',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: true,
      },
    })

    expect(presented.documents).toEqual(plain.documents)
    expect(presented.subjects).toEqual(plain.subjects)
    expect(presented.claims).toEqual(plain.claims)
  })

  it('emits results conforming to the normative result schema', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../schema/yarramate-projection-result.schema.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const result = evaluateProjection(compilation.graph, {
      format: 'yarramate/projection/v1',
      id: 'all-concepts',
      version: '1.0',
      query: {},
    })

    expect(validate(result), JSON.stringify(validate.errors ?? [])).toBe(
      true,
    )
  })

  it('selects concepts semantically and includes relationships between them', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const projection: ProjectionDefinition = {
      format: 'yarramate/projection/v1',
      id: 'current-capabilities',
      version: '1.0',
      query: {
        kinds: ['yarramate/core@0.1#capability'],
        statuses: ['current'],
        relationships: 'between',
      },
      presentation: {
        title: 'Current capabilities',
      },
    }

    const result = evaluateProjection(compilation.graph, projection)
    expect(result).toMatchObject({
      format: 'yarramate/projection-result/v1',
      projection: 'current-capabilities@1.0',
      presentation: {
        title: 'Current capabilities',
      },
      subjects: [
        { id: 'projection-model#first', type: 'concept' },
        {
          id: 'projection-model#first-supports-second',
          type: 'relationship',
        },
        { id: 'projection-model#second', type: 'concept' },
      ],
    })
    expect(
      result.claims.some(
        ({ id }) => id === 'projection-model#second-supports-future',
      ),
    ).toBe(false)
    expect(renderProjectionMarkdown(result)).toBe(
      '# Current capabilities\n' +
        '\n' +
        '## Concepts\n' +
        '\n' +
        '- First (`projection-model#first`) — `yarramate/core@0.1#capability` — current\n' +
        '- Second (`projection-model#second`) — `yarramate/core@0.1#capability` — current\n' +
        '\n' +
        '## Relationships\n' +
        '\n' +
        '- `projection-model#first` — `yarramate/core@0.1#association` → `projection-model#second` (`projection-model#first-supports-second`)\n',
    )
  })

  it('loads a normative projection YAML document', () => {
    const result = loadProjection({
      path: 'current-capabilities.projection.yaml',
      source: readFileSync(
        fileURLToPath(
          new URL(
            './fixtures/valid/current-capabilities.projection.yaml',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    })

    expect(result).toEqual({
      ok: true,
      projection: {
        format: 'yarramate/projection/v1',
        id: 'current-capabilities',
        version: '1.0',
        query: {
          kinds: ['yarramate/core@0.1#capability'],
          statuses: ['current'],
          relationships: 'between',
        },
        presentation: {
          title: 'Current capabilities',
        },
      },
    })
  })
})

describe('excludeStatuses', () => {
  const graphOf = (source: string) => {
    const result = compileWorkspace([{ path: 'doc.yaml', source }])
    if (!result.ok) throw new Error('fixture must compile')
    return result.graph
  }

  it('drops excluded statuses while keeping unstatused concepts', () => {
    const graph = graphOf(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: actor
    kind: businessActor
    name: Actor
  - id: live-service
    kind: applicationService
    name: Live service
    status: current
  - id: dead-service
    kind: applicationService
    name: Dead service
    status: retired
relationships:
  - id: dead-serves-actor
    kind: serving
    from: dead-service
    to: actor
`)
    const result = evaluateProjection(graph, {
      format: 'yarramate/projection/v1',
      id: 'living',
      version: '1.0',
      query: { excludeStatuses: ['retired'], relationships: 'between' },
    })
    expect(result.subjects.map(({ id }) => id)).toEqual([
      'main#actor',
      'main#live-service',
    ])
  })

  it('vetoes connected expansion into excluded concepts', () => {
    const graph = graphOf(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: live-service
    kind: applicationService
    name: Live service
    status: current
  - id: dead-service
    kind: applicationService
    name: Dead service
    status: retired
relationships:
  - id: live-serves-dead
    kind: serving
    from: live-service
    to: dead-service
`)
    const result = evaluateProjection(graph, {
      format: 'yarramate/projection/v1',
      id: 'living',
      version: '1.0',
      query: {
        subjects: ['main#live-service'],
        excludeStatuses: ['retired'],
        relationships: 'connected',
      },
    })
    // The retired neighbour is not pulled in, and the edge to it is
    // dropped rather than left dangling.
    expect(result.subjects.map(({ id }) => id)).toEqual([
      'main#live-service',
    ])
  })
})
