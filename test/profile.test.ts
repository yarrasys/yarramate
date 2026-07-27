import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  aspects,
  conceptKinds,
  layers,
  relationshipKinds,
  relationshipPolicies,
} from '../src/profile.js'

const specificationPath = fileURLToPath(
  new URL('../.yarramate/integrations/likec4/prototype/specification.likec4', import.meta.url),
)
const specification = readFileSync(specificationPath, 'utf8')

const declarations = (declaration: 'element' | 'relationship'): string[] =>
  [...specification.matchAll(new RegExp(`^\\s*${declaration}\\s+(\\w+)`, 'gm'))]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined)

describe('YarraMate semantic profile', () => {
  it('uses unique, valid concept identifiers and coordinates', () => {
    const ids = conceptKinds.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(
      conceptKinds.every(
        ({ id, layer, aspect }) =>
          /^[a-z][A-Za-z0-9]*$/.test(id) &&
          layers.includes(layer) &&
          aspects.includes(aspect),
      ),
    ).toBe(true)
  })

  it('keeps the machine catalogue synchronized with LikeC4', () => {
    expect(declarations('element').sort()).toEqual(
      conceptKinds.map(({ id }) => id).sort(),
    )
    expect(declarations('relationship').sort()).toEqual(
      [...relationshipKinds].sort(),
    )
  })

  it('defines one policy for every relationship kind', () => {
    expect(relationshipPolicies.map(({ id }) => id).sort()).toEqual(
      [...relationshipKinds].sort(),
    )
  })

  it('records compatibility as an explicit pointer', () => {
    expect(
      conceptKinds.every(({ inspiredBy }) =>
        inspiredBy.startsWith('ArchiMate-inspired:'),
      ),
    ).toBe(true)
  })
})
