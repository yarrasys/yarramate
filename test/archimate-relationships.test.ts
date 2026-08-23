import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ARCHIMATE_RELATIONSHIPS_VERSION,
  CORE_CONCEPT_KIND_ORDER,
  PERMITTED_RELATIONSHIP_LETTERS,
  RELATIONSHIP_LETTERS,
} from '../src/archimate-relationships.generated.js'
import { conceptKinds, relationshipKinds } from '../src/profile.js'
import {
  matrixEndpointAspects,
  permittedRelationshipKinds,
  relationshipPermitted,
  sourceKindsPermitting,
  targetKindsPermitting,
} from '../src/relationship-matrix.js'
// The generator is plain ESM with no build step; importing it here is what
// lets the test re-run it against the vendored XML.
import { generate } from '../scripts/generate-archimate-relationships.mjs'

const generated = fileURLToPath(
  new URL('../src/archimate-relationships.generated.ts', import.meta.url),
)

describe('the vendored ArchiMate relationship table', () => {
  it('is the table the committed module was generated from, byte for byte', () => {
    // The runtime never reads the XML, so the only thing that keeps the
    // committed module honest is this: regenerate and compare.
    expect(readFileSync(generated, 'utf8')).toBe(generate())
  })

  it('encodes ArchiMate 3.2', () => {
    expect(ARCHIMATE_RELATIONSHIPS_VERSION).toBe('3.2')
  })

  it('covers every core concept kind exactly once', () => {
    expect([...CORE_CONCEPT_KIND_ORDER].sort()).toEqual(
      conceptKinds.map((kind) => kind.id).sort(),
    )
  })

  it('names every core relationship kind exactly once', () => {
    expect(Object.values(RELATIONSHIP_LETTERS).sort()).toEqual(
      [...relationshipKinds].sort(),
    )
  })

  it('carries one letter group per target kind on every row', () => {
    for (const from of CORE_CONCEPT_KIND_ORDER) {
      expect(
        PERMITTED_RELATIONSHIP_LETTERS[from].split(' '),
        `row ${from}`,
      ).toHaveLength(CORE_CONCEPT_KIND_ORDER.length)
    }
  })

  it('permits association between every pair, so no permitted set is empty', () => {
    for (const from of CORE_CONCEPT_KIND_ORDER) {
      for (const to of CORE_CONCEPT_KIND_ORDER) {
        expect(
          relationshipPermitted(from, 'association', to),
          `${from} -> ${to}`,
        ).toBe(true)
      }
    }
  })

  it('gives both junctions identical rows and columns', () => {
    expect(PERMITTED_RELATIONSHIP_LETTERS.andJunction).toBe(
      PERMITTED_RELATIONSHIP_LETTERS.orJunction,
    )
    for (const from of CORE_CONCEPT_KIND_ORDER) {
      expect(permittedRelationshipKinds(from, 'andJunction')).toEqual(
        permittedRelationshipKinds(from, 'orJunction'),
      )
    }
  })
})

describe('rulings the migration and the catalogue were built on', () => {
  it.each([
    ['node', 'assignment', 'applicationComponent', false],
    ['node', 'realization', 'applicationComponent', true],
    ['node', 'serving', 'applicationComponent', true],
    ['applicationComponent', 'assignment', 'applicationInterface', false],
    ['applicationComponent', 'composition', 'applicationInterface', true],
    ['applicationComponent', 'assignment', 'node', false],
    ['businessActor', 'assignment', 'capability', false],
    ['resource', 'assignment', 'capability', true],
    ['businessActor', 'assignment', 'applicationProcess', false],
    ['businessActor', 'assignment', 'businessService', true],
    ['courseOfAction', 'realization', 'capability', false],
    ['capability', 'realization', 'courseOfAction', true],
    ['courseOfAction', 'composition', 'applicationComponent', false],
    ['deliverable', 'realization', 'gap', false],
    ['deliverable', 'realization', 'plateau', true],
    ['applicationInterface', 'realization', 'contract', false],
    ['applicationInterface', 'access', 'dataObject', true],
    ['applicationComponent', 'realization', 'dataObject', false],
    ['dataObject', 'realization', 'dataObject', false],
    ['artifact', 'realization', 'dataObject', true],
    ['artifact', 'realization', 'applicationComponent', true],
    ['artifact', 'realization', 'capability', true],
    ['capability', 'realization', 'businessService', false],
    ['capability', 'realization', 'goal', true],
    ['applicationService', 'access', 'dataObject', true],
    ['applicationService', 'access', 'contract', true],
    ['applicationFunction', 'realization', 'dataObject', false],
    ['workPackage', 'realization', 'deliverable', true],
    ['goal', 'assignment', 'businessProcess', false],
  ] as const)('%s -%s-> %s permitted: %s', (from, kind, to, permitted) => {
    expect(relationshipPermitted(from, kind, to)).toBe(permitted)
  })

  it('permits triggering exactly as ArchiMate does, including between active structure', () => {
    // The rule this replaced pinned triggering to behavior at both ends;
    // Appendix B derives active-to-active and active-to-behavior triggering.
    expect(
      relationshipPermitted('applicationComponent', 'triggering', 'applicationComponent'),
    ).toBe(true)
    expect(relationshipPermitted('businessActor', 'triggering', 'businessActor')).toBe(
      true,
    )
    expect(
      relationshipPermitted('businessProcess', 'triggering', 'businessProcess'),
    ).toBe(true)
    expect(relationshipPermitted('applicationComponent', 'triggering', 'dataObject')).toBe(
      false,
    )
    expect(relationshipPermitted('goal', 'triggering', 'goal')).toBe(false)
  })

  it('lets a junction join anything but constrains what leaves it', () => {
    // The junction column is fully permissive; the junction row is not.
    for (const from of CORE_CONCEPT_KIND_ORDER) {
      expect(relationshipPermitted(from, 'triggering', 'andJunction')).toBe(true)
    }
    expect(relationshipPermitted('andJunction', 'triggering', 'businessProcess')).toBe(
      true,
    )
    expect(relationshipPermitted('andJunction', 'triggering', 'goal')).toBe(false)
  })
})

describe('the aspect shadow the table casts', () => {
  // These pin the coarse view two older surfaces still speak in: YM412's
  // narrow-only rule for extension profiles, and the `ask --kinds` roster.
  // Junction endpoints are excluded from the derivation, or every aspect
  // would be a source of every kind.
  it('keeps assignment sourced from active structure (and composites)', () => {
    expect([...matrixEndpointAspects('assignment', 'source')].sort()).toEqual([
      'active-structure',
      'composite',
    ])
  })

  it('keeps access targeted at passive structure (and composites)', () => {
    expect([...matrixEndpointAspects('access', 'target')].sort()).toEqual([
      'composite',
      'passive-structure',
    ])
  })

  it('keeps influence targeted at motivation (and composites)', () => {
    expect([...matrixEndpointAspects('influence', 'target')].sort()).toEqual([
      'composite',
      'motivation',
    ])
  })

  it('widens triggering to active structure and behavior at both ends', () => {
    for (const endpoint of ['source', 'target'] as const) {
      expect([...matrixEndpointAspects('triggering', endpoint)].sort()).toEqual([
        'active-structure',
        'behavior',
        'composite',
      ])
    }
  })

  it('answers which kinds may stand at either end of a relationship', () => {
    expect(sourceKindsPermitting('assignment', 'capability')).toEqual(
      new Set(['resource', 'andJunction', 'orJunction', 'grouping']),
    )
    expect(targetKindsPermitting('realization', 'gap').size).toBeGreaterThan(0)
    expect(targetKindsPermitting('realization', 'gap').has('plateau')).toBe(false)
  })
})
