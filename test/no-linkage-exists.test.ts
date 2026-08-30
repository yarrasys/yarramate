import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// `no-linkage-exists` (#436, ADR 0138): the workspace-scope negative of
// `exists-linkage`, so a vocabulary question can ask for its SCHEME instead
// of counting its members.
//
// The reported defect, from live use of `below-subject-count`: the count is a
// proxy that fails in both directions. Two throwaway values close the question
// dishonestly, and a truthful single-value estate can never close it at all,
// because saying "one is the whole scheme" was not recordable. That is a
// MODEL-FLOOR violation — whatever the interrogation asks about must be
// recordable as an answer — and the floor already names the answer's home: a
// classification axis is a grouping that aggregates its members.

// Modelled the way the reporting adopter does: the CLASSES are a profile
// specialization of `grouping`, and the SCHEME is a plain grouping above
// them. Using bare groupings for both would let the scheme count as one of
// its own members, which quietly satisfies the count test by doing the right
// thing and hides the very row this file exists to pin.
const workspaceOf = (concepts: string, relationships = ' []') => {
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
concepts:${concepts}
relationships:${relationships}
`,
    },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

const CLASS = (id: string) => `
  - id: ${id}
    kind: sensitivity-class
    name: ${id}`

const NONE = workspaceOf(' []')
const ONE_INCIDENTAL = workspaceOf(CLASS('confidential'))
const TWO_INCIDENTAL = workspaceOf(CLASS('confidential') + CLASS('public'))
const ONE_WITH_SCHEME = workspaceOf(
  `
  - id: scheme
    kind: grouping
    name: Sensitivity scheme` + CLASS('confidential'),
  `
  - id: scheme-aggregates-confidential
    kind: aggregation
    from: scheme
    to: confidential`,
)

const catalogueSource = (trigger: string) => `format: yarramate/question-catalogue/v1
id: fixture
version: "1.0"
profile: acme/consulting@1.0
waves:
  - id: vocabulary
    name: Vocabulary
questions:
  - id: scheme-undeclared
    wave: vocabulary
    since: "1.0"
    scope: workspace
    trigger:
${trigger}
    question: Which sensitivity classes does this platform recognise?
    materiality: A vocabulary nobody surveyed is not a vocabulary.
    authority: human
    resolution: Declare the scheme and aggregate the classes it recognises.
`

const load = (trigger: string) =>
  loadQuestionCatalogue({
    path: 'catalogues/fixture.yaml',
    source: catalogueSource(trigger),
  })

const isOpen = (trigger: string, compiled: typeof NONE): boolean => {
  const loaded = load(trigger)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics))
  return evaluateCatalogue(
    loaded.catalogue,
    compiled.graph,
    compiled.profileContext,
  )
    .waves.flatMap(({ questions }) => questions)
    .find(({ id }) => id.endsWith('scheme-undeclared'))!.open
}

const SCHEME_TEST = `      - condition: no-linkage-exists
        kinds:
          - yarramate/core@0.1#aggregation
        direction: outgoing
        counterpartKinds:
          - acme/consulting@1.0#sensitivity-class
`

const COUNT_TEST = `      - condition: below-subject-count
        kinds:
          - acme/consulting@1.0#sensitivity-class
        atLeast: 2
`

// The whole design in one table. Both reported problems are the rows where
// the two tests disagree, and the scheme test is right in both.
describe('a vocabulary is closed by its scheme, not its count', () => {
  it('is open when nothing is declared at all', () => {
    expect(isOpen(SCHEME_TEST, NONE)).toBe(true)
  })

  it('is open for one incidental class, as the count test also is', () => {
    expect(isOpen(SCHEME_TEST, ONE_INCIDENTAL)).toBe(true)
    expect(isOpen(COUNT_TEST, ONE_INCIDENTAL)).toBe(true)
  })

  it('STAYS OPEN for two incidental classes, where the count test closes', () => {
    // Reported problem 1: the count is satisfied by exactly the behaviour it
    // exists to prevent, because anyone wanting the question gone adds a
    // second value. The closer here is a declaration, so a tally cannot reach
    // it.
    expect(isOpen(COUNT_TEST, TWO_INCIDENTAL)).toBe(false)
    expect(isOpen(SCHEME_TEST, TWO_INCIDENTAL)).toBe(true)
  })

  it('CLOSES for one class with a scheme, where the count test cannot', () => {
    // Reported problem 2, and the operational half: a truthful single-value
    // estate had no way to say so, so a correct model carried a permanently
    // open question that only a human could clear. Now an agent can author
    // the answer.
    expect(isOpen(COUNT_TEST, ONE_WITH_SCHEME)).toBe(true)
    expect(isOpen(SCHEME_TEST, ONE_WITH_SCHEME)).toBe(false)
  })
})

describe('it is the negative of exists-linkage, and behaves like one', () => {
  const EXISTS = SCHEME_TEST.replace('no-linkage-exists', 'exists-linkage')

  it('answers the opposite of exists-linkage in every state', () => {
    for (const [name, model] of [
      ['none', NONE],
      ['one incidental', ONE_INCIDENTAL],
      ['two incidental', TWO_INCIDENTAL],
      ['one with scheme', ONE_WITH_SCHEME],
    ] as const) {
      expect(isOpen(SCHEME_TEST, model), name).toBe(!isOpen(EXISTS, model))
    }
  })

  it('honours direction, and the asymmetry is the point', () => {
    // The scheme aggregates the class, so the linkage runs scheme -> class.
    // Asked OUTGOING with a `sensitivity-class` counterpart it is found, and
    // the question closes. Asked INCOMING it looks for something aggregated
    // BY a sensitivity-class, and the scheme is a plain grouping, so nothing
    // matches and the question stays open.
    //
    // Worth pinning rather than assuming: a catalogue author who writes the
    // direction the wrong way round gets a question that never closes, not
    // one that closes wrongly, which is the safer of the two failures and is
    // the direction `missing-linkage` also fails in.
    const incoming = SCHEME_TEST.replace(
      'direction: outgoing',
      'direction: incoming',
    )
    expect(isOpen(incoming, ONE_WITH_SCHEME)).toBe(true)
    expect(isOpen(SCHEME_TEST, ONE_WITH_SCHEME)).toBe(false)
  })

  it('honours counterpart kinds', () => {
    const wrongCounterpart = SCHEME_TEST.replace(
      '          - acme/consulting@1.0#sensitivity-class\n',
      '          - yarramate/core@0.1#dataObject\n',
    )
    expect(isOpen(wrongCounterpart, ONE_WITH_SCHEME)).toBe(true)
  })
})

describe('it is workspace scope, so it may gate a wave', () => {
  it('is legal in opensWhen', () => {
    const source = catalogueSource(SCHEME_TEST).replace(
      '    name: Vocabulary\n',
      `    name: Vocabulary
    opensWhen:
${SCHEME_TEST}`,
    )
    expect(
      loadQuestionCatalogue({ path: 'catalogues/fixture.yaml', source }).ok,
    ).toBe(true)
  })
})
