import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  composeCatalogues,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// `below-subject-count` (#411): a vocabulary question needs to ask for a
// VOCABULARY, and `no-subject-of-kind` closes on the first term.
//
// The adopter's two field cases are the whole motivation, and they differ in
// the way that matters. In the first, one `sensitivity-class` was authored
// incidentally to answer a per-object question, which closed the "which
// classes does this platform recognise?" question four versions before it was
// ever asked; it self-corrected seven versions later only because a second
// object arrived and a human noticed it could point at nothing right. In the
// second, `integration-style` closed after one style and nothing will ever
// disagree with it, so a one-term vocabulary sits there looking declared
// forever. The first case was luck. The second has no forcing function, and
// that is what this condition is for.

const workspaceOf = (concepts: string) => {
  const result = compileWorkspaceWithProfileContext([
    {
      path: 'architecture/main.yaml',
      source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:${concepts}
relationships: []
`,
    },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

const grouping = (id: string) => `
  - id: ${id}
    kind: grouping
    name: ${id}`

const NONE = workspaceOf(' []')
const ONE = workspaceOf(grouping('confidential'))
const TWO = workspaceOf(grouping('confidential') + grouping('public'))
const THREE = workspaceOf(
  grouping('confidential') + grouping('public') + grouping('internal'),
)

const catalogueSource = (trigger: string) => `format: yarramate/question-catalogue/v1
id: fixture
version: "1.0"
profile: yarramate/core@0.1
presentation:
  title: Fixture
  description: A vocabulary question.
waves:
  - id: vocabulary
    name: Vocabulary
questions:
  - id: classes-undeclared
    wave: vocabulary
    since: "1.0"
    scope: workspace
    trigger:
${trigger}
    question: Which sensitivity classes does this platform recognise?
    materiality: A one-term vocabulary is indistinguishable from a complete one.
    authority: human
    resolution: Declare the classes this platform recognises.
`

const load = (trigger: string) =>
  loadQuestionCatalogue({
    path: 'catalogues/fixture.yaml',
    source: catalogueSource(trigger),
  })

const loadOrThrow = (trigger: string) => {
  const result = load(trigger)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.catalogue
}

const isOpen = (trigger: string, compiled: typeof NONE): boolean =>
  evaluateCatalogue(
    loadOrThrow(trigger),
    compiled.graph,
    compiled.profileContext,
  )
    .waves.flatMap(({ questions }) => questions)
    .find(({ id }) => id.endsWith('classes-undeclared'))!.open

const atLeast = (n: number, kind = 'grouping') => `      - condition: below-subject-count
        kinds:
          - yarramate/core@0.1#${kind}
        atLeast: ${n}
`

describe('a vocabulary question stays open until the vocabulary has terms', () => {
  it('is open when the model holds none', () => {
    expect(isOpen(atLeast(2), NONE)).toBe(true)
  })

  it('is STILL open at one, which is the whole point', () => {
    // `no-subject-of-kind` closes here. That is the defect: the single class
    // a consultant authored to answer a different question satisfies the
    // vocabulary question, and it never appears.
    expect(isOpen(atLeast(2), ONE)).toBe(true)
  })

  it('closes once the floor is reached', () => {
    expect(isOpen(atLeast(2), TWO)).toBe(false)
  })

  it('stays closed above the floor', () => {
    expect(isOpen(atLeast(2), THREE)).toBe(false)
  })

  it('honours a floor higher than two', () => {
    expect(isOpen(atLeast(3), TWO)).toBe(true)
    expect(isOpen(atLeast(3), THREE)).toBe(false)
  })
})

// The adopter's `sensitivity-class` is a `grouping` SPECIALIZATION, so the
// counting has to reach through profile lineage. Plain groupings would not
// test that at all: a fixture has to hold a declared child kind, or "counts
// descendants" is a claim about a case the test never builds.
const SPECIALIZED = (() => {
  const result = compileWorkspaceWithProfileContext([
    {
      path: 'profile.yaml',
      source: `format: yarramate/profile/v1
id: acme/consulting
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: sensitivity-class
    name: Sensitivity class
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`,
    },
    {
      path: 'architecture/main.yaml',
      source: `format: yarramate/v1
id: main
profile: acme/consulting@1.0
concepts:
  - id: confidential
    kind: sensitivity-class
    name: Confidential
  - id: public
    kind: sensitivity-class
    name: Public
relationships: []
`,
    },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
})()

describe('counting follows the same kind rules as the rest of the family', () => {
  it('counts a profile-declared specialization by default', () => {
    // Two `sensitivity-class` subjects, counted against the core `grouping`
    // the catalogue names. Flip the default to `exact` and this fires,
    // because neither subject IS a grouping.
    expect(isOpen(atLeast(2), SPECIALIZED)).toBe(false)
    expect(isOpen(atLeast(3), SPECIALIZED)).toBe(true)
  })

  it('counts only the named kind under kindMatching: exact', () => {
    const exact = `      - condition: below-subject-count
        kinds:
          - yarramate/core@0.1#grouping
        atLeast: 2
        kindMatching: exact
`
    expect(isOpen(exact, SPECIALIZED)).toBe(true)
  })

  it('counts nothing of another kind', () => {
    const ACTORS = workspaceOf(`
  - id: teller
    kind: businessActor
    name: Teller
  - id: clerk
    kind: businessActor
    name: Clerk`)
    expect(isOpen(atLeast(2), ACTORS)).toBe(true)
  })
})

describe('the degenerate spellings are refused rather than accepted quietly', () => {
  // Two names for one condition is the thing this design refuses wherever it
  // finds it, and a threshold nothing could fall below is `YM914`'s defect
  // arriving through arithmetic.
  const diagnostics = (n: number) => {
    const result = load(atLeast(n))
    if (result.ok) throw new Error(`atLeast: ${n} was accepted`)
    return result.diagnostics
  }

  it('refuses atLeast 1 and names the condition that already says it', () => {
    const [first] = diagnostics(1)
    expect(first?.code).toBe('YM918')
    expect(first?.message).toContain('no-subject-of-kind')
  })

  it('refuses atLeast 0 structurally, before the semantic check sees it', () => {
    // Two layers on purpose. A floor below 1 is nonsense about counting, so
    // the schema refuses it (`minimum: 1`) and reports a shape error. A floor
    // of exactly 1 is well-formed and means something the vocabulary already
    // says, which no schema can know, so `YM918` refuses that one and names
    // the condition the author actually wanted.
    expect(diagnostics(0)[0]?.code).not.toBe('YM918')
    expect(load(atLeast(0)).ok).toBe(false)
  })

  it('still refuses atLeast 0 from a host that never saw the schema', () => {
    // `loadQuestionCatalogue` is not the only door: the engine's guard is
    // `< 2`, not `=== 1`, so a programmatically composed catalogue cannot
    // slip a never-firing question past the schema layer.
    const result = loadQuestionCatalogue({
      path: 'catalogues/fixture.yaml',
      source: catalogueSource(atLeast(1)),
    })
    expect(result.ok).toBe(false)
  })

  it('accepts the smallest threshold that means something new', () => {
    expect(load(atLeast(2)).ok).toBe(true)
  })
})

describe('it is a workspace condition, so it may gate a wave', () => {
  // The adopter asked for this explicitly: "open once at least two runtime
  // planes exist" is coherent. Scope is declared in CONDITION_SCOPE, and
  // YM917 would refuse it in a gate if it were subject-scope.
  const gated = (compiled: typeof NONE) =>
    evaluateCatalogue(
      loadOrThrow(atLeast(2)),
      compiled.graph,
      compiled.profileContext,
    ).waves.find(({ id }) => id === 'vocabulary')!.opened

  it('is legal in opensWhen and is not refused as subject-scope', () => {
    const source = catalogueSource(atLeast(2)).replace(
      '    name: Vocabulary\n',
      `    name: Vocabulary
    opensWhen:
      - condition: below-subject-count
        kinds:
          - yarramate/core@0.1#grouping
        atLeast: 2
`,
    )
    const result = loadQuestionCatalogue({
      path: 'catalogues/fixture.yaml',
      source,
    })
    expect(result.ok).toBe(true)
  })

  it('leaves an ungated wave open', () => {
    expect(gated(NONE)).toBe(true)
  })
})

describe('the refusal reaches the composition path too', () => {
  // Two doors into the engine, and a check wired into only one is a check
  // that silently is not there. A workspace contributing its own questions
  // (`questions:` in the manifest, ADR 0129) composes rather than loads, so
  // a threshold refused on one path and accepted on the other would let an
  // adopter author exactly the question this condition exists to prevent.
  const compose = (trigger: string) =>
    composeCatalogues([
      { path: 'catalogues/fixture.yaml', source: catalogueSource(trigger) },
    ])

  it('refuses atLeast 1 when the catalogue arrives by composition', () => {
    const result = compose(atLeast(1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe('YM918')
    expect(result.diagnostics[0]?.message).toContain('no-subject-of-kind')
  })

  it('composes a legal threshold', () => {
    expect(compose(atLeast(2)).ok).toBe(true)
  })
})
