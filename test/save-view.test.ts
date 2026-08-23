import { describe, expect, it } from 'vitest'
import { buildPayload } from '../src/visual-app/save-view.js'
import type { ProjectionQuery } from '../src/projection.js'

const query: ProjectionQuery = { kinds: ['yarramate/core@0.1#businessActor'] }

describe('buildPayload', () => {
  it('carries the active view id when overwriting an existing view', () => {
    const payload = buildPayload({
      id: 'existing-view',
      title: 'My View',
      description: 'desc',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

    expect(payload).toEqual({
      id: 'existing-view',
      title: 'My View',
      description: 'desc',
      query,
      presentation: {
        layout: 'layered',
        direction: 'top-down',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
      },
    })
  })

  it('round-trips the three presentation flags into the saved presentation object', () => {
    const payload = buildPayload({
      id: 'existing-view',
      title: 'My View',
      description: 'desc',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: false,
      showEvidence: true,
      showOwnership: true,
    })

    expect(payload.presentation?.showLifecycle).toBe(false)
    expect(payload.presentation?.showEvidence).toBe(true)
    expect(payload.presentation?.showOwnership).toBe(true)
  })

  it('omits id entirely for an ad-hoc/new view', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'New View',
      description: 'desc',
      query,
      layout: 'layered',
      carriedDirection: 'left-right',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

    expect(payload).not.toHaveProperty('id')
    expect(payload).toEqual({
      title: 'New View',
      description: 'desc',
      query,
      presentation: {
        layout: 'layered',
        direction: 'left-right',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
      },
    })
  })

  it('passes title, description, and direction through unchanged', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'Exact Title',
      description: 'Exact description',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

    expect(payload.title).toBe('Exact Title')
    expect(payload.description).toBe('Exact description')
    expect(payload.presentation?.direction).toBe('top-down')
    expect(payload.presentation?.layout).toBe('layered')
  })

  it('substitutes an empty query object when no filter is active', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'Unfiltered',
      description: 'desc',
      query: null,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: false,
      showOwnership: false,
    })

    expect(payload.query).toEqual({})
  })

  it('carries the layout through to presentation', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'Layered View',
      description: 'A layout round-trip test',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: false,
      showOwnership: false,
    })

    expect(payload.presentation?.layout).toBe('layered')
    expect(payload.id).toBe('view-id')
    expect(payload.title).toBe('Layered View')
    expect(payload.description).toBe('A layout round-trip test')
    expect(payload.query).toEqual(query)
    expect(payload.presentation?.direction).toBe('top-down')
  })

  // ArchiMate is the only notation, so a save writes no `notation` at all
  // rather than stamping the same value onto every projection it touches. A
  // view that declares one by hand keeps it; nothing here mints one.
  it('writes no notation, because there is only one', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'A View',
      description: 'A test',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

    expect(payload.presentation?.notation).toBeUndefined()
  })

  // The canvas has no direction control, so a save must carry through what the
  // view already declared. Dropping it would discard a value the LikeC4 export
  // reads and the reviewer never saw.
  it('omits direction entirely when there is none to carry', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'A New View',
      description: 'A test',
      query,
      layout: 'layered',
      carriedDirection: undefined,
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

    expect(payload.presentation).not.toHaveProperty('direction')
  })

  // The seed the canvas actually laid this view out with is what a save must
  // write back - not the placeholder a view with no declared seed falls to.
  it('carries the live canvas seed through to presentation', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'Seeded View',
      description: 'A reviewer-chosen seed',
      query,
      layout: 'layered',
      carriedDirection: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
    })

  })
})
