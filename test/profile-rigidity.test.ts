import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/index.js'
import { conceptKinds, rigidities } from '../src/profile.js'

const profile = (kinds: string): string =>
  `format: yarramate/profile/v1
id: example/crew
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
${kinds}relationshipKinds: []
`

describe('rigidity meta-properties on concept kinds', () => {
  it('annotates only the core kinds ArchiMate itself calls roles or collaborations', () => {
    expect(
      conceptKinds
        .filter(({ rigidity }) => rigidity !== undefined)
        .map(({ id, rigidity }) => `${id}:${rigidity}`),
    ).toEqual([
      'stakeholder:anti-rigid',
      'businessRole:anti-rigid',
      'businessCollaboration:anti-rigid',
      'applicationCollaboration:anti-rigid',
      'technologyCollaboration:anti-rigid',
    ])
    expect(
      conceptKinds.every(
        ({ rigidity }) => rigidity === undefined || rigidities.includes(rigidity),
      ),
    ).toBe(true)
  })

  it('rejects a rigid kind that specializes an anti-rigid parent', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: crew
    name: Crew
    parent: yarramate/core@0.1#businessRole
    rigidity: rigid
`,
        ),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM413',
          message:
            'Rigid concept kind "crew" specializes anti-rigid kind "yarramate/core@0.1#businessRole"; nothing is essentially of an anti-rigid kind, so parent "crew" under an entity kind, or drop its "rigid" annotation',
          path: 'profiles/crew.yaml',
          pointer: '/conceptKinds/0/rigidity',
          line: 9,
          column: 15,
        },
      ],
    })
  })

  it('follows the whole lineage, so an unannotated kind cannot launder the violation', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: duty
    name: Duty
    parent: yarramate/core@0.1#businessRole
  - id: crew
    name: Crew
    parent: example/crew@1.0#duty
    rigidity: rigid
`,
        ),
      },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'YM413',
        message:
          'Rigid concept kind "crew" specializes anti-rigid kind "yarramate/core@0.1#businessRole"; nothing is essentially of an anti-rigid kind, so parent "crew" under an entity kind, or drop its "rigid" annotation',
        pointer: '/conceptKinds/1/rigidity',
      }),
    ])
  })

  it('accepts an anti-rigid kind under a kind nothing has annotated', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: on-call
    name: On call
    parent: yarramate/core@0.1#businessActor
    rigidity: anti-rigid
`,
        ),
      },
    ])

    expect(result.ok).toBe(true)
  })

  it('accepts a rigid kind under an unannotated parent, and any unannotated kind anywhere', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
    rigidity: rigid
  - id: squad
    name: Squad
    parent: yarramate/core@0.1#businessRole
  - id: pairing
    name: Pairing
    parent: yarramate/core@0.1#applicationCollaboration
`,
        ),
      },
    ])

    expect(result.ok).toBe(true)
  })

  it('rejects a rigidity value outside the vocabulary', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: crew
    name: Crew
    parent: yarramate/core@0.1#businessActor
    rigidity: sometimes
`,
        ),
      },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['YM201'])
  })

  it('rejects rigidity on a relationship kind, which has no instances to be essential to', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: `format: yarramate/profile/v1
id: example/crew
version: "1.0"
extends: yarramate/core@0.1
conceptKinds: []
relationshipKinds:
  - id: crews
    name: Crews
    parent: yarramate/core@0.1#assignment
    rigidity: rigid
`,
      },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'YM201',
        message: 'Property "rigidity" is not allowed',
      }),
    ])
  })

  it('changes no compiled output, because the annotation is checked and then discarded', () => {
    const document = {
      path: 'architecture/crew.yaml',
      source: `format: yarramate/v1
id: crew
profile: example/crew@1.0
concepts:
  - id: checkout
    kind: microservice
    name: Checkout
relationships: []
`,
    }
    const withoutAnnotation = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
`,
        ),
      },
      document,
    ])
    const withAnnotation = compileWorkspace([
      {
        path: 'profiles/crew.yaml',
        source: profile(
          `  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
    rigidity: rigid
`,
        ),
      },
      document,
    ])

    expect(withAnnotation.ok).toBe(true)
    expect(JSON.stringify(withAnnotation)).toBe(JSON.stringify(withoutAnnotation))
  })
})
