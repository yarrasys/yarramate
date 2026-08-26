import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const reportSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-interrogation-report.schema.json'),
    'utf8',
  ),
) as object

const catalogueSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-question-catalogue.schema.json'),
    'utf8',
  ),
) as { readonly $defs: { readonly question: { readonly properties: { readonly authority: { readonly enum: readonly string[] } } } } }

const catalogue =
  'format: yarramate/question-catalogue/v1\n' +
  'id: fixture\n' +
  'version: "1.0"\n' +
  'profile: yarramate/core@0.1\n' +
  'waves:\n' +
  '  - id: motivation\n' +
  '    name: Motivation\n' +
  '  - id: hygiene\n' +
  '    name: Hygiene\n' +
  'questions:\n' +
  '  - id: goal-missing\n' +
  '    wave: motivation\n' +
  '    scope: workspace\n' +
  '    trigger:\n' +
  '      - condition: no-subject-of-kind\n' +
  '        kinds: ["yarramate/core@0.1#goal"]\n' +
  '    question: What outcome justifies this system?\n' +
  '    materiality: Without a goal every trade-off becomes taste.\n' +
  '    authority: human\n' +
  '    resolution: Add a goal concept.\n' +
  '  - id: actor-owner-missing\n' +
  '    wave: hygiene\n' +
  '    since: "1.1"\n' +
  '    scope: subject\n' +
  '    subjects:\n' +
  '      kinds: ["yarramate/core@0.1#businessActor"]\n' +
  '    trigger:\n' +
  '      - condition: missing-claim\n' +
  '        predicate: yarramate/ownership/owner\n' +
  '    question: Who is accountable for {subject.name}?\n' +
  '    materiality: Ownership decides who accepts changes.\n' +
  '    authority: either\n' +
  '    resolution: Add an owner reference.\n'

const document =
  'format: yarramate/v1\n' +
  'id: main\n' +
  'profile: example/platform@1.0\n' +
  'concepts:\n' +
  '  - id: platform\n' +
  '    kind: platform-team\n' +
  '    name: Platform team\n' +
  '  - id: customer\n' +
  '    kind: businessActor\n' +
  '    name: Customer\n' +
  'relationships: []\n'

const manifest =
  'format: yarramate/workspace/v1\n' +
  'id: interrogate-fixture\n' +
  'documents:\n' +
  '  - architecture/main.yaml\n' +
  'profiles:\n' +
  '  - profiles/platform.yaml\n' +
  'projections: []\n' +
  'adapterMappings: []\n' +
  'evidence: []\n'

describe('ask --open interrogation', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-interrogate-'))
    mkdirSync(join(workspace, 'architecture'))
    mkdirSync(join(workspace, 'profiles'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(
      join(workspace, 'profiles/platform.yaml'),
      readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/platform-profile.yaml'),
        'utf8',
      ),
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'catalogue.yaml'), catalogue, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('reports open questions and closes them when triggers stop matching', () => {
    const before = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(before.exitCode).toBe(0)
    expect(before.stdout).toContain(
      'OPEN   goal-missing — What outcome justifies this system?',
    )

    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      document.replace(
        'relationships: []\n',
        '  - id: engagement\n' +
          '    kind: goal\n' +
          '    name: Engagement\n' +
          'relationships: []\n',
      ),
      'utf8',
    )
    const after = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    expect(after.stdout).toContain('closed goal-missing')
  })

  it.each(catalogueSchema.$defs.question.properties.authority.enum)(
    'renders a "%s" authority into a schema-valid report',
    (authority) => {
      // The catalogue is an input contract and the report is an output one.
      // An authority a catalogue may legally declare that the report cannot
      // carry is a vocabulary split that only shows up once someone writes
      // the catalogue - so every admitted value round-trips here.
      writeFileSync(
        join(workspace, 'catalogue.yaml'),
        catalogue.replace('    authority: human\n', `    authority: ${authority}\n`),
        'utf8',
      )
      const result = runCli(
        [
          'ask',
          'workspace.yaml',
          '--open',
          '--catalogue',
          'catalogue.yaml',
          '--json',
        ],
        workspace,
      )
      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as {
        readonly report: unknown
      }
      const validate = new Ajv2020({ allErrors: true }).compile(reportSchema)
      expect({ authority, valid: validate(payload.report), errors: validate.errors }).toEqual({
        authority,
        valid: true,
        errors: null,
      })
    },
  )

  it('matches subject selectors through profile lineage by default', () => {
    // platform-team descends from businessActor, so the selector written
    // against the core kind must reach the derived concept too.
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'actor-owner-missing [since 1.1] (2 subjects)',
    )
    expect(result.stdout).toContain(
      'ask: "Who is accountable for Customer?" [authority: either]',
    )
    expect(result.stdout).toContain(
      'ask: "Who is accountable for Platform team?" [authority: either]',
    )
  })

  it('honours an explicit exact kind matching', () => {
    writeFileSync(
      join(workspace, 'catalogue.yaml'),
      catalogue.replace(
        '      kinds: ["yarramate/core@0.1#businessActor"]\n',
        '      kinds: ["yarramate/core@0.1#businessActor"]\n' +
          '      kindMatching: exact\n',
      ),
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'actor-owner-missing [since 1.1] (1 subject)',
    )
    expect(result.stdout).not.toContain('Platform team?')
  })

  it('emits a deterministic, schema-valid machine report', () => {
    const first = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    const second = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(first.exitCode).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    const payload = (
      JSON.parse(first.stdout) as {
        report: {
          format: string
          workspace: string
          catalogue: string
          summary: {
            questions: number
            openQuestions: number
            open: number
          }
          waves: readonly {
            id: string
            questions: readonly {
              id: string
              open: boolean
              subjects?: readonly { id: string; question: string }[]
            }[]
          }[]
        }
      }
    ).report
    expect(payload.format).toBe('yarramate/interrogation-report/v1')
    expect(payload.workspace).toBe('interrogate-fixture')
    expect(payload.catalogue).toBe('fixture@1.0')
    expect(payload.summary).toEqual({ questions: 2, openQuestions: 2, open: 3 })
    const owners = payload.waves
      .find(({ id }) => id === 'hygiene')!
      .questions.find(({ id }) => id === 'actor-owner-missing')!
    expect(owners.subjects!.map(({ id }) => id)).toEqual([
      'customer',
      'platform',
    ])
    // The delta annotation (ADR 0063) rides the report so consumers can
    // tell 'the catalogue deepened' from 'the model regressed'.
    expect((owners as { since?: string }).since).toBe('1.1')
    // The verbatim catalogue trigger rides every question (#289): the
    // machine-readable answer shape a host builds its affordance from,
    // instead of re-deriving it from its own catalogue copy.
    expect((owners as { trigger?: unknown }).trigger).toEqual([
      { condition: 'missing-claim', predicate: 'yarramate/ownership/owner' },
    ])
    const validate = new Ajv2020({ allErrors: true }).compile(reportSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('never interrogates retired subjects (ADR 0064)', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      document.replace(
        '  - id: customer\n' +
          '    kind: businessActor\n' +
          '    name: Customer\n',
        '  - id: customer\n' +
          '    kind: businessActor\n' +
          '    name: Customer\n' +
          '    status: retired\n',
      ),
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    // Retirement is the recorded descoping decision: the retired actor
    // leaves the interview entirely; the live one is still asked.
    expect(result.stdout).not.toContain('Customer?')
    expect(result.stdout).toContain('Platform team?')
  })

  it('locates a question referencing an undeclared wave', () => {
    writeFileSync(
      join(workspace, 'catalogue.yaml'),
      catalogue.replace('    wave: hygiene\n', '    wave: hygeine\n'),
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error YM911')
    expect(result.stdout).toContain(
      'Question "actor-owner-missing" references undeclared wave "hygeine"',
    )
    expect(result.stdout).toMatch(/^catalogue\.yaml:\d+:\d+ /)
  })

  it('rejects a composing catalogue: extends is deferred from v1', () => {
    writeFileSync(
      join(workspace, 'catalogue.yaml'),
      catalogue.replace(
        'profile: yarramate/core@0.1\n',
        'profile: yarramate/core@0.1\nextends: other-catalogue@1.0\n',
      ),
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('extends')
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(
      ['ask', 'architecture/main.yaml', '--open', '--catalogue', 'catalogue.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'ask requires an explicit workspace manifest',
    )
  })

  it('rejects unknown options with usage', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--budget'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })

  it('evaluates linkage, reference, and attestation conditions with lineage', () => {
    const adequacy =
      'format: yarramate/question-catalogue/v1\n' +
      'id: adequacy-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: depth\n' +
      '    name: Depth\n' +
      'questions:\n' +
      '  - id: goal-no-driver\n' +
      '    wave: depth\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#goal"]\n' +
      '    trigger:\n' +
      '      - condition: missing-linkage\n' +
      '        kinds: ["yarramate/core@0.1#influence"]\n' +
      '        direction: incoming\n' +
      '        counterpartKinds: ["yarramate/core@0.1#businessActor"]\n' +
      '    question: What pressure produces {subject.name}?\n' +
      '    materiality: Goals with no driver cannot be reprioritized.\n' +
      '    authority: human\n' +
      '    resolution: Link the driver.\n' +
      '  - id: constraint-unenforced\n' +
      '    wave: depth\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#constraint"]\n' +
      '    trigger:\n' +
      '      - condition: missing-reference\n' +
      '        predicate: yarramate/constraint/requires\n' +
      '        direction: incoming\n' +
      '    question: Nothing binds itself to {subject.name}. Enforced where?\n' +
      '    materiality: A constraint nothing cites constrains nothing.\n' +
      '    authority: either\n' +
      '    resolution: Attach constraint references from bound subjects.\n' +
      '  - id: goal-unattested\n' +
      '    wave: depth\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#goal"]\n' +
      '    trigger:\n' +
      '      - condition: missing-attestation\n' +
      '        topic: adequacy\n' +
      '    question: Has {subject.name} been accepted as adequately stated?\n' +
      '    materiality: Without attestation adequacy is nobody\'s decision.\n' +
      '    authority: human\n' +
      '    resolution: Record an adequacy attestation.\n'
    const enriched =
      'format: yarramate/v1\n' +
      'id: main\n' +
      'profile: example/platform@1.0\n' +
      'concepts:\n' +
      '  - id: engagement\n' +
      '    kind: goal\n' +
      '    name: Engagement\n' +
      '  - id: platform\n' +
      '    kind: platform-team\n' +
      '    name: Platform team\n' +
      '  - id: budget-cap\n' +
      '    kind: constraint\n' +
      '    name: Budget cap\n' +
      'relationships: []\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), adequacy, 'utf8')
    writeFileSync(join(workspace, 'architecture/main.yaml'), enriched, 'utf8')

    const before = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(before.exitCode).toBe(0)
    expect(JSON.parse(before.stdout).report.summary).toEqual({
      questions: 3,
      openQuestions: 3,
      open: 3,
    })

    // Close all three: an influence from a profile-derived actor (lineage
    // reaches businessActor), a constraint reference, and an attestation.
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: example/platform@1.0\n' +
        'concepts:\n' +
        '  - id: engagement\n' +
        '    kind: goal\n' +
        '    name: Engagement\n' +
        '    attestations:\n' +
        '      - topic: adequacy\n' +
        '        by: platform\n' +
        '        on: "2026-08-01"\n' +
        '  - id: platform\n' +
        '    kind: platform-team\n' +
        '    name: Platform team\n' +
        '  - id: budget-cap\n' +
        '    kind: constraint\n' +
        '    name: Budget cap\n' +
        '  - id: rollout\n' +
        '    kind: businessProcess\n' +
        '    name: Rollout\n' +
        '    constraints:\n' +
        '      - id: cap\n' +
        '        ref: budget-cap\n' +
        'relationships:\n' +
        '  - id: platform-drives-engagement\n' +
        '    kind: influence\n' +
        '    from: platform\n' +
        '    to: engagement\n',
      'utf8',
    )
    const after = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    expect(JSON.parse(after.stdout).report.summary).toEqual({
      questions: 3,
      openQuestions: 0,
      open: 0,
    })
  })

  it('opens a kind nothing constrains and closes it through an inherited endpoint aspect', () => {
    // ADR 0083: a kind is falsifiable only where some relationship kind pins
    // the aspect at that subject's end. The fixture's `owns` declares no
    // `sourceAspects` - it inherits `active-structure` from core
    // `assignment` - so the pin is only visible through profile lineage.
    // `association` pins neither end, which is the control: participating in
    // a relationship is not the test, being constrained by one is.
    const hygiene =
      'format: yarramate/question-catalogue/v1\n' +
      'id: kind-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: hygiene\n' +
      '    name: Hygiene\n' +
      'questions:\n' +
      '  - id: kind-untested\n' +
      '    wave: hygiene\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#businessActor"]\n' +
      '    trigger:\n' +
      '      - condition: unconstrained-kind\n' +
      '    question: Nothing tests that {subject.name} is what its kind says.\n' +
      '    materiality: A kind no rule can contradict is a label.\n' +
      '    authority: either\n' +
      '    resolution: Assign it to the behaviour it performs.\n'
    const kinded =
      'format: yarramate/v1\n' +
      'id: main\n' +
      'profile: example/platform@1.0\n' +
      'concepts:\n' +
      '  - id: platform\n' +
      '    kind: platform-team\n' +
      '    name: Platform team\n' +
      '  - id: customer\n' +
      '    kind: businessActor\n' +
      '    name: Customer\n' +
      '  - id: rollout\n' +
      '    kind: businessProcess\n' +
      '    name: Rollout\n' +
      'relationships: []\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), hygiene, 'utf8')
    writeFileSync(join(workspace, 'architecture/main.yaml'), kinded, 'utf8')

    const before = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(before.exitCode).toBe(0)
    const opened = JSON.parse(before.stdout).report
    expect(opened.summary).toEqual({ questions: 1, openQuestions: 1, open: 2 })
    expect(
      opened.waves[0].questions[0].subjects.map(
        (subject: { readonly id: string }) => subject.id,
      ),
    ).toEqual(['customer', 'platform'])

    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      kinded.replace(
        'relationships: []\n',
        'relationships:\n' +
          '  - id: platform-owns-rollout\n' +
          '    kind: owns\n' +
          '    from: platform\n' +
          '    to: rollout\n' +
          '  - id: customer-associates-rollout\n' +
          '    kind: association\n' +
          '    from: customer\n' +
          '    to: rollout\n',
      ),
      'utf8',
    )
    const after = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    const remaining = JSON.parse(after.stdout).report
    expect(remaining.summary).toEqual({ questions: 1, openQuestions: 1, open: 1 })
    expect(
      remaining.waves[0].questions[0].subjects.map(
        (subject: { readonly id: string }) => subject.id,
      ),
    ).toEqual(['customer'])
  })

  it('opens has-linkage including a flow sink via direction either', () => {
    const linkageCatalogue =
      'format: yarramate/question-catalogue/v1\n' +
      'id: linkage-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: interaction\n' +
      '    name: Interaction\n' +
      'questions:\n' +
      '  - id: hop-unrealised\n' +
      '    wave: interaction\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#applicationComponent"]\n' +
      '    trigger:\n' +
      '      - condition: has-linkage\n' +
      '        kinds: ["yarramate/core@0.1#flow"]\n' +
      '        direction: either\n' +
      '        counterpartKinds: ["yarramate/core@0.1#applicationComponent"]\n' +
      '      - condition: missing-linkage\n' +
      '        kinds: ["yarramate/core@0.1#assignment"]\n' +
      '        direction: outgoing\n' +
      '        counterpartKinds: ["yarramate/core@0.1#applicationProcess"]\n' +
      '    question: What process is {subject.name} assigned to for this hop?\n' +
      '    materiality: A hop with no assigned behavior is inventory.\n' +
      '    authority: either\n' +
      '    resolution: Assign a process.\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), linkageCatalogue, 'utf8')
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: source\n' +
        '    kind: applicationComponent\n' +
        '    name: Source\n' +
        '  - id: sink\n' +
        '    kind: applicationComponent\n' +
        '    name: Sink\n' +
        'relationships:\n' +
        '  - id: source-flows-sink\n' +
        '    kind: flow\n' +
        '    from: source\n' +
        '    to: sink\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: interrogate-fixture\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles: []\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    const before = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(before.exitCode).toBe(0)
    const openIds = JSON.parse(before.stdout)
      .report.waves[0].questions[0].subjects.map(
        (subject: { readonly id: string }) => subject.id,
      )
      .sort()
    expect(openIds).toEqual(['sink', 'source'])

    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: source\n' +
        '    kind: applicationComponent\n' +
        '    name: Source\n' +
        '  - id: sink\n' +
        '    kind: applicationComponent\n' +
        '    name: Sink\n' +
        '  - id: ship\n' +
        '    kind: applicationProcess\n' +
        '    name: Ship\n' +
        'relationships:\n' +
        '  - id: source-flows-sink\n' +
        '    kind: flow\n' +
        '    from: source\n' +
        '    to: sink\n' +
        '  - id: source-assigned\n' +
        '    kind: assignment\n' +
        '    from: source\n' +
        '    to: ship\n' +
        '  - id: sink-assigned\n' +
        '    kind: assignment\n' +
        '    from: sink\n' +
        '    to: ship\n',
      'utf8',
    )
    const after = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    expect(JSON.parse(after.stdout).report.summary.open).toBe(0)
  })

  it('omits questions that name unselected profile kinds rather than closing or sticking open', () => {
    const policyCatalogue =
      'format: yarramate/question-catalogue/v1\n' +
      'id: policy-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: interaction\n' +
      '    name: Interaction\n' +
      'questions:\n' +
      '  - id: authn-standard-missing\n' +
      '    wave: interaction\n' +
      '    scope: workspace\n' +
      '    trigger:\n' +
      '      - condition: no-subject-of-kind\n' +
      '        kinds: ["example/policy@1.0#authentication-constraint"]\n' +
      '    question: What is the default authentication mechanism?\n' +
      '    materiality: Unbound hops pick a mechanism in code.\n' +
      '    authority: human\n' +
      '    resolution: Add an authentication-constraint.\n' +
      '  - id: hop-trust\n' +
      '    wave: interaction\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["example/policy@1.0#authentication-constraint"]\n' +
      '    trigger:\n' +
      '      - condition: isolated\n' +
      '    question: Isolated policy subject {subject.name}?\n' +
      '    materiality: Unused policy is noise.\n' +
      '    authority: either\n' +
      '    resolution: Bind it or remove it.\n' +
      '  - id: outcome-missing\n' +
      '    wave: interaction\n' +
      '    scope: workspace\n' +
      '    trigger:\n' +
      '      - condition: no-subject-of-kind\n' +
      '        kinds: ["yarramate/core@0.1#goal"]\n' +
      '    question: What outcome justifies this system?\n' +
      '    materiality: Without a goal every trade-off becomes taste.\n' +
      '    authority: human\n' +
      '    resolution: Add a goal.\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), policyCatalogue, 'utf8')
    writeFileSync(
      join(workspace, 'profiles/policy.yaml'),
      readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/document-transfer.profile.yaml'),
        'utf8',
      ),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: interrogate-fixture\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles:\n' +
        '  - profiles/platform.yaml\n' +
        '  - profiles/policy.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    const loadedUnselected = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(loadedUnselected.exitCode).toBe(0)
    const loadedReport = JSON.parse(loadedUnselected.stdout).report
    expect(loadedReport.summary.questions).toBe(1)
    expect(loadedReport.waves[0].questions.map((q: { id: string }) => q.id)).toEqual(
      ['outcome-missing'],
    )

    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: interrogate-fixture\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles:\n' +
        '  - profiles/platform.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    const coreOnly = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(coreOnly.exitCode).toBe(0)
    expect(JSON.parse(coreOnly.stdout).report).toEqual(loadedReport)
  })

  it('closes no-subject-of-kind when the only match is a descendant kind', () => {
    writeFileSync(
      join(workspace, 'profiles/platform.yaml'),
      'format: yarramate/profile/v1\n' +
        'id: example/platform\n' +
        'version: "1.0"\n' +
        'extends: yarramate/core@0.1\n' +
        'conceptKinds:\n' +
        '  - id: platform-team\n' +
        '    name: Platform team\n' +
        '    parent: yarramate/core@0.1#businessActor\n' +
        '  - id: specialized-goal\n' +
        '    name: Specialized goal\n' +
        '    parent: yarramate/core@0.1#goal\n' +
        'relationshipKinds: []\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: example/platform@1.0\n' +
        'concepts:\n' +
        '  - id: north-star\n' +
        '    kind: specialized-goal\n' +
        '    name: North star\n' +
        'relationships: []\n',
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout).report
    const goalMissing = report.waves
      .flatMap((wave: { questions: { id: string; open: boolean }[] }) =>
        wave.questions,
      )
      .find((question: { id: string }) => question.id === 'goal-missing')
    expect(goalMissing.open).toBe(false)
  })

  it('does not let a rate-limit constraint close a missing authentication constraint', () => {
    writeFileSync(
      join(workspace, 'profiles/policy.yaml'),
      readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/document-transfer.profile.yaml'),
        'utf8',
      ),
      'utf8',
    )
    const constraintCatalogue =
      'format: yarramate/question-catalogue/v1\n' +
      'id: constraint-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: interaction\n' +
      '    name: Interaction\n' +
      'questions:\n' +
      '  - id: trust-unbound\n' +
      '    wave: interaction\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#applicationProcess"]\n' +
      '    trigger:\n' +
      '      - condition: missing-constraint\n' +
      '        kinds: ["example/policy@1.0#authentication-constraint"]\n' +
      '    question: How is trust established for {subject.name}?\n' +
      '    materiality: An unbound hop picks a mechanism in code.\n' +
      '    authority: either\n' +
      '    resolution: Bind an authentication-constraint.\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), constraintCatalogue, 'utf8')
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      'format: yarramate/v1\n' +
        'id: policy\n' +
        'profile: example/policy@1.0\n' +
        'concepts:\n' +
        '  - id: oauth\n' +
        '    kind: authentication-constraint\n' +
        '    name: OAuth\n' +
        '  - id: rps\n' +
        '    kind: rate-limit-constraint\n' +
        '    name: 100 rps\n' +
        'relationships: []\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: accept\n' +
        '    kind: applicationProcess\n' +
        '    name: Accept\n' +
        '    constraints:\n' +
        '      - id: capacity\n' +
        '        ref: rps\n' +
        'relationships: []\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: interrogate-fixture\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        '  - architecture/policy.yaml\n' +
        'profiles:\n' +
        '  - profiles/policy.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    const onlyRate = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(onlyRate.exitCode).toBe(0)
    expect(JSON.parse(onlyRate.stdout).report.summary.open).toBe(1)

    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: accept\n' +
        '    kind: applicationProcess\n' +
        '    name: Accept\n' +
        '    constraints:\n' +
        '      - id: capacity\n' +
        '        ref: rps\n' +
        '      - id: authn\n' +
        '        ref: oauth\n' +
        'relationships: []\n',
      'utf8',
    )
    const both = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(both.exitCode).toBe(0)
    expect(JSON.parse(both.stdout).report.summary.open).toBe(0)
  })

  it('opens missing-flow-content until every touching flow has content', () => {
    const flowCatalogue =
      'format: yarramate/question-catalogue/v1\n' +
      'id: flow-fixture\n' +
      'version: "1.0"\n' +
      'profile: yarramate/core@0.1\n' +
      'waves:\n' +
      '  - id: interaction\n' +
      '    name: Interaction\n' +
      'questions:\n' +
      '  - id: content-unknown\n' +
      '    wave: interaction\n' +
      '    scope: subject\n' +
      '    subjects:\n' +
      '      kinds: ["yarramate/core@0.1#applicationProcess"]\n' +
      '    trigger:\n' +
      '      - condition: missing-flow-content\n' +
      '    question: What does {subject.name} move?\n' +
      '    materiality: A flow with no content is an unnamed payload.\n' +
      '    authority: either\n' +
      '    resolution: Set flow content.\n'
    writeFileSync(join(workspace, 'catalogue.yaml'), flowCatalogue, 'utf8')
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: send\n' +
        '    kind: applicationProcess\n' +
        '    name: Send\n' +
        '  - id: receive\n' +
        '    kind: applicationProcess\n' +
        '    name: Receive\n' +
        'relationships:\n' +
        '  - id: send-flows-receive\n' +
        '    kind: flow\n' +
        '    from: send\n' +
        '    to: receive\n',
      'utf8',
    )
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      'format: yarramate/workspace/v1\n' +
        'id: interrogate-fixture\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles: []\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'evidence: []\n',
      'utf8',
    )
    const before = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(before.exitCode).toBe(0)
    expect(JSON.parse(before.stdout).report.summary.open).toBe(2)

    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      'format: yarramate/v1\n' +
        'id: main\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: send\n' +
        '    kind: applicationProcess\n' +
        '    name: Send\n' +
        '  - id: receive\n' +
        '    kind: applicationProcess\n' +
        '    name: Receive\n' +
        'relationships:\n' +
        '  - id: send-flows-receive\n' +
        '    kind: flow\n' +
        '    from: send\n' +
        '    to: receive\n' +
        '    content: Document payload\n',
      'utf8',
    )
    const after = runCli(
      ['ask', 'workspace.yaml', '--open', '--catalogue', 'catalogue.yaml', '--json'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    expect(JSON.parse(after.stdout).report.summary.open).toBe(0)
  })

  it('keeps the shipped catalogue fully closed on the repository self-model', () => {
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      report: { summary: { open: number } }
    }
    expect(payload.report.summary.open).toBe(0)
    const validate = new Ajv2020({ allErrors: true }).compile(reportSchema)
    expect(validate(payload.report), 'schema-valid').toBe(true)
  })
})
