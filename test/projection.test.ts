import { describe, expect, it } from 'vitest'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  canonicalProjection,
  compileWorkspace,
  compileWorkspaceWithProfileContext,
  evaluateProjection,
  explainProjection,
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
      { id: 'operate', type: 'concept' },
      { id: 'team', type: 'concept' },
      {
        id: 'team-owns-operation',
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
        id: 'first-influences-future',
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
      { id: 'first', type: 'concept' },
      {
        id: 'first-supports-second',
        type: 'relationship',
      },
      { id: 'future', type: 'concept' },
      { id: 'second', type: 'concept' },
      {
        id: 'second-supports-future',
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
      { id: 'first', type: 'concept' },
      { id: 'second', type: 'concept' },
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
      { id: 'first', type: 'concept' },
      {
        id: 'first-influences-future',
        type: 'relationship',
      },
      {
        id: 'first-supports-second',
        type: 'relationship',
      },
      { id: 'future', type: 'concept' },
      { id: 'second', type: 'concept' },
      {
        id: 'second-supports-future',
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
        states: ['target'],
        relationships: 'between',
      },
    })

    expect(result.subjects).toEqual([
      { id: 'modern', type: 'concept' },
      { id: 'modern-uses-shared', type: 'relationship' },
      { id: 'shared', type: 'concept' },
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
        subjects: ['modern'],
        states: ['target'],
        relationships: 'connected',
      },
    })

    expect(result.subjects).toEqual([
      { id: 'modern', type: 'concept' },
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
        states: ['target'],
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
    - target
`,
    })

    expect(loaded).toEqual({
      ok: true,
      projection: {
        format: 'yarramate/projection/v1',
        id: 'target',
        version: '1.0',
        query: {
          states: ['target'],
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
          'first',
          'second',
        ],
        relationships: 'between',
      },
    } as ProjectionDefinition)

    expect(result.subjects).toEqual([
      { id: 'first', type: 'concept' },
      { id: 'first-supports-second', type: 'relationship' },
      { id: 'second', type: 'concept' },
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
          owners: ['platform-team'],
          relationships: 'none',
        },
      } as ProjectionDefinition,
    )

    expect(result.subjects).toEqual([
      { id: 'first', type: 'concept' },
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
          constraints: ['australia-only'],
          relationships: 'none',
        },
      } as ProjectionDefinition,
    )

    expect(result.subjects).toEqual([
      { id: 'second', type: 'concept' },
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
        owners: ['payments-team'],
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
        '  showLifecycle: true\n' +
        '  showEvidence: false\n' +
        '  showOwnership: true\n',
    })
    const second = loadProjection({
      path: 'second.projection.yaml',
      source:
        'presentation:\n' +
        '  showOwnership: true\n' +
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

  it('round-trips notation through a saved projection document', () => {
    const withArchimate = loadProjection({
      path: 'archimate.projection.yaml',
      source: `format: yarramate/projection/v1
id: notation-test
version: "1.0"
query: {}
presentation:
  notation: archimate
`,
    })
    expect(withArchimate.ok).toBe(true)
    if (!withArchimate.ok) return
    expect(withArchimate.projection.presentation?.notation).toBe('archimate')
    expect(canonicalProjection(withArchimate.projection).presentation?.notation).toBe('archimate')
  })

  // `native` was a renderer, and it is gone. The field stays so a second
  // notation has somewhere to land, which is only worth anything if naming a
  // notation that does not exist is refused rather than quietly drawn as
  // ArchiMate.
  it('refuses a projection that asks for a notation nothing renders', () => {
    const withNative = loadProjection({
      path: 'native.projection.yaml',
      source: `format: yarramate/projection/v1
id: notation-test
version: "1.0"
query: {}
presentation:
  notation: native
`,
    })
    expect(withNative.ok).toBe(false)
    if (withNative.ok) return
    expect(withNative.diagnostics[0]?.pointer).toBe('/presentation/notation')
  })

  it('rejects unknown notation values in schema validation', () => {
    const invalid = loadProjection({
      path: 'invalid.projection.yaml',
      source: `format: yarramate/projection/v1
id: bad-notation
version: "1.0"
query: {}
presentation:
  notation: invalid-notation
`,
    })
    expect(invalid.ok).toBe(false)
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
        layout: 'layered',
        direction: 'top-down',
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
        { id: 'first', type: 'concept' },
        {
          id: 'first-supports-second',
          type: 'relationship',
        },
        { id: 'second', type: 'concept' },
      ],
    })
    expect(
      result.claims.some(
        ({ id }) => id === 'second-supports-future',
      ),
    ).toBe(false)
    expect(renderProjectionMarkdown(result)).toBe(
      '# Current capabilities\n' +
        '\n' +
        '## Concepts\n' +
        '\n' +
        '- First (`first`) — `yarramate/core@0.1#capability` — current\n' +
        '- Second (`second`) — `yarramate/core@0.1#capability` — current\n' +
        '\n' +
        '## Relationships\n' +
        '\n' +
        '- `first` — `yarramate/core@0.1#association` → `second` (`first-supports-second`)\n',
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

  it('produces the same subjects from a synthetic ad-hoc projection as from the equivalent on-disk file', () => {
    const compilation = compileWorkspace([
      { path: 'projection-model.yaml', source },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    const loaded = loadProjection({
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
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    // Mirrors the synthetic `ProjectionDefinition` session-server.ts builds
    // for `filter.query`: an ad-hoc id/version wrapping the browser's query,
    // with no presentation. It must select the same subjects as loading the
    // equivalent on-disk projection file for the same query.
    const synthetic: ProjectionDefinition = {
      format: 'yarramate/projection/v1',
      id: 'ad-hoc',
      version: '0',
      query: loaded.projection.query,
    }

    const fromFile = evaluateProjection(compilation.graph, loaded.projection)
    const fromSynthetic = evaluateProjection(compilation.graph, synthetic)
    expect(fromSynthetic.subjects).toEqual(fromFile.subjects)
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
      'actor',
      'live-service',
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
        subjects: ['live-service'],
        excludeStatuses: ['retired'],
        relationships: 'connected',
      },
    })
    // The retired neighbour is not pulled in, and the edge to it is
    // dropped rather than left dangling.
    expect(result.subjects.map(({ id }) => id)).toEqual([
      'live-service',
    ])
  })
})

/**
 * The editor has to tell a reviewer WHY a subject is not on the canvas (#248).
 * A query that selects nothing, or that quietly drops the one subject they
 * were looking for, is otherwise indistinguishable from a model that does not
 * hold it.
 */
describe('explainProjection', () => {
  const compiled = compileWorkspace([{ path: 'model.yaml', source }])
  if (!compiled.ok) throw new Error('fixture must compile')
  const graph = compiled.graph

  const explain = (query: ProjectionDefinition['query']) =>
    explainProjection(graph, {
      format: 'yarramate/projection/v1',
      id: 'explaining',
      version: '1.0',
      query,
    })

  it('names nothing when a query keeps everything', () => {
    expect(explain({})).toEqual([])
  })

  it('names the facet that dropped each subject', () => {
    const excluded = explain({ kinds: ['yarramate/core@0.1#capability'] })

    expect(excluded).toEqual(
      expect.arrayContaining([
        { id: 'platform-team', facet: 'kinds' },
        { id: 'australia-only', facet: 'kinds' },
        { id: 'future', facet: 'kinds' },
      ]),
    )
    expect(excluded.map(({ id }) => id)).not.toContain('first')
    expect(excluded.map(({ id }) => id)).not.toContain('second')
  })

  it('reports the first facet a query declares, not every one that would drop it', () => {
    // `subjects` is declared before `statuses`, and `future` fails both. A
    // reader scanning the query reaches `subjects` first, so that is the
    // answer - a list of every reason is a list nobody reads.
    expect(
      explain({ subjects: ['first'], statuses: ['current'] }).find(
        ({ id }) => id === 'future',
      ),
    ).toEqual({ id: 'future', facet: 'subjects' })
  })

  it('agrees with what the projection actually selected', () => {
    // The property that matters: one definition decides both, so the reason
    // shown and the set drawn can never come from two readings of a query.
    const kept = new Set(
      evaluateProjection(graph, {
        format: 'yarramate/projection/v1',
        id: 'agreeing',
        version: '1.0',
        query: { statuses: ['current'], relationships: 'none' },
      }).subjects.map(({ id }) => id),
    )
    const dropped = new Set(
      explain({ statuses: ['current'] }).map(({ id }) => id),
    )

    for (const subject of graph.subjects) {
      if (subject.type !== 'concept') continue
      expect(kept.has(subject.id)).toBe(!dropped.has(subject.id))
    }
  })

  it('says nothing about relationships, which enter through their endpoints', () => {
    expect(
      explain({ kinds: ['yarramate/core@0.1#capability'] }).map(({ id }) => id),
    ).not.toContain('first-supports-second')
  })
})
