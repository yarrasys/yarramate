import { describe, expect, it } from 'vitest'
import { draftInstance, type SlotBinding } from '../src/concept-drafting.js'
import type { CanvasGraph } from '../src/graph-projection.js'

// #473 phase 4 item 4.4 (ADR 0146): dropping a pattern opens a form, and what
// the form stages is ONE changeset. Item 4.1 proved a child and the instance
// that binds it land in a single batch; this is the shape of that batch.

const node = (id: string, name: string) =>
  ({ id, name, localId: id, kind: 'k', kindLabel: 'k', coreKindLabel: 'k' }) as never

const graph = { nodes: [node('existing-thing', 'Existing thing')], edges: [] } as unknown as CanvasGraph

const PATTERN = {
  name: 'Check-in API',
  document: 'architecture/main.yaml',
  kind: 'api',
  slots: [
    { name: 'component', required: true, admits: ['applicationComponent'] },
    { name: 'payload', required: false, admits: ['dataObject', 'special-object'] },
  ],
}

const bind = (entries: Record<string, SlotBinding>) =>
  new Map(Object.entries(entries))

describe('what the form stages', () => {
  it('mints the children first and the instance last', () => {
    const ops = draftInstance(
      graph,
      PATTERN,
      bind({
        component: { mode: 'new', name: 'Check-in app', kind: 'applicationComponent' },
        payload: { mode: 'existing', subject: 'existing-thing' },
      }),
    )
    expect(ops?.map((op) => op.op)).toEqual(['add-concept', 'add-concept'])
    // The order a reader would write by hand, so the diff reads forwards.
    expect(ops?.[0]).toMatchObject({
      concept: { id: 'check-in-app', kind: 'applicationComponent' },
    })
    expect(ops?.[1]).toMatchObject({
      concept: {
        id: 'check-in-api',
        kind: 'api',
        parts: { component: 'check-in-app', payload: 'existing-thing' },
      },
    })
  })

  it('puts every minted child in the instance own document', () => {
    const ops = draftInstance(
      graph,
      { ...PATTERN, document: 'architecture/apis.yaml' },
      bind({
        component: { mode: 'new', name: 'App', kind: 'applicationComponent' },
      }),
    )
    // A part authored somewhere else is a part the reader has to go looking for.
    expect(ops?.every((op) => 'document' in op && op.document === 'architecture/apis.yaml')).toBe(true)
  })

  it('refuses when a required slot is left empty', () => {
    // Refused HERE rather than staged and refused by the compiler: a changeset
    // that cannot land is worse than a form that will not submit.
    expect(draftInstance(graph, PATTERN, bind({ payload: null }))).toBeNull()
  })

  it('stages an optional slot left empty, binding nothing', () => {
    const ops = draftInstance(
      graph,
      PATTERN,
      bind({
        component: { mode: 'existing', subject: 'existing-thing' },
        payload: null,
      }),
    )
    expect(ops?.[0]).toMatchObject({
      concept: { parts: { component: 'existing-thing' } },
    })
    expect(
      (ops?.[0] as { concept: { parts: Record<string, string> } }).concept.parts,
    ).not.toHaveProperty('payload')
  })

  it('omits parts entirely when nothing is bound', () => {
    const ops = draftInstance(
      graph,
      { ...PATTERN, slots: [{ name: 'payload', required: false, admits: ['dataObject'] }] },
      bind({}),
    )
    // An empty `parts` claims the instance binds nothing. Absent says the
    // question has not been answered, which is what the interview asks about.
    expect(ops?.[0]).not.toHaveProperty('concept.parts')
  })

  it('refuses a child whose kind the slot does not admit', () => {
    expect(
      draftInstance(
        graph,
        PATTERN,
        bind({
          component: { mode: 'new', name: 'Wrong', kind: 'businessActor' },
        }),
      ),
    ).toBeNull()
  })

  it('reserves each minted id, so two children do not collide', () => {
    const ops = draftInstance(
      graph,
      {
        ...PATTERN,
        slots: [
          { name: 'component', required: true, admits: ['applicationComponent'] },
          { name: 'payload', required: false, admits: ['applicationComponent'] },
        ],
      },
      bind({
        component: { mode: 'new', name: 'Same name', kind: 'applicationComponent' },
        payload: { mode: 'new', name: 'Same name', kind: 'applicationComponent' },
      }),
    )
    const ids = ops?.slice(0, 2).map((op) => (op as { concept: { id: string } }).concept.id)
    // #315: without reserving as it goes, the second slugs to the same id and
    // replace-by-target staging swallows the first without a word.
    expect(new Set(ids).size).toBe(2)
  })

  it('honours ids the changeset already claims', () => {
    const ops = draftInstance(graph, PATTERN, bind({
      component: { mode: 'existing', subject: 'existing-thing' },
    }), ['check-in-api'])
    expect((ops?.[0] as { concept: { id: string } }).concept.id).not.toBe('check-in-api')
  })

  it('refuses a nameless instance, a nameless child and no document', () => {
    expect(draftInstance(graph, { ...PATTERN, name: '  ' }, bind({
      component: { mode: 'existing', subject: 'existing-thing' },
    }))).toBeNull()
    expect(draftInstance(graph, { ...PATTERN, document: '' }, bind({
      component: { mode: 'existing', subject: 'existing-thing' },
    }))).toBeNull()
    expect(draftInstance(graph, PATTERN, bind({
      component: { mode: 'new', name: '   ', kind: 'applicationComponent' },
    }))).toBeNull()
  })
})
