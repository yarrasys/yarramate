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

  it('still refuses an unknown key', () => {
    expect(validate({ ...base, collapsed: ['checkout'] })).toBe(false)
  })
})
