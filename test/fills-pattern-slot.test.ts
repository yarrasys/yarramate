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

// fills-pattern-slot (#346, ADR 0131): membership survives the compile as
// context, and a guard reads it. The fixtures mirror the api-led cluster
// from pattern-expansion.test.ts.

const profile = `format: yarramate/profile/v1
id: yarrasys/api-led
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

const pattern = `format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
        required: true
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: component
      - from: component
        kind: yarramate/core@0.1#composition
        to: interface
      - from: interface
        kind: yarramate/core@0.1#assignment
        to: service
`

// One bound cluster, and a twin component bound into nothing: the pair a
// membership condition must tell apart, because both carry the same kind
// and only the binding separates them.
const document = `format: yarramate/v1
id: main
profile: yarrasys/api-led@1.0
concepts:
  - id: sys-api
    kind: api
    name: System API
    parts:
      component: sys-component
      interface: sys-interface
      service: sys-service
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
  - id: lone-component
    kind: applicationComponent
    name: Lone component
relationships: []
`

const catalogue = (
  patternKind = 'yarrasys/api-led@1.0#api',
) => `format: yarramate/question-catalogue/v1
id: slot-probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: probe
    name: Probe
questions:
  - id: hub-owner
    wave: probe
    scope: subject
    subjects:
      kinds:
        - yarramate/core@0.1#applicationComponent
    trigger:
      - condition: fills-pattern-slot
        patternKinds:
          - ${patternKind}
        slots:
          - component
    question: Who owns the retry policy of {subject.name}?
    materiality: The hub is where every spoke's failure lands.
    resolution: Record the owner.
    authority: human
  - id: any-member
    wave: probe
    scope: subject
    subjects: {}
    trigger:
      - condition: fills-pattern-slot
    question: What does {subject.name} decide as a pattern member?
    materiality: A bound part inherits the pattern's consequences.
    resolution: Answer per member.
    authority: either
  - id: wrong-slot
    wave: probe
    scope: subject
    subjects:
      kinds:
        - yarramate/core@0.1#applicationComponent
    trigger:
      - condition: fills-pattern-slot
        slots:
          - service
    question: Never fires — no component fills the service slot.
    materiality: Placeholder.
    resolution: Placeholder.
    authority: human
`

const sources: readonly WorkspaceSource[] = [
  { path: 'profiles/api-led.yaml', source: profile },
  { path: 'patterns/api-led.yaml', source: pattern },
  { path: 'architecture/main.yaml', source: document },
]

interface ReportedQuestion {
  readonly id: string
  readonly open: boolean
  readonly subjects?: readonly { readonly id: string }[]
}

describe('fills-pattern-slot through the CLI', () => {
  let workspace = ''
  const write = (relative: string, source: string) =>
    writeFileSync(join(workspace, relative), source, 'utf8')

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-slot-'))
    for (const directory of [
      'architecture',
      'profiles',
      'patterns',
      'questions',
    ]) {
      mkdirSync(join(workspace, '.yarramate', directory), { recursive: true })
    }
    write(
      '.yarramate/workspace.yaml',
      'format: yarramate/workspace/v1\n' +
        'id: slot-probe\n' +
        'documents:\n  - architecture/*.yaml\n' +
        'profiles:\n  - profiles/*.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'patterns:\n  - patterns/*.yaml\n' +
        'questions:\n  - questions/*.yaml\n',
    )
    write('.yarramate/architecture/main.yaml', document)
    write('.yarramate/profiles/api-led.yaml', profile)
    write('.yarramate/patterns/api-led.yaml', pattern)
    write('.yarramate/questions/slot-probe.yaml', catalogue())
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

  it('asks the slot question of the bound member and nobody else', () => {
    const questions = probeQuestions()
    const hubOwner = questions.get('slot-probe#hub-owner')
    expect(hubOwner?.open).toBe(true)
    // Exactly the bound component: lone-component carries the same kind and
    // is NOT asked, which is the whole point of the condition — and the
    // fixture proves the twin exists by asking `any-member` about nobody
    // named lone-component either.
    expect(hubOwner?.subjects?.map(({ id }) => id)).toEqual(['sys-component'])
  })

  it('asks a bare membership question of every bound member only', () => {
    const questions = probeQuestions()
    const anyMember = questions.get('slot-probe#any-member')
    expect(anyMember?.open).toBe(true)
    expect(anyMember?.subjects?.map(({ id }) => id).sort()).toEqual([
      'sys-component',
      'sys-interface',
      'sys-service',
    ])
  })

  it('stays closed when the named slot is filled by another kind', () => {
    const questions = probeQuestions()
    expect(questions.get('slot-probe#wrong-slot')?.open).toBe(false)
  })

  it('reaches advice: the slice names the slot question at its subject', () => {
    // Each evaluation call site threads memberships separately, and an
    // unthreaded one fails SILENTLY (the question just never fires) — so
    // every ask mode that evaluates gets its own assertion. This is the
    // --advise path.
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--advise', 'System component', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const advice = JSON.parse(result.stdout) as {
      openQuestions: readonly { id: string; subject?: string }[]
    }
    expect(
      advice.openQuestions.some(
        ({ id, subject }) =>
          id === 'slot-probe#hub-owner' && subject === 'sys-component',
      ),
    ).toBe(true)
  })

  it('reaches orientation: the open count carries the slot questions', () => {
    // Bare-ask orientation reports design.open. Asserted as a DELTA against
    // the same workspace with its questions category removed, so shipped
    // catalogue evolution cannot move the expectation: hub-owner opens at
    // one subject and any-member at three, and only memberships make that 4.
    const withQuestions = JSON.parse(
      runCli(['ask', '.yarramate/workspace.yaml', '--json'], workspace)
        .stdout,
    ) as { design: { open: number } }
    write(
      '.yarramate/workspace.yaml',
      'format: yarramate/workspace/v1\n' +
        'id: slot-probe\n' +
        'documents:\n  - architecture/*.yaml\n' +
        'profiles:\n  - profiles/*.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'patterns:\n  - patterns/*.yaml\n',
    )
    const withoutQuestions = JSON.parse(
      runCli(['ask', '.yarramate/workspace.yaml', '--json'], workspace)
        .stdout,
    ) as { design: { open: number } }
    expect(withQuestions.design.open - withoutQuestions.design.open).toBe(4)
  })

  it('reaches the design verb: the interview asks the slot question', () => {
    // design threads memberships through its own evaluate call, and an
    // unthreaded one is the interview itself going silent on pattern
    // questions. `--catalogue` REPLACES the shipped base, which is what
    // makes the selected step deterministic — and the `questions:` category
    // must go, because it ADDS even alongside `--catalogue` and the same
    // catalogue twice is a composition refusal.
    write(
      '.yarramate/workspace.yaml',
      'format: yarramate/workspace/v1\n' +
        'id: slot-probe\n' +
        'documents:\n  - architecture/*.yaml\n' +
        'profiles:\n  - profiles/*.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'patterns:\n  - patterns/*.yaml\n',
    )
    const result = runCli(
      [
        'design',
        '.yarramate/workspace.yaml',
        '--catalogue',
        '.yarramate/questions/slot-probe.yaml',
        '--subject',
        'sys-component',
        '--json',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { step } = JSON.parse(result.stdout) as {
      step: {
        questionId?: string
        openSubjects?: readonly string[]
      } | null
    }
    expect(step?.questionId).toBe('slot-probe#hub-owner')
    expect(step?.openSubjects).toEqual(['sys-component'])
  })

  it('refuses a mistyped pattern kind with YM914', () => {
    write(
      '.yarramate/questions/slot-probe.yaml',
      catalogue('yarrasys/api-led@1.0#nonexistent'),
    )
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('YM914')
    expect(result.stdout).toContain('yarrasys/api-led@1.0#nonexistent')
  })
})

describe('fills-pattern-slot through the published API', () => {
  it('compiles the memberships and evaluates them when passed', () => {
    const compiled = compileWorkspaceWithProfileContext(sources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    // The exact context a host threads through — values, not shapes.
    // `wiring` arrived with #473 and says which way the pattern's wires run
    // between the instance and the slot. This fixture has all three cases bar
    // `context`: `self -> component` makes the component OWNED, while
    // `component -> interface` and `interface -> service` never touch `self`,
    // so both are UNWIRED. See `test/apply-parts.test.ts` for `context`.
    expect(compiled.patternMemberships).toEqual([
      {
        member: 'sys-component',
        slot: 'component',
        instance: 'sys-api',
        pattern: 'yarrasys/api-led@1.0#api',
        wiring: 'owned',
      },
      {
        member: 'sys-interface',
        slot: 'interface',
        instance: 'sys-api',
        pattern: 'yarrasys/api-led@1.0#api',
        wiring: 'unwired',
      },
      {
        member: 'sys-service',
        slot: 'service',
        instance: 'sys-api',
        pattern: 'yarrasys/api-led@1.0#api',
        wiring: 'unwired',
      },
    ])

    const composed = composeCatalogues([
      { path: 'questions/slot-probe.yaml', source: catalogue() },
    ])
    expect(composed.ok).toBe(true)
    if (!composed.ok) return

    const withMemberships = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      undefined,
      composed.composed.catalogues,
      compiled.patternMemberships,
    )
    const asked = withMemberships.waves[0]?.questions.find(
      ({ id }) => id === 'slot-probe#hub-owner',
    )
    expect(asked?.open).toBe(true)

    // Absent memberships stay quiet: the caller did not derive them, so
    // participation is unknown, not absent — the recorded semantics of
    // `unchallenged-evidence` with a missing overlay (ADR 0131).
    const withoutMemberships = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      undefined,
      composed.composed.catalogues,
    )
    const quiet = withoutMemberships.waves[0]?.questions.find(
      ({ id }) => id === 'slot-probe#hub-owner',
    )
    expect(quiet?.open).toBe(false)
  })

  it('reaches the embedded pane through its own compiled shape', () => {
    // The visual host evaluates through interrogationOverlayOf with a
    // structural `compiled` — the narrow-copy construction sites are where
    // a slot question would silently never fire in the pane (ADR 0131).
    const compiled = compileWorkspaceWithProfileContext(sources)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const overlay = interrogationOverlayOf(compiled, {
      path: 'questions/slot-probe.yaml',
      source: catalogue(),
    })
    expect(overlay).toBeDefined()
    expect(
      overlay!.subjects['sys-component']?.map(({ questionId }) => questionId),
    ).toContain('slot-probe#hub-owner')
    expect(Object.keys(overlay!.subjects)).not.toContain('lone-component')
  })
})
