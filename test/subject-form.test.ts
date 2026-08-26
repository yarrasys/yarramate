import { describe, expect, it } from 'vitest'
import type { CanvasEdge, CanvasNode } from '../src/graph-projection.js'
import {
  overlayConceptFields,
  overlayRelationshipFields,
  stageConceptListChange,
  stageConceptScalarChange,
  stageRelationshipScalarChange,
} from '../src/visual-app/subject-form.js'

// Coverage for the pure operation-construction and overlay functions the
// editable inspector forms stage through. No DOM: these are the same
// functions a `<select>`/`<input>` `onBlur` handler calls, exercised
// directly against the authoring rules `src/apply-command.ts` enforces.

const node: CanvasNode = {
  id: 'yarramate/checkout-service',
  localId: 'checkout-service',
  document: 'main.yaml',
  kind: 'yarramate/concept/application',
  kindLabel: 'Application',
  coreKindLabel: 'Application',
  portKinds: [],
  layer: null,
  aspect: null,
  name: 'Checkout Service',
  description: 'Handles checkout.',
  aka: ['Checkout'],
  status: 'current',
  owner: 'payments-team',
  folder: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
}

const edge: CanvasEdge = {
  id: 'yarramate/checkout-service.dependency->api',
  localId: 'checkout-service.dependency->api',
  document: 'main.yaml',
  kind: 'yarramate/relationship/dependency',
  kindLabel: 'Dependency',
  coreKindLabel: 'Dependency',
  from: 'yarramate/checkout-service',
  to: 'yarramate/api',
  name: null,
  description: null,
  mode: 'read',
  content: null,
  status: 'current',
  references: [],
  presentIn: [],
}

describe('stageConceptScalarChange', () => {
  it('renaming a concept produces one update-concept with name only', () => {
    const ops = stageConceptScalarChange(node.document, node.localId, 'name', node.name, 'Checkout API')
    expect(ops).toEqual([
      { op: 'update-concept', document: node.document, concept: { id: node.localId, name: 'Checkout API' } },
    ])
  })

  it('clearing owner produces remove:[owner]', () => {
    const ops = stageConceptScalarChange(node.document, node.localId, 'owner', node.owner, '')
    expect(ops).toEqual([
      { op: 'update-concept', document: node.document, concept: { id: node.localId }, remove: ['owner'] },
    ])
  })

  it('emits nothing when the value is unchanged', () => {
    expect(stageConceptScalarChange(node.document, node.localId, 'name', node.name, node.name)).toEqual([])
  })

  it('never retracts a field that is already empty', () => {
    expect(stageConceptScalarChange(node.document, node.localId, 'owner', null, '')).toEqual([])
  })
})

describe('stageConceptListChange (aka)', () => {
  it('appending an aka produces a single op carrying only the new entry', () => {
    const ops = stageConceptListChange(node.document, node.localId, 'aka', node.aka, ['Checkout', 'Checkout Svc'])
    expect(ops).toEqual([
      { op: 'update-concept', document: node.document, concept: { id: node.localId, aka: ['Checkout Svc'] } },
    ])
  })

  it('deleting one of two aka entries produces the retract-then-set pair in order', () => {
    const previous = ['Checkout', 'Checkout Svc']
    const ops = stageConceptListChange(node.document, node.localId, 'aka', previous, ['Checkout Svc'])
    expect(ops).toEqual([
      { op: 'update-concept', document: node.document, concept: { id: node.localId }, remove: ['aka'] },
      { op: 'update-concept', document: node.document, concept: { id: node.localId, aka: ['Checkout Svc'] } },
    ])
  })

  it('deleting the only aka entry produces the retraction alone', () => {
    const ops = stageConceptListChange(node.document, node.localId, 'aka', node.aka, [])
    expect(ops).toEqual([
      { op: 'update-concept', document: node.document, concept: { id: node.localId }, remove: ['aka'] },
    ])
  })

  it('emits nothing when the list is unchanged', () => {
    expect(stageConceptListChange(node.document, node.localId, 'aka', node.aka, [...node.aka])).toEqual([])
  })
})

describe('stageRelationshipScalarChange', () => {
  it("changing an edge's to produces update-relationship with to", () => {
    const ops = stageRelationshipScalarChange(edge.document, edge.localId, 'to', edge.to, 'yarramate/gateway')
    expect(ops).toEqual([
      {
        op: 'update-relationship',
        document: edge.document,
        relationship: { id: edge.localId, to: 'yarramate/gateway' },
      },
    ])
  })
})

describe('overlayConceptFields', () => {
  it('reflects a staged rename', () => {
    const ops = stageConceptScalarChange(node.document, node.localId, 'name', node.name, 'Checkout API')
    expect(overlayConceptFields(node, ops).name).toBe('Checkout API')
  })

  it('reflects a staged owner removal', () => {
    const ops = stageConceptScalarChange(node.document, node.localId, 'owner', node.owner, '')
    expect(overlayConceptFields(node, ops).owner).toBeNull()
  })

  it('reflects a staged aka append', () => {
    const ops = stageConceptListChange(node.document, node.localId, 'aka', node.aka, ['Checkout', 'Checkout Svc'])
    expect(overlayConceptFields(node, ops).aka).toEqual(['Checkout', 'Checkout Svc'])
  })

  it('reflects a staged aka retract-then-set pair', () => {
    const previous = ['Checkout', 'Checkout Svc']
    const withTwo: CanvasNode = { ...node, aka: previous }
    const ops = stageConceptListChange(withTwo.document, withTwo.localId, 'aka', previous, ['Checkout Svc'])
    expect(overlayConceptFields(withTwo, ops).aka).toEqual(['Checkout Svc'])
  })

  it('reflects a staged aka full retraction', () => {
    const ops = stageConceptListChange(node.document, node.localId, 'aka', node.aka, [])
    expect(overlayConceptFields(node, ops).aka).toEqual([])
  })

  it('ignores operations targeting a different subject', () => {
    const ops = stageConceptScalarChange('main.yaml', 'other', 'name', 'Other', 'Renamed')
    expect(overlayConceptFields(node, ops)).toEqual(node)
  })

  it('ignores the same authored id edited in another document', () => {
    const ops = stageConceptScalarChange(
      'operations.yaml',
      node.localId,
      'name',
      node.name,
      'Renamed Elsewhere',
    )
    expect(overlayConceptFields(node, ops)).toEqual(node)
  })
})

describe('overlayRelationshipFields', () => {
  it("reflects a staged 'to' change", () => {
    const ops = stageRelationshipScalarChange(edge.document, edge.localId, 'to', edge.to, 'yarramate/gateway')
    expect(overlayRelationshipFields(edge, ops).to).toBe('yarramate/gateway')
  })
})
