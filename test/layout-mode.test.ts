import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  LAYERING_REVERSED_KINDS,
  LAYER_BAND,
  LAYOUT_MODES,
  isLayoutMode,
  layerBandOf,
  partitionsByLayer,
  reversesForLayering,
  routesEdges,
} from '../src/layout-mode.js'
import { layers } from '../src/profile.js'

const enumOf = (path: string): readonly string[] => {
  const schema = JSON.parse(readFileSync(path, 'utf8')) as {
    $defs?: { presentation?: { properties: { layout: { enum: string[] } } } }
    properties?: { presentation?: { properties: { layout: { enum: string[] } } } }
  }
  const presentation = schema.$defs?.presentation ?? schema.properties?.presentation
  if (presentation === undefined) throw new Error(`no presentation block in ${path}`)
  return presentation.properties.layout.enum
}

describe('layout modes (ADR 0147)', () => {
  // Served-by, because it read correctly the first time anyone looked at real
  // tiers; a view that wants the pre-1.24 picture says `layered`.
  it('lays a silent view out served-by', () => {
    expect(DEFAULT_LAYOUT).toBe('served-by')
    expect(LAYOUT_MODES).toContain(DEFAULT_LAYOUT)
  })

  // The module is the vocabulary the schema admits, stated once: a mode the
  // format accepts and the canvas cannot name, or the reverse, is a defect.
  it('names exactly the modes the projection schema and its result schema admit', () => {
    expect([...LAYOUT_MODES]).toEqual(enumOf('schema/yarramate-projection.schema.json'))
    expect([...LAYOUT_MODES]).toEqual(enumOf('schema/yarramate-projection-result.schema.json'))
  })

  it('recognises a mode and refuses anything else', () => {
    for (const mode of LAYOUT_MODES) expect(isLayoutMode(mode)).toBe(true)
    expect(isLayoutMode('force')).toBe(false)
    expect(isLayoutMode(undefined)).toBe(false)
  })

  // A ladder: each mode keeps everything below it.
  it.each([
    ['layered', false, false, false],
    ['routed', true, false, false],
    ['served-by', true, true, false],
    ['bands', true, true, true],
  ] as const)('%s routes=%s reverses=%s bands=%s', (mode, routes, reverses, bands) => {
    expect(routesEdges(mode)).toBe(routes)
    expect(reversesForLayering(mode)).toBe(reverses)
    expect(partitionsByLayer(mode)).toBe(bands)
  })

  it('turns exactly the three kinds ArchiMate draws target-above-source', () => {
    expect([...LAYERING_REVERSED_KINDS].sort()).toEqual(['realization', 'serving', 'specialization'])
  })

  // Motivation at the top, physical at the bottom, the way an ArchiMate
  // layered view stacks. `composite` has no band and an unlayered subject
  // floats free.
  it('orders the bands top to bottom the way ArchiMate stacks them', () => {
    const ordered = ['motivation', 'strategy', 'business', 'application', 'technology', 'physical', 'implementation']
    for (let i = 1; i < ordered.length; i += 1) {
      expect(LAYER_BAND[ordered[i]!]).toBeGreaterThan(LAYER_BAND[ordered[i - 1]!]!)
    }
    expect(layerBandOf('composite')).toBeUndefined()
    expect(layerBandOf(null)).toBeUndefined()
    expect(layerBandOf(undefined)).toBeUndefined()
  })

  it('bands every layer the profile declares except composite', () => {
    for (const layer of layers) {
      if (layer === 'composite') continue
      expect(layerBandOf(layer)).toBeDefined()
    }
  })
})
