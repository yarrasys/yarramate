import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
// The barrel import is the point (the composeCatalogues lesson): the types
// and calls a host needs must be reachable from the published entry.
import {
  compileWorkspaceWithProfileContext,
  composeCatalogues,
  evaluateCatalogue,
  type WorkspaceSource,
} from '../src/index.js'
import { interrogationOverlayOf } from '../src/adapters/visual/workspace-model.js'

// missing-part (#447): a pattern's vacant optional slots are the questions it
// already knows to ask, and nothing could see them because a vacancy has no
// `member` and so no row in `patternMemberships`.
//
// The fixture is the adopter's own MuleSoft shape rather than a minimal one,
// because the ask came from moving a real pack from kind-selected questions to
// pattern-derived ones: one required part and four optional ones, so an
// instance that has bound only what the compiler enforces carries exactly four
// open questions.
//
// It also carries the case the first draft of #447 could not see: an instance
// that declares no `parts` at all. That one is not a `PatternInstance`, so it
// never reaches YM416 and compiles clean with every slot vacant, the required
// one included. Vacancies are derived for it too, which is why the row carries
// `required` and why `[]` can be trusted to mean "fully bound".
//
// CONTRIBUTING's fifth rule, b (the #360 shape): a `missing-part` test whose
// fixture happens to have no vacancies passes against an engine that never
// fires. Every assertion below that a question OPENED is preceded by an
// assertion that the vacancy it reads EXISTS, and the mutation this file is
// written to keep red is "make the condition always return false".

const profile = `format: yarramate/profile/v1
id: aperturex/mule
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: mule-http-api
    name: Mule HTTP API
    parent: yarramate/core@0.1#grouping
  - id: mule-process-api
    name: Mule process API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

// Two patterns, and the second exists for one reason: it declares a slot ALSO
// named `service`. A slot name is scoped to its pattern, so an engine matching
// on the name alone leaks one pattern's question onto the other's instance.
const pattern = `format: yarramate/pattern/v1
id: mule
version: "1.0"
patterns:
  - kind: aperturex/mule@1.0#mule-http-api
    parts:
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
      backend:
        kind: yarramate/core@0.1#applicationComponent
      behaviour:
        kind: yarramate/core@0.1#applicationFunction
      mapping:
        kind: yarramate/core@0.1#dataObject
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: interface
      - from: interface
        kind: yarramate/core@0.1#assignment
        to: service
      - from: service
        kind: yarramate/core@0.1#serving
        to: backend
      - from: backend
        kind: yarramate/core@0.1#realization
        to: behaviour
      - from: behaviour
        kind: yarramate/core@0.1#access
        to: mapping
  - kind: aperturex/mule@1.0#mule-process-api
    parts:
      service:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: service
`

/**
 * `greeting-app` binds only what YM416 enforces, so four optional slots are
 * vacant. `process-app` is the other pattern's instance with its own `service`
 * slot vacant: the collision the engine has to tell apart.
 */
const document = `format: yarramate/v1
id: main
profile: aperturex/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
    parts:
      interface: patron-api
  - id: patron-api
    kind: applicationInterface
    name: Patron API
  - id: process-app
    kind: mule-process-api
    name: Process app
relationships: []
`

/** Every slot bound: the golden instance, whose vacancies are `[]`, not absent. */
const goldenDocument = `format: yarramate/v1
id: main
profile: aperturex/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
    parts:
      interface: patron-api
      service: greeting-service
      backend: greeting-backend
      behaviour: greeting-behaviour
      mapping: greeting-mapping
  - id: patron-api
    kind: applicationInterface
    name: Patron API
  - id: greeting-service
    kind: applicationService
    name: Greeting service
  - id: greeting-backend
    kind: applicationComponent
    name: Greeting backend
  - id: greeting-behaviour
    kind: applicationFunction
    name: Greeting behaviour
  - id: greeting-mapping
    kind: dataObject
    name: Greeting mapping
relationships: []
`

/** No `parts` line at all: the greenfield instance, and it compiles clean. */
const bareDocument = `format: yarramate/v1
id: main
profile: aperturex/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
relationships: []
`

const slotQuestion = (slot: string, patternKinds = true) => `  - id: bind-${slot}
    wave: probe
    scope: subject
    subjects:
      kinds:
        - aperturex/mule@1.0#mule-http-api
    trigger:
      - condition: missing-part
${patternKinds ? '        patternKinds:\n          - aperturex/mule@1.0#mule-http-api\n' : ''}        slots:
          - ${slot}
    question: What fills the ${slot} of {subject.name}?
    materiality: An unbound part is a decision nobody has taken.
    resolution: Bind the part, or record why it stays empty.
    authority: human
`

const catalogue = (
  patternKind = 'aperturex/mule@1.0#mule-http-api',
) => `format: yarramate/question-catalogue/v1
id: vacancy-probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: probe
    name: Probe
questions:
${['service', 'backend', 'behaviour', 'mapping'].map((slot) => slotQuestion(slot)).join('')}  - id: any-vacancy
    wave: probe
    scope: subject
    subjects:
      kinds:
        - ${patternKind}
    trigger:
      - condition: missing-part
    question: What has {subject.name} not decided yet?
    materiality: Bare, the mirror of a bare fills-pattern-slot.
    resolution: Answer per instance.
    authority: either
`

const sources: readonly WorkspaceSource[] = [
  { path: 'profiles/mule.yaml', source: profile },
  { path: 'patterns/mule.yaml', source: pattern },
  { path: 'architecture/main.yaml', source: document },
]

const goldenSources: readonly WorkspaceSource[] = [
  { path: 'profiles/mule.yaml', source: profile },
  { path: 'patterns/mule.yaml', source: pattern },
  { path: 'architecture/main.yaml', source: goldenDocument },
]

interface ReportedQuestion {
  readonly id: string
  readonly open: boolean
  readonly asked?: boolean
  readonly subjects?: readonly { readonly id: string }[]
  readonly trigger?: readonly Record<string, unknown>[]
}

describe('missing-part: the compiled vacancy', () => {
  it('emits one row per vacant optional slot, and none for a bound one', () => {
    const compiled = compileWorkspaceWithProfileContext(sources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    // Values, not shapes: this is the exact context a host threads through,
    // and it is asserted BEFORE any question is evaluated so a later "the
    // question opened" can never be read off an engine with nothing to read.
    expect(compiled.patternVacancies).toEqual([
      {
        instance: 'greeting-app',
        pattern: 'aperturex/mule@1.0#mule-http-api',
        slot: 'backend',
        slotKind: 'yarramate/core@0.1#applicationComponent',
        required: false,
      },
      {
        instance: 'greeting-app',
        pattern: 'aperturex/mule@1.0#mule-http-api',
        slot: 'behaviour',
        slotKind: 'yarramate/core@0.1#applicationFunction',
        required: false,
      },
      {
        instance: 'greeting-app',
        pattern: 'aperturex/mule@1.0#mule-http-api',
        slot: 'mapping',
        slotKind: 'yarramate/core@0.1#dataObject',
        required: false,
      },
      {
        instance: 'greeting-app',
        pattern: 'aperturex/mule@1.0#mule-http-api',
        slot: 'service',
        slotKind: 'yarramate/core@0.1#applicationService',
        required: false,
      },
      // The bare instance: no `parts` line at all, so nothing collected it as
      // a PatternInstance and its one slot was invisible. It is asked about.
      {
        instance: 'process-app',
        pattern: 'aperturex/mule@1.0#mule-process-api',
        slot: 'service',
        slotKind: 'yarramate/core@0.1#applicationService',
        required: false,
      },
    ])
    // The bound part is in the OTHER array and in neither twice.
    expect(
      compiled.patternMemberships?.map(({ member, slot }) => [member, slot]),
    ).toEqual([['patron-api', 'interface']])
    expect(
      compiled.patternVacancies?.some(({ slot }) => slot === 'interface'),
    ).toBe(false)
  })

  it('emits an empty array, not an absent one, when every slot is bound', () => {
    // An empty set is not a finished one, read from the other side: `[]` is a
    // workspace whose instances are fully bound and a host may say so, while
    // an absent array is a caller that never looked and a host may not.
    const compiled = compileWorkspaceWithProfileContext(goldenSources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.patternVacancies).toEqual([])
    expect(Array.isArray(compiled.patternVacancies)).toBe(true)
  })

  it('asks the greenfield instance about every slot, required ones included', () => {
    // The case the first draft could not see. `greeting-app` here declares no
    // `parts`, so it is not a PatternInstance: YM416 never fires, the compile
    // SUCCEEDS, and before this it reported `[]` — "fully bound" — for a model
    // missing a required part. Every slot is a question, and the required one
    // says so.
    const compiled = compileWorkspaceWithProfileContext([
      { path: 'profiles/mule.yaml', source: profile },
      { path: 'patterns/mule.yaml', source: pattern },
      { path: 'architecture/main.yaml', source: bareDocument },
    ])
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(
      compiled.patternVacancies?.map(({ slot, required }) => [slot, required]),
    ).toEqual([
      ['backend', false],
      ['behaviour', false],
      ['interface', true],
      ['mapping', false],
      ['service', false],
    ])
    // Still not an instance for the purposes that would break a build: no
    // membership, no YM416, nothing that compiles today stops compiling.
    expect(compiled.patternMemberships).toEqual([])
  })

  it('flags a required vacancy only where the compile could reach one', () => {
    // The mirror of the above, and the reason `required` is not decoration:
    // an instance that DECLARES parts and leaves a required one unbound is
    // YM416 and never produces a result at all, so `required: true` on a row
    // you can actually read always means the greenfield case.
    const compiled = compileWorkspaceWithProfileContext([
      { path: 'profiles/mule.yaml', source: profile },
      { path: 'patterns/mule.yaml', source: pattern },
      {
        path: 'architecture/main.yaml',
        source: `format: yarramate/v1
id: main
profile: aperturex/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
    parts:
      service: greeting-service
  - id: greeting-service
    kind: applicationService
    name: Greeting service
relationships: []
`,
      },
    ])
    expect(compiled.ok).toBe(false)
    if (compiled.ok) return
    expect(compiled.diagnostics.map(({ code }) => code)).toContain('YM416')
  })
})

describe('missing-part through the CLI', () => {
  let workspace = ''
  const write = (relative: string, source: string) =>
    writeFileSync(join(workspace, relative), source, 'utf8')

  const manifest = (withQuestions: boolean) =>
    'format: yarramate/workspace/v1\n' +
    'id: vacancy-probe\n' +
    'documents:\n  - architecture/*.yaml\n' +
    'profiles:\n  - profiles/*.yaml\n' +
    'projections: []\n' +
    'adapterMappings: []\n' +
    'patterns:\n  - patterns/*.yaml\n' +
    (withQuestions ? 'questions:\n  - questions/*.yaml\n' : '')

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-vacancy-'))
    for (const directory of [
      'architecture',
      'profiles',
      'patterns',
      'questions',
    ]) {
      mkdirSync(join(workspace, '.yarramate', directory), { recursive: true })
    }
    write('.yarramate/workspace.yaml', manifest(true))
    write('.yarramate/architecture/main.yaml', document)
    write('.yarramate/profiles/mule.yaml', profile)
    write('.yarramate/patterns/mule.yaml', pattern)
    write('.yarramate/questions/vacancy-probe.yaml', catalogue())
  })

  afterEach(() => rmSync(workspace, { recursive: true, force: true }))

  const probeQuestions = (): ReadonlyMap<string, ReportedQuestion> => {
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { report } = JSON.parse(result.stdout) as {
      report: { waves: { id: string; questions: ReportedQuestion[] }[] }
    }
    const probe = report.waves.find(({ id }) => id === 'probe')
    expect(probe).toBeDefined()
    return new Map(probe!.questions.map((question) => [question.id, question]))
  }

  const openSlotQuestions = (
    questions: ReadonlyMap<string, ReportedQuestion>,
  ): readonly string[] =>
    ['service', 'backend', 'behaviour', 'mapping']
      .filter(
        (slot) => questions.get(`vacancy-probe#bind-${slot}`)?.open === true,
      )
      .sort()

  it('opens one question per vacant slot on the instance that owns it', () => {
    const questions = probeQuestions()
    expect(openSlotQuestions(questions)).toEqual([
      'backend',
      'behaviour',
      'mapping',
      'service',
    ])
    // Subject-scoped, so the subject is the INSTANCE — the thing that has to
    // decide — not the absent member, which by definition has no id.
    expect(
      questions.get('vacancy-probe#bind-service')?.subjects?.map(({ id }) => id),
    ).toEqual(['greeting-app'])
  })

  it('closes exactly the slots that get bound, and leaves the rest open', () => {
    write(
      '.yarramate/architecture/main.yaml',
      document
        .replace(
          '      interface: patron-api\n',
          '      interface: patron-api\n' +
            '      service: greeting-service\n' +
            '      backend: greeting-backend\n',
        )
        // Before `relationships:`, not after it — appending to the end of the
        // document puts concepts inside the relationships list.
        .replace(
          'relationships: []\n',
          `  - id: greeting-service
    kind: applicationService
    name: Greeting service
  - id: greeting-backend
    kind: applicationComponent
    name: Greeting backend
relationships: []
`,
        ),
    )
    expect(openSlotQuestions(probeQuestions())).toEqual(['behaviour', 'mapping'])
  })

  it('asks nothing of an instance whose slots are all bound', () => {
    write('.yarramate/architecture/main.yaml', goldenDocument)
    const questions = probeQuestions()
    expect(openSlotQuestions(questions)).toEqual([])
    // Closed because nothing is vacant, not because nothing matched: the
    // selector still found the instance. Without this the assertion above
    // would pass against a fixture that had stopped compiling the pattern.
    expect(questions.get('vacancy-probe#bind-service')?.asked).not.toBe(false)
  })

  it('does not leak a slot name across patterns that both declare it', () => {
    // `process-app` has a vacant `service` too, and it is a different
    // pattern's `service`. Both guards are in place here; the next test
    // measures which one is actually doing the work.
    const questions = probeQuestions()
    expect(
      questions.get('vacancy-probe#bind-service')?.subjects?.map(({ id }) => id),
    ).toEqual(['greeting-app'])
    expect(
      questions.get('vacancy-probe#any-vacancy')?.subjects?.map(({ id }) => id),
    ).toEqual(['greeting-app'])
  })

  it('scopes by the subject selector even with patternKinds removed', () => {
    // Amendment 1 on #447, measured rather than assumed: a kind has at most
    // one pattern (YM411), so the selector alone already pins the pattern and
    // `patternKinds` is defence in depth. Recorded as a test so the docs claim
    // that it is optional cannot quietly stop being true.
    write(
      '.yarramate/questions/vacancy-probe.yaml',
      `format: yarramate/question-catalogue/v1
id: vacancy-probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: probe
    name: Probe
questions:
${slotQuestion('service', false)}`,
    )
    const questions = probeQuestions()
    expect(
      questions.get('vacancy-probe#bind-service')?.subjects?.map(({ id }) => id),
    ).toEqual(['greeting-app'])
  })

  it('narrows by patternKinds where the selector is broader than one kind', () => {
    // And here it IS load-bearing: a selector naming both kinds matches both
    // instances, both have a vacant slot named `service`, and only
    // `patternKinds` separates them. This is the case the facet exists for.
    const broadSelector = (patternKinds: boolean) =>
      `format: yarramate/question-catalogue/v1
id: vacancy-probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: probe
    name: Probe
questions:
  - id: bind-service
    wave: probe
    scope: subject
    subjects:
      kinds:
        - aperturex/mule@1.0#mule-http-api
        - aperturex/mule@1.0#mule-process-api
    trigger:
      - condition: missing-part
${patternKinds ? '        patternKinds:\n          - aperturex/mule@1.0#mule-http-api\n' : ''}        slots:
          - service
    question: What fills the service of {subject.name}?
    materiality: An unbound part is a decision nobody has taken.
    resolution: Bind the part.
    authority: human
`
    write('.yarramate/questions/vacancy-probe.yaml', broadSelector(false))
    expect(
      probeQuestions()
        .get('vacancy-probe#bind-service')
        ?.subjects?.map(({ id }) => id)
        .sort(),
    ).toEqual(['greeting-app', 'process-app'])

    write('.yarramate/questions/vacancy-probe.yaml', broadSelector(true))
    expect(
      probeQuestions()
        .get('vacancy-probe#bind-service')
        ?.subjects?.map(({ id }) => id),
    ).toEqual(['greeting-app'])
  })

  it('echoes the trigger verbatim, so a host can join to the slot kind', () => {
    // The seventh admission test with no new report field: the host reads
    // `slots` off the echoed trigger, joins (instance, slot) against
    // `patternVacancies`, and derives its own answer shape from `slotKind`.
    // The kind is NOT copied into the report, where it could drift from the
    // pattern document.
    const trigger = probeQuestions().get('vacancy-probe#bind-service')?.trigger
    expect(trigger).toEqual([
      {
        condition: 'missing-part',
        patternKinds: ['aperturex/mule@1.0#mule-http-api'],
        slots: ['service'],
      },
    ])
  })

  it('reaches advice: the slice names the vacancy question at its instance', () => {
    // Each evaluation call site threads vacancies separately and an unthreaded
    // one fails SILENTLY, so every ask mode that evaluates gets its own
    // assertion (ADR 0131's lesson, paid again here).
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--advise', 'Greeting app', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const advice = JSON.parse(result.stdout) as {
      openQuestions: readonly { id: string; subject?: string }[]
    }
    expect(
      advice.openQuestions.some(
        ({ id, subject }) =>
          id === 'vacancy-probe#bind-service' && subject === 'greeting-app',
      ),
    ).toBe(true)
  })

  it('reaches orientation: the open count carries the vacancy questions', () => {
    // A DELTA against the same workspace with its questions category removed,
    // so shipped catalogue evolution cannot move the expectation: four slot
    // questions at one subject each plus the bare one, and only vacancies
    // make that 5.
    const withQuestions = JSON.parse(
      runCli(['ask', '.yarramate/workspace.yaml', '--json'], workspace).stdout,
    ) as { design: { open: number } }
    write('.yarramate/workspace.yaml', manifest(false))
    const withoutQuestions = JSON.parse(
      runCli(['ask', '.yarramate/workspace.yaml', '--json'], workspace).stdout,
    ) as { design: { open: number } }
    expect(withQuestions.design.open - withoutQuestions.design.open).toBe(5)
  })

  it('reaches the design verb: the interview asks for the vacant part', () => {
    write('.yarramate/workspace.yaml', manifest(false))
    const result = runCli(
      [
        'design',
        '.yarramate/workspace.yaml',
        '--catalogue',
        '.yarramate/questions/vacancy-probe.yaml',
        '--subject',
        'greeting-app',
        '--json',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { step } = JSON.parse(result.stdout) as {
      step: { questionId?: string; openSubjects?: readonly string[] } | null
    }
    expect(step?.questionId).toBe('vacancy-probe#bind-service')
    expect(step?.openSubjects).toEqual(['greeting-app'])
  })

  it('refuses a mistyped pattern kind with YM914', () => {
    // `patternKinds` is a kind reference wherever it appears, so the field
    // joins the existing validation by name rather than by condition.
    write(
      '.yarramate/questions/vacancy-probe.yaml',
      catalogue().replace(
        'aperturex/mule@1.0#mule-http-api\n    trigger:\n      - condition: missing-part\n        patternKinds:\n          - aperturex/mule@1.0#mule-http-api',
        'aperturex/mule@1.0#mule-http-api\n    trigger:\n      - condition: missing-part\n        patternKinds:\n          - aperturex/mule@1.0#nonexistent',
      ),
    )
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('YM914')
    expect(result.stdout).toContain('aperturex/mule@1.0#nonexistent')
  })
})

describe('missing-part through the published API', () => {
  it('fires when vacancies are passed and stays quiet when they are not', () => {
    const compiled = compileWorkspaceWithProfileContext(sources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    // The vacancy exists first. Only then is the question allowed to prove
    // anything about the engine.
    expect(
      compiled.patternVacancies?.some(
        ({ instance, slot }) =>
          instance === 'greeting-app' && slot === 'service',
      ),
    ).toBe(true)

    const composed = composeCatalogues([
      { path: 'questions/vacancy-probe.yaml', source: catalogue() },
    ])
    expect(composed.ok).toBe(true)
    if (!composed.ok) return

    const evaluate = (vacancies?: typeof compiled.patternVacancies) =>
      evaluateCatalogue(
        composed.composed.catalogue,
        compiled.graph,
        compiled.profileContext,
        undefined,
        composed.composed.catalogues,
        compiled.patternMemberships,
        vacancies,
      ).waves[0]?.questions.find(
        ({ id }) => id === 'vacancy-probe#bind-service',
      )

    expect(evaluate(compiled.patternVacancies)?.open).toBe(true)
    // Absent vacancies stay quiet: the caller did not derive them, so what is
    // unbound is unknown rather than nothing — the rule ADR 0131 recorded for
    // absent memberships and `unchallenged-evidence` for an absent overlay.
    //
    // The report cannot yet distinguish this from an answered question, which
    // is #450 and deliberately not this issue: fixing it here would put a
    // published-shape change inside a feature addition.
    expect(evaluate(undefined)?.open).toBe(false)
    // An EMPTY array is the opposite of an absent one and must not be read as
    // "no data": it says every slot is bound, and the question closes on the
    // evidence rather than on the silence.
    expect(evaluate([])?.open).toBe(false)
  })

  it('reaches the embedded pane through its own compiled shape', () => {
    // The visual host evaluates through interrogationOverlayOf with a
    // structural `compiled`, and the narrow-copy construction sites are
    // exactly where a vacancy question would silently never fire in the pane.
    const compiled = compileWorkspaceWithProfileContext(sources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.patternVacancies?.length).toBeGreaterThan(0)
    const overlay = interrogationOverlayOf(compiled, {
      path: 'questions/vacancy-probe.yaml',
      source: catalogue(),
    })
    expect(overlay).toBeDefined()
    expect(
      overlay!.subjects['greeting-app']?.map(({ questionId }) => questionId),
    ).toContain('vacancy-probe#bind-service')
    // The other pattern's instance has a vacant `service` and is not asked.
    expect(
      overlay!.subjects['process-app']?.map(({ questionId }) => questionId) ??
        [],
    ).not.toContain('vacancy-probe#bind-service')
  })
})
