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
    })

    expect(payload).toEqual({
      id: 'existing-view',
      title: 'My View',
      description: 'desc',
      query,
      presentation: { layout: 'layered', direction: 'top-down', seed: 'default' },
    })
  })

  it('omits id entirely for an ad-hoc/new view', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'New View',
      description: 'desc',
      query,
      layout: 'layered',
      direction: 'left-right',
    })

    expect(payload).not.toHaveProperty('id')
    expect(payload).toEqual({
      title: 'New View',
      description: 'desc',
      query,
      presentation: { layout: 'layered', direction: 'left-right', seed: 'default' },
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
    })

    expect(payload.presentation?.layout).toBe('radial')
    expect(payload.id).toBe('view-id')
    expect(payload.title).toBe('Radial View')
    expect(payload.description).toBe('A radial layout test')
    expect(payload.query).toEqual(query)
    expect(payload.presentation?.direction).toBe('top-down')
    expect(payload.presentation?.seed).toBe('default')
  })
})
