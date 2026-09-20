import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConnectionPanel } from '../src/visual-app/connection-panel.js'
import { relationshipKindOffer } from '../src/visual-app/relationship-kind-options.js'
import type { CanvasGraph } from '../src/graph-projection.js'

// The two palette surfaces of #571 (ADR 0162). The connection panel leads with
// the kind practice expects and names it; the offer that feeds the properties
// form carries it for marking. Neither removes a kind: a convention is not a
// rule, and the other kinds the table permits stay one click away.

const node = (id: string, coreKindLabel: string) =>
  ({
    id,
    localId: id,
    document: 'main.yaml',
    kind: `yarramate/core@0.1#${coreKindLabel}`,
    kindLabel: coreKindLabel,
    coreKindLabel,
    portKinds: [],
    layer: null,
    aspect: null,
    name: id,
    description: null,
    aka: [],
    status: null,
    owner: null,
    folder: null,
    distinctFrom: [],
    supersedes: [],
    constraints: [],
    references: [],
    attestations: [],
    openQuestions: 0,
  }) as unknown as CanvasGraph['nodes'][number]

const graph = {
  nodes: [
    node('gateway', 'applicationComponent'),
    node('routing', 'applicationFunction'),
    node('catalogue', 'dataObject'),
    // `serving` sorts last of the four kinds the table permits from a service
    // to an actor, so the ordering assertions below say something: alphabetical
    // order and convention order disagree here, which they do not for a
    // component and a function.
    node('lookup', 'applicationService'),
    node('teller', 'businessActor'),
  ],
  edges: [],
} as unknown as CanvasGraph

const vocabulary = [
  'assignment',
  'realization',
  'serving',
  'flow',
  'triggering',
  'association',
  'access',
  'composition',
].map((label) => ({
  label,
  coreLabel: label,
  kind: `yarramate/core@0.1#${label}`,
})) as never

const panel = (from: string, to: string): string =>
  renderToStaticMarkup(
    createElement(ConnectionPanel, {
      draft: { from, to },
      graph,
      reservedIds: [],
      onTarget: () => {},
      onStage: () => {},
      onCancel: () => {},
    } as never),
  )

describe('the palette carries the convention (#571)', () => {
  it('leads with the usual kind and names it, without removing the others', () => {
    // The table permits association, flow, serving and triggering from a
    // service to an actor, and `serving` sorts LAST of the four. Leading with
    // it is therefore visible: without the convention the panel would open
    // with `association`.
    const markup = panel('lookup', 'teller')
    expect(markup).toContain('connection-usual')
    expect(markup).toContain('usually')
    expect(markup.indexOf('serving')).toBeLessThan(markup.indexOf('association'))
    expect(markup.indexOf('serving')).toBeLessThan(markup.indexOf('flow'))
    // Marking is not filtering: every kind the table permits is still offered.
    for (const kind of ['association', 'flow', 'triggering']) {
      expect(markup, kind).toContain(kind)
    }
  })

  it('also leads for the pair that started the issue', () => {
    const markup = panel('gateway', 'routing')
    expect(markup).toContain('usually')
    expect(markup.indexOf('assignment')).toBeLessThan(markup.indexOf('realization'))
    expect(markup).toContain('serving')
  })

  it('says nothing where the language permits several readings', () => {
    // Two application functions relate by composition, triggering, flow or
    // serving depending on what the author means. No marker, same options.
    const markup = panel('routing', 'routing')
    expect(markup).not.toContain('connection-usual')
    expect(markup).toContain('composition')
  })

  it('carries the convention to the properties form for marking, not sorting', () => {
    const offer = relationshipKindOffer(
      graph,
      { from: 'gateway', to: 'routing' },
      vocabulary,
      'association',
    )
    expect(offer.conventional?.kind).toBe('assignment')
    expect(offer.conventional?.rule).toBe('active-structure-performs-behaviour')
    expect(offer.conventional?.because).toContain('assigned')
    // Vocabulary order is kept: reordering a list someone is reading is worse
    // than annotating it.
    const servingOffer = relationshipKindOffer(
      graph,
      { from: 'lookup', to: 'teller' },
      vocabulary,
      'association',
    )
    expect(servingOffer.conventional?.kind).toBe('serving')
    // Vocabulary order, untouched. Stated as the invariant rather than as one
    // pair's indices: the options are the vocabulary filtered, in the order it
    // was given, and the convention rides alongside without moving anything.
    const vocabularyOrder = (vocabulary as unknown as { label: string }[]).map(
      ({ label }) => label,
    )
    const labels = servingOffer.options.map((option) => option.label)
    expect(labels).toEqual(vocabularyOrder.filter((label) => labels.includes(label)))
    expect(labels).toContain('serving')
    expect(labels).toContain('association')
  })

  it('names access for behaviour touching data, and nothing for an unknown pair', () => {
    expect(
      relationshipKindOffer(graph, { from: 'routing', to: 'catalogue' }, vocabulary, 'access')
        .conventional?.kind,
    ).toBe('access')
    expect(
      relationshipKindOffer(graph, { from: 'nowhere', to: 'routing' }, vocabulary, 'association')
        .conventional,
    ).toBeNull()
  })
})
