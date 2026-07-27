import { describe, expect, it } from 'vitest'
import { loadLikeC4KindMapping } from '../src/adapters/likec4-kind-mapping.js'

describe('loadLikeC4KindMapping', () => {
  it('loads and deterministically orders adapter-owned kind mappings', () => {
    const result = loadLikeC4KindMapping({
      path: 'likec4-kinds.yaml',
      source: `format: yarramate/likec4-kind-mapping/v1
id: development-likec4
version: "1.0"
conceptKinds:
  - native: yarramate/development@1.0#repository-file
    external: artifact
  - native: yarramate/development@1.0#compiler-module
    external: applicationComponent
relationshipKinds:
  - native: yarramate/development@1.0#implements
    external: realization
`,
    })

    expect(result).toEqual({
      ok: true,
      mapping: {
        format: 'yarramate/likec4-kind-mapping/v1',
        id: 'development-likec4',
        version: '1.0',
        conceptKinds: [
          {
            native: 'yarramate/development@1.0#compiler-module',
            external: 'applicationComponent',
          },
          {
            native: 'yarramate/development@1.0#repository-file',
            external: 'artifact',
          },
        ],
        relationshipKinds: [
          {
            native: 'yarramate/development@1.0#implements',
            external: 'realization',
          },
        ],
      },
    })
  })

  it('rejects a native kind mapped more than once with a source location', () => {
    const result = loadLikeC4KindMapping({
      path: 'duplicate-likec4-kinds.yaml',
      source: `format: yarramate/likec4-kind-mapping/v1
id: duplicate
version: "1.0"
conceptKinds:
  - native: yarramate/development@1.0#compiler-module
    external: applicationComponent
  - native: yarramate/development@1.0#compiler-module
    external: element
relationshipKinds: []
`,
    })

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YMLC201',
          message:
            'Native concept kind "yarramate/development@1.0#compiler-module" is mapped more than once',
          path: 'duplicate-likec4-kinds.yaml',
          pointer: '/conceptKinds/1/native',
          line: 7,
          column: 13,
        },
      ],
    })
  })
})
