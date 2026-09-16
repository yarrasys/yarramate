import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/digest.js'

const reference = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex')

describe('sha256Hex', () => {
  it('matches node:crypto on the published test vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches node:crypto across block boundaries, UTF-8 and bytes', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 4097]) {
      const bytes = randomBytes(length)
      expect(sha256Hex(bytes), `${length} bytes`).toBe(reference(bytes))
      const text = 'ü'.repeat(length)
      expect(sha256Hex(text), `${length} umlauts`).toBe(reference(text))
    }
    expect(sha256Hex('format: yarramate/v1\nid: halcyon\n')).toBe(
      reference('format: yarramate/v1\nid: halcyon\n'),
    )
  })
})
