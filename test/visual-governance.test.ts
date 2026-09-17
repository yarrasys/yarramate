import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { edgeLabelText } from '../src/visual-app/elk-layout.js'
import { graphToElements } from '../src/visual-app/graph-canvas.js'

const document = `format: yarramate/v1
id: main
profile: yarramate/policy@0.3
concepts:
  - id: g1
    kind: goal
    name: Go live in Q4
  - id: wp1
    kind: workPackage
    name: Vendor onboarding
  - id: r1
    kind: risk
    name: Vendor slips
  - id: a1
    kind: assumption
    name: Budget holds
  - id: req1
    kind: requirement
    name: Nightly reconciliation
relationships:
  - id: e1
    kind: influence
    from: r1
    to: g1
  - id: e2
    kind: influence
    from: wp1
    to: r1
  - id: e3
    kind: association
    from: a1
    to: req1
  - id: e4
    kind: influence
    from: wp1
    to: g1
`

const canvasOf = () => {
  const result = compileWorkspaceWithProfileContext([{ path: 'main.yaml', source: document }])
  if (!result.ok) throw new Error('fixture does not compile')
  return projectGraphForCanvas(result.graph, result.profileContext)
}

describe('readings the endpoints decide, in the editor (#560, ADR 0160)', () => {
  it('label the edge with the contextual reading before the kind reading', () => {
    const canvas = canvasOf()
    const edge = (id: string) => canvas.edges.find((candidate) => candidate.localId === id)!
    expect(edgeLabelText(edge('e1'), 'layered', true)).toBe('threatens')
    expect(edgeLabelText(edge('e2'), 'served-by', true)).toBe('mitigates')
    expect(edgeLabelText(edge('e3'), 'layered', true)).toBe('bears on')
    expect(edgeLabelText(edge('e4'), 'layered', true)).toBe('influences')
    expect(edgeLabelText(edge('e1'), 'layered', false)).toBe('')
  })
  it('carry the reading into the element data the label mapper reads', () => {
    const elements = graphToElements(canvasOf(), [], new Map(), { folded: new Set() })
    const data = (id: string) =>
      elements.find((el) => el.group === 'edges' && String(el.data.id).endsWith(id))!.data as { reading?: string }
    expect(data('e1').reading).toBe('threatens')
    expect(data('e2').reading).toBe('mitigates')
    expect(data('e4').reading).toBeUndefined()
  })
})
