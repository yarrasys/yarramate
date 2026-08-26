import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { connectableKinds } from '../src/relationship-drafting.js'
import { ConnectionPanel } from '../src/visual-app/connection-panel.js'
import type { CanvasGraph } from '../src/graph-projection.js'
import type { YarramateOperation } from '../src/operations.js'

/**
 * What the panel puts on screen, which is the safety-critical half: a kind
 * offered here is a kind the reviewer can land. What happens when one is
 * clicked is `draftRelationship`, covered in `relationship-drafting.test.ts`
 * by compiling every draft it produces, and the transitions around it are
 * covered in `visual-workspace-state.test.ts`.
 */
const graphOf = (source: string): CanvasGraph => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return projectGraphForCanvas(result.graph, result.profileContext)
}

const graph = graphOf(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: orders
    kind: applicationComponent
    name: Orders
  - id: settle
    kind: applicationFunction
    name: Settle
relationships: []
`)

const render = (draft: { from: string; to: string | null }) =>
  renderToStaticMarkup(
    createElement(ConnectionPanel, {
      draft,
      graph,
      reservedIds: [],
      onStage: () => undefined,
      onCancel: () => undefined,
    }),
  )

describe('ConnectionPanel', () => {
  it('names the source and asks for a target', () => {
    const markup = render({ from: 'orders', to: null })

    expect(markup).toContain('Orders')
    expect(markup).toContain('Choose a target')
    expect(markup).not.toContain('connection-kinds')
  })

  it('offers exactly what the table permits between the two', () => {
    const markup = render({ from: 'orders', to: 'settle' })
    const offered = connectableKinds(graph, 'orders', 'settle')

    expect(offered.length).toBeGreaterThan(1)
    for (const kind of offered) {
      expect(markup, kind).toContain(`>${kind}<`)
    }
  })

  it('offers no kind the table forbids between the two', () => {
    const markup = render({ from: 'settle', to: 'orders' })
    const offered = new Set(connectableKinds(graph, 'settle', 'orders'))
    const everyKind = [
      'access',
      'aggregation',
      'assignment',
      'association',
      'composition',
      'flow',
      'influence',
      'realization',
      'serving',
      'specialization',
      'triggering',
    ]
    const withheld = everyKind.filter((kind) => !offered.has(kind as never))

    expect(withheld.length).toBeGreaterThan(0)
    for (const kind of withheld) {
      expect(markup, kind).not.toContain(`>${kind}<`)
    }
  })

  it('says why there is nothing to offer rather than showing an empty list', () => {
    // An endpoint outside the ArchiMate vocabulary has no row in the table. A
    // pair the table knows always permits `association`, so an empty list can
    // only mean this.
    const outside: CanvasGraph = {
      nodes: graph.nodes.map((node) =>
        node.id === 'settle'
          ? { ...node, coreKindLabel: 'somethingElse' }
          : node,
      ),
      edges: graph.edges,
    }
    const markup = renderToStaticMarkup(
      createElement(ConnectionPanel, {
        draft: { from: 'orders', to: 'settle' },
        graph: outside,
        reservedIds: [],
        onStage: () => undefined,
        onCancel: () => undefined,
      }),
    )

    expect(markup).toContain('outside the ArchiMate vocabulary')
    expect(markup).not.toContain('connection-kinds')
  })

  it('can always be backed out of', () => {
    expect(render({ from: 'orders', to: null })).toContain('Cancel')
    expect(render({ from: 'orders', to: 'settle' })).toContain('Cancel')
  })

  it('threads reserved ids into the draft it stages (#306)', () => {
    // The panel is hook-free, so it can be invoked as a plain function and
    // its element tree walked for the kind button - no DOM needed. The
    // reserved id plays a first relationship that is staged but not landed:
    // clicking the same kind again must draft `-2`, not silently collide.
    const staged: YarramateOperation[] = []
    const buttonsOf = (
      node: unknown,
      found: Array<{ children?: unknown; onClick?: () => void }> = [],
    ): Array<{ children?: unknown; onClick?: () => void }> => {
      if (Array.isArray(node)) {
        for (const child of node) buttonsOf(child, found)
        return found
      }
      if (node === null || typeof node !== 'object') return found
      const element = node as {
        type?: unknown
        props?: { children?: unknown; onClick?: () => void }
      }
      if (element.type === 'button' && element.props !== undefined) {
        found.push(element.props)
      }
      buttonsOf(element.props?.children, found)
      return found
    }

    const tree = ConnectionPanel({
      draft: { from: 'orders', to: 'settle' },
      graph,
      reservedIds: ['orders-assignment-settle'],
      onStage: (operation) => staged.push(operation),
      onCancel: () => undefined,
    })
    const assignment = buttonsOf(tree).find(
      (button) => button.children === 'assignment',
    )
    expect(assignment).toBeDefined()
    assignment!.onClick!()

    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({
      op: 'add-relationship',
      relationship: { id: 'orders-assignment-settle-2' },
    })
  })
})
