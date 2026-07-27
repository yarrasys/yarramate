import { describe, expect, it } from 'vitest'
import { compileWorkspace, serializeSemanticGraph } from '../src/index.js'

describe('YarraMate library entrypoint', () => {
  it('exposes the compiler through the package interface', () => {
    const result = compileWorkspace([
      {
        path: 'library.yaml',
        source: `format: yarramate/v1
id: library
profile: yarramate/core@0.1
concepts: []
relationships: []
`,
      },
    ])

    expect(result).toMatchObject({
      ok: true,
      graph: {
        format: 'yarramate/graph/v2',
        documents: [{ id: 'library', source: 'library.yaml' }],
      },
    })
  })

  it('serializes graph v2 as canonical deterministic JSON', () => {
    const result = compileWorkspace([
      {
        path: 'library.yaml',
        source: `format: yarramate/v1
id: library
profile: yarramate/core@0.1
concepts: []
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(serializeSemanticGraph(result.graph)).toBe(
      '{\n' +
        '  "format": "yarramate/graph/v2",\n' +
        '  "profiles": [\n' +
        '    "yarramate/core@0.1"\n' +
        '  ],\n' +
        '  "documents": [\n' +
        '    {\n' +
        '      "id": "library",\n' +
        '      "source": "library.yaml"\n' +
        '    }\n' +
        '  ],\n' +
        '  "subjects": [],\n' +
        '  "claims": []\n' +
        '}\n',
    )
  })
})
