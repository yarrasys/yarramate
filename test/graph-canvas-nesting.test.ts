import { describe, expect, it, vi } from 'vitest'
import { resolveNestingParents } from '../src/visual-app/graph-canvas.js'
import type { CanvasEdge } from '../src/graph-projection.js'
import type { NestingKind } from '../src/projection.js'

const COMPOSITION = 'yarramate/core@0.1#composition'
const ASSIGNMENT = 'yarramate/core@0.1#assignment'

const edge = (
  id: string,
  kind: string,
  from: string,
  to: string,
): CanvasEdge =>
  ({
    id,
    localId: id,
    document: 'main.yaml',
    kind,
    kindLabel: kind.split('#')[1]!,
    coreKindLabel: kind.split('#')[1]!,
    portKinds: [],
    from,
    to,
    name: null,
    description: null,
    mode: null,
    content: null,
    status: null,
    references: [],
  }) as unknown as CanvasEdge

// The kinds a child may be, which is what decides whether an assignment is
// allowed to swallow it.
const kinds: Record<string, string> = {
  component: 'applicationComponent',
  otherComponent: 'applicationComponent',
  behaviour: 'applicationFunction',
  service: 'applicationService',
  part: 'applicationComponent',
}
const kindOf = (id: string) => kinds[id] ?? 'applicationComponent'

const resolve = (edges: readonly CanvasEdge[], nesting: readonly NestingKind[]) =>
  resolveNestingParents(edges, nesting, kindOf)

describe('nesting is what the view says it is (ADR 0101)', () => {
  it('nests a composition and leaves an assignment as a line by default', () => {
    const edges = [
      edge('e1', COMPOSITION, 'component', 'part'),
      edge('e2', ASSIGNMENT, 'component', 'behaviour'),
    ]

    const { parentOf, consumedEdgeIds } = resolve(edges, ['composition'])

    expect(parentOf.get('part')).toBe('component')
    expect(parentOf.has('behaviour')).toBe(false)
    expect([...consumedEdgeIds]).toEqual(['e1'])
  })

  it('nests an assignment when the view asks for it', () => {
    const edges = [edge('e1', ASSIGNMENT, 'component', 'behaviour')]

    const { parentOf, consumedEdgeIds } = resolve(edges, [
      'composition',
      'assignment',
    ])

    expect(parentOf.get('behaviour')).toBe('component')
    expect([...consumedEdgeIds]).toEqual(['e1'])
  })

  it('never nests a service by assignment, even when asked', () => {
    // Permitted by the ArchiMate 3.2 table, so the model is correct; this
    // declines to draw it as containment, not to accept it.
    const edges = [edge('e1', ASSIGNMENT, 'component', 'service')]

    const { parentOf, consumedEdgeIds } = resolve(edges, [
      'composition',
      'assignment',
    ])

    expect(parentOf.has('service')).toBe(false)
    expect(consumedEdgeIds.size).toBe(0)
  })

  it('still nests a service that is composed, because a part is a part', () => {
    const edges = [edge('e1', COMPOSITION, 'component', 'service')]

    const { parentOf } = resolve(edges, ['composition', 'assignment'])

    expect(parentOf.get('service')).toBe('component')
  })

  it('gives the earlier-listed kind precedence over the later one', () => {
    const edges = [
      edge('e1', ASSIGNMENT, 'otherComponent', 'behaviour'),
      edge('e2', COMPOSITION, 'component', 'behaviour'),
    ]

    const { parentOf, consumedEdgeIds } = resolve(edges, [
      'composition',
      'assignment',
    ])

    expect(parentOf.get('behaviour')).toBe('component')
    // The losing claim is not consumed, so it stays drawn as a line.
    expect([...consumedEdgeIds]).toEqual(['e2'])
  })

  it('leaves two claims at the same rank undecided, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const edges = [
        edge('e1', COMPOSITION, 'component', 'part'),
        edge('e2', COMPOSITION, 'otherComponent', 'part'),
      ]

      const { parentOf, consumedEdgeIds } = resolve(edges, ['composition'])

      expect(parentOf.has('part')).toBe(false)
      expect(consumedEdgeIds.size).toBe(0)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Nesting conflict'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('nests nothing when the view asks for nothing', () => {
    const edges = [
      edge('e1', COMPOSITION, 'component', 'part'),
      edge('e2', ASSIGNMENT, 'component', 'behaviour'),
    ]

    const { parentOf, consumedEdgeIds } = resolve(edges, [])

    expect(parentOf.size).toBe(0)
    expect(consumedEdgeIds.size).toBe(0)
  })

  it('unnests a cycle that only a mixed vocabulary could form', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // component composes behaviour, behaviour is assigned back to component:
      // impossible while only one kind nested, and a cycle cytoscape cannot
      // render.
      const edges = [
        edge('e1', COMPOSITION, 'component', 'behaviour'),
        edge('e2', ASSIGNMENT, 'behaviour', 'component'),
      ]

      const { parentOf } = resolve(edges, ['composition', 'assignment'])

      expect(parentOf.size).toBe(0)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Nesting cycle'),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
