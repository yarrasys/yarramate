import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE_PRESET,
  STYLE_PRESETS,
  STYLE_PRESET_IDS,
  STYLE_STORAGE_KEY,
  isStylePresetId,
  presetBlocks,
  readStoredStylePreset,
  storeStylePreset,
  stylePresetOf,
} from '../src/visual-app/style-presets.js'
import { LAYER_COLORS } from '../src/notation/archimate.js'

const selectorsOf = (id: (typeof STYLE_PRESET_IDS)[number]) =>
  presetBlocks(id).map((block) => (block as { selector: string }).selector)

describe('style presets (ADR 0148)', () => {
  it('names every preset once, current first, and opens on it', () => {
    expect(STYLE_PRESETS.map((preset) => preset.id)).toEqual([...STYLE_PRESET_IDS])
    expect(DEFAULT_STYLE_PRESET).toBe('current')
    expect(stylePresetOf('current').title).toBe('Current')
    for (const preset of STYLE_PRESETS) expect(preset.blurb.length).toBeGreaterThan(20)
  })

  it('recognises a preset id and refuses anything else', () => {
    for (const id of STYLE_PRESET_IDS) expect(isStylePresetId(id)).toBe(true)
    expect(isStylePresetId('neon')).toBe(false)
    expect(isStylePresetId(null)).toBe(false)
    expect(stylePresetOf('neon' as never).id).toBe('current')
  })

  // `current` is what shipped: it must add nothing, so the base stylesheet
  // alone decides the picture.
  it('appends nothing for current', () => {
    expect(presetBlocks('current')).toEqual([])
  })

  // Every other dress recolours every layer the notation knows, so no layer
  // is left wearing the pastel of a different dress.
  it.each(['drafting', 'ink', 'tinted', 'dark'] as const)('%s recolours every layer', (id) => {
    const selectors = selectorsOf(id)
    for (const layer of Object.keys(LAYER_COLORS)) {
      expect(selectors).toContain(`node[layer = "${layer}"]`)
      expect(selectors).toContain(`node[layer = "${layer}"][aspect = "passive-structure"]:childless`)
    }
    for (const selector of ['node', 'node:parent', 'edge', 'edge.lifted', 'node.selected', 'edge.selected']) {
      expect(selectors).toContain(selector)
    }
  })

  // A dark ground needs a light glyph, or the notation's ink strokes vanish
  // into the fills; the light dresses keep the notation's own ink.
  it('asks for a light glyph and its own ground only where the ground is dark', () => {
    expect(stylePresetOf('dark').canvas).toBe('#12161b')
    expect(stylePresetOf('dark').glyph).toBe('#e5e9ed')
    for (const id of ['current', 'drafting', 'ink', 'tinted'] as const) {
      expect(stylePresetOf(id).canvas).toBeUndefined()
      expect(stylePresetOf(id).glyph).toBeUndefined()
    }
  })

  // The browser remembers the pick; a browser with no storage, or storage
  // that refuses, opens on the default rather than failing.
  it('remembers the pick in the browser and survives a missing store', () => {
    const held = new Map<string, string>()
    const storage = {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => {
        held.set(key, value)
      },
    }
    const previous = (globalThis as { localStorage?: unknown }).localStorage
    try {
      ;(globalThis as { localStorage?: unknown }).localStorage = storage
      expect(readStoredStylePreset()).toBe('current')
      storeStylePreset('tinted')
      expect(held.get(STYLE_STORAGE_KEY)).toBe('tinted')
      expect(readStoredStylePreset()).toBe('tinted')
      held.set(STYLE_STORAGE_KEY, 'neon')
      expect(readStoredStylePreset()).toBe('current')
      ;(globalThis as { localStorage?: unknown }).localStorage = {
        getItem: () => {
          throw new Error('refused')
        },
        setItem: () => {
          throw new Error('refused')
        },
      }
      expect(readStoredStylePreset()).toBe('current')
      expect(() => storeStylePreset('dark')).not.toThrow()
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = previous
    }
    expect(readStoredStylePreset()).toBe('current')
  })
})
