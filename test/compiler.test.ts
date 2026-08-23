import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspace,
  compileWorkspaceWithProfileContext,
  withDiagnosticSubjects,
} from '../src/compiler.js'

const fixture = (path: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)),
    'utf8',
  )

describe('compileWorkspace', () => {
  it('keeps graph v2 identical when resolved profile context is requested', () => {
    const sources = [
      {
        path: 'minimal.yaml',
        source: `format: yarramate/v1
id: minimal
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationService
    name: Service
relationships: []
`,
      },
    ]

    const graphOnly = compileWorkspace(sources)
    const contextual = compileWorkspaceWithProfileContext(sources)
    expect(graphOnly.ok).toBe(true)
    expect(contextual.ok).toBe(true)
    if (!graphOnly.ok || !contextual.ok) return

    expect(contextual.graph).toEqual(graphOnly.graph)
    expect(contextual.profileContext.conceptKindLineages.get(
      'yarramate/core@0.1#applicationService',
    )).toEqual(['yarramate/core@0.1#applicationService'])
  })

  it('resolves inherited and explicit concept kind layers into a frozen qualified-kind map', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'layered-profile.yaml',
        source: `format: yarramate/profile/v1
id: example/layered
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: application-capability
    name: Application capability
    parent: yarramate/core@0.1#capability
    layer: application
  - id: inherited-capability
    name: Inherited capability
    parent: yarramate/core@0.1#capability
relationshipKinds: []
`,
      },
      {
        path: 'layered.yaml',
        source: `format: yarramate/v1
id: layered
profile: example/layered@1.0
concepts:
  - id: capability
    kind: application-capability
    name: Capability
relationships: []
`,
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profileContext.conceptKindLayers.get(
      'example/layered@1.0#application-capability',
    )).toBe('application')
    expect(result.profileContext.conceptKindLayers.get(
      'example/layered@1.0#inherited-capability',
    )).toBe('strategy')
    expect(Object.isFrozen(result.profileContext.conceptKindLayers)).toBe(true)
    expect(() =>
      (
        result.profileContext.conceptKindLayers as unknown as Map<string, string>
      ).set('example/layered@1.0#application-capability', 'business'),
    ).toThrow()
    expect(result.profileContext.conceptKindLayers.get(
      'example/layered@1.0#application-capability',
    )).toBe('application')
    result.profileContext.conceptKindLayers.forEach((_, key, map) => {
      expect(() => (map as unknown as Map<string, string>).set(key, 'business')).toThrow()
    })
    expect(result.profileContext.conceptKindLayers.get(
      'example/layered@1.0#application-capability',
    )).toBe('application')
    for (const map of [
      result.profileContext.conceptKindLineages,
      result.profileContext.relationshipKindLineages,
    ]) {
      expect(Object.isFrozen(map)).toBe(true)
      expect(() =>
        (map as unknown as Map<string, readonly string[]>).clear(),
      ).toThrow()
      map.forEach((lineage, key, exposedMap) => {
        expect(Object.isFrozen(lineage)).toBe(true)
        expect(() =>
          (lineage as unknown as string[]).push('mutated'),
        ).toThrow()
        expect(() =>
          (
            exposedMap as unknown as Map<string, readonly string[]>
          ).delete(key),
        ).toThrow()
      })
    }
  })

  it('compiles architecture states and concise subject presence into claims', () => {
    const result = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Current architecture
  - id: target
    kind: target
    name: Target architecture
    after: baseline
concepts:
  - id: payments
    kind: applicationComponent
    name: Payments platform
    presentIn: [target]
relationships: []
`,
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.subjects).toContainEqual({
      id: 'target',
      type: 'concept',
    })
    expect(result.graph.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'target~kind',
          subject: 'target',
          predicate: 'yarramate/concept/kind',
          object: { value: 'yarramate/core@0.1#plateau' },
        }),
        expect.objectContaining({
          id: 'target~state-type',
          subject: 'target',
          predicate: 'yarramate/state/type',
          object: { value: 'target' },
        }),
        expect.objectContaining({
          id: 'target~after',
          subject: 'target',
          predicate: 'yarramate/state/after',
          object: { ref: 'baseline' },
        }),
        expect.objectContaining({
          subject: 'payments',
          predicate: 'yarramate/state/present-in',
          object: { ref: 'target' },
          source: expect.objectContaining({
            path: 'roadmap.yaml',
            pointer: '/concepts/0/presentIn/0',
            line: 16,
            column: 17,
          }),
        }),
      ]),
    )
  })

  it('reports an unresolved architecture-state reference at its authored value', () => {
    const result = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
concepts:
  - id: payments
    kind: applicationComponent
    name: Payments
    presentIn:
      - missing-state
relationships: []
`,
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM307',
          message:
            'Unresolved architecture state reference "missing-state"',
          path: 'roadmap.yaml',
          pointer: '/concepts/0/presentIn/0',
          line: 9,
          column: 9,
        },
      ],
    })
  })

  it('rejects cyclic architecture-state ordering', () => {
    const result = compileWorkspace([
      {
        path: 'roadmap.yaml',
        source: `format: yarramate/v1
id: roadmap
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Baseline
    after: target
  - id: target
    kind: target
    name: Target
    after: baseline
concepts: []
relationships: []
`,
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM502',
          message:
            'Architecture state "baseline" participates in an ordering cycle',
          path: 'roadmap.yaml',
          pointer: '/states/0/after',
          line: 8,
          column: 12,
        },
        {
          severity: 'error',
          code: 'YM502',
          message:
            'Architecture state "target" participates in an ordering cycle',
          path: 'roadmap.yaml',
          pointer: '/states/1/after',
          line: 12,
          column: 12,
        },
      ],
    })
  })

  it('rejects a relationship present where one endpoint is absent', () => {
    const result = compileWorkspace([
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
  - id: legacy
    kind: applicationComponent
    name: Legacy
    presentIn: [baseline]
  - id: modern
    kind: applicationComponent
    name: Modern
    presentIn: [target]
relationships:
  - id: legacy-serves-modern
    kind: serving
    from: legacy
    to: modern
    presentIn: [target]
`,
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM503',
          message:
            'Relationship "legacy-serves-modern" is present in "target" but endpoint "legacy" is absent',
          path: 'roadmap.yaml',
          pointer: '/relationships/0/presentIn/0',
          line: 25,
          column: 17,
        },
      ],
    })
  })

  it('compiles concise ownership into an explicit stable claim', () => {
    const result = compileWorkspace([
      {
        path: 'ownership.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: ownership\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: payments-team\n' +
          '    kind: businessActor\n' +
          '    name: Payments team\n' +
          '  - id: payments-api\n' +
          '    kind: applicationService\n' +
          '    name: Payments API\n' +
          '    owner: payments-team\n' +
          'relationships: []\n',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.claims).toContainEqual({
      id: 'payments-api~owner',
      subject: 'payments-api',
      predicate: 'yarramate/ownership/owner',
      object: { ref: 'payments-team' },
      origin: 'declared',
      source: {
        document: 'ownership',
        path: 'ownership.yaml',
        pointer: '/concepts/1/owner',
        line: 11,
        column: 12,
      },
    })
  })

  it('reports an unresolved owner at the authored reference', () => {
    const result = compileWorkspace([
      {
        path: 'ownership.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: ownership\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: payments-api\n' +
          '    kind: applicationService\n' +
          '    name: Payments API\n' +
          '    owner: missing-team\n' +
          'relationships: []\n',
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM304',
          message: 'Unresolved owner reference "missing-team"',
          path: 'ownership.yaml',
          pointer: '/concepts/0/owner',
          line: 8,
          column: 12,
        },
      ],
    })
  })

  it('reports an unresolved attestation authority at the authored reference', () => {
    const result = compileWorkspace([
      {
        path: 'adequacy.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: adequacy\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: payments-api\n' +
          '    kind: applicationService\n' +
          '    name: Payments API\n' +
          '    attestations:\n' +
          '      - topic: adequacy\n' +
          '        by: missing-reviewer\n' +
          '        on: "2026-08-01"\n' +
          'relationships: []\n',
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM304',
          message: 'Unresolved attestation authority reference "missing-reviewer"',
          path: 'adequacy.yaml',
          pointer: '/concepts/0/attestations/0/by',
          line: 10,
          column: 13,
        },
      ],
    })
  })

  it('packs the recorder into the attestation claim beside the authority', () => {
    const result = compileWorkspace([
      {
        path: 'adequacy.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: adequacy\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: review-board\n' +
          '    kind: businessActor\n' +
          '    name: Review board\n' +
          '  - id: payments-api\n' +
          '    kind: applicationService\n' +
          '    name: Payments API\n' +
          '    attestations:\n' +
          '      - topic: adequacy\n' +
          '        by: review-board\n' +
          '        recordedBy: claude-fable-5\n' +
          '        on: "2026-08-01"\n' +
          'relationships: []\n',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.claims).toContainEqual({
      id: 'payments-api~attestation-adequacy',
      subject: 'payments-api',
      predicate: 'yarramate/attestation/adequacy',
      object: {
        value: 'review-board 2026-08-01 claude-fable-5',
      },
      origin: 'declared',
      source: {
        document: 'adequacy',
        path: 'adequacy.yaml',
        pointer: '/concepts/1/attestations/0/topic',
        line: 12,
        column: 16,
      },
    })
  })

  it('compiles identified constraints into stable explicit claims', () => {
    const result = compileWorkspace([
      {
        path: 'constraints.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: constraints\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: australia-only\n' +
          '    kind: constraint\n' +
          '    name: Data remains in Australia\n' +
          '  - id: customer-data\n' +
          '    kind: dataObject\n' +
          '    name: Customer data\n' +
          '    constraints:\n' +
          '      - id: residency\n' +
          '        ref: australia-only\n' +
          'relationships: []\n',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.claims).toContainEqual({
      id: 'customer-data~constraint-residency',
      subject: 'customer-data',
      predicate: 'yarramate/constraint/requires',
      object: { ref: 'australia-only' },
      origin: 'declared',
      source: {
        document: 'constraints',
        path: 'constraints.yaml',
        pointer: '/concepts/1/constraints/0/ref',
        line: 13,
        column: 14,
      },
    })
  })

  it('reports an unresolved constraint at the authored reference', () => {
    const result = compileWorkspace([
      {
        path: 'constraints.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: constraints\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: customer-data\n' +
          '    kind: dataObject\n' +
          '    name: Customer data\n' +
          '    constraints:\n' +
          '      - id: residency\n' +
          '        ref: missing-constraint\n' +
          'relationships: []\n',
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM305',
          message:
            'Unresolved constraint reference "missing-constraint"',
          path: 'constraints.yaml',
          pointer: '/concepts/0/constraints/0/ref',
          line: 10,
          column: 14,
        },
      ],
    })
  })

  it('rejects duplicate constraint IDs on one subject', () => {
    const result = compileWorkspace([
      {
        path: 'constraints.yaml',
        source:
          'format: yarramate/v1\n' +
          'id: constraints\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: first-rule\n' +
          '    kind: constraint\n' +
          '    name: First rule\n' +
          '  - id: second-rule\n' +
          '    kind: constraint\n' +
          '    name: Second rule\n' +
          '  - id: customer-data\n' +
          '    kind: dataObject\n' +
          '    name: Customer data\n' +
          '    constraints:\n' +
          '      - id: residency\n' +
          '        ref: first-rule\n' +
          '      - id: residency\n' +
          '        ref: second-rule\n' +
          'relationships: []\n',
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM306',
          message: 'Duplicate constraint ID "residency"',
          path: 'constraints.yaml',
          pointer: '/concepts/2/constraints/1/id',
          line: 17,
          column: 13,
        },
      ],
    })
  })

  it('compiles identified references from concepts and relationships into stable claims', () => {
    const result = compileWorkspace([
      {
        path: 'references.yaml',
        source: fixture('valid/identified-references.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'worker~reference-lifecycle-rule',
          subject: 'worker',
          predicate: 'yarramate/reference/refers-to',
          object: { ref: 'worker-triggers-lifecycle' },
          source: expect.objectContaining({
            pointer: '/concepts/1/references/0/ref',
            line: 13,
            column: 14,
          }),
        }),
        expect.objectContaining({
          id: 'worker-triggers-lifecycle~reference-governing-subject',
          subject: 'worker-triggers-lifecycle',
          predicate: 'yarramate/reference/refers-to',
          object: { ref: 'lifecycle' },
          source: expect.objectContaining({
            pointer: '/relationships/0/references/0/ref',
            line: 21,
            column: 14,
          }),
        }),
      ]),
    )
  })

  it('reports an unresolved subject reference at its authored value', () => {
    const result = compileWorkspace([
      {
        path: 'references.yaml',
        source: fixture('invalid/unresolved-subject-reference.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM308',
          message: 'Unresolved subject reference "missing-subject"',
          path: 'references.yaml',
          pointer: '/concepts/0/references/0/ref',
          line: 10,
          column: 14,
        },
      ],
    })
  })

  it('rejects duplicate reference IDs on one subject', () => {
    const result = compileWorkspace([
      {
        path: 'references.yaml',
        source: fixture('invalid/duplicate-reference-id.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM309',
          message: 'Duplicate reference ID "governing-rule"',
          path: 'references.yaml',
          pointer: '/concepts/2/references/1/id',
          line: 17,
          column: 13,
        },
      ],
    })
  })

  it('compiles concise authoring syntax into explicit declared claims', () => {
    const result = compileWorkspace([
      {
        path: 'architecture/checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: true,
      graph: {
        format: 'yarramate/graph/v2',
        profiles: ['yarramate/core@0.1'],
        documents: [{ id: 'checkout', source: 'architecture/checkout.yaml' }],
        subjects: [
          { id: 'api-realizes-approval', type: 'relationship' },
          { id: 'approval-api', type: 'concept' },
          { id: 'approve-order', type: 'concept' },
        ],
        claims: [
          {
            id: 'api-realizes-approval',
            subject: 'approval-api',
            predicate: 'yarramate/core@0.1#realization',
            object: { ref: 'approve-order' },
            origin: 'declared',
            source: {
              document: 'checkout',
              path: 'architecture/checkout.yaml',
              pointer: '/relationships/0',
              line: 12,
              column: 5,
            },
          },
          {
            id: 'approval-api~kind',
            subject: 'approval-api',
            predicate: 'yarramate/concept/kind',
            object: { value: 'yarramate/core@0.1#applicationService' },
            origin: 'declared',
            source: {
              document: 'checkout',
              path: 'architecture/checkout.yaml',
              pointer: '/concepts/1/kind',
              line: 9,
              column: 11,
            },
          },
          {
            id: 'approval-api~name',
            subject: 'approval-api',
            predicate: 'yarramate/concept/name',
            object: { value: 'Approval API' },
            origin: 'declared',
            source: {
              document: 'checkout',
              path: 'architecture/checkout.yaml',
              pointer: '/concepts/1/name',
              line: 10,
              column: 11,
            },
          },
          {
            id: 'approve-order~kind',
            subject: 'approve-order',
            predicate: 'yarramate/concept/kind',
            object: { value: 'yarramate/core@0.1#capability' },
            origin: 'declared',
            source: {
              document: 'checkout',
              path: 'architecture/checkout.yaml',
              pointer: '/concepts/0/kind',
              line: 6,
              column: 11,
            },
          },
          {
            id: 'approve-order~name',
            subject: 'approve-order',
            predicate: 'yarramate/concept/name',
            object: { value: 'Approve order' },
            origin: 'declared',
            source: {
              document: 'checkout',
              path: 'architecture/checkout.yaml',
              pointer: '/concepts/0/name',
              line: 7,
              column: 11,
            },
          },
        ],
      },
    })
  })

  it('reports duplicate local IDs at the later declaration', () => {
    const result = compileWorkspace([
      {
        path: 'duplicate.yaml',
        source: fixture('invalid/duplicate-id.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM301',
          message: 'Duplicate ID "shared"',
          path: 'duplicate.yaml',
          pointer: '/concepts/1/id',
          line: 8,
          column: 9,
        },
      ],
    })
  })

  it('reports an unresolved relationship endpoint at its reference', () => {
    const result = compileWorkspace([
      {
        path: 'unresolved.yaml',
        source: fixture('invalid/unresolved-reference.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM302',
          message: 'Unresolved concept reference "absent"',
          path: 'unresolved.yaml',
          pointer: '/relationships/0/to',
          line: 12,
          column: 9,
        },
      ],
    })
  })

  it('reports a concept kind absent from the selected profile', () => {
    const result = compileWorkspace([
      {
        path: 'unknown-concept.yaml',
        source: fixture('invalid/unknown-concept-kind.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM401',
          message:
            'Unknown concept kind "mysteryKind" in profile "yarramate/core@0.1"',
          path: 'unknown-concept.yaml',
          pointer: '/concepts/0/kind',
          line: 6,
          column: 11,
        },
      ],
    })
  })

  it('reports a relationship kind absent from the selected profile', () => {
    const result = compileWorkspace([
      {
        path: 'unknown-relationship.yaml',
        source: fixture('invalid/unknown-relationship-kind.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM402',
          message:
            'Unknown relationship kind "dependsOn" in profile "yarramate/core@0.1"',
          path: 'unknown-relationship.yaml',
          pointer: '/relationships/0/kind',
          line: 13,
          column: 11,
        },
      ],
    })
  })

  it('serializes identically regardless of workspace source order', () => {
    const checkout = {
      path: 'z-checkout.yaml',
      source: fixture('valid/minimal.yaml'),
    }
    const strategy = {
      path: 'a-strategy.yaml',
      source: fixture('valid/strategy.yaml'),
    }

    const forward = compileWorkspace([checkout, strategy])
    const reverse = compileWorkspace([strategy, checkout])

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse))
  })

  it('enforces the closed normative document schema', () => {
    const result = compileWorkspace([
      {
        path: 'metadata.yaml',
        source: fixture('invalid/unstructured-metadata.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM201',
          message: 'Property "metadata" is not allowed',
          path: 'metadata.yaml',
          pointer: '/metadata',
          line: 5,
          column: 3,
        },
      ],
    })
  })

  it('reports malformed YAML with a source location', () => {
    const result = compileWorkspace([
      {
        path: 'malformed.yaml',
        source: fixture('invalid/malformed.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM101',
          message:
            'Flow sequence in block collection must be sufficiently indented and end with a ]',
          path: 'malformed.yaml',
          pointer: '/',
          line: 5,
          column: 1,
        },
      ],
    })
  })

  it('compiles optional descriptive authoring fields into claims', () => {
    const result = compileWorkspace([
      {
        path: 'described.yaml',
        source: fixture('valid/described.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.filter(({ id }) =>
          [
            'goal~description',
            'realizes~description',
            'realizes~name',
          ].includes(id),
        ),
      ).toEqual([
        {
          id: 'goal~description',
          subject: 'goal',
          predicate: 'yarramate/concept/description',
          object: { value: 'A concise explanation' },
          origin: 'declared',
          source: {
            document: 'described',
            path: 'described.yaml',
            pointer: '/concepts/0/description',
            line: 8,
            column: 18,
          },
        },
        {
          id: 'realizes~description',
          subject: 'realizes',
          predicate: 'yarramate/relationship/description',
          object: {
            value: 'This dependency records the chosen delivery rationale',
          },
          origin: 'declared',
          source: {
            document: 'described',
            path: 'described.yaml',
            pointer: '/relationships/0/description',
            line: 18,
            column: 18,
          },
        },
        {
          id: 'realizes~name',
          subject: 'realizes',
          predicate: 'yarramate/relationship/name',
          object: { value: 'Delivers' },
          origin: 'declared',
          source: {
            document: 'described',
            path: 'described.yaml',
            pointer: '/relationships/0/name',
            line: 17,
            column: 11,
          },
        },
      ])
    }
  })

  it('reports duplicate document IDs before they can collide globally', () => {
    const source = fixture('valid/strategy.yaml')
    const result = compileWorkspace([
      { path: 'first.yaml', source },
      { path: 'second.yaml', source },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM303',
          message: 'Duplicate document ID "strategy"',
          path: 'second.yaml',
          pointer: '/id',
          line: 2,
          column: 5,
        },
      ],
    })
  })

  it('does not silently validate against an unavailable profile', () => {
    const result = compileWorkspace([
      {
        path: 'unknown-profile.yaml',
        source: fixture('invalid/unknown-profile.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM403',
          message: 'Profile "example/custom@1.0" is not available',
          path: 'unknown-profile.yaml',
          pointer: '/profile',
          line: 3,
          column: 10,
        },
      ],
    })
  })

  it('rejects relationship endpoints outside the native profile policy', () => {
    const result = compileWorkspace([
      {
        path: 'incompatible.yaml',
        source: fixture('invalid/incompatible-endpoints.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM404',
          message:
            'Relationship "assignment" is not permitted from "intent" (goal) to "work" (businessProcess); ArchiMate 3.2 permits: association',
          path: 'incompatible.yaml',
          pointer: '/relationships/0/kind',
          line: 13,
          column: 11,
        },
      ],
    })
  })

  it('applies native profile restrictions to relationship targets', () => {
    const result = compileWorkspace([
      {
        path: 'incompatible-target.yaml',
        source: fixture('invalid/incompatible-target.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM404',
          message:
            'Relationship "access" is not permitted from "actor" (businessActor) to "intent" (goal); ArchiMate 3.2 permits: realization, influence, association',
          path: 'incompatible-target.yaml',
          pointer: '/relationships/0/kind',
          line: 13,
          column: 11,
        },
      ],
    })
  })

  it('compiles controlled relationship fields into explicit claims', () => {
    const result = compileWorkspace([
      {
        path: 'controlled.yaml',
        source: fixture('valid/controlled-relationships.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.filter(({ id }) =>
          [
            'reads-orders~mode',
            'sends-orders~content',
          ].includes(id),
        ),
      ).toEqual([
        {
          id: 'reads-orders~mode',
          subject: 'reads-orders',
          predicate: 'yarramate/access/mode',
          object: { value: 'read' },
          origin: 'declared',
          source: {
            document: 'controlled',
            path: 'controlled.yaml',
            pointer: '/relationships/0/mode',
            line: 19,
            column: 11,
          },
        },
        {
          id: 'sends-orders~content',
          subject: 'sends-orders',
          predicate: 'yarramate/flow/content',
          object: { value: 'Orders' },
          origin: 'declared',
          source: {
            document: 'controlled',
            path: 'controlled.yaml',
            pointer: '/relationships/1/content',
            line: 24,
            column: 14,
          },
        },
      ])
    }
  })

  it('rejects controlled fields on unrelated relationship kinds', () => {
    const result = compileWorkspace([
      {
        path: 'misplaced.yaml',
        source: fixture('invalid/misplaced-relationship-field.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM405',
          message: 'Field "mode" is only valid for relationship kind "access"',
          path: 'misplaced.yaml',
          pointer: '/relationships/0/mode',
          line: 16,
          column: 11,
        },
      ],
    })
  })

  it('rejects competing declared whole-part claims', () => {
    const result = compileWorkspace([
      {
        path: 'contradiction.yaml',
        source: fixture('invalid/contradictory-whole-part.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM501',
          message:
            'Relationship "weak-parts" contradicts "strong-parts": the same endpoints cannot be both aggregation and composition',
          path: 'contradiction.yaml',
          pointer: '/relationships/1/kind',
          line: 17,
          column: 11,
        },
      ],
    })
  })

  it('rejects competing whole-part claims declared in different documents', () => {
    const concepts = `format: yarramate/v1
id: structure
profile: yarramate/core@0.1
concepts:
  - id: whole
    kind: applicationComponent
    name: Whole
  - id: part
    kind: applicationComponent
    name: Part
relationships: []
`
    const strong = `format: yarramate/v1
id: strong-model
profile: yarramate/core@0.1
concepts: []
relationships:
  - id: contains-strongly
    kind: composition
    from: whole
    to: part
`
    const weak = `format: yarramate/v1
id: weak-model
profile: yarramate/core@0.1
concepts: []
relationships:
  - id: contains-weakly
    kind: aggregation
    from: whole
    to: part
`

    const sources = [
      { path: 'weak.yaml', source: weak },
      { path: 'structure.yaml', source: concepts },
      { path: 'strong.yaml', source: strong },
    ] as const
    const result = compileWorkspace(sources)

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM501',
          message:
            'Relationship "contains-weakly" contradicts "contains-strongly": the same endpoints cannot be both aggregation and composition',
          path: 'weak.yaml',
          pointer: '/relationships/0/kind',
          line: 7,
          column: 11,
        },
      ],
    })
    expect(compileWorkspace([...sources].reverse())).toEqual(result)
  })

  it('allows competing whole-part kinds in disjoint architecture states', () => {
    const result = compileWorkspace([
      {
        path: 'evolution.yaml',
        source: `format: yarramate/v1
id: evolution
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
  - id: whole
    kind: applicationComponent
    name: Whole
    presentIn: [baseline, target]
  - id: part
    kind: applicationComponent
    name: Part
    presentIn: [baseline, target]
relationships:
  - id: strong-parts
    kind: composition
    from: whole
    to: part
    presentIn: [baseline]
  - id: weak-parts
    kind: aggregation
    from: whole
    to: part
    presentIn: [target]
`,
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.graph.claims.filter(
        ({ predicate }) =>
          predicate === 'yarramate/core@0.1#composition' ||
          predicate === 'yarramate/core@0.1#aggregation',
      ),
    ).toHaveLength(2)
  })

  it('orders diagnostics independently of workspace source order', () => {
    const source = fixture('invalid/unstructured-metadata.yaml')
    const first = { path: 'z-last.yaml', source }
    const second = { path: 'a-first.yaml', source }

    const forward = compileWorkspace([first, second])
    const reverse = compileWorkspace([second, first])

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse))
    expect(forward.ok).toBe(false)
    if (!forward.ok) {
      expect(forward.diagnostics.map(({ path }) => path)).toEqual([
        'a-first.yaml',
        'z-last.yaml',
      ])
    }
  })

  it('resolves qualified concept references across documents', () => {
    const result = compileWorkspace([
      {
        path: 'product.yaml',
        source: fixture('valid/workspace-product.yaml'),
      },
      {
        path: 'engine.yaml',
        source: fixture('valid/workspace-engine.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.find(
          ({ id }) =>
            id ===
            'compiler-realizes-compilation',
        ),
      ).toEqual({
        id: 'compiler-realizes-compilation',
        subject: 'compiler',
        predicate: 'yarramate/core@0.1#realization',
        object: { ref: 'native-compilation' },
        origin: 'declared',
        source: {
          document: 'workspace-engine',
          path: 'engine.yaml',
          pointer: '/relationships/0',
          line: 9,
          column: 5,
        },
      })
    }
  })

  it('reports an unresolved qualified reference at its authored location', () => {
    const result = compileWorkspace([
      {
        path: 'qualified.yaml',
        source: fixture('invalid/unresolved-qualified-reference.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM302',
          message:
            'Unresolved concept reference "absent"',
          path: 'qualified.yaml',
          pointer: '/relationships/0/to',
          line: 12,
          column: 9,
        },
      ],
    })
  })

  it('compiles extension kinds to globally qualified graph identities', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/platform.yaml',
        source: fixture('valid/platform-profile.yaml'),
      },
      {
        path: 'architecture/platform.yaml',
        source: fixture('valid/platform-document.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.graph.format).toBe('yarramate/graph/v2')
      expect(result.graph.profiles).toEqual([
        'example/platform@1.0',
        'yarramate/core@0.1',
      ])
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'team~kind',
        ),
      ).toMatchObject({
        predicate: 'yarramate/concept/kind',
        object: { value: 'example/platform@1.0#platform-team' },
      })
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'team-owns-delivery',
        ),
      ).toMatchObject({
        predicate: 'example/platform@1.0#owns',
        subject: 'team',
        object: { ref: 'delivery' },
      })
    }
  })

  it('validates an extension relationship kind by its core ancestor', () => {
    // `owns` descends from assignment, and an actor is never assigned to a
    // goal, so the table rejects the pair before the profile's own narrowing
    // is reached. The diagnostic names the declared kind and its ancestor.
    const result = compileWorkspace([
      {
        path: 'profiles/platform.yaml',
        source: fixture('valid/platform-profile.yaml'),
      },
      {
        path: 'architecture/constrained.yaml',
        source: fixture('invalid/platform-constraint.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM404',
          message:
            'Relationship "owns" (assignment) is not permitted from "team" (platform-team, a businessActor) to "target" (goal); ArchiMate 3.2 permits: realization, influence, association',
          path: 'architecture/constrained.yaml',
          pointer: '/relationships/0/kind',
          line: 13,
          column: 11,
        },
      ],
    })
  })

  it('accepts every relationship the ArchiMate table permits, including triggering between active structure', () => {
    const source = (relationships: string) =>
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: cli
    kind: applicationComponent
    name: CLI
  - id: engine
    kind: applicationComponent
    name: Engine
  - id: ops
    kind: businessActor
    name: Ops
  - id: support
    kind: businessActor
    name: Support
  - id: host
    kind: node
    name: Host
relationships:
${relationships}`
    expect(
      compileWorkspace([
        {
          path: 'main.yaml',
          source: source(`  - id: cli-triggers-engine
    kind: triggering
    from: cli
    to: engine
  - id: ops-triggers-support
    kind: triggering
    from: ops
    to: support
  - id: host-realizes-engine
    kind: realization
    from: host
    to: engine
  - id: host-serves-cli
    kind: serving
    from: host
    to: cli
`),
        },
      ]).ok,
    ).toBe(true)
  })

  it('lets relationships pass through a junction but keeps the junction row', () => {
    const source = (relationships: string) =>
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: first
    kind: businessProcess
    name: First
  - id: second
    kind: businessProcess
    name: Second
  - id: both
    kind: andJunction
    name: Both
  - id: why
    kind: goal
    name: Why
relationships:
${relationships}`
    expect(
      compileWorkspace([
        {
          path: 'main.yaml',
          source: source(`  - id: first-to-junction
    kind: triggering
    from: first
    to: both
  - id: junction-to-second
    kind: triggering
    from: both
    to: second
`),
        },
      ]).ok,
    ).toBe(true)
    const rejected = compileWorkspace([
      {
        path: 'main.yaml',
        source: source(`  - id: junction-to-goal
    kind: triggering
    from: both
    to: why
`),
      },
    ])
    expect(rejected.ok).toBe(false)
    if (rejected.ok) return
    expect(rejected.diagnostics.map(({ code }) => code)).toEqual(['YM404'])
  })

  it('requires every relationship on one junction to be the same kind', () => {
    const result = compileWorkspace([
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: first
    kind: businessProcess
    name: First
  - id: second
    kind: businessProcess
    name: Second
  - id: both
    kind: andJunction
    name: Both
relationships:
  - id: first-triggers-junction
    kind: triggering
    from: first
    to: both
  - id: junction-flows-second
    kind: flow
    from: both
    to: second
`,
      },
    ])
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM414',
          message:
            'Relationship "junction-flows-second" (flow) joins junction "both" whose relationships are "triggering"; every relationship on one junction must be the same kind',
          path: 'main.yaml',
          pointer: '/relationships/1/kind',
          line: 20,
          column: 11,
        },
      ],
    })
  })

  it('says nothing about a pair whose endpoint never resolved', () => {
    const result = compileWorkspace([
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: intent
    kind: goal
    name: Intent
relationships:
  - id: dangling
    kind: assignment
    from: intent
    to: nowhere
`,
      },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['YM302'])
  })

  it('rejects an extension kind whose semantic parent is unavailable', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/broken.yaml',
        source: fixture('invalid/profile-missing-parent.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM407',
          message:
            'Concept parent "example/absent@1.0#missing" is not available',
          path: 'profiles/broken.yaml',
          pointer: '/conceptKinds/0/parent',
          line: 8,
          column: 13,
        },
      ],
    })
  })

  it('rejects an extension kind that shadows an inherited local name', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/collision.yaml',
        source: fixture('invalid/profile-kind-collision.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM409',
          message:
            'Concept kind "capability" conflicts with an inherited kind',
          path: 'profiles/collision.yaml',
          pointer: '/conceptKinds/0/id',
          line: 6,
          column: 9,
        },
      ],
    })
  })

  it('resolves profile inheritance independently of source order', () => {
    const parent = {
      path: 'profiles/platform.yaml',
      source: fixture('valid/platform-profile.yaml'),
    }
    const child = {
      path: 'profiles/reliability.yaml',
      source: fixture('valid/reliability-profile.yaml'),
    }
    const document = {
      path: 'architecture/reliability.yaml',
      source: fixture('valid/reliability-document.yaml'),
    }

    const childFirst = compileWorkspace([child, document, parent])
    const parentFirst = compileWorkspace([parent, child, document])

    expect(JSON.stringify(childFirst)).toBe(JSON.stringify(parentFirst))
    expect(childFirst.ok).toBe(true)
    if (childFirst.ok) {
      expect(
        childFirst.graph.claims.find(
          ({ id }) => id === 'team~kind',
        ),
      ).toMatchObject({
        object: {
          value: 'example/reliability@1.0#reliability-team',
        },
      })
    }
  })

  it('rejects an extension that broadens a parent endpoint constraint', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/broad.yaml',
        source: fixture('invalid/profile-broadens-parent.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM412',
          message:
            'Relationship kind "delegates" broadens its parent source aspects',
          path: 'profiles/broad.yaml',
          pointer: '/relationshipKinds/0/sourceAspects',
          line: 10,
          column: 20,
        },
      ],
    })
  })

  it('compiles controlled lifecycle status into claims', () => {
    const result = compileWorkspace([
      {
        path: 'lifecycle.yaml',
        source: fixture('valid/lifecycle-status.yaml'),
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.filter(({ id }) =>
          [
            'current-capability~status',
            'capability-supports-goal~status',
          ].includes(id),
        ),
      ).toEqual([
        {
          id: 'capability-supports-goal~status',
          subject: 'capability-supports-goal',
          predicate: 'yarramate/lifecycle/status',
          object: { value: 'planned' },
          origin: 'declared',
          source: {
            document: 'lifecycle',
            path: 'lifecycle.yaml',
            pointer: '/relationships/0/status',
            line: 17,
            column: 13,
          },
        },
        {
          id: 'current-capability~status',
          subject: 'current-capability',
          predicate: 'yarramate/lifecycle/status',
          object: { value: 'current' },
          origin: 'declared',
          source: {
            document: 'lifecycle',
            path: 'lifecycle.yaml',
            pointer: '/concepts/0/status',
            line: 8,
            column: 13,
          },
        },
      ])
    }
  })

  it('rejects lifecycle values outside the controlled vocabulary', () => {
    const result = compileWorkspace([
      {
        path: 'invalid-lifecycle.yaml',
        source: fixture('invalid/lifecycle-status.yaml'),
      },
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'YM201',
          message:
            'Document schema violation: must be equal to one of the allowed values: "planned", "current", "retired"',
          path: 'invalid-lifecycle.yaml',
          pointer: '/concepts/0/status',
          line: 8,
          column: 13,
        },
      ])
    }
  })

  it('rejects text that is present but says nothing', () => {
    const result = compileWorkspace([
      {
        path: 'blank-name.yaml',
        source: `format: yarramate/v1
id: blank
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: "   "
relationships: []
`,
      },
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'YM201',
          message: 'Document schema violation: must not be blank',
          path: 'blank-name.yaml',
          pointer: '/concepts/0/name',
          line: 7,
          column: 11,
        },
      ])
    }
  })

  it('reports malformed profile YAML through the parse taxonomy', () => {
    const result = compileWorkspace([
      {
        path: 'profiles/malformed.yaml',
        source: fixture('invalid/malformed-profile.yaml'),
      },
    ])

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM101',
          message:
            'Flow sequence in block collection must be sufficiently indented and end with a ]',
          path: 'profiles/malformed.yaml',
          pointer: '/',
          line: 6,
          column: 1,
        },
      ],
    })
  })

  it('reports duplicate profiles independently of source order', () => {
    const source = fixture('valid/platform-profile.yaml')
    const first = { path: 'z-profile.yaml', source }
    const second = { path: 'a-profile.yaml', source }

    const forward = compileWorkspace([first, second])
    const reverse = compileWorkspace([second, first])

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse))
    expect(forward).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM411',
          message: 'Profile "example/platform@1.0" is declared more than once',
          path: 'z-profile.yaml',
          pointer: '/id',
          line: 2,
          column: 5,
        },
      ],
    })
  })

  it('resolves yarramate/policy@0.1 without a workspace profile file', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'policy.yaml',
        source: `format: yarramate/v1
id: policy
profile: yarramate/policy@0.1
concepts:
  - id: oauth
    kind: authentication-constraint
    name: OAuth
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.profiles).toEqual([
      'yarramate/core@0.1',
      'yarramate/policy@0.1',
    ])
    expect(
      result.profileContext.conceptKindLineages.get(
        'yarramate/policy@0.1#authentication-constraint',
      ),
    ).toEqual([
      'yarramate/core@0.1#constraint',
      'yarramate/policy@0.1#authentication-constraint',
    ])
  })

  it('does not inject yarramate/policy@0.1 when no document selects it', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'minimal.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.profiles).toEqual(['yarramate/core@0.1'])
    expect(
      result.profileContext.conceptKindLineages.has(
        'yarramate/policy@0.1#authentication-constraint',
      ),
    ).toBe(false)
  })
})

// A diagnostic anchored at a subject now says which subject, derived once from
// the pointer it already carried rather than by asking every rule to remember.
// Absence is the signal that the diagnostic belongs somewhere other than the
// canvas, so it must stay absent for the document- and workspace-level ones.
describe('withDiagnosticSubjects', () => {
  const workspaceWith = (documentBody: string) => [
    {
      path: 'architecture/main.yaml',
      source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
${documentBody}`,
    },
  ]

  const diagnosticsOf = (sources: readonly { path: string; source: string }[]) => {
    const result = compileWorkspace(sources)
    if (result.ok) throw new Error('expected the workspace to be refused')
    return withDiagnosticSubjects(result.diagnostics, sources)
  }

  it('names the relationship a forbidden endpoint pairing was refused on', () => {
    const diagnostics = diagnosticsOf(
      workspaceWith(`concepts:
  - id: comp
    kind: applicationComponent
    name: A component
    status: current
  - id: aim
    kind: goal
    name: A goal
    status: current
relationships:
  - id: bad-edge
    kind: assignment
    from: comp
    to: aim
`),
    )
    const refusal = diagnostics.find((diagnostic) => diagnostic.code === 'YM404')
    expect(refusal?.pointer).toBe('/relationships/0/kind')
    expect(refusal?.subjects).toEqual(['bad-edge'])
  })

  it('names the concept an unknown kind was refused on', () => {
    const diagnostics = diagnosticsOf(
      workspaceWith(`concepts:
  - id: fine
    kind: applicationComponent
    name: Fine
    status: current
  - id: mystery
    kind: notAKindAtAll
    name: Unknown kind
    status: current
relationships: []
`),
    )
    const refusal = diagnostics.find((diagnostic) => diagnostic.code === 'YM401')
    expect(refusal?.pointer).toBe('/concepts/1/kind')
    expect(refusal?.subjects).toEqual(['mystery'])
  })

  it('leaves a whole-document refusal without subjects', () => {
    const diagnostics = diagnosticsOf([
      { path: 'architecture/main.yaml', source: 'format: yarramate/v1\nid: main\n' },
    ])
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.subjects).toBeUndefined()
    }
  })

  it('resolves the index against the document the diagnostic points into', () => {
    // Two documents, each with its own `/concepts/0`: the subject must come
    // from the one the diagnostic names, not from whichever parsed first.
    const diagnostics = diagnosticsOf([
      {
        path: 'architecture/alpha.yaml',
        source: `format: yarramate/v1
id: alpha
profile: yarramate/core@0.1
concepts:
  - id: alpha-one
    kind: applicationComponent
    name: Alpha one
    status: current
relationships: []
`,
      },
      {
        path: 'architecture/beta.yaml',
        source: `format: yarramate/v1
id: beta
profile: yarramate/core@0.1
concepts:
  - id: beta-one
    kind: notAKindAtAll
    name: Beta one
    status: current
relationships: []
`,
      },
    ])
    const refusal = diagnostics.find((diagnostic) => diagnostic.code === 'YM401')
    expect(refusal?.path).toBe('architecture/beta.yaml')
    expect(refusal?.subjects).toEqual(['beta-one'])
  })
})

// Flattened identity (ADR 0099) is only safe because a collision is refused:
// without this, two documents declaring one id would silently merge two
// distinct subjects into one.
describe('workspace-wide subject id uniqueness', () => {
  const documentNamed = (id: string, subject: string) => ({
    path: `${id}.yaml`,
    source: `format: yarramate/v1
id: ${id}
profile: yarramate/core@0.1
concepts:
  - id: ${subject}
    kind: applicationComponent
    name: ${subject}
    status: current
relationships: []
`,
  })

  it('refuses one id declared by two documents, naming the first', () => {
    const result = compileWorkspace([
      documentNamed('alpha', 'shared-name'),
      documentNamed('beta', 'shared-name'),
    ])
    if (result.ok) throw new Error('expected the workspace to be refused')
    const refusal = result.diagnostics.find(({ code }) => code === 'YM314')
    expect(refusal?.path).toBe('beta.yaml')
    expect(refusal?.pointer).toBe('/concepts/0/id')
    expect(refusal?.message).toContain('already declared by "alpha.yaml"')
  })

  it('keeps a repeat inside one document as YM301', () => {
    const result = compileWorkspace([
      {
        path: 'solo.yaml',
        source: `format: yarramate/v1
id: solo
profile: yarramate/core@0.1
concepts:
  - id: twice
    kind: applicationComponent
    name: First
    status: current
  - id: twice
    kind: applicationComponent
    name: Second
    status: current
relationships: []
`,
      },
    ])
    if (result.ok) throw new Error('expected the workspace to be refused')
    expect(result.diagnostics.map(({ code }) => code)).toContain('YM301')
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('YM314')
  })

  it('accepts the same id in two workspaces compiled separately', () => {
    expect(compileWorkspace([documentNamed('alpha', 'shared-name')]).ok).toBe(true)
    expect(compileWorkspace([documentNamed('beta', 'shared-name')]).ok).toBe(true)
  })

  // A document whose own id repeats would collide on every subject it
  // declares, so the one fault worth acting on is reported alone.
  it('does not pile subject collisions onto a duplicate document id', () => {
    const source = documentNamed('same', 'thing').source
    const result = compileWorkspace([
      { path: 'first.yaml', source },
      { path: 'second.yaml', source },
    ])
    if (result.ok) throw new Error('expected the workspace to be refused')
    expect(result.diagnostics.map(({ code }) => code)).toContain('YM303')
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('YM314')
  })
})
