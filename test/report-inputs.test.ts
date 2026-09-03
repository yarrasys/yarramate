import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  composeCatalogues,
  conditionInput,
  evaluateCatalogue,
  renderInterrogationReport,
  type CatalogueCondition,
} from '../src/index.js'

// #450: `asked: false` (#375, ADR 0132) says "this was never asked" for a
// selector that matched no subject. The same fault existed one level down, for
// INPUTS: a condition that reads an optional input it was not given stays quiet
// - correct, since the caller did not look - but a quiet condition and a
// satisfied one are both `open: false, asked: true`.
//
// A host summing closed questions therefore read "nothing was supplied" as
// "nothing is missing", and for an absence question like `missing-part` the
// silent direction is "the interview is satisfied", which stops an agent
// working rather than making it do redundant work. The adopter reports three
// shipped bugs of this class.

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const profile = `format: yarramate/profile/v1
id: acme/mule
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: mule-http-api
    name: Mule HTTP API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

const pattern = `format: yarramate/pattern/v1
id: mule
version: "1.0"
patterns:
  - kind: acme/mule@1.0#mule-http-api
    parts:
      service:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: service
`

const document = `format: yarramate/v1
id: main
profile: acme/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
relationships: []
`

const catalogue = `format: yarramate/question-catalogue/v1
id: probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: w
    name: Wave
questions:
  - id: bind-service
    wave: w
    scope: subject
    subjects:
      kinds:
        - acme/mule@1.0#mule-http-api
    trigger:
      - condition: missing-part
        slots:
          - service
    question: What fills the service of {subject.name}?
    materiality: An unbound part is a decision nobody has taken.
    resolution: Bind the part.
    authority: human
`

const compiled = () => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'profiles/mule.yaml', source: profile },
    { path: 'patterns/mule.yaml', source: pattern },
    { path: 'architecture/main.yaml', source: document },
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('fixture does not compile')
  return result
}

const composed = () => {
  const result = composeCatalogues([
    { path: 'questions/probe.yaml', source: catalogue },
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('fixture does not compose')
  return result.composed
}

describe('#450: a report says which inputs it was given', () => {
  it('reports every input, supplied or not', () => {
    const model = compiled()
    const withEverything = evaluateCatalogue(
      composed().catalogue,
      model.graph,
      model.profileContext,
      [],
      composed().catalogues,
      model.patternMemberships,
      model.patternVacancies,
    )
    expect(withEverything.inputs).toEqual({
      profileContext: true,
      evidence: true,
      patternMemberships: true,
      patternVacancies: true,
    })

    const withNothing = evaluateCatalogue(composed().catalogue, model.graph)
    expect(withNothing.inputs).toEqual({
      profileContext: false,
      evidence: false,
      patternMemberships: false,
      patternVacancies: false,
    })
  })

  it('tells a withheld input apart from a satisfied condition', () => {
    // The whole point. Both reports say `open: false` for the same question
    // against the same model, and before this they were byte-identical.
    const model = compiled()
    const evaluate = (vacancies?: typeof model.patternVacancies) =>
      evaluateCatalogue(
        composed().catalogue,
        model.graph,
        model.profileContext,
        undefined,
        composed().catalogues,
        model.patternMemberships,
        vacancies,
      )

    const withheld = evaluate(undefined)
    const satisfied = evaluate([])
    const question = (report: typeof withheld) =>
      report.waves[0]!.questions.find(({ id }) => id === 'probe#bind-service')!

    // Indistinguishable at the question level, which is the fault.
    expect(question(withheld).open).toBe(false)
    expect(question(satisfied).open).toBe(false)
    expect(question(withheld).asked).toBe(question(satisfied).asked)

    // Distinguishable at the report level, which is the fix.
    expect(withheld.inputs.patternVacancies).toBe(false)
    expect(satisfied.inputs.patternVacancies).toBe(true)
  })

  it('lets a host find WHICH questions could not be evaluated', () => {
    // The question a host actually has. It joins the echoed trigger to the
    // inputs map through the published `conditionInput`, which is why that
    // accessor is exported rather than kept internal: without it the map says
    // "vacancies were not supplied" and the host still cannot tell which of
    // the questions in front of it that silenced.
    const model = compiled()
    const report = evaluateCatalogue(
      composed().catalogue,
      model.graph,
      model.profileContext,
      undefined,
      composed().catalogues,
      model.patternMemberships,
      // vacancies withheld
    )
    const unevaluated = report.waves.flatMap((wave) =>
      wave.questions
        .filter((question) =>
          question.trigger.some((condition) => {
            const input = conditionInput(condition)
            return input !== undefined && !report.inputs[input]
          }),
        )
        .map(({ id }) => id),
    )
    expect(unevaluated).toEqual(['probe#bind-service'])
  })

  it('names a withheld input in the rendered report, but only when it matters', () => {
    const model = compiled()
    const withheld = renderInterrogationReport({
      ...evaluateCatalogue(
        composed().catalogue,
        model.graph,
        model.profileContext,
        undefined,
        composed().catalogues,
        model.patternMemberships,
      ),
      workspace: 'w',
    })
    expect(withheld).toContain('patternVacancies not supplied')
    expect(withheld).toContain('could not be evaluated')

    // Supplied: no note at all. A line printed on every report is a line a
    // reader learns to skip, and the one that mattered would go with it.
    const supplied = renderInterrogationReport({
      ...evaluateCatalogue(
        composed().catalogue,
        model.graph,
        model.profileContext,
        undefined,
        composed().catalogues,
        model.patternMemberships,
        model.patternVacancies,
      ),
      workspace: 'w',
    })
    expect(supplied).not.toContain('not supplied')
  })

  it('stays silent about an input no question in the catalogue reads', () => {
    // `evidence` is withheld here too, and this catalogue has no
    // `unchallenged-evidence` question, so saying so would be noise about a
    // thing that changed no answer. The note is derived from (withheld) x
    // (actually used), not from the map alone.
    const model = compiled()
    const rendered = renderInterrogationReport({
      ...evaluateCatalogue(
        composed().catalogue,
        model.graph,
        model.profileContext,
        undefined,
        composed().catalogues,
        model.patternMemberships,
      ),
      workspace: 'w',
    })
    expect(rendered).toContain('patternVacancies')
    expect(rendered).not.toContain('evidence')
  })

  it('maps every condition to the input it goes quiet without', () => {
    // The table is a Record over the condition union, so a new condition is a
    // typecheck error until it declares a dependency. What a test can add is
    // that the declared dependencies are the RIGHT ones for the four
    // conditions that have them.
    const of = (condition: CatalogueCondition) => conditionInput(condition)
    expect(of({ condition: 'unconstrained-kind' })).toBe('profileContext')
    expect(of({ condition: 'unchallenged-evidence' })).toBe('evidence')
    expect(of({ condition: 'fills-pattern-slot' })).toBe('patternMemberships')
    expect(of({ condition: 'missing-part' })).toBe('patternVacancies')
    expect(of({ condition: 'has-any-subject' })).toBeUndefined()
    expect(of({ condition: 'isolated' })).toBeUndefined()
  })
})

describe('the ask-result schema restates the report, and must not drift', () => {
  const load = (name: string) =>
    JSON.parse(
      readFileSync(join(repositoryRoot, 'schema', name), 'utf8'),
    ) as {
      readonly required?: readonly string[]
      readonly properties?: Readonly<Record<string, unknown>>
      readonly oneOf?: readonly {
        readonly properties?: {
          readonly report?: {
            readonly required?: readonly string[]
            readonly properties?: Readonly<Record<string, unknown>>
          }
        }
      }[]
    }

  it('carries every field the report schema declares', () => {
    // This drift was already a SHIPPED bug when the test was written, not a
    // hypothetical: `catalogues` arrived with composition (#345), the
    // restatement here was never updated, and `additionalProperties` is false,
    // so `ask --open --json` on a workspace with two catalogues emitted a
    // report its own published schema rejected. Nothing caught it because
    // every fixture used one catalogue.
    //
    // A rule rather than a list: whatever the report schema grows, this asks
    // for it, so the next field cannot repeat the trick.
    const report = load('yarramate-interrogation-report.schema.json')
    const ask = load('yarramate-ask-result.schema.json')
    const restatement = (ask.oneOf ?? []).find(
      (branch) => branch.properties?.report !== undefined,
    )?.properties?.report
    expect(restatement).toBeDefined()

    const declared = Object.keys(report.properties ?? {})
    expect(declared.length).toBeGreaterThan(5)
    expect(
      declared.filter(
        (name) => !(name in (restatement!.properties ?? {})),
      ),
    ).toEqual([])
    expect(
      (report.required ?? []).filter(
        (name) => !(restatement!.required ?? []).includes(name),
      ),
    ).toEqual([])
  })
})
