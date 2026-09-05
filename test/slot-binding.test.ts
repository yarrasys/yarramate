import { describe, expect, it } from 'vitest'
import { draftSlotBinding } from '../src/concept-drafting.js'
import type { CanvasGraph } from '../src/graph-projection.js'

// #473 phase 4 item 4.5 (ADR 0146): the Slots section becomes editable, and an
// empty slot is where a `missing-part` card is answered on the canvas.

const graph = {
  nodes: [
    { id: 'sys-api', name: 'System API', localId: 'sys-api', kindLabel: 'api' },
    { id: 'existing', name: 'Existing', localId: 'existing', kindLabel: 'dataObject' },
  ],
  edges: [],
} as unknown as CanvasGraph

const input = {
  instance: 'sys-api',
  slot: 'payload',
  document: 'architecture/main.yaml',
  admits: ['dataObject'],
}

describe('filling one slot of an instance that exists', () => {
  it('names only the slot being filled', () => {
    const ops = draftSlotBinding(graph, input, {
      mode: 'existing',
      subject: 'existing',
    })
    // Merge by slot (#448, ADR 0062): the slots it does not mention are left
    // alone, so answering one question cannot unbind another.
    expect(ops).toEqual([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'sys-api', parts: { payload: 'existing' } },
      },
    ])
  })

  it('mints a child and binds it, in that order', () => {
    const ops = draftSlotBinding(graph, input, {
      mode: 'new',
      name: 'Fresh payload',
      kind: 'dataObject',
    })
    expect(ops?.map((op) => op.op)).toEqual(['add-concept', 'update-concept'])
    expect(ops?.[0]).toMatchObject({
      concept: { id: 'fresh-payload', kind: 'dataObject' },
    })
    expect(ops?.[1]).toMatchObject({
      concept: { parts: { payload: 'fresh-payload' } },
    })
  })

  it('stages the same shape either way, so the model cannot tell them apart', () => {
    const fromPicker = draftSlotBinding(graph, input, {
      mode: 'existing',
      subject: 'existing',
    })
    const fromMint = draftSlotBinding(graph, input, {
      mode: 'new',
      name: 'Existing',
      kind: 'dataObject',
    })
    expect(fromPicker?.at(-1)?.op).toBe('update-concept')
    expect(fromMint?.at(-1)?.op).toBe('update-concept')
  })

  it('refuses a child whose kind the slot does not admit', () => {
    expect(
      draftSlotBinding(graph, input, {
        mode: 'new',
        name: 'Wrong',
        kind: 'businessActor',
      }),
    ).toBeNull()
  })

  it('refuses an empty choice, an empty name and no document', () => {
    expect(draftSlotBinding(graph, input, null)).toBeNull()
    expect(
      draftSlotBinding(graph, input, { mode: 'existing', subject: '' }),
    ).toBeNull()
    expect(
      draftSlotBinding(graph, input, { mode: 'new', name: ' ', kind: 'dataObject' }),
    ).toBeNull()
    expect(
      draftSlotBinding(graph, { ...input, document: '' }, {
        mode: 'existing',
        subject: 'existing',
      }),
    ).toBeNull()
  })

  it('honours ids the changeset already claims', () => {
    const ops = draftSlotBinding(
      graph,
      input,
      { mode: 'new', name: 'Fresh payload', kind: 'dataObject' },
      ['fresh-payload'],
    )
    expect((ops?.[0] as { concept: { id: string } }).concept.id).not.toBe(
      'fresh-payload',
    )
  })
})
