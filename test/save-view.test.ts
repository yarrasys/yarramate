import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildPayload,
  SaveViewDialog,
  type SaveViewDialogProps,
} from '../src/visual-app/save-view.js'
import type {
  ProjectionDefinition,
  ProjectionQuery,
} from '../src/projection.js'
import {
  declaredFolder,
  duplicateView,
  membershipDelta,
  renameView,
  withMembership,
} from '../src/adapters/visual/view-identity.js'

const query: ProjectionQuery = { kinds: ['yarramate/core@0.1#businessActor'] }

/**
 * Saving a view stages a `write-view` (ADR 0103), so this composes the whole
 * projection document and the path it will occupy rather than a payload the
 * server would finish. The properties are the same ones as before; what moved
 * is that they now sit inside `projection`, and that the id and the path are
 * decided here rather than on the far side of a round trip.
 */
const build = (
  overrides: Partial<Parameters<typeof buildPayload>[0]> = {},
) =>
  buildPayload({
    id: 'existing-view',
    taken: new Set<string>(),
    path: '.yarramate/projections/existing-view.yaml',
    folder: undefined,
    title: 'My View',
    description: 'desc',
    query,
    layout: 'layered',
    carriedDirection: 'top-down',
    showLifecycle: true,
    showEvidence: true,
    showOwnership: false,
    ...overrides,
  })

/** Narrowed once so each test reads `projection` without re-checking the op. */
const projectionOf = (operation: ReturnType<typeof buildPayload>) => {
  if (operation.op !== 'write-view') throw new Error('expected a write-view')
  return operation.projection
}

describe('buildPayload', () => {
  it('writes the document the view already occupies when overwriting', () => {
    const operation = build()

    expect(operation).toEqual({
      op: 'write-view',
      path: '.yarramate/projections/existing-view.yaml',
      projection: {
        format: 'yarramate/projection/v1',
        id: 'existing-view',
        version: '1.0',
        query,
        presentation: {
          title: 'My View',
          description: 'desc',
          layout: 'layered',
          direction: 'top-down',
          showLifecycle: true,
          showEvidence: true,
          showOwnership: false,
        },
      },
    })
  })

  it('keeps a view in the folder it was saved into', () => {
    // Folders are read back off projection paths (#245), so a save that
    // rebuilt the path from the id would quietly move the view.
    expect(
      build({ path: '.yarramate/projections/current/engine.yaml' }).path,
    ).toBe('.yarramate/projections/current/engine.yaml')
  })

  it('mints an id and a path for a new view, from its title', () => {
    const operation = build({ id: undefined, path: undefined, title: 'My New View' })

    expect(operation.path).toBe('.yarramate/projections/my-new-view.yaml')
    expect(projectionOf(operation).id).toBe('my-new-view')
  })

  it('steps past an id already in use rather than overwriting it', () => {
    const operation = build({
      id: undefined,
      path: undefined,
      title: 'My New View',
      taken: new Set(['my-new-view']),
    })

    expect(projectionOf(operation).id).toBe('my-new-view-2')
    expect(operation.path).toBe('.yarramate/projections/my-new-view-2.yaml')
  })

  it('round-trips the three presentation flags', () => {
    const presentation = projectionOf(
      build({ showLifecycle: false, showEvidence: true, showOwnership: true }),
    ).presentation

    expect(presentation?.showLifecycle).toBe(false)
    expect(presentation?.showEvidence).toBe(true)
    expect(presentation?.showOwnership).toBe(true)
  })

  it('substitutes an empty query object when no filter is active', () => {
    // Every field of a `ProjectionQuery` is optional, so `{}` is a valid if
    // unconstrained query - an unfiltered view is a view over everything.
    expect(projectionOf(build({ query: null })).query).toEqual({})
  })

  it('carries the layout through to presentation', () => {
    expect(projectionOf(build()).presentation?.layout).toBe('layered')
  })

  it('writes no notation, because there is only one', () => {
    expect(projectionOf(build()).presentation?.notation).toBeUndefined()
  })

  // The canvas has no direction control, so a save must carry through what the
  // view already declared. Dropping it would discard a value the LikeC4 export
  // reads and the reviewer never saw.
  it('omits direction entirely when there is none to carry', () => {
    expect(
      projectionOf(build({ carriedDirection: undefined })).presentation,
    ).not.toHaveProperty('direction')
  })

  it('declares the folder a new view was asked for, and files it beside the rest', () => {
    // A folder is a LABEL now (ADR 0104): the document says which folder it
    // belongs to, and every projection sits in one directory. Writing into a
    // subdirectory was the one motion that could put a projection where the
    // manifest's patterns do not reach.
    const operation = build({
      id: undefined,
      path: undefined,
      folder: 'Current',
      title: 'In A Folder',
    })

    expect(operation.path).toBe('.yarramate/projections/in-a-folder.yaml')
    expect(projectionOf(operation).presentation).toMatchObject({
      folder: 'Current',
    })
  })

  it('writes no folder for a view that was not asked to be in one', () => {
    // An empty label is not "no folder", it is a folder with no name, and the
    // schema refuses it.
    expect(
      projectionOf(build({ id: undefined, path: undefined, folder: '' }))
        .presentation,
    ).not.toHaveProperty('folder')
  })

  it('writes the folder it is given, because the presentation is composed here', () => {
    // Carried, never assumed: this builds the whole presentation block, so a
    // field it is not handed is a field the save drops - the same trap
    // `direction` fell into. The control decides WHICH folder that is: the one
    // the reviewer named for a new view, the one the view already declares for
    // an overwrite.
    expect(
      projectionOf(build({ folder: 'Somewhere Else' })).presentation,
    ).toMatchObject({ folder: 'Somewhere Else' })
  })
})

describe('renaming and duplicating a view', () => {
  const view = {
    id: 'current-engine',
    title: 'Current engine',
    description: 'What is built today',
    query,
    presentation: {
      title: 'Current engine',
      description: 'What is built today',
      layout: 'layered',
      direction: 'top-down',
      nesting: ['composition'],
    },
    path: '.yarramate/projections/current/current-engine.yaml',
  } as const

  it('renames without moving the document or the id', () => {
    // The id keys the layout sidecar (`.yarramate/visual-layout/<id>.yaml`), so
    // a rename that carried it along would orphan the positions the reviewer
    // dragged. Renaming is what a view is CALLED.
    const renamed = renameView(view, 'Engine today')

    expect(renamed.path).toBe(view.path)
    expect(renamed.projection.id).toBe('current-engine')
    expect(renamed.projection.presentation?.title).toBe('Engine today')
  })

  it('carries every other presentation field through a rename', () => {
    const renamed = renameView(view, 'Engine today')

    expect(renamed.projection.presentation?.direction).toBe('top-down')
    expect(renamed.projection.presentation?.nesting).toEqual(['composition'])
    expect(renamed.projection.query).toEqual(query)
  })

  it('duplicates beside the original, with a free id', () => {
    const copy = duplicateView(view, new Set(['current-engine']))

    expect(copy.path).toBe('.yarramate/projections/current-engine-copy.yaml')
    expect(copy.projection.id).toBe('current-engine-copy')
    expect(copy.projection.presentation?.title).toBe('Current engine copy')
  })

  it('steps past a duplicate id already taken', () => {
    const copy = duplicateView(
      view,
      new Set(['current-engine', 'current-engine-copy']),
    )

    expect(copy.projection.id).toBe('current-engine-copy-2')
  })

  it('reads the folder a view declares, and calls an undeclared one none', () => {
    expect(
      declaredFolder({ presentation: { folder: 'Current / Engine' } }),
    ).toBe('Current / Engine')
    expect(declaredFolder({ presentation: {} })).toBe('')
    expect(declaredFolder({ presentation: undefined })).toBe('')
  })

  it('keeps the original folder on a duplicate, without keeping its path', () => {
    const copy = duplicateView(
      { ...view, presentation: { ...view.presentation, folder: 'Current' } },
      new Set<string>(),
    )

    expect(copy.projection.presentation).toMatchObject({ folder: 'Current' })
    expect(copy.path).toBe('.yarramate/projections/current-engine-copy.yaml')
  })
})

describe('view membership', () => {
  const listed: ProjectionDefinition = {
    format: 'yarramate/projection/v1',
    id: 'payment-flow',
    version: '1.0',
    query: { subjects: ['checkout', 'ledger'], relationships: 'between' },
    presentation: { title: 'Payment flow', description: 'The hop' },
  }

  const described: ProjectionDefinition = {
    ...listed,
    query: { layers: ['application'] },
  }

  it('adds a subject to a view that lists its subjects', () => {
    expect(
      withMembership(listed, 'fraud-screening', 'add')?.query.subjects,
    ).toEqual(['checkout', 'ledger', 'fraud-screening'])
  })

  it('appends rather than sorting, because the list belongs to its author', () => {
    // Sorting it in would rewrite lines nobody touched, and a projection
    // document is read by people as well as by the compiler.
    expect(withMembership(listed, 'a-first-alphabetically', 'add')?.query.subjects)
      .toEqual(['checkout', 'ledger', 'a-first-alphabetically'])
  })

  it('takes a subject out of the list', () => {
    expect(withMembership(listed, 'ledger', 'remove')?.query.subjects).toEqual([
      'checkout',
    ])
  })

  it('has nothing to say to a view that describes its subjects', () => {
    // A facet query already includes anything matching it: membership is
    // decided by what the subject IS, so there is no list to amend.
    expect(withMembership(described, 'checkout', 'add')).toBeNull()
    expect(withMembership(described, 'checkout', 'remove')).toBeNull()
  })

  it('has nothing to say when the list already says it', () => {
    // Not an unchanged document: the absence, so no row reaches the tray for
    // a reviewer to read and discard for nothing.
    expect(withMembership(listed, 'checkout', 'add')).toBeNull()
    expect(withMembership(listed, 'fraud-screening', 'remove')).toBeNull()
  })

  it('carries every other field of the document through untouched', () => {
    const amended = withMembership(listed, 'fraud-screening', 'add')

    expect(amended?.query.relationships).toBe('between')
    expect(amended?.presentation?.title).toBe('Payment flow')
    expect(amended?.id).toBe('payment-flow')
  })

  it('reports what a row moved, as the tray reads it', () => {
    expect(
      membershipDelta(listed.query, {
        subjects: ['checkout', 'fraud-screening'],
      }),
    ).toEqual(['+fraud-screening', '-ledger'])
  })

  it('reports nothing where the membership did not move', () => {
    // A rename or a presentation edit is a row about something else, and says
    // so by other means.
    expect(membershipDelta(listed.query, listed.query)).toEqual([])
    expect(membershipDelta(described.query, described.query)).toEqual([])
  })
})

/**
 * The folder-preset rule (#299, ADR 0114). Plain Save carries the active
 * view's own folder by design; opened by "New folder…" or "New view in this
 * folder…", it is therefore the one button that would silently drop the
 * folder the reviewer just named — so it is disabled, and Save As New (which
 * adopts the preset) is the action left standing.
 */
describe('the save dialog, opened with a folder preset', () => {
  const activeView = {
    id: 'existing-view',
    title: 'Existing view',
    description: 'What it shows',
    query: {},
    presentation: { folder: 'Elsewhere' },
    path: '.yarramate/projections/existing-view.yaml',
    subjectCount: 3,
  }

  const renderDialog = (overrides: Partial<SaveViewDialogProps> = {}) =>
    renderToStaticMarkup(
      createElement(SaveViewDialog, {
        views: [activeView],
        activeViewId: 'existing-view',
        query: null,
        layout: 'layered',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
        open: true,
        folder: undefined,
        onClose: () => {},
        onStage: () => {},
        ...overrides,
      }),
    )

  /** The overwrite button's own markup, so `disabled` cannot be read off a
   * neighbour. */
  const saveButton = (markup: string): string => {
    const at = markup.indexOf('<button type="submit"')
    if (at === -1) throw new Error('expected a Save button')
    return markup.slice(at, markup.indexOf('</button>', at))
  }

  it('offers the overwrite as usual when no folder was preset', () => {
    // The ordinary flows are untouched: an overwrite still carries the
    // active view's own folder, and nothing here disables it.
    expect(saveButton(renderDialog())).not.toContain('disabled')
  })

  it('disables the overwrite, which is the one button that would drop the folder', () => {
    const markup = renderDialog({ folder: 'Roadmap' })

    expect(saveButton(markup)).toContain('disabled')
    // Save As New stays available: it is the action the opener asked for,
    // and the one that adopts the folder.
    expect(markup).toContain('<button type="button">Save As New</button>')
  })

  it('says why, on the disabled button itself', () => {
    // A control that refuses without saying why reads as broken.
    expect(saveButton(renderDialog({ folder: 'Roadmap' }))).toContain(
      'Save As New puts the first view in &quot;Roadmap&quot;',
    )
  })
})
