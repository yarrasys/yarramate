import Ajv2020Module from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/index.js'
import graphSchema from '../schema/yarramate-graph-v2.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateGraph = new Ajv2020({ allErrors: true }).compile(graphSchema)

describe('normative semantic graph v2 schema', () => {
  it('accepts the graph emitted by the public compiler', () => {
    const result = compileWorkspace([
      {
        path: 'schema.yaml',
        source: `format: yarramate/v1
id: schema
profile: yarramate/core@0.1
concepts:
  - id: stable-context
    kind: capability
    name: Stable context
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(validateGraph(result.graph)).toBe(true)
    expect(validateGraph.errors).toBeNull()
  })

  it('rejects a graph claim without normative source provenance', () => {
    expect(
      validateGraph({
        format: 'yarramate/graph/v2',
        profiles: ['yarramate/core@0.1'],
        documents: [{ id: 'schema', source: 'schema.yaml' }],
        subjects: [{ id: 'stable-context', type: 'concept' }],
        claims: [
          {
            id: 'stable-context~kind',
            subject: 'stable-context',
            predicate: 'yarramate/concept/kind',
            object: { value: 'yarramate/core@0.1#capability' },
            origin: 'declared',
          },
        ],
      }),
    ).toBe(false)
  })

  it('accepts the complete graph emitted for the YarraMate self-model', () => {
    const source = (path: string) => ({
      path,
      source: readFileSync(
        fileURLToPath(new URL(`../${path}`, import.meta.url)),
        'utf8',
      ),
    })
    const result = compileWorkspace([
      source('.yarramate/profiles/yarramate-development.yaml'),
      source('.yarramate/architecture/product.yaml'),
      source('.yarramate/architecture/engine.yaml'),
      source('.yarramate/architecture/repository.yaml'),
      source('.yarramate/architecture/evolution.yaml'),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(validateGraph(result.graph)).toBe(true)
    expect(validateGraph.errors).toBeNull()
  })
})
