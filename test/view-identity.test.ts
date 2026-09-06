import { describe, expect, it } from 'vitest'
import { composeProjection, withMembership } from '../src/adapters/visual/view-identity.js'
import { validateProjection } from '../src/schema-validation.js'

// What the editor holds of a view goes back to disk through one composer.
// The schema's title and description are non-empty text, and the editor
// reads an undeclared description back as "", so an empty value has to mean
// "no field" or every write of an undescribed view is refused (#509).
describe('composeProjection', () => {
  const query = { subjects: ['checkout', 'ledger'] }

  it('writes no description for a view that has none, and the document validates', () => {
    const projection = composeProjection({
      id: 'api-tiers',
      title: 'API tiers',
      description: '',
      query,
      presentation: { title: 'API tiers', layout: 'layered', nesting: ['composition', 'assignment'] },
    })
    expect(validateProjection(projection), JSON.stringify(validateProjection.errors)).toBe(true)
    expect(projection.presentation).toEqual({
      title: 'API tiers',
      layout: 'layered',
      nesting: ['composition', 'assignment'],
    })
  })

  it('writes the title and description it is given when they say something', () => {
    const projection = composeProjection({
      id: 'landscape',
      title: 'Landscape',
      description: 'Everything, once',
      query,
      presentation: { layout: 'routed' },
    })
    expect(projection.presentation).toEqual({
      layout: 'routed',
      title: 'Landscape',
      description: 'Everything, once',
    })
  })

  it('treats a blank as empty, and an emptied description as removed rather than kept from the declaration', () => {
    const projection = composeProjection({
      id: 'landscape',
      title: 'Landscape',
      description: '   ',
      query,
      presentation: { title: 'Old title', description: 'The one being cleared', direction: 'left-right' },
    })
    expect(projection.presentation).toEqual({ direction: 'left-right', title: 'Landscape' })
    expect(validateProjection(projection)).toBe(true)
  })

  it('composes a membership edit on an undescribed view into a document the schema accepts', () => {
    const saved = composeProjection({
      id: 'api-tiers',
      title: 'API tiers',
      description: '',
      query,
      presentation: { title: 'API tiers' },
    })
    const amended = withMembership(saved, 'fraud-screening', 'add')
    expect(amended).not.toBeNull()
    if (amended === null) return
    expect(validateProjection(amended), JSON.stringify(validateProjection.errors)).toBe(true)
    expect(amended.query.subjects).toEqual(['checkout', 'ledger', 'fraud-screening'])
  })
})
