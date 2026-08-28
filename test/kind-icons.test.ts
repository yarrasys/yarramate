import { describe, expect, it } from 'vitest'
import { kindIconUriOf } from '../src/visual-app/kind-icons.js'

describe('kind icon URIs', () => {
  const labels = [
    'applicationComponent',
    'applicationFunction',
    'applicationService',
    'artifact',
    'businessActor',
    'businessFunction',
    'capability',
    'dataObject',
    'deliverable',
    'driver',
    'goal',
    'node',
    'plateau',
    'representation',
    'requirement',
    'systemSoftware',
    'technologyFunction',
  ]

  it('resolves every one of the 17 core labels to a non-empty data:image/svg+xml URI', () => {
    for (const label of labels) {
      const uri = kindIconUriOf(label)
      expect(uri).not.toBeNull()
      expect(uri).toBeDefined()
      expect(uri).toMatch(/^data:image\/svg\+xml;utf8,/)
      expect(uri).toBeTruthy()
    }
  })

  it('decodes every URI to markup containing opening and closing SVG tags', () => {
    for (const label of labels) {
      const uri = kindIconUriOf(label)
      expect(uri).not.toBeNull()
      const decoded = decodeURIComponent(uri!.slice('data:image/svg+xml;utf8,'.length))
      expect(decoded).toContain('<svg')
      expect(decoded).toContain('</svg>')
    }
  })

  it('returns null for an unmapped label', () => {
    expect(kindIconUriOf('notAKind')).toBeNull()
  })

  it('has no glyph of its own for a profile-declared kind', () => {
    // This is a label-to-glyph lookup and nothing more. A profile-declared
    // kind has no glyph, and it is not this function's business to find one:
    // resolving through the core ancestor needs lineage, which the callers
    // hold and this does not. It used to carry a two-entry alias map naming
    // this repository's OWN extension kinds, which meant the dogfood path
    // had icons and every adopter's did not.
    expect(kindIconUriOf('compiler-module')).toBeNull()
    expect(kindIconUriOf('rest-api')).toBeNull()
    expect(kindIconUriOf('applicationComponent')).not.toBeNull()
  })
})
