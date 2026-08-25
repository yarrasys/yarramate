import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
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
const EXPECTED_FINGERPRINT = '50f0a37db8ad99e1'

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
const conditions: readonly (readonly [string, readonly string[]])[] = [
  ['missing-claim', ['      - condition: missing-claim', '        predicate: yarramate/ownership/owner']],
  ['missing-relationship', ['      - condition: missing-relationship', `        kinds: ["${profile}#serving"]`, '        direction: outgoing']],
  ['isolated', ['      - condition: isolated']],
  ['no-subject-of-kind', ['      - condition: no-subject-of-kind', `        kinds: ["${profile}#goal"]`]],
  ['no-state-defined', ['      - condition: no-state-defined']],
  ['missing-linkage', ['      - condition: missing-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationFunction"]`]],
  ['has-linkage', ['      - condition: has-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationFunction"]`]],
  ['exists-linkage', ['      - condition: exists-linkage', `        kinds: ["${profile}#applicationComponent"]`, '        direction: outgoing', `        counterpartKinds: ["${profile}#applicationService"]`]],
  ['missing-constraint', ['      - condition: missing-constraint', `        kinds: ["${profile}#applicationComponent"]`]],
  ['missing-flow-content', ['      - condition: missing-flow-content']],
  ['missing-reference', ['      - condition: missing-reference', '        predicate: yarramate/reference/spec', '        direction: outgoing']],
  ['missing-attestation', ['      - condition: missing-attestation', '        topic: adequacy']],
  ['near-duplicate', ['      - condition: near-duplicate']],
  ['unconstrained-kind', ['      - condition: unconstrained-kind']],
]

const catalogue = [
  'format: yarramate/question-catalogue/v1',
  'id: semantics-fingerprint',
  'version: "1.0"',
  `profile: ${profile}`,
  'waves:',
  '  - id: all',
  '    name: All conditions',
  'questions:',
  ...conditions.flatMap(([name, trigger]) => [
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
  it('exercises every condition the engine understands', () => {
    const seen = answers().map(({ id }) => id.replace('cond-', ''))
    expect(seen.sort()).toEqual(conditions.map(([name]) => name).sort())
  })

  it('has not changed what an existing question answers', () => {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(answers()))
      .digest('hex')
      .slice(0, 16)
    expect(
      fingerprint,
      `Condition evaluation changed. If that was deliberate, bump ` +
        `INTERROGATION_SEMANTICS_VERSION in src/interrogate-command.ts and ` +
        `set EXPECTED_FINGERPRINT here to ${fingerprint}. If it was not ` +
        `deliberate, an existing question now answers differently for an ` +
        `unchanged model, which is a bug.`,
    ).toBe(EXPECTED_FINGERPRINT)
  })

  it('pins the semantics version this fingerprint belongs to', () => {
    expect(INTERROGATION_SEMANTICS_VERSION).toBe(EXPECTED_SEMANTICS)
  })
})
