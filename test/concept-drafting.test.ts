import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { draftConcept, proposeConceptId } from '../src/concept-drafting.js'
import { applyOperations } from '../src/apply-command.js'
import type { CanvasGraph } from '../src/graph-projection.js'

const DOCUMENT = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: orders
    kind: applicationComponent
    name: Orders
relationships: []
`

const KINDS = ['applicationComponent', 'applicationService', 'businessActor']

const graphOf = (source: string): CanvasGraph => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return projectGraphForCanvas(result.graph, result.profileContext)
}

const graph = graphOf(DOCUMENT)

const apply = (operations: readonly unknown[]) =>
  applyOperations({
    workspace: {
      id: 'drafting',
      documents: ['architecture/main.yaml'],
      profiles: [],
      projections: [],
      adapterMappings: [],
      evidence: [],
      contracts: [],
    },
    sources: [{ path: 'architecture/main.yaml', source: DOCUMENT }],
    operations: {
      path: 'changeset.yaml',
      source: stringify({
        format: 'yarramate/operations/v1',
        operations,
      }),
    },
    manifestDirectory: '.yarramate',
  })

describe('proposeConceptId', () => {
  it('transliterates a name into an id a human can read in a diff', () => {
    expect(proposeConceptId(graph, 'Order Intake')).toBe('order-intake')
    expect(proposeConceptId(graph, 'Order Intake (v2)')).toBe('order-intake-v2')
    expect(proposeConceptId(graph, '  Spaced   Out  ')).toBe('spaced-out')
  })

  it('steps past an id already taken', () => {
    expect(proposeConceptId(graph, 'Orders')).toBe('orders-2')
  })

  it('drops the marks an accent decomposes into rather than hyphenating them', () => {
    // Asserting the pattern alone let this through as "u-ni-code-name".
    expect(proposeConceptId(graph, 'Ünïcodé Name')).toBe('unicode-name')
  })

  it('refuses a name it cannot make an id of, rather than inventing one', () => {
    // A placeholder id nothing could be traced back from is worse than asking
    // the reviewer for a different name.
    expect(proposeConceptId(graph, '???')).toBeNull()
    expect(proposeConceptId(graph, '   ')).toBeNull()
    expect(proposeConceptId(graph, '\u65e5\u672c\u8a9e')).toBeNull()
  })

  it('refuses a leading digit rather than silently dropping it', () => {
    // "2FA Gateway" -> "fa-gateway" would be an id that no longer names the
    // thing. An id must start with a letter, so this is a name it cannot be
    // made of, and the caller is told rather than handed a mangled one.
    expect(proposeConceptId(graph, '2FA Gateway')).toBeNull()
    expect(proposeConceptId(graph, '123')).toBeNull()
  })

  it('always produces something the document schema accepts', () => {
    const pattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
    for (const name of [
      'Orders',
      'Order Intake (v2)',
      'ACME  Billing',
      'a',
      'trailing---hyphens---',
    ]) {
      const id = proposeConceptId(graph, name)
      if (id === null) continue
      expect(id, name).toMatch(pattern)
    }
  })
})

describe('draftConcept', () => {
  it('takes the short name a document uses, not the wire identity', () => {
    // The other half of the bug in `subject-draft-panel.test.ts`. A model
    // frame carries `{ id: 'yarramate/core@0.1#applicationComponent', label:
    // 'applicationComponent' }`. A document names the kind the short way, and
    // `apply` refuses the identity as `YM401 Unknown concept kind`, so the
    // form must offer labels. This pins which of the two is the valid one.
    const identity = 'yarramate/core@0.1#applicationComponent'

    expect(
      draftConcept(
        graph,
        { name: 'Thing', kind: identity, document: 'architecture/main.yaml' },
        [identity],
      ),
    ).toMatchObject({ concept: { kind: identity } })

    const viaIdentity = apply([
      {
        op: 'add-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'thing', kind: identity, name: 'Thing' },
      },
    ])
    expect(viaIdentity.ok).toBe(false)
    if (!viaIdentity.ok) {
      expect(viaIdentity.diagnostics.map((d) => d.code)).toContain('YM401')
    }

    const viaLabel = apply([
      {
        op: 'add-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'thing', kind: 'applicationComponent', name: 'Thing' },
      },
    ])
    expect(viaLabel.ok).toBe(true)
  })

  it('refuses a kind outside the workspace vocabulary', () => {
    expect(
      draftConcept(graph, { name: 'Thing', kind: 'invented', document: 'architecture/main.yaml' }, KINDS),
    ).toBeNull()
  })

  it('refuses a draft with nothing to name it or nowhere to put it', () => {
    expect(
      draftConcept(graph, { name: '', kind: 'applicationComponent', document: 'architecture/main.yaml' }, KINDS),
    ).toBeNull()
    expect(
      draftConcept(graph, { name: 'Thing', kind: 'applicationComponent', document: '' }, KINDS),
    ).toBeNull()
  })

  /**
   * The property, driven through: whatever the form produces is applied and
   * compiled, so anything the editor could land already has a passing `check`
   * behind it. No filesystem, because Core is pure since ADR 0100.
   */
  it('produces a concept that applies and compiles, for every kind offered', () => {
    let drafted = 0
    for (const kind of KINDS) {
      const operation = draftConcept(
        graph,
        { name: `New ${kind}`, kind, document: 'architecture/main.yaml' },
        KINDS,
      )
      expect(operation, kind).not.toBeNull()
      if (operation === null) continue
      drafted += 1

      const outcome = applyOperations({
        workspace: {
          id: 'drafting',
          documents: ['architecture/main.yaml'],
          profiles: [],
          projections: [],
          adapterMappings: [],
          evidence: [],
          contracts: [],
        },
        sources: [{ path: 'architecture/main.yaml', source: DOCUMENT }],
        operations: {
          path: 'changeset.yaml',
          source: stringify({
            format: 'yarramate/operations/v1',
            operations: [operation],
          }),
        },
        manifestDirectory: '.yarramate',
      })

      expect(
        outcome.ok ? [] : outcome.diagnostics.map((d) => d.code),
        `${kind} did not apply`,
      ).toEqual([])
    }
    expect(drafted).toBe(KINDS.length)
  })

  it('lands a subject the connection tool can then reach', () => {
    // The two halves meet: a subject made here is an endpoint there.
    const operation = draftConcept(
      graph,
      { name: 'Billing', kind: 'applicationComponent', document: 'architecture/main.yaml' },
      KINDS,
    )
    expect(operation).not.toBeNull()
    if (operation === null) return

    const outcome = applyOperations({
      workspace: {
        id: 'drafting',
        documents: ['architecture/main.yaml'],
        profiles: [],
        projections: [],
        adapterMappings: [],
        evidence: [],
        contracts: [],
      },
      sources: [{ path: 'architecture/main.yaml', source: DOCUMENT }],
      operations: {
        path: 'changeset.yaml',
        source: stringify({
          format: 'yarramate/operations/v1',
          operations: [operation],
        }),
      },
      manifestDirectory: '.yarramate',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const after = graphOf(outcome.sources[0]!.source)
    expect(after.nodes.map((node) => node.id)).toContain('billing')
  })
})
