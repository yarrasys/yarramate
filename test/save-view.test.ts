import { describe, expect, it } from 'vitest'
import { buildPayload } from '../src/visual-app/save-view.js'
import type { ProjectionQuery } from '../src/projection.js'
import {
  directoryOf,
  duplicateView,
  renameView,
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
    directory: undefined,
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

  it('writes a new view into the folder it was asked for', () => {
    const operation = build({
      id: undefined,
      path: undefined,
      directory: '.yarramate/projections/current',
      title: 'In A Folder',
    })

    expect(operation.path).toBe('.yarramate/projections/current/in-a-folder.yaml')
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

  it('duplicates into the same folder, with a free id', () => {
    // A duplicate the reviewer then has to move is a duplicate in the wrong
    // place - and the source's folder is one the manifest demonstrably reaches.
    const copy = duplicateView(view, new Set(['current-engine']))

    expect(copy.path).toBe(
      '.yarramate/projections/current/current-engine-copy.yaml',
    )
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

  it('reads a folder off a path, and calls the default directory no folder', () => {
    expect(directoryOf('.yarramate/projections/current/a.yaml')).toBe(
      '.yarramate/projections/current',
    )
    expect(directoryOf('a.yaml')).toBe('')
  })
})
