import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// The wave gate (#334, ADR 0125). A workspace-scoped absence question could
// not say "only once the model has substance", so a blank project was greeted
// with six questions of the form "you have nothing of kind X" - including how
// the planned architecture becomes real, before anyone had named a subject.
// The fix is a property of the WAVE rather than of each question, because "the
// implementation wave is premature" is one fact and a per-question guard is
// only as good as an author's memory.

const graphOf = (concepts: string) => {
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

const EMPTY = graphOf(' []')
const POPULATED = graphOf(`
  - id: teller
    kind: businessActor
    name: Teller`)

const catalogueOf = (opensWhen: string) => {
  const loaded = loadQuestionCatalogue({
    path: 'catalogues/fixture.yaml',
    source: `format: yarramate/question-catalogue/v1
id: fixture
version: "1.0"
profile: yarramate/core@0.1
presentation:
  title: Fixture
  description: A gated late wave and an ungated early one.
waves:
  - id: early
    name: Early
    description: Always open.
  - id: late
    name: Late
    description: Premature on an empty model.
${opensWhen}questions:
  - id: outcome-missing
    wave: early
    since: "1.0"
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#outcome
    question: What outcome justifies this system?
    materiality: Without one, no alternative can be judged.
    authority: human
    resolution: Declare an outcome.
  - id: implementation-path-missing
    wave: late
    since: "1.0"
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#workPackage
    question: How does the planned architecture become real?
    materiality: A target with no work reaching it is a wish.
    authority: human
    resolution: Declare the work packages in flight.
`,
  })
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics))
  return loaded.catalogue
}

const GATED = catalogueOf(`    opensWhen:
      - condition: has-any-subject
`)
const UNGATED = catalogueOf('')

const reportOf = (
  catalogue: ReturnType<typeof catalogueOf>,
  compiled: typeof EMPTY,
) => evaluateCatalogue(catalogue, compiled.graph, compiled.profileContext)

describe('a gated wave asks nothing until the model has substance', () => {
  it('reports the wave closed and carrying no questions on an empty model', () => {
    const late = reportOf(GATED, EMPTY).waves.find(({ id }) => id === 'late')!
    expect(late.opened).toBe(false)
    // Not evaluated and reported closed - that would say the question had
    // been asked and answered. Absent entirely.
    expect(late.questions).toEqual([])
  })

  it('leaves the ungated wave open and asking on the same empty model', () => {
    const early = reportOf(GATED, EMPTY).waves.find(({ id }) => id === 'early')!
    expect(early.opened).toBe(true)
    expect(early.questions.map(({ id, open }) => [id, open])).toEqual([
      ['outcome-missing', true],
    ])
  })

  it('opens the wave the moment one concept exists', () => {
    const late = reportOf(GATED, POPULATED).waves.find(
      ({ id }) => id === 'late',
    )!
    expect(late.opened).toBe(true)
    expect(late.questions.map(({ id, open }) => [id, open])).toEqual([
      ['implementation-path-missing', true],
    ])
  })

  // ADR 0120's reading survives: an architecture that HAS started and declares
  // no work is saying something true, and the question stays open to say it.
  it('still lets a model at rest keep the question open', () => {
    const late = reportOf(GATED, POPULATED).waves.find(
      ({ id }) => id === 'late',
    )!
    expect(late.questions[0]!.open).toBe(true)
  })

  it('is what a wave without opensWhen never does', () => {
    const late = reportOf(UNGATED, EMPTY).waves.find(({ id }) => id === 'late')!
    expect(late.opened).toBe(true)
    expect(late.questions[0]!.open).toBe(true)
  })
})

describe('the counts stay honest through a closed gate', () => {
  it('leaves a closed wave out of the denominator, not marked answered', () => {
    // "1 of 2" would report the gated question as answered when it was never
    // put. The denominator is what was ASKED.
    expect(reportOf(GATED, EMPTY).summary).toEqual({
      questions: 1,
      openQuestions: 1,
      open: 1,
    })
  })

  it('grows the denominator as the model gains substance', () => {
    expect(reportOf(GATED, POPULATED).summary).toEqual({
      questions: 2,
      openQuestions: 2,
      open: 2,
    })
  })
})
