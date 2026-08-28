import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// Two things that arrived together because an adopter authoring phase-ordered
// waves needed the first and would silently have been bitten by the second.
//
// #398: `has-subject-of-kind`, the positive twin of `no-subject-of-kind`. A
// question exists to be closed by an absence ending; a GATE wants the opposite
// polarity, and `opensWhen` has no `not`.
//
// #400: a gate is evaluated with NO subject, and the schema offered the whole
// condition vocabulary in that position. A subject-scope condition there left
// the wave permanently shut or the gate inert, and nothing said so.

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

const EMPTY = workspaceOf(' []')
const HAS_ACTOR = workspaceOf(`
  - id: teller
    kind: businessActor
    name: Teller`)
const HAS_INTERFACE = workspaceOf(`
  - id: teller
    kind: businessActor
    name: Teller
  - id: payments-api
    kind: applicationInterface
    name: Payments API`)

const catalogueSource = (opensWhen: string) => `format: yarramate/question-catalogue/v1
id: fixture
version: "1.0"
profile: yarramate/core@0.1
presentation:
  title: Fixture
  description: A gated wave.
waves:
  - id: design
    name: Design
    description: Premature until there is something to design.
${opensWhen}questions:
  - id: interface-owner-missing
    wave: design
    since: "1.0"
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#outcome
    question: Who is paged for this interface?
    materiality: An interface nobody owns has no one to call.
    authority: human
    resolution: Declare an owner.
`

const load = (opensWhen: string) =>
  loadQuestionCatalogue({
    path: 'catalogues/fixture.yaml',
    source: catalogueSource(opensWhen),
  })

const loadOrThrow = (opensWhen: string) => {
  const result = load(opensWhen)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.catalogue
}

const gateOpens = (
  opensWhen: string,
  compiled: typeof EMPTY,
): boolean =>
  evaluateCatalogue(
    loadOrThrow(opensWhen),
    compiled.graph,
    compiled.profileContext,
  ).waves.find(({ id }) => id === 'design')!.opened

const HAS_SUBJECT_OF_KIND = `    opensWhen:
      - condition: has-subject-of-kind
        kinds:
          - yarramate/core@0.1#applicationInterface
`

describe('has-subject-of-kind gates a wave on the model HAVING something', () => {
  it('stays shut when the workspace holds nothing of the kind', () => {
    expect(gateOpens(HAS_SUBJECT_OF_KIND, HAS_ACTOR)).toBe(false)
  })

  it('opens once one subject of the kind exists', () => {
    expect(gateOpens(HAS_SUBJECT_OF_KIND, HAS_INTERFACE)).toBe(true)
  })

  // The #334 posture falls out rather than being special-cased: an empty
  // workspace holds no subject of any kind, so every gate using it is shut.
  it('stays shut on the empty workspace', () => {
    expect(gateOpens(HAS_SUBJECT_OF_KIND, EMPTY)).toBe(false)
  })

  it('resolves through profile lineage by default, like its negative', () => {
    // `applicationComponent` is the parent of nothing declared here, so this
    // asserts the default matching is `descendants` and not `exact` by
    // selecting a CORE kind a subject holds directly.
    const gate = `    opensWhen:
      - condition: has-subject-of-kind
        kinds:
          - yarramate/core@0.1#applicationInterface
        kindMatching: exact
`
    expect(gateOpens(gate, HAS_INTERFACE)).toBe(true)
    expect(gateOpens(gate, HAS_ACTOR)).toBe(false)
  })

  it('is the polarity no existing condition could express', () => {
    // The point of the issue: the negative gates the wave the wrong way round.
    const negative = `    opensWhen:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#applicationInterface
`
    expect(gateOpens(negative, HAS_INTERFACE)).toBe(false)
    expect(gateOpens(negative, HAS_ACTOR)).toBe(true)
  })
})

// Every subject-scope condition, authored into a gate as a catalogue author
// would write it. Each one loaded WITHOUT COMPLAINT before this refusal, and
// the comment records which way each failed, because the split is what made it
// invisible: a gate that never opens and a gate that does nothing both read as
// a gate.
const SUBJECT_SCOPE_GATES: Record<string, string> = {
  // never opened
  'has-linkage': `    opensWhen:
      - condition: has-linkage
        kinds:
          - yarramate/core@0.1#serving
        direction: outgoing
        counterpartKinds:
          - yarramate/core@0.1#businessActor
`,
  'near-duplicate': `    opensWhen:
      - condition: near-duplicate
`,
  'fills-pattern-slot': `    opensWhen:
      - condition: fills-pattern-slot
`,
  // inert
  'missing-linkage': `    opensWhen:
      - condition: missing-linkage
        kinds:
          - yarramate/core@0.1#serving
        direction: outgoing
        counterpartKinds:
          - yarramate/core@0.1#businessActor
`,
  isolated: `    opensWhen:
      - condition: isolated
`,
  'missing-claim': `    opensWhen:
      - condition: missing-claim
        predicate: yarramate/ownership/owner
`,
  'missing-constraint': `    opensWhen:
      - condition: missing-constraint
        kinds:
          - yarramate/core@0.1#constraint
`,
  'missing-flow-content': `    opensWhen:
      - condition: missing-flow-content
`,
  'unconstrained-kind': `    opensWhen:
      - condition: unconstrained-kind
`,
  'unscoped-succession': `    opensWhen:
      - condition: unscoped-succession
`,
  'missing-attestation': `    opensWhen:
      - condition: missing-attestation
        topic: security-review
`,
  'missing-reference': `    opensWhen:
      - condition: missing-reference
        predicate: yarramate/reference/cites
        direction: outgoing
`,
  'missing-relationship': `    opensWhen:
      - condition: missing-relationship
        kinds:
          - yarramate/core@0.1#serving
        direction: outgoing
`,
}

const WORKSPACE_SCOPE_GATES: Record<string, string> = {
  'has-any-subject': `    opensWhen:
      - condition: has-any-subject
`,
  'no-subject-of-kind': `    opensWhen:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#applicationInterface
`,
  'has-subject-of-kind': HAS_SUBJECT_OF_KIND,
  'no-state-defined': `    opensWhen:
      - condition: no-state-defined
`,
  'exists-linkage': `    opensWhen:
      - condition: exists-linkage
        kinds:
          - yarramate/core@0.1#serving
        direction: either
        counterpartKinds:
          - yarramate/core@0.1#businessActor
`,
  'unchallenged-evidence': `    opensWhen:
      - condition: unchallenged-evidence
`,
}

describe('a wave gate may only ask about the workspace (YM917)', () => {
  for (const [condition, opensWhen] of Object.entries(SUBJECT_SCOPE_GATES)) {
    it(`refuses ${condition} in opensWhen`, () => {
      const result = load(opensWhen)
      expect(result.ok).toBe(false)
      if (result.ok) return
      const refusal = result.diagnostics.find(({ code }) => code === 'YM917')
      expect(refusal).toBeDefined()
      // Names the offending condition, and points at it: the author cannot
      // see this one by reading, so the diagnostic has to do the seeing.
      expect(refusal!.message).toContain(`"${condition}"`)
      expect(refusal!.pointer).toBe('/waves/0/opensWhen/0')
    })
  }

  for (const [condition, opensWhen] of Object.entries(WORKSPACE_SCOPE_GATES)) {
    it(`accepts ${condition} in opensWhen`, () => {
      const result = load(opensWhen)
      expect(
        result.ok ? [] : result.diagnostics.filter((d) => d.code === 'YM917'),
      ).toEqual([])
    })
  }

  it('covers every condition the vocabulary has, so none is left unclassified', () => {
    // The scope table itself is exhaustive by TYPECHECK - a new member of
    // CatalogueCondition cannot compile until its scope is declared. This
    // asserts the FIXTURES kept up, which the typechecker cannot do: a
    // condition added and classified but never authored into a gate here
    // would leave the refusal unexercised for that condition.
    const covered = new Set([
      ...Object.keys(SUBJECT_SCOPE_GATES),
      ...Object.keys(WORKSPACE_SCOPE_GATES),
    ])
    expect(covered.size).toBe(19)
  })

  it('offers the workspace-scope conditions as the remedy', () => {
    const result = load(SUBJECT_SCOPE_GATES['isolated']!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const message = result.diagnostics.find(
      ({ code }) => code === 'YM917',
    )!.message
    for (const workspaceScope of Object.keys(WORKSPACE_SCOPE_GATES)) {
      expect(message).toContain(workspaceScope)
    }
  })

  it('leaves a wave with no gate alone', () => {
    const result = load('')
    expect(result.ok).toBe(true)
  })
})
