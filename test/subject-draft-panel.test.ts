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

const render = (overrides: { readonly initialKind?: string } = {}) =>
  renderToStaticMarkup(
    createElement(SubjectDraftPanel, {
      ...overrides,
      graph,
      kinds: [
        // id is the full identity the wire carries; label is the short name a
        // document names. The two differ, which is the whole point.
        {
          id: 'yarramate/core@0.1#applicationComponent',
          label: 'applicationComponent',
          coreLabel: 'applicationComponent',
        },
        {
          id: 'yarramate/core@0.1#businessActor',
          label: 'businessActor',
          coreLabel: 'businessActor',
        },
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

  /**
   * The bug this exists for: the form offered `option.id`, the full kind
   * identity, where a document names a kind the short way. Every Add was
   * refused on commit with `YM401 Unknown concept kind`.
   *
   * This half asserts what the form puts in the DOM. The other half - that a
   * short name is what `apply` accepts and an identity is not - is in
   * `concept-drafting.test.ts`, because the engine cannot be imported here:
   * `tsconfig.visual.json` lists what the browser program may see, and
   * reaching past it is the same mistake in a different direction.
   */
  it('offers kind values a document accepts, never the full identity', () => {
    const markup = render()
    const values = [...markup.matchAll(/<option value="([^"]*)"/g)]
      .map((match) => match[1]!)
      .filter((value) => value !== '')

    expect(values).toContain('applicationComponent')
    expect(values.some((value) => value.includes('#'))).toBe(false)
  })

  /**
   * The palette's half of #295: a kind dragged or clicked there arrives as
   * `initialKind` and the select opens on it. Not a default - the reviewer's
   * own pick riding the gesture in - so the untouched form's no-default rule
   * (below) stands, and the guidance moves on to the name the id still needs.
   */
  it('seeds the kind a palette gesture picked up', () => {
    const markup = render({ initialKind: 'businessActor' })

    // Only the Kind select: Document legitimately opens on its default too.
    const kindSelect =
      /<select id="subject-draft-kind"[^>]*>([\s\S]*?)<\/select>/.exec(
        markup,
      )?.[1] ?? ''
    const seeded = [...kindSelect.matchAll(/<option ([^>]*)>/g)]
      .filter((match) => match[1]!.includes('selected'))
      .map((match) => /value="([^"]*)"/.exec(match[1]!)?.[1])
    expect(seeded).toEqual(['businessActor'])
    expect(markup).toContain('Give it a name.')
    expect(markup).not.toContain('Choose a kind.')
  })

  it('picks no kind for the reviewer', () => {
    // The first kind alphabetically is `andJunction`. A form that defaults to
    // it makes junctions by accident.
    const markup = render()
    expect(markup).toContain('Choose a kind')
    expect(markup).toContain('disabled')
  })

  it('shows guidance rather than an id until it has what it needs', () => {
    // The id is derived, so there is nothing to show yet. An untouched form
    // asks for the kind first, because that is what it now has no default for.
    const markup = render()
    expect(markup).toContain('Choose a kind')
    expect(markup).not.toContain('Id:')
  })

  it('cannot be submitted while there is nothing to submit', () => {
    expect(render()).toContain('disabled')
  })

  it('can always be backed out of', () => {
    expect(render()).toContain('Cancel')
  })

  /**
   * The a11y half of #296: the labels wrapped their controls but named them
   * for nothing else — no `for`/`id`, so `getByLabel`-style queries and some
   * assistive tech could not resolve Name, Kind or Document. Every label must
   * point at a control that exists, and every id must be unique, or two
   * fields would answer to one name.
   */
  it('associates every label with its control', () => {
    const markup = render()

    const fors = [...markup.matchAll(/<label[^>]*\bfor="([^"]*)"/g)].map(
      (match) => match[1]!,
    )
    const ids = [...markup.matchAll(/\bid="([^"]*)"/g)].map(
      (match) => match[1]!,
    )

    // One association per field: Name, Kind, Document.
    expect(fors).toHaveLength(3)
    expect(fors.every((target) => target !== '')).toBe(true)
    // Each names a control that is really there…
    for (const target of fors) {
      expect(ids).toContain(target)
    }
    // …and no id is claimed twice, in the panel or by two labels.
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(fors).size).toBe(fors.length)
  })
})
