import { describe, expect, it } from 'vitest'
import { prepareLikeC4Export } from '../src/adapters/likec4.js'

describe('prepareLikeC4Export', () => {
  it('derives comparison presentation from the compiled semantic graph', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
  - id: target
    kind: target
    name: Target
concepts:
  - id: legacy
    kind: applicationComponent
    name: Legacy
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern
    presentIn: [target]
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system-change
version: "1.0"
query:
  states: [system#baseline, system#target]
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#legacy
    external: legacy
    type: concept
  - native: system#modern
    external: modern
    type: concept
`,
      },
      comparison: {
        from: 'system#baseline',
        to: 'system#target',
      },
      vocabulary: 'bundled',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toContain(`yarramateChange 'removed'`)
    expect(result.source).toContain(`yarramateChange 'added'`)
  })

  it('rejects a comparison projection that omits either compared state', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
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
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system-change
version: "1.0"
query:
  states: [system#target]
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings: []
`,
      },
      comparison: {
        from: 'system#baseline',
        to: 'system#target',
      },
      vocabulary: 'bundled',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC106',
          message:
            'Comparison state "system#baseline" is not selected by projection "system-change@1.0"',
          subject: 'system#baseline',
          path: 'system.projection.yaml',
          pointer: '/query/states',
          line: 5,
          column: 11,
        },
      ],
    })
  })

  it('locates an unknown compared state at its portable selector', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
concepts: []
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system-change
version: "1.0"
query:
  states:
    - system#baseline
    - system#missing
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings: []
`,
      },
      comparison: {
        from: 'system#baseline',
        to: 'system#missing',
      },
      vocabulary: 'bundled',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC105',
          message:
            'Architecture state "system#missing" does not exist',
          subject: 'system#missing',
          path: 'system.projection.yaml',
          pointer: '/query/states/1',
          line: 7,
          column: 7,
        },
      ],
    })
  })

  it('compiles, projects, maps, validates, and renders through one public seam', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      },
      vocabulary: 'bundled',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.projection).toBe('system@1.0')
    expect(result.subjectMapping.id).toBe('system-likec4')
    expect(result.source).toContain(
      "service = applicationComponent 'Service'",
    )
  })

  it('returns bundled-vocabulary diagnostics before publication', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'profile.yaml',
          source: `format: yarramate/profile/v1
id: example/profile
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: custom-service
    name: Custom service
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds: []
`,
        },
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: example/profile@1.0
concepts:
  - id: service
    kind: custom-service
    name: Service
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      },
      vocabulary: 'bundled',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC104',
          message:
            'Semantic concept kind "example/profile@1.0#custom-service" resolves to unsupported bundled LikeC4 kind "custom-service"',
          subject: 'system#service',
          path: 'system.yaml',
          pointer: '/concepts/0/kind',
          line: 6,
          column: 11,
        },
      ],
    })
  })

  it('locates an invalid LikeC4 identity at the authored mapping value', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: bad.identity
    type: concept
`,
      },
      vocabulary: 'consumer',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC103',
          message:
            'LikeC4 identity "bad.identity" is not a valid identifier',
          subject: 'system#service',
          path: 'system.mapping.yaml',
          pointer: '/mappings/0/external',
          line: 7,
          column: 15,
        },
      ],
    })
  })

  it('locates an incompatible adapter at the authored adapter value', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts: []
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-graphify
version: "1.0"
adapter: graphify
mappings: []
`,
      },
      vocabulary: 'consumer',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC101',
          message:
            'Adapter mapping "system-graphify@1.0" targets "graphify", not "likec4"',
          path: 'system.mapping.yaml',
          pointer: '/adapter',
          line: 4,
          column: 10,
        },
      ],
    })
  })

  it('locates an unsupported mapped kind at the authored external kind', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Service
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#service
    external: service
    type: concept
`,
      },
      kindMapping: {
        path: 'system.kinds.yaml',
        source: `format: yarramate/likec4-kind-mapping/v1
id: system-kinds
version: "1.0"
conceptKinds:
  - native: yarramate/core@0.1#applicationComponent
    external: unavailable-kind
relationshipKinds: []
`,
      },
      vocabulary: 'bundled',
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC104',
          message:
            'Semantic concept kind "yarramate/core@0.1#applicationComponent" resolves to unsupported bundled LikeC4 kind "unavailable-kind"',
          subject: 'system#service',
          path: 'system.kinds.yaml',
          pointer: '/conceptKinds/0/external',
          line: 6,
          column: 15,
        },
      ],
    })
  })

  it('orders adapter diagnostics by authored source location', () => {
    const result = prepareLikeC4Export({
      sources: [
        {
          path: 'profile.yaml',
          source: `format: yarramate/profile/v1
id: example/profile
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: custom-service
    name: Custom service
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds: []
`,
        },
        {
          path: 'system.yaml',
          source: `format: yarramate/v1
id: system
profile: example/profile@1.0
concepts:
  - id: zeta
    kind: custom-service
    name: First authored
  - id: alpha
    kind: custom-service
    name: Second authored
relationships: []
`,
        },
      ],
      projection: {
        path: 'system.projection.yaml',
        source: `format: yarramate/projection/v1
id: system
version: "1.0"
query: {}
`,
      },
      subjectMapping: {
        path: 'system.mapping.yaml',
        source: `format: yarramate/adapter-mapping/v1
id: system-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: system#alpha
    external: alpha
    type: concept
  - native: system#zeta
    external: zeta
    type: concept
`,
      },
      vocabulary: 'bundled',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.diagnostics.map((diagnostic) =>
        'subject' in diagnostic ? diagnostic.subject : undefined,
      ),
    ).toEqual(['system#zeta', 'system#alpha'])
  })
})
