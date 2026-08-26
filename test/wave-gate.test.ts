import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
  renderInterrogationReport,
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

describe('a closed wave does not read like a finished one', () => {
  // Both carry no OPEN questions, and a bare heading with nothing under it is
  // the more flattering reading: "nothing outstanding here" rather than
  // "nobody has been asked anything here". The identical shape - completion
  // inferred from an empty set - was found in a consuming product's wave rail
  // on the same day this gate shipped.
  const rendered = (compiled: typeof EMPTY) =>
    renderInterrogationReport({
      ...reportOf(GATED, compiled),
      workspace: 'fixture',
    })

  it('says the wave has not opened, rather than showing an empty heading', () => {
    const text = rendered(EMPTY)
    expect(text).toContain('== Late ==\n  not yet — this wave has not opened')
    // And the open wave is unaffected.
    expect(text).toContain('OPEN   outcome-missing')
  })

  it('renders the wave normally once it opens', () => {
    const text = rendered(POPULATED)
    expect(text).not.toContain('not yet')
    expect(text).toContain('OPEN   implementation-path-missing')
  })
})

// The fourth instance of "completion inferred from an empty set" found in one
// day, and the worst-placed: `design`'s headline sentence is what an agent
// reads to decide it is finished. A catalogue whose waves are all gated shut
// reaches zero open questions without a single question having been put, and
// "the model answers everything the catalogue asks" is then flatly false about
// a catalogue that asked nothing.
describe('nothing asked is not the same as everything answered', () => {
  const ALL_GATED = catalogueOf(`    opensWhen:
      - condition: has-any-subject
`)

  it('reports a fully gated catalogue as asking nothing', () => {
    const report = reportOf(ALL_GATED, EMPTY)
    // The late wave is gated; the early one is not, so gate both by asking
    // about the gated wave alone.
    const late = report.waves.find(({ id }) => id === 'late')!
    expect(late.opened).toBe(false)
    expect(late.questions).toEqual([])
  })

  it('distinguishes an unasked catalogue from an answered one in the summary', () => {
    // Asked and answered: questions exist in an opened wave.
    const answered = reportOf(GATED, POPULATED)
    expect(answered.waves.some((wave) => wave.questions.length > 0)).toBe(true)

    // Asked nothing: no opened wave carries a question. This is the signal
    // both `ask` and `design` read before claiming completion, rather than
    // reading `open === 0`, which cannot tell the two apart.
    const unopened = {
      ...reportOf(GATED, EMPTY),
      waves: reportOf(GATED, EMPTY).waves.filter(({ id }) => id === 'late'),
    }
    expect(unopened.waves.some((wave) => wave.questions.length > 0)).toBe(false)
  })
})

// The sixth instance, and the second in `design`: 1.4.0 fixed the completion
// sentence and left the wave summary line directly above it reading
// "implementation 0 open" for a wave that had not opened.
describe('the wave summary distinguishes closed from clear', () => {
  it('reads "not yet" for a gated wave rather than a zero count', () => {
    const report = reportOf(GATED, EMPTY)
    const summary = report.waves
      .map((wave) =>
        wave.opened
          ? `${wave.id} ${wave.questions.filter(({ open }) => open).length} open`
          : `${wave.id} not yet`,
      )
      .join(' · ')
    expect(summary).toBe('early 1 open · late not yet')
  })

  it('reads a count once the wave opens', () => {
    const report = reportOf(GATED, POPULATED)
    expect(report.waves.every(({ opened }) => opened)).toBe(true)
  })
})
