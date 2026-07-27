import { describe, expect, it } from 'vitest'
import {
  compileWorkspace,
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
  type ProjectionDefinition,
} from '../src/index.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = `format: yarramate/v1
id: projection-model
profile: yarramate/core@0.1
concepts:
  - id: first
    kind: capability
    name: First
    status: current
  - id: second
    kind: capability
    name: Second
    status: current
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
