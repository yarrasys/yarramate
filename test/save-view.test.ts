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
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
      notation: 'native',
      seed: 'default',
    })

    expect(payload).toEqual({
      id: 'existing-view',
      title: 'My View',
      description: 'desc',
      query,
      presentation: {
        layout: 'layered',
        direction: 'top-down',
        seed: 'default',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
        notation: 'native',
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
      direction: 'top-down',
      showLifecycle: false,
      showEvidence: true,
      showOwnership: true,
      notation: 'native',
      seed: 'default',
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
      direction: 'left-right',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
      notation: 'native',
      seed: 'default',
    })

    expect(payload).not.toHaveProperty('id')
    expect(payload).toEqual({
      title: 'New View',
      description: 'desc',
      query,
      presentation: {
        layout: 'layered',
        direction: 'left-right',
        seed: 'default',
        showLifecycle: true,
        showEvidence: true,
        showOwnership: false,
        notation: 'native',
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
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
      notation: 'native',
      seed: 'default',
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
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: false,
      showOwnership: false,
      notation: 'native',
      seed: 'default',
    })

    expect(payload.query).toEqual({})
  })

  it('carries layout through to presentation when radial is selected', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'Radial View',
      description: 'A radial layout test',
      query,
      layout: 'radial',
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: false,
      showOwnership: false,
      notation: 'native',
      seed: 'default',
    })

    expect(payload.presentation?.layout).toBe('radial')
    expect(payload.id).toBe('view-id')
    expect(payload.title).toBe('Radial View')
    expect(payload.description).toBe('A radial layout test')
    expect(payload.query).toEqual(query)
    expect(payload.presentation?.direction).toBe('top-down')
    expect(payload.presentation?.seed).toBe('default')
  })

  it('carries notation through to presentation', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'ArchiMate View',
      description: 'An archimate test',
      query,
      layout: 'layered',
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
      notation: 'archimate',
      seed: 'default',
    })

    expect(payload.presentation?.notation).toBe('archimate')
  })

  // The seed the canvas actually laid this view out with is what a save must
  // write back - not the placeholder a view with no declared seed falls to.
  it('carries the live canvas seed through to presentation', () => {
    const payload = buildPayload({
      id: 'view-id',
      title: 'Seeded View',
      description: 'A reviewer-chosen seed',
      query,
      layout: 'force',
      direction: 'top-down',
      showLifecycle: true,
      showEvidence: true,
      showOwnership: false,
      notation: 'native',
      seed: 'reviewer-seed-7',
    })

    expect(payload.presentation?.seed).toBe('reviewer-seed-7')
  })
})
