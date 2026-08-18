import { describe, expect, it } from 'vitest'
import { conceptKinds, layers, relationshipKinds } from '../src/profile.js'
import {
  CONCEPT_NOTATION,
  LAYER_COLORS,
  RELATIONSHIP_NOTATION,
  conceptNotationOf,
  kindGlyphDataUriOf,
  relationshipNotationOf,
} from '../src/notation/archimate.js'

const KNOWN_GLYPHS = [
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
] as const

describe('archimate notation vocabulary', () => {
  it('covers every core concept kind exactly once', () => {
    const ids = CONCEPT_NOTATION.map((row) => row.id).sort()
    const expected = conceptKinds.map((k) => k.id).sort()
    expect(ids).toEqual(expected)
  })

  it('covers every core relationship kind exactly once', () => {
    const ids = RELATIONSHIP_NOTATION.map((row) => row.id).sort()
    const expected = [...relationshipKinds].sort()
    expect(ids).toEqual(expected)
  })

  it('uses the locked canvas layer palette', () => {
    expect(LAYER_COLORS.motivation).toEqual({ fill: '#CCCCFF', border: '#8F8FE0' })
    expect(LAYER_COLORS.strategy).toEqual({ fill: '#F5DEAA', border: '#C9A355' })
    expect(LAYER_COLORS.business).toEqual({ fill: '#FFFF99', border: '#C9C355' })
    expect(LAYER_COLORS.application).toEqual({ fill: '#CCFFFF', border: '#4FB8B8' })
    expect(LAYER_COLORS.technology).toEqual({ fill: '#CCFFCC', border: '#5FAE5F' })
    expect(LAYER_COLORS.implementation).toEqual({ fill: '#FFE0E0', border: '#D89999' })
    expect(LAYER_COLORS.physical).toEqual({ fill: '#F0F0F0', border: '#999999' })
    expect(LAYER_COLORS.composite).toEqual({ fill: '#F0F0F0', border: '#999999' })
    for (const layer of layers) {
      expect(LAYER_COLORS[layer]).toEqual(
        expect.objectContaining({ fill: expect.any(String), border: expect.any(String) }),
      )
    }
  })

  it('derives shape tokens from aspect', () => {
    expect(conceptNotationOf('applicationComponent')).toMatchObject({
      aspect: 'active-structure',
      shape: 'rectangle',
    })
    expect(conceptNotationOf('applicationFunction')).toMatchObject({
      aspect: 'behavior',
      shape: 'round-rectangle',
    })
    expect(conceptNotationOf('dataObject')).toMatchObject({
      aspect: 'passive-structure',
      shape: 'rectangle',
      accent: 'top-band',
    })
    expect(conceptNotationOf('goal')).toMatchObject({
      aspect: 'motivation',
      shape: 'octagon',
    })
    expect(conceptNotationOf('grouping')).toMatchObject({
      aspect: 'composite',
      shape: 'rectangle',
      borderStyle: 'dashed',
    })
  })

  it('ships glyphs for the 17 kinds the canvas already drew; null otherwise is allowed', () => {
    for (const id of KNOWN_GLYPHS) {
      expect(conceptNotationOf(id)?.glyph).toEqual(expect.any(String))
      expect(kindGlyphDataUriOf(id)).toMatch(/^data:image\/svg\+xml;utf8,/)
    }
    // A core kind never drawn before may be null — stakeholder is one.
    const stakeholder = conceptNotationOf('stakeholder')
    expect(stakeholder).not.toBeNull()
    // glyph may be null or string; lookup still works
    expect(conceptNotationOf('notAKind')).toBeNull()
    expect(kindGlyphDataUriOf('notAKind')).toBeNull()
  })

  it('maps composition and realization edge notation', () => {
    expect(relationshipNotationOf('composition')).toEqual({
      id: 'composition',
      lineStyle: 'solid',
      sourceArrow: { shape: 'diamond', fill: 'filled' },
      targetArrow: { shape: 'none' },
    })
    expect(relationshipNotationOf('realization')).toEqual({
      id: 'realization',
      lineStyle: 'dotted',
      sourceArrow: { shape: 'none' },
      targetArrow: { shape: 'triangle', fill: 'hollow' },
    })
  })

  it('does not publish profile-extended aliases', () => {
    expect(conceptNotationOf('compiler-module')).toBeNull()
    expect(conceptNotationOf('repository-file')).toBeNull()
  })
})
