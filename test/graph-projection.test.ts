import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'

const compile = (source: string) =>
  compileWorkspaceWithProfileContext([{ path: 'main.yaml', source }])

describe('projectGraphForCanvas', () => {
  it('projects a concept with every optional field populated, round-tripping every value and sorting every array field', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: team
    kind: businessActor
    name: Platform team
  - id: similar-zeta
    kind: applicationComponent
    name: Similar zeta
  - id: similar-alpha
    kind: applicationComponent
    name: Similar alpha
  - id: legacy-zeta
    kind: applicationComponent
    name: Legacy zeta
    status: retired
  - id: legacy-alpha
    kind: applicationComponent
    name: Legacy alpha
    status: retired
  - id: data-residency-rule
    kind: constraint
    name: Data stays in region
  - id: naming-convention-rule
    kind: constraint
    name: Follows naming convention
  - id: policy-zeta
    kind: dataObject
    name: Policy zeta
  - id: policy-alpha
    kind: dataObject
    name: Policy alpha
  - id: review-board
    kind: businessActor
    name: Review board
  - id: service
    kind: applicationComponent
    name: Payments service
    description: Handles payment processing
    aka:
      - Zulu Service
      - Alpha Service
    status: current
    owner: team
    distinctFrom:
      - similar-zeta
      - similar-alpha
    supersedes:
      - legacy-zeta
      - legacy-alpha
    constraints:
      - id: residency
        ref: data-residency-rule
        expects:
          provider: terraform-scan
          key: region
          value: ap-southeast-2
      - id: naming
        ref: naming-convention-rule
    references:
      - id: policy-source-zeta
        ref: policy-zeta
      - id: policy-source-alpha
        ref: policy-alpha
    presentIn:
      - state-zeta
      - state-alpha
    attestations:
      - topic: adequacy
        by: review-board
        recordedBy: claude-fable-5
        on: "2026-08-01"
states:
  - id: state-alpha
    kind: baseline
    name: Alpha state
  - id: state-zeta
    kind: target
    name: Zeta state
relationships: []
`)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    const node = projected.nodes.find((candidate) => candidate.id === 'service')
    expect(node).toBeDefined()
    if (node === undefined) return
    expect(node.kind).toBe('yarramate/core@0.1#applicationComponent')
    expect(node.kindLabel).toBe('applicationComponent')
    expect(node.document).toBe('main.yaml')
    expect(node.layer).toBe('application')
    expect(node.name).toBe('Payments service')
    expect(node.description).toBe('Handles payment processing')
    // Declared in reverse alphabetical order (Zulu, Alpha) to prove the
    // projection sorts rather than preserving authored order.
    expect(node.aka).toEqual(['Alpha Service', 'Zulu Service'])
    expect(node.status).toBe('current')
    expect(node.owner).toBe('team')
    expect(node.distinctFrom).toEqual(['similar-alpha', 'similar-zeta'])
    expect(node.supersedes).toEqual(['legacy-alpha', 'legacy-zeta'])
    expect(node.constraints).toHaveLength(2)
    expect(node.constraints).toEqual(
      expect.arrayContaining([
        {
          id: 'residency',
          ref: 'data-residency-rule',
          expects: {
            provider: 'terraform-scan',
            key: 'region',
            value: 'ap-southeast-2',
          },
        },
        {
          id: 'naming',
          ref: 'naming-convention-rule',
          expects: null,
        },
      ]),
    )
    // References are sorted by ref value, not id
    expect(node.references).toEqual([
      { id: 'policy-source-alpha', ref: 'policy-alpha' },
      { id: 'policy-source-zeta', ref: 'policy-zeta' },
    ])
    expect(node.presentIn).toEqual(['state-alpha', 'state-zeta'])
    // Attestations are unsorted, preserving authored order
    expect(node.attestations).toEqual([
      {
        topic: 'adequacy',
        by: 'review-board',
        on: '2026-08-01',
        recordedBy: 'claude-fable-5',
      },
    ])
  })

  it('projects a concept with only required fields, leaving every optional as null/empty', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: bare
    kind: applicationComponent
    name: Bare component
relationships: []
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    expect(projected.nodes).toEqual([
      {
        id: 'bare',
        localId: 'bare',
        document: 'main.yaml',
        kind: 'yarramate/core@0.1#applicationComponent',
        kindLabel: 'applicationComponent',
        layer: 'application',
        aspect: 'active-structure',
        name: 'Bare component',
        description: null,
        aka: [],
        status: null,
        owner: null,
        distinctFrom: [],
        supersedes: [],
        constraints: [],
        references: [],
        presentIn: [],
        attestations: [],
      },
    ])
  })

  it('projects a relationship, resolving from/to correctly and stripping the profile prefix from kindLabel', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: consumer
    kind: applicationComponent
    name: Consumer
  - id: store
    kind: dataObject
    name: Store
relationships:
  - id: consumer-accesses-store
    kind: access
    from: consumer
    to: store
    name: Reads store
    description: Consumer reads the store without writing to it
    mode: read
    status: current
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    // `from`/`to` are deliberately different concept types (an
    // applicationComponent and a dataObject), so a swap would be visible
    // even without comparing raw ids.
    expect(projected.edges).toEqual([
      {
        id: 'consumer-accesses-store',
        localId: 'consumer-accesses-store',
        document: 'main.yaml',
        kind: 'yarramate/core@0.1#access',
        kindLabel: 'access',
        coreKindLabel: 'access',
        from: 'consumer',
        to: 'store',
        name: 'Reads store',
        description: 'Consumer reads the store without writing to it',
        mode: 'read',
        content: null,
        status: 'current',
        references: [],
        presentIn: [],
      },
    ])
  })

  it('resolves layer to a real value for a kind with known ArchiMate lineage', () => {
    // Every concept kind the profile can resolve declares a required
    // `layer` (src/profile.ts's `kind()` helper takes layer as a mandatory
    // parameter, not an optional one), and a concept can only compile at
    // all if its kind resolves against the profile. So a successfully
    // compiled concept's kind is always present in
    // `profileContext.conceptKindLayers`, and the `null` fallback in
    // `projectConcept` cannot be reached through the public
    // compile-then-project path this suite exercises — it only guards a
    // projection-layer caller that hands in a profile context mismatched
    // from the graph it is projecting. That case is not separately tested
    // here for lack of a reachable, compiling fixture that would trigger it.
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: team
    kind: businessActor
    name: Platform team
relationships: []
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    expect(projected.nodes[0]?.layer).toBe('business')
  })

  it('resolves aspect through kind inheritance, not just direct declaration', () => {
    // `repository-file` declares no aspect of its own; it inherits
    // `passive-structure` from `yarramate/core@0.1#artifact` the same way it
    // inherits the `technology` layer. This mirrors the repo's real
    // development profile (`.yarramate/profiles/yarramate-development.yaml`),
    // inlined here so the suite stays hermetic. Task 11 shapes nodes by
    // aspect, so an inherited kind arriving as `null` would silently draw the
    // wrong shape rather than fail loudly.
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'inheriting-profile.yaml',
        source: `format: yarramate/profile/v1
id: example/development
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: repository-file
    name: Repository file
    parent: yarramate/core@0.1#artifact
relationshipKinds: []
`,
      },
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: example/development@1.0
concepts:
  - id: compiler
    kind: repository-file
    name: Compiler source
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    expect(projected.nodes[0]?.aspect).toBe('passive-structure')
    expect(projected.nodes[0]?.layer).toBe('technology')
  })

  it('sorts nodes and edges by id regardless of declaration order', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: zulu-concept
    kind: applicationComponent
    name: Zulu concept
  - id: alpha-concept
    kind: applicationComponent
    name: Alpha concept
relationships:
  - id: zulu-relationship
    kind: serving
    from: zulu-concept
    to: alpha-concept
  - id: alpha-relationship
    kind: serving
    from: alpha-concept
    to: zulu-concept
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    expect(projected.nodes.map((node) => node.id)).toEqual([
      'alpha-concept',
      'zulu-concept',
    ])
    expect(projected.edges.map((edge) => edge.id)).toEqual([
      'alpha-relationship',
      'zulu-relationship',
    ])
  })

  it('projects coreKindLabel: equal to kindLabel for a core kind, collapsed onto the core ancestor for a derived kind', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'development-profile.yaml',
        source: `format: yarramate/profile/v1
id: yarramate/development
version: "1.0"
extends: yarramate/core@0.1
conceptKinds: []
relationshipKinds:
  - id: implements
    name: Implements
    parent: yarramate/core@0.1#realization
`,
      },
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/development@1.0
concepts:
  - id: consumer
    kind: applicationComponent
    name: Consumer
  - id: store
    kind: applicationService
    name: Store
relationships:
  - id: consumer-implements-store
    kind: implements
    from: consumer
    to: store
  - id: consumer-realizes-store
    kind: realization
    from: consumer
    to: store
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)
    const derived = projected.edges.find((edge) => edge.localId === 'consumer-implements-store')
    const core = projected.edges.find((edge) => edge.localId === 'consumer-realizes-store')
    expect(derived?.kindLabel).toBe('implements')
    expect(derived?.coreKindLabel).toBe('realization')
    expect(core?.kindLabel).toBe('realization')
    expect(core?.coreKindLabel).toBe('realization')
  })
})
