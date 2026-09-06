import { describe, expect, it } from 'vitest'
import {
  LAYOUT_SIDECAR_DIR,
  isLayoutSidecarPath,
  layoutSidecarPath,
  readLayoutSidecars,
} from '../src/adapters/visual/layout-sidecar.js'

// One reader for both hosts (#503). What it accepts is the sidecar schema;
// what it yields is exactly what the session server used to build for itself.
const sidecar = (extra = '') => `format: yarramate/visual-layout/v1
projectionId: apps
positions:
  checkout: { x: 1, y: 2 }
  ledger: { x: 300, y: 60 }
${extra}`

describe('readLayoutSidecars', () => {
  it('yields positions, routes and a stated fold, keyed by the projection each sidecar names', () => {
    const read = readLayoutSidecars([
      {
        path: layoutSidecarPath('apps'),
        source: sidecar(`folded: [checkout]
unfolded: []
routes:
  checkout-serves-ledger:
    points: [{ x: 86, y: 2 }, { x: 150, y: 2 }, { x: 150, y: 60 }]
    labelAt: 64
`),
      },
      {
        path: layoutSidecarPath('other'),
        source: `format: yarramate/visual-layout/v1\nprojectionId: other\npositions:\n  a: { x: 0, y: 0 }\n`,
      },
    ])
    expect(read.layouts).toEqual({
      apps: { checkout: { x: 1, y: 2 }, ledger: { x: 300, y: 60 } },
      other: { a: { x: 0, y: 0 } },
    })
    expect(read.routes).toEqual({
      apps: {
        'checkout-serves-ledger': {
          points: [{ x: 86, y: 2 }, { x: 150, y: 2 }, { x: 150, y: 60 }],
          labelAt: 64,
        },
      },
    })
    expect(read.folds).toEqual({ apps: { folded: ['checkout'], unfolded: [] } })
  })

  // A sidecar written before #473 says nothing about folding, not "fold
  // nothing": the view's default decides. Only a stated list yields an entry.
  it('yields no fold entry for a sidecar that states none, and one for a sidecar that states one list', () => {
    expect(readLayoutSidecars([{ path: layoutSidecarPath('apps'), source: sidecar() }]).folds).toEqual({})
    expect(
      readLayoutSidecars([{ path: layoutSidecarPath('apps'), source: sidecar('unfolded: [ledger]\n') }]).folds,
    ).toEqual({ apps: { folded: [], unfolded: ['ledger'] } })
  })

  it('skips a sidecar that does not parse or does not validate, and keeps the rest', () => {
    const read = readLayoutSidecars([
      { path: layoutSidecarPath('broken'), source: 'format: [unclosed' },
      {
        path: layoutSidecarPath('short'),
        source: sidecar(`routes:\n  e:\n    points: [{ x: 0, y: 0 }]\n    labelAt: null\n`).replace('projectionId: apps', 'projectionId: short'),
      },
      { path: layoutSidecarPath('stray'), source: sidecar('bend: true\n').replace('projectionId: apps', 'projectionId: stray') },
      { path: layoutSidecarPath('apps'), source: sidecar() },
    ])
    expect(Object.keys(read.layouts)).toEqual(['apps'])
  })
})

describe('the sidecar path', () => {
  it('is one file per projection under the sidecar directory, in yaml', () => {
    expect(layoutSidecarPath('apps')).toBe(`${LAYOUT_SIDECAR_DIR}/apps.yaml`)
    expect(isLayoutSidecarPath(layoutSidecarPath('apps'))).toBe(true)
    expect(isLayoutSidecarPath(`${LAYOUT_SIDECAR_DIR}/apps.yml`)).toBe(true)
  })

  it('refuses anything else the store may hold', () => {
    expect(isLayoutSidecarPath('architecture/main.yaml')).toBe(false)
    expect(isLayoutSidecarPath(`${LAYOUT_SIDECAR_DIR}/nested/apps.yaml`)).toBe(false)
    expect(isLayoutSidecarPath(`${LAYOUT_SIDECAR_DIR}/notes.md`)).toBe(false)
    expect(isLayoutSidecarPath(`${LAYOUT_SIDECAR_DIR}-old/apps.yaml`)).toBe(false)
  })
})
