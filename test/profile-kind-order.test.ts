import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/index.js'

// #470: a profile's concept kinds resolved in DECLARATION ORDER, so a kind
// whose parent was declared below it was refused with
// `YM407 ... is not available` — the same message a genuinely missing kind
// gets. The author went looking for a typo while the file in front of them
// already declared the parent three lines down.
//
// A profile is a set of kind declarations. Resolution now runs in rounds until
// one adds nothing, so order carries no meaning.
//
// Found by the ApertureX session building a profile-adopt step that re-parents
// two shipped kinds under a new one: their append-only writer put the new
// parent at the end and moved the children's `parent` in place, which is the
// obvious thing for such a writer to do, and it was refused.

const profileWith = (kinds: readonly string[]) => `format: yarramate/profile/v1
id: acme/p
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
${kinds.join('\n')}
relationshipKinds: []
`

const FAMILY = `  - id: family
    name: Family
    parent: yarramate/core@0.1#artifact`
const LEAF = `  - id: leaf
    name: Leaf
    parent: acme/p@1.0#family`
const MID = `  - id: mid
    name: Mid
    parent: acme/p@1.0#leaf`

const document = `format: yarramate/v1
id: main
profile: acme/p@1.0
concepts: []
relationships: []
`

const compile = (kinds: readonly string[]) =>
  compileWorkspaceWithProfileContext([
    { path: 'profiles/p.yaml', source: profileWith(kinds) },
    { path: 'architecture/main.yaml', source: document },
  ])

const lineageOf = (kinds: readonly string[], kind: string) => {
  const result = compile(kinds)
  expect(result.ok).toBe(true)
  if (!result.ok) return undefined
  return result.profileContext.conceptKindLineages.get(`acme/p@1.0#${kind}`)
}

const codes = (kinds: readonly string[]) => {
  const result = compile(kinds)
  expect(result.ok).toBe(false)
  if (result.ok) return []
  return result.diagnostics.map(({ code }) => code)
}

const messages = (kinds: readonly string[]) => {
  const result = compile(kinds)
  if (result.ok) return []
  return result.diagnostics.map(({ message }) => message)
}

describe('#470: a profile is a set, not a sequence', () => {
  it('resolves a parent declared BELOW the kind that names it', () => {
    // The reported case. Refused before this.
    expect(lineageOf([LEAF, FAMILY], 'leaf')).toEqual([
      'yarramate/core@0.1#artifact',
      'acme/p@1.0#family',
      'acme/p@1.0#leaf',
    ])
  })

  it('gives the same lineage whichever order the kinds are written in', () => {
    // Asserted as an equality between the two orders rather than as a literal
    // twice, because the claim is that order carries no meaning — not that
    // both happen to produce a value someone wrote down.
    expect(lineageOf([LEAF, FAMILY], 'leaf')).toEqual(
      lineageOf([FAMILY, LEAF], 'leaf'),
    )
  })

  it('resolves a chain written fully backwards', () => {
    // Three deep and every parent below its child, so it takes three rounds.
    // A single pass could not do this in any order but one.
    expect(lineageOf([MID, LEAF, FAMILY], 'mid')).toEqual([
      'yarramate/core@0.1#artifact',
      'acme/p@1.0#family',
      'acme/p@1.0#leaf',
      'acme/p@1.0#mid',
    ])
  })

  it('still refuses a parent that is declared nowhere', () => {
    // The message this diagnostic was always right about, unchanged.
    const kinds = [
      `  - id: ghost
    name: Ghost
    parent: acme/p@1.0#nope`,
    ]
    expect(codes(kinds)).toEqual(['YM407'])
    expect(messages(kinds)[0]).toContain('is not available')
    expect(messages(kinds)[0]).not.toContain('cycle')
  })

  it('names a parent cycle as a cycle, which nothing could express before', () => {
    // Newly reachable: under one pass, whichever kind came first was refused
    // as a forward reference, so a cycle never survived to be diagnosed. Under
    // rounds both survive unresolved, and "not available" would be actively
    // wrong — the parent is right there, it just cannot ever have a lineage.
    const kinds = [
      `  - id: cyc-a
    name: A
    parent: acme/p@1.0#cyc-b`,
      `  - id: cyc-b
    name: B
    parent: acme/p@1.0#cyc-a`,
    ]
    expect(codes(kinds)).toEqual(['YM407', 'YM407'])
    for (const message of messages(kinds)) {
      expect(message).toContain('parent cycle')
      expect(message).not.toContain('is not available')
    }
  })

  it('does not let a cycle stop the kinds around it from resolving', () => {
    // The cycle is refused and the compile fails, but the diagnostics are
    // about the cycle alone: a healthy kind declared between the two halves
    // must not be swept up as collateral.
    const kinds = [
      `  - id: cyc-a
    name: A
    parent: acme/p@1.0#cyc-b`,
      FAMILY,
      `  - id: cyc-b
    name: B
    parent: acme/p@1.0#cyc-a`,
    ]
    expect(codes(kinds)).toEqual(['YM407', 'YM407'])
    expect(messages(kinds).join(' ')).not.toContain('family')
  })

  it('terminates on a kind that is its own parent', () => {
    // A one-kind cycle. The rounds have to stop on it as surely as on a
    // two-kind one, and the test exists because "repeat until nothing changes"
    // is exactly the shape that hangs when the base case is wrong.
    const kinds = [
      `  - id: selfish
    name: Selfish
    parent: acme/p@1.0#selfish`,
    ]
    expect(codes(kinds)).toEqual(['YM407'])
    expect(messages(kinds)[0]).toContain('parent cycle')
  })
})
