import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  compareArchitectureStates,
  compileWorkspace,
} from '../src/index.js'

describe('compareArchitectureStates', () => {
  it('classifies added, removed, and retained subjects deterministically', () => {
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
    name: Shared
  - id: legacy
    kind: applicationComponent
    name: Legacy
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern
    presentIn: [target]
relationships:
  - id: legacy-uses-shared
    kind: serving
    from: shared
    to: legacy
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

    const result = compareArchitectureStates(
      compilation.graph,
      'baseline',
      'target',
    )

    expect(result).toEqual({
      ok: true,
      comparison: {
        format: 'yarramate/state-comparison/v1',
        from: 'baseline',
        to: 'target',
        added: [
          { id: 'modern', type: 'concept' },
          { id: 'modern-uses-shared', type: 'relationship' },
        ],
        removed: [
          { id: 'legacy', type: 'concept' },
          { id: 'legacy-uses-shared', type: 'relationship' },
        ],
        retained: [{ id: 'shared', type: 'concept' }],
      },
    })
  })

  it('is independent of semantic graph array order', () => {
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
concepts:
  - id: first
    kind: capability
    name: First
    presentIn: [baseline]
  - id: first-companion
    kind: capability
    name: First companion
    presentIn: [baseline]
  - id: second
    kind: capability
    name: Second
    presentIn: [target]
  - id: second-companion
    kind: capability
    name: Second companion
    presentIn: [target]
relationships: []
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const forward = compareArchitectureStates(
      compilation.graph,
      'baseline',
      'target',
    )
    const reversed = compareArchitectureStates(
      {
        ...compilation.graph,
        subjects: [...compilation.graph.subjects].reverse(),
        claims: [...compilation.graph.claims].reverse(),
      },
      'baseline',
      'target',
    )

    expect(reversed).toEqual(forward)
  })

  it('emits a comparison conforming to the normative result schema', () => {
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
concepts: []
relationships: []
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const result = compareArchitectureStates(
      compilation.graph,
      'baseline',
      'target',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../schema/yarramate-state-comparison.schema.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    )
    const Ajv2020 = Ajv2020Module.default
    const validate = new Ajv2020({ allErrors: true }).compile(schema)

    expect(
      validate(result.comparison),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('reports unknown comparison states without guessing', () => {
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
concepts: []
relationships: []
`,
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return

    expect(
      compareArchitectureStates(
        compilation.graph,
        'baseline',
        'missing',
      ),
    ).toEqual({
      ok: false,
      issues: [
        {
          code: 'YMS101',
          message:
            'Architecture state "missing" does not exist',
          state: 'missing',
        },
      ],
    })
  })
})
