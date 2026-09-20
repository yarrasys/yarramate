import { describe, expect, it } from 'vitest'
// Deliberately the published entry, not the module the rule lives in: what
// this file guards is that a consumer drawing the canvas's picture somewhere
// else can reach the decision, which is exactly what #576 was about. Importing
// `./elk-layout.js` here would pass while the package exported nothing.
import {
  DEFAULT_LAYOUT,
  edgeLabelText,
  LAYOUT_MODES,
  type EdgeLabelData,
  type LayoutMode,
} from '../src/visual-app/mount.js'
import { reversesForLayering } from '../src/layout-mode.js'

const serving = (extra: Partial<EdgeLabelData> = {}): EdgeLabelData => ({
  coreKindLabel: 'serving',
  kindLabel: 'serving',
  ...extra,
})

describe('the edge-label rule travels with the editor (#576)', () => {
  it('is reachable from the entry a consumer mounts, with its data type', () => {
    expect(typeof edgeLabelText).toBe('function')
    expect(LAYOUT_MODES).toContain(DEFAULT_LAYOUT)
  })

  // The branch ApertureX had to guess at: they tested the mode names, we test
  // the predicate, and the two agreed only by coincidence of the current list.
  // Iterating every published mode means a mode added later is covered here
  // without anyone remembering to come back.
  it('reads the reversed form in exactly the modes that layer the target above', () => {
    const readings = new Map<LayoutMode, string>(
      LAYOUT_MODES.map((mode) => [mode, edgeLabelText(serving(), mode, true)]),
    )
    for (const mode of LAYOUT_MODES) {
      expect(readings.get(mode)).toBe(
        reversesForLayering(mode) ? 'served by' : 'serves',
      )
    }
    // Both forms are actually reached, so the loop cannot pass by asserting
    // one answer everywhere.
    expect(new Set(readings.values())).toEqual(new Set(['serves', 'served by']))
  })

  it('never reverses a kind that has no passive reading', () => {
    for (const mode of LAYOUT_MODES) {
      expect(
        edgeLabelText(
          { coreKindLabel: 'access', kindLabel: 'access' },
          mode,
          true,
        ),
      ).toBe('accesses')
    }
  })

  it('prefers the name the author gave the edge, even over kind labels being off', () => {
    expect(edgeLabelText(serving({ name: 'pays' }), 'served-by', true)).toBe('pays')
    expect(edgeLabelText(serving({ name: 'pays' }), 'layered', false)).toBe('pays')
  })

  it('says nothing when kind labels are off, leaving the line and arrowhead', () => {
    expect(edgeLabelText(serving(), 'served-by', false)).toBe('')
  })

  it('prefers a reading the endpoints decided over the table', () => {
    expect(
      edgeLabelText(serving({ reading: 'signs off' }), 'served-by', true),
    ).toBe('signs off')
  })

  it('spells out a subkind rather than its core reading', () => {
    expect(
      edgeLabelText(
        { coreKindLabel: 'serving', kindLabel: 'deploys-to' },
        'served-by',
        true,
      ),
    ).toBe('deploys to')
  })

  it('says how many relationships a lifted edge stands for', () => {
    expect(edgeLabelText(serving({ liftedCount: 3 }), 'layered', true)).toBe(
      'serves ×3',
    )
    expect(edgeLabelText(serving({ liftedCount: 1 }), 'layered', true)).toBe(
      'serves',
    )
  })
})
