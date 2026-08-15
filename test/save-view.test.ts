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
      direction: 'top-down',
    })

    expect(payload.title).toBe('Exact Title')
    expect(payload.description).toBe('Exact description')
    expect(payload.presentation?.direction).toBe('top-down')
  })

  it('substitutes an empty query object when no filter is active', () => {
    const payload = buildPayload({
      id: undefined,
      title: 'Unfiltered',
      description: 'desc',
      query: null,
      direction: 'top-down',
    })

    expect(payload.query).toEqual({})
  })
})
