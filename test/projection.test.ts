import { describe, expect, it } from 'vitest'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  compileWorkspace,
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
`

describe('evaluateProjection', () => {
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
        '  description: Stable output\n',
    })
    const second = loadProjection({
      path: 'second.projection.yaml',
      source:
        'presentation:\n' +
        '  description: Stable output\n' +
        '  title: Reordered\n' +
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
