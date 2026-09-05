import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../src/graph-projection.js'
import type { ProjectionExclusion } from '../src/projection.js'
import type { VisualViewSummary } from '../src/adapters/visual/protocol-contract.js'
import {
  BOTTOM_PANEL_TABS,
  EXCLUSION_PREVIEW,
  QueryPanel,
  documentChanged,
  exclusionGroups,
  matchedSubjectCount,
  pulledBackIn,
  sameQuery,
  stagedViewEdit,
  viewDocument,
} from '../src/visual-app/query-panel.js'

const node = (id: string, name: string): CanvasNode => ({
  id,
  localId: id,
  document: 'architecture/main.yaml',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  coreKindLabel: 'applicationComponent',
  portKinds: [],
  layer: 'application',
  aspect: 'active-structure',
  name,
  description: null,
  aka: [],
  status: null,
  owner: null,
  folder: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
})

const nodes = [
  node('checkout', 'Checkout'),
  node('ledger', 'Ledger'),
  node('billing', 'Billing'),
]

const view: VisualViewSummary = {
  id: 'v1',
  title: 'View One',
  description: 'The first view',
  query: { layers: ['application'] },
  presentation: { layout: 'layered', direction: 'left-right' },
  path: '.yarramate/projections/v1.yaml',
  subjectCount: 2,
}

const badges = {
  showLifecycle: true,
  showEvidence: true,
  showOwnership: false,
  showConstraints: false,
} as const

const documentInput = {
  view,
  query: { layers: ['application'] },
  badges,
  // What the view opened with, so an untouched badge is not written into a
  // document that never declared it.
  opened: badges,
} as const

describe('sameQuery', () => {
  it('reads two queries with the same fields in a different order as the same', () => {
    // The seed comes off a YAML document and the form composes its own key
    // order, so key-order equality would report every view's own query as an
    // unapplied edit the moment the panel opened.
    expect(
      sameQuery(
        { layers: ['application'], subjects: ['checkout'] },
        { subjects: ['checkout'], layers: ['application'] },
      ),
    ).toBe(true)
  })

  it('tells two different queries apart', () => {
    expect(sameQuery({ layers: ['application'] }, { layers: ['business'] })).toBe(
      false,
    )
    expect(sameQuery({}, { layers: ['application'] })).toBe(false)
  })
})

describe('matchedSubjectCount', () => {
  it('counts subjects, never the relationships the match set also names', () => {
    // The count beside a query is the number of boxes the reviewer can see. A
    // match set holds concepts and relationships together, so counting it
    // whole reports five for three components with two relationships.
    expect(
      matchedSubjectCount(nodes, ['checkout', 'ledger', 'checkout-serves-ledger']),
    ).toBe(2)
  })

  it('counts the whole model when no filter is standing', () => {
    expect(matchedSubjectCount(nodes, null)).toBe(3)
  })
})

describe('exclusionGroups', () => {
  const excluded: readonly ProjectionExclusion[] = [
    { id: 'ledger', facet: 'layers' },
    { id: 'billing', facet: 'subjects' },
  ]

  it('groups what the canvas is not drawing under the facet that dropped it', () => {
    const groups = exclusionGroups(nodes, ['checkout'], excluded)

    expect(groups).toEqual([
      { reason: 'subjects', label: 'Subjects', subjects: [{ id: 'billing', title: 'Billing' }] },
      { reason: 'layers', label: 'Layers', subjects: [{ id: 'ledger', title: 'Ledger' }] },
    ])
  })

  it('orders the groups the way the query applies its facets', () => {
    // "The first reason" is the one a reader would reach first themselves, so
    // the groups arrive in the order `explainProjection` checks them.
    const groups = exclusionGroups(nodes, [], [
      { id: 'checkout', facet: 'constraints' },
      { id: 'ledger', facet: 'states' },
      { id: 'billing', facet: 'kinds' },
    ])

    expect(groups.map(({ reason }) => reason)).toEqual([
      'states',
      'kinds',
      'constraints',
    ])
  })

  it('takes the SET from what the canvas draws, so the list cannot disagree with it', () => {
    // `ledger` was dropped by a facet and drawn anyway, which is what
    // `relationships: connected` does. The list describes the diagram.
    const groups = exclusionGroups(nodes, ['checkout', 'ledger'], excluded)

    expect(groups).toEqual([
      { reason: 'subjects', label: 'Subjects', subjects: [{ id: 'billing', title: 'Billing' }] },
    ])
  })

  it('names the isolated-concepts rule for a subject no facet reports', () => {
    // The facets are not the only thing that removes a concept:
    // `isolatedConcepts: exclude` runs after them and reports nothing.
    expect(exclusionGroups(nodes, ['checkout', 'ledger'], [])).toEqual([
      {
        reason: 'isolatedConcepts',
        label: 'Isolated concepts',
        subjects: [{ id: 'billing', title: 'Billing' }],
      },
    ])
  })

  it('says nothing rather than inventing a reason when none was reported', () => {
    // A chat filter's answer carries no exclusions at all.
    expect(exclusionGroups(nodes, ['checkout'], null)).toEqual([
      {
        reason: 'unreported',
        label: 'Not reported',
        subjects: [
          { id: 'ledger', title: 'Ledger' },
          { id: 'billing', title: 'Billing' },
        ],
      },
    ])
  })

  it('has nothing to report when no filter is standing', () => {
    expect(exclusionGroups(nodes, null, null)).toEqual([])
  })
})

describe('pulledBackIn', () => {
  it('counts the subjects a facet dropped that the canvas draws anyway', () => {
    expect(
      pulledBackIn(['checkout', 'ledger'], [{ id: 'ledger', facet: 'layers' }]),
    ).toBe(1)
  })

  it('counts none where nothing was reported', () => {
    expect(pulledBackIn(['checkout'], null)).toBe(0)
    expect(pulledBackIn(null, [{ id: 'ledger', facet: 'layers' }])).toBe(0)
  })
})

describe('viewDocument', () => {
  it('carries every presentation field the view already declared', () => {
    // The canvas has no direction control, so a document composed without one
    // would silently drop what the view declared and the reviewer never saw.
    expect(viewDocument(documentInput).presentation).toMatchObject({
      direction: 'left-right',
      layout: 'layered',
      title: 'View One',
      description: 'The first view',
    })
  })

  it('writes no badge the view never declared and the reviewer never moved', () => {
    // Not one projection in this repository declares `showOwnership`, so a
    // document that wrote all three would add fields the author never wrote
    // every time a query was staged.
    expect(viewDocument(documentInput).presentation).not.toHaveProperty(
      'showOwnership',
    )
    expect(viewDocument(documentInput).presentation).not.toHaveProperty(
      'showLifecycle',
    )
  })

  it('writes a badge the reviewer moved', () => {
    expect(
      viewDocument({
        ...documentInput,
        badges: { ...badges, showOwnership: true },
      }).presentation,
    ).toMatchObject({ showOwnership: true })
  })

  it('keeps writing a badge the view already declares', () => {
    expect(
      viewDocument({
        ...documentInput,
        view: {
          ...view,
          presentation: { layout: 'layered', showLifecycle: true },
        },
      }).presentation,
    ).toMatchObject({ showLifecycle: true })
  })

  it('writes the edited query, keeping the view id and its document', () => {
    const operation = stagedViewEdit({
      ...documentInput,
      query: { layers: ['business'] },
    })

    expect(operation).toEqual({
      op: 'write-view',
      path: '.yarramate/projections/v1.yaml',
      projection: expect.objectContaining({
        id: 'v1',
        query: { layers: ['business'] },
      }),
    })
  })
})

describe('documentChanged', () => {
  it('is false where the fields still say what the view already says', () => {
    expect(documentChanged(documentInput)).toBe(false)
  })

  it('is false where the view states its query in a different key order', () => {
    // A query read off a YAML document holds its fields in the order the
    // author wrote them; the form composes its own. Comparing the documents as
    // text would report every view as edited the moment it was opened.
    expect(
      documentChanged({
        ...documentInput,
        query: { layers: ['application'], subjects: ['checkout'] },
        view: {
          ...view,
          query: { subjects: ['checkout'], layers: ['application'] },
        },
      }),
    ).toBe(false)
  })

  it('is true for an edited query', () => {
    expect(
      documentChanged({ ...documentInput, query: { layers: ['business'] } }),
    ).toBe(true)
  })

  it('is true for a presentation change alone', () => {
    // Staging is about the document, not the query: a badge the reviewer
    // turned off is a change to what the view declares.
    expect(
      documentChanged({
        ...documentInput,
        badges: { ...badges, showOwnership: true },
      }),
    ).toBe(true)
  })
})

describe('QueryPanel', () => {
  const render = (
    overrides: Partial<Parameters<typeof QueryPanel>[0]> = {},
  ): string =>
    renderToStaticMarkup(
      createElement(QueryPanel, {
        nodes,
        activeFilter: {
          query: { layers: ['application'] },
          matchedIds: ['checkout'],
          excluded: [
            { id: 'ledger', facet: 'layers' },
            { id: 'billing', facet: 'layers' },
          ],
          source: 'editor',
        },
        view,
        open: true,
        tab: 'view-query',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
        showConstraints: false,
        showNudges: true,
        onTogglePresentation: vi.fn(),
        onToggleOpen: vi.fn(),
        onSelectTab: vi.fn(),
        onApply: vi.fn(),
        onStage: vi.fn(),
        ...overrides,
      }),
    )

  it('is collapsed at rest, and still says what the query matched', () => {
    const markup = render({ open: false })

    expect(markup).not.toContain('role="tabpanel"')
    expect(markup).toContain('aria-expanded="false"')
    // The count survives the collapse: the panel is shut, not silent.
    expect(markup).toContain('1 subject')
    expect(markup).toContain('2 excluded')
  })

  it('names its tabs so a second one can land beside the first', () => {
    expect(BOTTOM_PANEL_TABS.map(({ id }) => id)).toEqual(['view-query'])
    const markup = render()

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('id="bottom-tab-view-query"')
    expect(markup).toContain('aria-selected="true"')
  })

  it('shows the facets, the count, the excluded list and the document together', () => {
    const markup = render()

    // The facets, reused rather than restated.
    expect(markup).toContain('id="filter-layers"')
    expect(markup).toContain('id="filter-isolated-concepts"')
    // The count, against the checked model.
    expect(markup).toContain('<strong>1</strong>')
    expect(markup).toContain('of 3')
    // The excluded, and why.
    expect(markup).toContain('Layers')
    expect(markup).toContain('Ledger')
    expect(markup).toContain('Billing')
    // The document, as the query resolves to it.
    expect(markup).toContain('id: v1')
    expect(markup).toContain('layers:')
    expect(markup).toContain('Stage view change')
  })

  it('says so when a query selects nothing, before it is staged', () => {
    const markup = render({
      activeFilter: {
        query: { layers: ['nothing'] },
        matchedIds: [],
        excluded: nodes.map(({ id }) => ({ id, facet: 'layers' as const })),
        source: 'editor',
      },
    })

    expect(markup).toContain('This query selects nothing')
  })

  it('offers no document to stage where no view is active', () => {
    const markup = render({ view: null })

    expect(markup).not.toContain('Stage view change')
    expect(markup).toContain('No view is active')
  })

  it('counts the rest rather than listing an exclusion group without end', () => {
    const many = Array.from({ length: EXCLUSION_PREVIEW + 5 }, (_, index) =>
      node(`subject-${index}`, `Subject ${index}`),
    )
    const markup = render({
      nodes: many,
      activeFilter: {
        query: { layers: ['application'] },
        matchedIds: [],
        excluded: many.map(({ id }) => ({ id, facet: 'layers' as const })),
        source: 'editor',
      },
    })

    expect(markup).toContain('and 5 more')
  })
})
