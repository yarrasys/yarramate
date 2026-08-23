import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { SubjectDraftPanel } from '../src/visual-app/subject-draft-panel.js'
import type { CanvasGraph } from '../src/graph-projection.js'

/**
 * What the form puts on screen. What it produces when submitted is
 * `draftConcept`, covered in `concept-drafting.test.ts` by compiling every
 * draft it makes.
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
relationships: []
`)

const render = () =>
  renderToStaticMarkup(
    createElement(SubjectDraftPanel, {
      graph,
      kinds: [
        { id: 'applicationComponent', label: 'applicationComponent' },
        { id: 'businessActor', label: 'businessActor' },
      ],
      documents: ['architecture/main.yaml', 'architecture/other.yaml'],
      defaultDocument: 'architecture/main.yaml',
      onStage: () => undefined,
      onCancel: () => undefined,
    }),
  )

describe('SubjectDraftPanel', () => {
  it('offers the workspace vocabulary rather than a list of its own', () => {
    const markup = render()

    expect(markup).toContain('applicationComponent')
    expect(markup).toContain('businessActor')
  })

  it('offers every document the workspace declares', () => {
    const markup = render()

    expect(markup).toContain('architecture/main.yaml')
    expect(markup).toContain('architecture/other.yaml')
  })

  it('asks for a name before proposing anything', () => {
    // The id is derived, so there is nothing to show until there is a name.
    expect(render()).toContain('Give it a name')
  })

  it('cannot be submitted while there is nothing to submit', () => {
    expect(render()).toContain('disabled')
  })

  it('can always be backed out of', () => {
    expect(render()).toContain('Cancel')
  })
})
