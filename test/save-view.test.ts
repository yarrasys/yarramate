import { describe, expect, it } from 'vitest'
import { buildPayload } from '../src/visual-app/save-view.js'
import type { ProjectionQuery } from '../src/projection.js'

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
})
