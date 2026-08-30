import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type CatalogueCondition,
  INTERROGATION_SEMANTICS_VERSION,
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// The backstop for INTERROGATION_SEMANTICS_VERSION.
//
// That version is a promise: it changes when an existing question's answer can
// change for an unchanged model, and does not change otherwise. A promise
// nothing enforces is one someone forgets on the commit that matters, which is
// how ADR 0097 flipped `missing-relationship` answers with nothing recording
// it. So every condition the engine understands is exercised here against one
// fixture, and the answers are fingerprinted. Change what a condition means and
// this fails, naming the version you now have to bump.
//
// It deliberately fingerprints ANSWERS, not the report: adding a question, a
// wave, or a rendering leaves it alone, because none of those changes what an
// existing question answers.

const EXPECTED_SEMANTICS = '1'
const EXPECTED_FINGERPRINT = '1ef7dc086fdde597'

const profile = 'yarramate/core@0.1'

const document = [
  'format: yarramate/v1',
  'id: main',
  `profile: ${profile}`,
  'states:',
  '  - id: now',
  '    kind: baseline',
  '    name: Now',
  'concepts:',
  '  - id: owner-actor',
  '    kind: businessActor',
  '    name: Owner',
  '  - id: served-component',
  '    kind: applicationComponent',
  '    name: Served component',
  '    owner: owner-actor',
  '    attestations:',
  '      - topic: adequacy',
  '        by: owner-actor',
  '        on: "2026-01-01"',
  '  - id: lonely-component',
  '    kind: applicationComponent',
  '    name: Lonely component',
  '  - id: near-duplicate-component',
  '    kind: applicationComponent',
  '    name: Lonely componant',
  '  - id: billing-service',
  '    kind: applicationService',
  '    name: Billing service',
  '  - id: billing-function',
  '    kind: applicationFunction',
  '    name: Billing function',
  '  - id: ledger-data',
  '    kind: dataObject',
  '    name: Ledger',
  '  - id: quiet-flow-target',
  '    kind: applicationComponent',
  '    name: Flow target',
  'relationships:',
  '  - id: served-serves-target',
  '    kind: serving',
  '    from: served-component',
  '    to: quiet-flow-target',
  '  - id: component-assigned-function',
  '    kind: assignment',
  '    from: served-component',
  '    to: billing-function',
  '  - id: function-realizes-service',
  '    kind: realization',
  '    from: billing-function',
  '    to: billing-service',
  '  - id: function-accesses-ledger',
  '    kind: access',
  '    from: billing-function',
  '    to: ledger-data',
  '    mode: read-write',
  '  - id: target-flows-served',
  '    kind: flow',
  '    from: quiet-flow-target',
  '    to: served-component',
  '',
].join('\n')

// One question per condition the engine understands. Several never fire
// against this fixture, and that is the point: a condition that starts firing
// when it did not before is exactly the drift this catches.
// A RECORD over the union's discriminant, not a list, and that is the point.
//
// This was a list, and it silently missed two conditions (`has-subject-of-kind`
// and `fills-pattern-slot`) while the test above claimed to exercise every one
// the engine understands. The claim was checked against the list itself, so it
// compared the list to the list and passed. That is CONTRIBUTING.md's ninth
// rule exactly: an allowlist cannot fail for the author who wrote it, and the
// author who adds a condition is the one who would have to remember.
//
// As a `Record` the typechecker asks instead. A new member of
// `CatalogueCondition` is a compile error here until it is given a probe, so
// the backstop cannot fall behind the engine it backstops. Same technique as
// `CONDITION_SCOPE` in the engine (ADR 0134).
const CONDITION_PROBES: Record<
  CatalogueCondition['condition'],
  readonly string[]
> = {
  'missing-claim': ['      - condition: missing-claim', '        predicate: yarramate/ownership/owner'],
  'missing-relationship': ['      - condition: missing-relationship', `        kinds: ["${profile}#serving"]`, '        direction: outgoing'],
  'isolated': ['      - condition: isolated'],
  'no-subject-of-kind': ['      - condition: no-subject-of-kind', `        kinds: ["${profile}#goal"]`],
  'no-state-defined': ['      - condition: no-state-defined'],
  'missing-linkage': ['      - condition: missing-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationFunction"]`],
  'has-linkage': ['      - condition: has-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationFunction"]`],
  'exists-linkage': ['      - condition: exists-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationService"]`],
  'missing-constraint': ['      - condition: missing-constraint', `        kinds: ["${profile}#applicationComponent"]`],
  'missing-flow-content': ['      - condition: missing-flow-content'],
  'missing-reference': ['      - condition: missing-reference', '        predicate: yarramate/reference/spec', '        direction: outgoing'],
  'missing-attestation': ['      - condition: missing-attestation', '        topic: adequacy'],
  'near-duplicate': ['      - condition: near-duplicate'],
  'unconstrained-kind': ['      - condition: unconstrained-kind'],
  'unscoped-succession': ['      - condition: unscoped-succession'],
  'unchallenged-evidence': ['      - condition: unchallenged-evidence'],
  'has-any-subject': ['      - condition: has-any-subject'],
  'has-subject-of-kind': ['      - condition: has-subject-of-kind', `        kinds: ["${profile}#applicationComponent"]`],
  // Fires: the fixture holds one applicationService and the floor is two.
  'below-subject-count': ['      - condition: below-subject-count', `        kinds: ["${profile}#applicationService"]`, '        atLeast: 2'],
  // Never fires here, deliberately: no memberships are passed, and "absent
  // memberships stay quiet" is itself a semantic worth pinning (ADR 0131).
  'fills-pattern-slot': ['      - condition: fills-pattern-slot'],
  // Fires: nothing in the fixture aggregates anything, which is the state a
  // vocabulary question is loudest about.
  'no-linkage-exists': ['      - condition: no-linkage-exists', `        kinds: ["${profile}#aggregation"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#grouping"]`],
}

const conditionProbes = Object.entries(CONDITION_PROBES) as readonly (readonly [
  CatalogueCondition['condition'],
  readonly string[],
])[]

// The overlay the unchallenged-evidence probe reads: one confirmed
// observation and no recorded search, so the condition fires. Every other
// condition ignores the overlay, which is itself part of what the
// fingerprint pins.
const evidenceOverlay = [{ result: 'confirmed' as const }]

const catalogue = [
  'format: yarramate/question-catalogue/v1',
  'id: semantics-fingerprint',
  'version: "1.0"',
  `profile: ${profile}`,
  'waves:',
  '  - id: all',
  '    name: All conditions',
  'questions:',
  ...conditionProbes.flatMap(([name, trigger]) => [
    `  - id: cond-${name}`,
    '    wave: all',
    '    scope: subject',
    '    subjects:',
    `      kinds: ["${profile}#applicationComponent"]`,
    '    trigger:',
    ...trigger,
    `    question: Probe for ${name} on {subject.name}?`,
    `    materiality: Fingerprint probe for the ${name} condition.`,
    '    authority: either',
    '    resolution: Not a real question; this catalogue exists to pin evaluation.',
  ]),
  '',
].join('\n')

const answers = () => {
  const compilation = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source: document },
  ])
  if (!compilation.ok) {
    throw new Error(
      `fixture did not compile: ${compilation.diagnostics.map(({ message }) => message).join('; ')}`,
    )
  }
  const loaded = loadQuestionCatalogue({
    path: 'catalogue.yaml',
    source: catalogue,
  })
  if (!loaded.ok) {
    throw new Error(
      `fixture catalogue did not load: ${loaded.diagnostics.map(({ message }) => message).join('; ')}`,
    )
  }
  const report = evaluateCatalogue(
    loaded.catalogue,
    compilation.graph,
    compilation.profileContext,
    evidenceOverlay,
  )
  // Answers only: which questions are open, and about which subjects.
  return report.waves
    .flatMap(({ questions }) => questions)
    .map((question) => ({
      id: question.id,
      open: question.open,
      subjects: (question.subjects ?? []).map(({ id }) => id).sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

describe('interrogation semantics are versioned and pinned', () => {
  it('answers every condition the engine understands', () => {
    // That the PROBES cover the union is the typechecker's job, above; a
    // missing member of `CatalogueCondition` will not compile. What this adds
    // is that every probe reached an answer, so a question cannot be silently
    // dropped between the catalogue and the report.
    const seen = answers().map(({ id }) => id.replace('cond-', ''))
    expect(seen.sort()).toEqual(conditionProbes.map(([name]) => name).sort())
  })

  it('has not changed what an existing question answers', () => {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(answers()))
      .digest('hex')
      .slice(0, 16)
    expect(
      fingerprint,
      `The fingerprint moved. Two different causes, and they want ` +
        `different responses.\n` +
        `  ADDED A CONDITION: this fixture gained a question, so only ` +
        `EXPECTED_FINGERPRINT changes. Set it to ${fingerprint}. Do NOT bump ` +
        `INTERROGATION_SEMANTICS_VERSION: no existing question answers ` +
        `differently.\n` +
        `  CHANGED WHAT A CONDITION MEANS: an existing question now answers ` +
        `differently for an unchanged model. Bump ` +
        `INTERROGATION_SEMANTICS_VERSION in src/interrogate-command.ts, set ` +
        `EXPECTED_SEMANTICS here to match, and set EXPECTED_FINGERPRINT to ` +
        `${fingerprint}.\n` +
        `  NEITHER: it is a bug. Answers moved and nothing asked them to.`,
    ).toBe(EXPECTED_FINGERPRINT)
  })

  it('pins the semantics version this fingerprint belongs to', () => {
    expect(INTERROGATION_SEMANTICS_VERSION).toBe(EXPECTED_SEMANTICS)
  })
})
