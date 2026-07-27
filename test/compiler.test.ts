import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'

const fixture = (path: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)),
    'utf8',
  )

describe('compileWorkspace', () => {
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
        format: 'yarramate/graph/v1',
        profiles: ['yarramate/core@0.1'],
        documents: [{ id: 'checkout', source: 'architecture/checkout.yaml' }],
        subjects: [
          { id: 'checkout#api-realizes-approval', type: 'relationship' },
          { id: 'checkout#approval-api', type: 'concept' },
          { id: 'checkout#approve-order', type: 'concept' },
        ],
        claims: [
          {
            id: 'checkout#api-realizes-approval',
            subject: 'checkout#approval-api',
            predicate: 'yarramate/relationship/realization',
            object: { ref: 'checkout#approve-order' },
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
            id: 'checkout#approval-api~kind',
            subject: 'checkout#approval-api',
            predicate: 'yarramate/concept/kind',
            object: { value: 'applicationService' },
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
            id: 'checkout#approval-api~name',
            subject: 'checkout#approval-api',
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
            id: 'checkout#approve-order~kind',
            subject: 'checkout#approve-order',
            predicate: 'yarramate/concept/kind',
            object: { value: 'capability' },
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
            id: 'checkout#approve-order~name',
            subject: 'checkout#approve-order',
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
          message: 'Duplicate local ID "shared"',
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
          ['described#goal~description', 'described#realizes~name'].includes(id),
        ),
      ).toEqual([
        {
          id: 'described#goal~description',
          subject: 'described#goal',
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
          id: 'described#realizes~name',
          subject: 'described#realizes',
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
            'Relationship "assignment" requires a source with aspect "active-structure"; "intent" has aspect "motivation"',
          path: 'incompatible.yaml',
          pointer: '/relationships/0/from',
          line: 14,
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
            'Relationship "access" requires a target with aspect "passive-structure"; "intent" has aspect "motivation"',
          path: 'incompatible-target.yaml',
          pointer: '/relationships/0/to',
          line: 15,
          column: 9,
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
            'controlled#reads-orders~mode',
            'controlled#sends-orders~content',
          ].includes(id),
        ),
      ).toEqual([
        {
          id: 'controlled#reads-orders~mode',
          subject: 'controlled#reads-orders',
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
          id: 'controlled#sends-orders~content',
          subject: 'controlled#sends-orders',
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
})
