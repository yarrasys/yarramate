import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas, type CanvasNode } from '../src/graph-projection.js'
import { RESPONSIBILITY_KINDS } from '../src/responsibility-kinds.js'
import { edgeLabelText } from '../src/visual-app/elk-layout.js'
import { graphToElements } from '../src/visual-app/graph-canvas.js'
import { responsibilityFacts } from '../src/visual-app/subject-form.js'
import type { VisualRenderedModel } from '../src/adapters/visual/wire.js'

// A consulting profile that extends the shipped policy@0.2 and specialises
// `responsible` once, the way an adopter would.
const consultingProfile = `format: yarramate/profile/v1
id: acme/delivery
version: "1.0"
extends: yarramate/policy@0.2
conceptKinds: []
relationshipKinds:
  - id: delivery-lead
    name: Delivery lead
    parent: yarramate/policy@0.2#responsible
`

// Eight facts a project manager would write down: a PM responsible for the
// portal and (as delivery lead) for the API, a vendor consulted on the
// portal, a patron informed of it and served by it, an auditor with nothing,
// an API with an owner and nobody responsible, and one security attestation
// by the vendor.
const document = `format: yarramate/v1
id: main
profile: acme/delivery@1.0
concepts:
  - id: pm
    kind: businessRole
    name: Project manager
  - id: vendor
    kind: businessActor
    name: Vendor
  - id: patron
    kind: businessActor
    name: Patron
  - id: auditor
    kind: businessRole
    name: Auditor
  - id: portal
    kind: applicationComponent
    name: Portal
    owner: pm
    attestations:
      - topic: security
        by: vendor
        on: "2026-09-01"
  - id: api
    kind: applicationComponent
    name: API
    owner: pm
  - id: billing
    kind: applicationComponent
    name: Billing
    owner: pm
  - id: guest
    kind: businessActor
    name: Guest
  - id: catalogue
    kind: dataObject
    name: Catalogue
relationships:
  - id: r1
    kind: responsible
    from: pm
    to: portal
  - id: r2
    kind: consulted
    from: vendor
    to: portal
  - id: r3
    kind: informed
    from: patron
    to: portal
  - id: r4
    kind: delivery-lead
    from: pm
    to: api
  - id: s1
    kind: serving
    from: portal
    to: patron
  - id: s2
    kind: serving
    from: portal
    to: guest
`

const compileFixture = (extra: string = '') => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'profiles/acme.yaml', source: consultingProfile },
    { path: 'main.yaml', source: document + extra },
  ])
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ code, message }) => `${code} ${message}`).join('; '))
  }
  return result
}

describe('responsibility edges in the editor (#557, ADR 0159)', () => {
  it('labels an edge with its reading through the lineage', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const edge = (id: string) => canvas.edges.find((candidate) => candidate.localId === id)!
    expect(edgeLabelText(edge('r1'), 'layered', true)).toBe('is responsible for')
    expect(edgeLabelText(edge('r4'), 'served-by', true)).toBe('is responsible for')
    expect(edgeLabelText(edge('r1'), 'layered', false)).toBe('')
    expect(edgeLabelText(edge('s1'), 'served-by', true)).toBe('served by')
  })
  it('keeps responsibility edges off the canvas until the view asks', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const ids = (elements: ReturnType<typeof graphToElements>) =>
      elements.filter((el) => el.group === 'edges').map((el) => String(el.data.id))
    const hidden = ids(graphToElements(canvas, [], new Map(), { folded: new Set() }))
    expect(hidden.some((id) => id.endsWith('s1'))).toBe(true)
    expect(hidden.some((id) => id.endsWith('r1') || id.endsWith('r4'))).toBe(false)
    const elements = graphToElements(canvas, [], new Map(), { folded: new Set(), showResponsibility: true })
    const shown = ids(elements)
    expect(['r1', 'r2', 'r3', 'r4', 's1'].every((local) => shown.some((id) => id.endsWith(local)))).toBe(true)
    // The element data carries what the label mapper reads, so the canvas
    // says "is responsible for" rather than humanising "delivery-lead".
    const r4 = elements.find((el) => el.group === 'edges' && String(el.data.id).endsWith('r4'))!
    expect(r4.data.readingKind).toBe(RESPONSIBILITY_KINDS.responsible)
    expect(r4.data.responsibility).toBe('R')
    expect(edgeLabelText(r4.data as Parameters<typeof edgeLabelText>[0], 'layered', true)).toBe('is responsible for')
  })
  it('reads the letters in the properties whether or not the canvas draws them', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const model = { graph: canvas } as unknown as VisualRenderedModel
    const node = (local: string): CanvasNode => canvas.nodes.find((candidate) => candidate.localId === local)!
    const rows = (local: string) =>
      responsibilityFacts(node(local), model)
        .filter(({ value }) => value !== '')
        .map(({ label, value }) => ({ label, value }))
    expect(rows('portal')).toEqual([
      { label: 'Responsible', value: 'Project manager' },
      { label: 'Consulted', value: 'Vendor' },
      { label: 'Informed', value: 'Patron' },
    ])
    expect(rows('pm')).toEqual([{ label: 'Responsible', value: 'for Portal, API' }])
    expect(new Set(responsibilityFacts(node('pm'), model).map(({ key }) => key)).size).toBe(6)
    expect(rows('catalogue')).toEqual([])
  })
})
