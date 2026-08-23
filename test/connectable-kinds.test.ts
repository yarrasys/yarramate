import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'
import {
  isCoreConceptKindId,
  permittedRelationshipKinds,
} from '../src/relationship-matrix.js'
import type { RelationshipKind } from '../src/profile.js'
import { CORE_CONCEPT_KIND_ORDER } from '../src/archimate-relationships.generated.js'

/**
 * An editor that offers only what `permittedRelationshipKinds` returns cannot
 * draw an edge the compiler rejects. That is the property a connection tool
 * rests on, and it is worth holding here rather than in the tool: it is about
 * the table and the compiler agreeing, and neither knows the tool exists.
 *
 * The palette is keyed on CORE kinds, which is why `CanvasNode` carries
 * `coreKindLabel`. A profile kind resolves through its lineage to one of these.
 */
const workspaceWith = (
  fromKind: string,
  toKind: string,
  relationshipKind: string,
) => `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: source
    kind: ${fromKind}
    name: Source
  - id: target
    kind: ${toKind}
    name: Target
relationships:
  - id: edge
    kind: ${relationshipKind}
    from: source
    to: target
`

const codesFor = (
  fromKind: string,
  toKind: string,
  relationshipKind: string,
): readonly string[] => {
  const result = compileWorkspace([
    { path: 'main.yaml', source: workspaceWith(fromKind, toKind, relationshipKind) },
  ])
  return result.ok ? [] : result.diagnostics.map((d) => d.code)
}

// A spread across aspects and layers rather than all 3,844 pairs: active
// structure to behaviour, behaviour to passive, motivation, technology, and a
// pair whose only legal answer is association.
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['applicationComponent', 'applicationFunction'],
  ['applicationComponent', 'applicationService'],
  ['applicationComponent', 'dataObject'],
  ['applicationFunction', 'dataObject'],
  ['businessActor', 'businessProcess'],
  ['businessProcess', 'businessObject'],
  ['node', 'artifact'],
  ['node', 'applicationComponent'],
  ['goal', 'requirement'],
  ['stakeholder', 'driver'],
  ['applicationComponent', 'goal'],
]

describe('the palette a connection tool would offer', () => {
  it('covers pairs whose kinds the table actually knows', () => {
    for (const [from, to] of PAIRS) {
      expect(isCoreConceptKindId(from), from).toBe(true)
      expect(isCoreConceptKindId(to), to).toBe(true)
    }
  })

  it('offers nothing the compiler would refuse with YM404', () => {
    for (const [from, to] of PAIRS) {
      if (!isCoreConceptKindId(from) || !isCoreConceptKindId(to)) continue
      for (const kind of permittedRelationshipKinds(from, to)) {
        expect(
          codesFor(from, to, kind),
          `${from} -${kind}-> ${to} was offered but refused`,
        ).not.toContain('YM404')
      }
    }
  })

  it('withholds nothing the compiler would accept', () => {
    // The other half: a kind absent from the palette must be one the compiler
    // actually rejects, or the tool would be hiding a legal edge.
    const everyKind = new Set<RelationshipKind>()
    for (const from of CORE_CONCEPT_KIND_ORDER) {
      for (const to of CORE_CONCEPT_KIND_ORDER) {
        if (!isCoreConceptKindId(from) || !isCoreConceptKindId(to)) continue
        for (const kind of permittedRelationshipKinds(from, to)) {
          everyKind.add(kind)
        }
      }
    }

    for (const [from, to] of PAIRS) {
      if (!isCoreConceptKindId(from) || !isCoreConceptKindId(to)) continue
      const offered = permittedRelationshipKinds(from, to)
      for (const kind of everyKind) {
        if (offered.has(kind)) continue
        expect(
          codesFor(from, to, kind),
          `${from} -${kind}-> ${to} was withheld but accepted`,
        ).toContain('YM404')
      }
    }
  })

  it('always leaves association available, so no pair is a dead end', () => {
    for (const [from, to] of PAIRS) {
      if (!isCoreConceptKindId(from) || !isCoreConceptKindId(to)) continue
      expect(
        [...permittedRelationshipKinds(from, to)],
        `${from} -> ${to}`,
      ).toContain('association')
    }
  })
})
