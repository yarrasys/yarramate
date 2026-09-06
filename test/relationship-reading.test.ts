import { describe, expect, it } from 'vitest'
import {
  RELATIONSHIP_READING,
  REVERSED_READING,
  humanizeKind,
  relationshipReading,
} from '../src/relationship-reading.js'
import { LAYERING_REVERSED_KINDS } from '../src/layout-mode.js'
import { relationshipKinds } from '../src/profile.js'

describe('relationship readings (ADR 0147)', () => {
  it('reads every core kind from the source', () => {
    for (const kind of relationshipKinds) {
      expect(RELATIONSHIP_READING[kind], kind).toBeDefined()
    }
    expect(relationshipReading('serving')).toBe('serves')
    expect(relationshipReading('realization')).toBe('realizes')
    expect(relationshipReading('access')).toBe('accesses')
    expect(relationshipReading('assignment')).toBe('is assigned to')
    expect(relationshipReading('association')).toBe('is associated with')
  })

  // The passive reading exists for exactly the kinds that turn for layering:
  // a canvas that draws the served element above reads "served by", and no
  // canvas reads "accessed by".
  it('reads the three turned kinds from the other end, and only those', () => {
    expect(Object.keys(REVERSED_READING).sort()).toEqual([...LAYERING_REVERSED_KINDS].sort())
    expect(relationshipReading('serving', true)).toBe('served by')
    expect(relationshipReading('realization', true)).toBe('realized by')
    expect(relationshipReading('specialization', true)).toBe('specialized by')
    expect(relationshipReading('association', true)).toBe('is associated with')
    expect(relationshipReading('access', true)).toBe('accesses')
  })

  it('spells out a kind it has no reading for', () => {
    expect(humanizeKind('acme/p@1.0#applicationComponent')).toBe('application component')
    expect(humanizeKind('deploys-to')).toBe('deploys to')
    expect(relationshipReading('deploys-to')).toBe('deploys to')
    expect(relationshipReading('deploys-to', true)).toBe('deploys to')
  })
})
