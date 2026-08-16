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
    'compiler-module',
    'repository-file',
  ]

  it('resolves every one of the 19 labels to a non-empty data:image/svg+xml URI', () => {
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

  it('compiler-module returns the same URI as applicationComponent', () => {
    const comp = kindIconUriOf('applicationComponent')
    const mod = kindIconUriOf('compiler-module')
    expect(mod).toEqual(comp)
  })

  it('repository-file returns the same URI as artifact', () => {
    const art = kindIconUriOf('artifact')
    const file = kindIconUriOf('repository-file')
    expect(file).toEqual(art)
  })
})
