import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import visualGraphSchema from '../schema/yarramate-visual-graph.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateVisualGraph = new Ajv2020({ allErrors: true }).compile(visualGraphSchema)

const compile = (source: string) =>
  compileWorkspaceWithProfileContext([{ path: 'main.yaml', source }])

describe('visual graph schema', () => {
  it('accepts a canvas graph projected from a compiled workspace', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: team
    kind: businessActor
    name: Payments team
  - id: policy
    kind: dataObject
    name: Payments policy
  - id: legacy
    kind: applicationComponent
    name: Legacy service
  - id: similar
    kind: applicationComponent
    name: Similar service
  - id: residency-rule
    kind: constraint
    name: Data stays in region
  - id: consumer
    kind: applicationComponent
    name: Consumer service
  - id: service
    kind: applicationComponent
    name: Payments service
    description: Handles payment processing
    aka:
      - Alpha Service
    status: current
    owner: team
    distinctFrom:
      - similar
    supersedes:
      - legacy
    constraints:
      - id: residency
        ref: residency-rule
        expects:
          provider: terraform-scan
          key: region
          value: ap-southeast-2
    references:
      - id: policy-source
        ref: policy
    presentIn:
      - state
    attestations:
      - topic: adequacy
        by: team
        recordedBy: claude-fable-5
        on: "2026-08-01"
states:
  - id: state
    kind: baseline
    name: Current state
relationships:
  - id: calls
    kind: flow
    from: service
    to: consumer
    name: Calls
    description: Service calls consumer
    content: payment event
`)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const projected = projectGraphForCanvas(result.graph, result.profileContext)

    expect(validateVisualGraph(projected)).toBe(true)
    expect(validateVisualGraph.errors).toBeNull()
  })

  it('rejects a canvas graph with an unknown top-level property', () => {
    expect(
      validateVisualGraph({
        nodes: [],
        edges: [],
        extra: 'not allowed',
      }),
    ).toBe(false)
  })

  it('rejects a canvas node with a wrong-typed field', () => {
    expect(
      validateVisualGraph({
        nodes: [
          {
            id: 'service',
            kind: 'yarramate/core@0.1#applicationComponent',
            kindLabel: 'applicationComponent',
            layer: null,
            name: 42,
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
        ],
        edges: [],
      }),
    ).toBe(false)
  })

  it('rejects a canvas edge missing coreKindLabel', () => {
    expect(
      validateVisualGraph({
        nodes: [],
        edges: [
          {
            id: 'calls',
            localId: 'calls',
            document: 'main.yaml',
            kind: 'yarramate/core@0.1#flow',
            kindLabel: 'flow',
            // coreKindLabel intentionally omitted
            from: 'service',
            to: 'consumer',
            name: null,
            description: null,
            mode: null,
            content: null,
            status: null,
            references: [],
            presentIn: [],
          },
        ],
      }),
    ).toBe(false)
  })

  it('accepts every profile layer and aspect enum value and null', () => {
    const baseNode = {
      id: 'service',
      localId: 'service',
      document: 'main.yaml',
      kind: 'yarramate/core@0.1#applicationComponent',
      kindLabel: 'applicationComponent',
      layer: 'application',
      aspect: 'active-structure',
      name: 'Service',
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
    }
    const layers = [
      'motivation', 'strategy', 'business', 'application',
      'technology', 'physical', 'implementation', 'composite', null,
    ]
    const aspects = [
      'motivation', 'active-structure', 'behavior',
      'passive-structure', 'composite', null,
    ]
    for (const layer of layers) {
      expect(validateVisualGraph({ nodes: [{ ...baseNode, layer }], edges: [] })).toBe(true)
    }
    for (const aspect of aspects) {
      expect(validateVisualGraph({ nodes: [{ ...baseNode, aspect }], edges: [] })).toBe(true)
    }
  })

  it('rejects free-string layer and aspect values', () => {
    const baseNode = {
      id: 'service',
      localId: 'service',
      document: 'main.yaml',
      kind: 'yarramate/core@0.1#applicationComponent',
      kindLabel: 'applicationComponent',
      layer: 'application',
      aspect: 'active-structure',
      name: 'Service',
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
    }
    expect(
      validateVisualGraph({ nodes: [{ ...baseNode, layer: 'not-a-layer' }], edges: [] }),
    ).toBe(false)
    expect(
      validateVisualGraph({ nodes: [{ ...baseNode, aspect: 'not-an-aspect' }], edges: [] }),
    ).toBe(false)
  })
})
