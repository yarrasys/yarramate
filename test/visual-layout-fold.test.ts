import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

// #473: the sidecar gained optional `folded` / `unfolded`, written WITH the
// positions in one document. Deliberately still `yarramate/visual-layout/v1`
// and not a v2: the addition is optional, so every sidecar a previous release
// wrote is still exactly valid, and a v2 would force every reader to branch on
// a version for a field it can simply not find.
//
// Compiled the way `session-server.ts` compiles it — the projection schema
// added first, because the sidecar `$ref`s that schema for its projection id.

const Ajv2020 = Ajv2020Module.default
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (name: string) =>
  JSON.parse(readFileSync(join(root, 'schema', name), 'utf8')) as object

const ajv = new Ajv2020({ allErrors: true })
ajv.addSchema(read('yarramate-projection.schema.json'))
const validate = ajv.compile(read('yarramate-visual-layout.schema.json'))

const base = {
  format: 'yarramate/visual-layout/v1',
  projectionId: 'apps',
  positions: { checkout: { x: 1, y: 2 } },
}

describe('#473: the layout sidecar carries fold state', () => {
  it('still accepts a sidecar written before fold existed', () => {
    // The assertion that matters most: this is every sidecar on every disk.
    expect(validate(base)).toBe(true)
  })

  it('accepts both lists beside the positions', () => {
    expect(validate({ ...base, folded: ['checkout'], unfolded: [] })).toBe(true)
    expect(validate({ ...base, folded: [], unfolded: ['checkout'] })).toBe(true)
  })

  it('keeps the format at v1', () => {
    // A v2 would force every reader to branch on a version for a field it can
    // simply not find.
    expect(validate({ ...base, format: 'yarramate/visual-layout/v2' })).toBe(false)
  })

  it('refuses ids that are not non-empty strings', () => {
    expect(validate({ ...base, folded: [1] })).toBe(false)
    expect(validate({ ...base, folded: [''] })).toBe(false)
  })

  it('refuses a repeated id', () => {
    // A set, not a list: an id folded twice is a bug in whatever wrote it.
    expect(validate({ ...base, folded: ['checkout', 'checkout'] })).toBe(false)
  })

  // ADR 0147: the routes the canvas was drawing ride beside the positions
  // they were computed for, so a reader who moved one subject keeps every
  // other edge's route.
  it('accepts the routes beside the positions', () => {
    expect(
      validate({
        ...base,
        routes: {
          'a-serves-b': { points: [{ x: 0, y: 25 }, { x: 0, y: 100 }, { x: 300, y: 100 }], labelAt: 40 },
          'b-flows-c': { points: [{ x: 85, y: 0 }, { x: 215, y: 0 }], labelAt: null },
        },
      }),
    ).toBe(true)
  })

  it('refuses a route with fewer than two points, a stray key, or a non-numeric label position', () => {
    expect(validate({ ...base, routes: { e: { points: [{ x: 0, y: 0 }], labelAt: null } } })).toBe(false)
    expect(validate({ ...base, routes: { e: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], labelAt: null, bend: true } } })).toBe(false)
    expect(validate({ ...base, routes: { e: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], labelAt: 'mid' } } })).toBe(false)
    expect(validate({ ...base, routes: { e: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } } })).toBe(false)
  })

  it('still refuses an unknown key', () => {
    expect(validate({ ...base, collapsed: ['checkout'] })).toBe(false)
  })
})
