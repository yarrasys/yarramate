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

const stepSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-design-step.schema.json'),
    'utf8',
  ),
) as object

// A deliberately thin greenfield model: the shipped catalogue must open
// its motivation wave on it without any catalogue path being passed.
const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
`

const manifest = `format: yarramate/workspace/v1
id: design-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

describe('design command', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-design-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('serves the shipped catalogue top question with no catalogue argument', () => {
    const result = runCli(['design', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('catalogue core-enrichment@')
    expect(result.stdout).toContain('Q [motivation · core-enrichment#outcome-missing]')
    expect(result.stdout).toContain('yarramate apply')
  })

  it('narrows to one subject and includes its brief slice', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'todo-service'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Todo service')
    expect(result.stdout).toContain('Subject slice:')
    expect(result.stdout).toContain('You are building "Todo service"')
    expect(result.stdout).not.toContain('core-enrichment#outcome-missing')
  })

  it('fails loudly on an unknown subject', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'nope'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown subject identity: nope')
  })

  it('prints a prefilled add-concept skeleton for a mapped workspace trigger', () => {
    const result = runCli(['design', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'Prefilled skeleton (edit the <placeholders>, save as operations.yaml):',
    )
    expect(result.stdout).toContain('- op: add-concept')
    expect(result.stdout).toContain('document: architecture/main.yaml')
    expect(result.stdout).toContain('kind: goal  # or: outcome')
  })

  it('prefills the subject endpoint in an add-relationship skeleton', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      [
        'format: yarramate/v1',
        'id: main',
        'profile: yarramate/core@0.1',
        'concepts:',
        '  - id: north-star',
        '    kind: goal',
        '    name: North star',
        'relationships: []',
        '',
      ].join('\n'),
      'utf8',
    )
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'north-star'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Q [motivation · core-enrichment#goal-unrealized]')
    expect(result.stdout).toContain('- op: add-relationship')
    expect(result.stdout).toContain('kind: realization')
    // goal-unrealized wants an incoming realization: the goal is the
    // fixed endpoint, the missing realizer is the placeholder.
    expect(result.stdout).toContain('from: <counterpart-id>')
    expect(result.stdout).toContain('to: north-star')
  })

  it('offers no skeleton when the trigger does not map onto one operation', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'todo-service'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('Prefilled skeleton')
  })

  it('emits a deterministic, schema-valid machine step', () => {
    const first = runCli(['design', 'workspace.yaml', '--json'], workspace)
    const second = runCli(['design', 'workspace.yaml', '--json'], workspace)
    expect(first.exitCode).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    const payload = JSON.parse(first.stdout) as {
      format: string
      step: { questionId: string; wave: string } | null
      progress: { waves: readonly { id: string; open: number }[] }
    }
    expect(payload.format).toBe('yarramate/design-step/v1')
    // Qualified even though ONE catalogue is in play (#345, ADR 0129).
    // Qualifying only when composed would mean a consultant adding a single
    // project question silently changes the id of every question in the
    // shipped catalogue, stranding every stored dismissal keyed on them -
    // which is the exact failure the unversioned qualified id exists to
    // prevent, triggered by adding a file.
    expect(payload.step?.questionId).toBe('core-enrichment#outcome-missing')
    expect(payload.step?.wave).toBe('motivation')
    expect(payload.progress.waves.map(({ id }) => id)).toEqual([
      'motivation',
      'interaction',
      'business',
      'application',
      'technology',
      'implementation',
      'hygiene',
    ])
    const validate = new Ajv2020({ allErrors: true }).compile(stepSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('reports completion on the enriched repository self-model', () => {
    const result = runCli(
      ['design', '.yarramate/workspace.yaml', '--json'],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: unknown
      progress: { open: number }
    }
    expect(payload.step).toBeNull()
    expect(payload.progress.open).toBe(0)
  })

  it('honours a catalogue override', () => {
    writeFileSync(
      join(workspace, 'tiny.yaml'),
      `format: yarramate/question-catalogue/v1
id: tiny
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: only
    name: Only
questions:
  - id: states-question
    wave: only
    scope: workspace
    trigger:
      - condition: no-state-defined
    question: Should states be declared?
    materiality: States separate current from target intent.
    authority: human
    resolution: Declare states or decline them.
`,
      'utf8',
    )
    const result = runCli(
      ['design', 'workspace.yaml', '--catalogue', 'tiny.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('catalogue tiny@1.0')
    expect(result.stdout).toContain('tiny#states-question')
  })

  it('carries the full open-subject roster for shared questions', () => {
    writeFileSync(
      join(workspace, 'owners.yaml'),
      `format: yarramate/question-catalogue/v1
id: owners
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: business
    name: Business
questions:
  - id: owner-missing
    wave: business
    scope: subject
    subjects:
      kinds:
        - "yarramate/core@0.1#businessActor"
        - "yarramate/core@0.1#applicationService"
    trigger:
      - condition: missing-claim
        predicate: yarramate/ownership/owner
    question: Who is accountable for {subject.name}?
    materiality: Ownership decides who accepts changes.
    authority: either
    resolution: Add an owner reference.
`,
      'utf8',
    )
    const result = runCli(
      ['design', 'workspace.yaml', '--catalogue', 'owners.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: {
        subject: { id: string }
        remainingSubjects?: number
        openSubjects?: readonly string[]
      }
    }
    // One policy answer covers both: the roster lets the harness land it
    // as one apply batch instead of interviewing twice.
    expect(payload.step.subject.id).toBe('todo-service')
    expect(payload.step.remainingSubjects).toBe(1)
    expect(payload.step.openSubjects).toEqual([
      'todo-service',
      'user',
    ])
    // Envelope stability: a catalogue without askPlain yields a step
    // without the key, exactly as before.
    expect(payload.step).not.toHaveProperty('askPlain')
    const validate = new Ajv2020({ allErrors: true }).compile(stepSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('prefers the plain workshop phrasing under --facilitate', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--facilitate'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Q [motivation · core-enrichment#outcome-missing]')
    // The shipped catalogue authors askPlain for the motivation wave.
    expect(result.stdout).toContain(
      'What would success look like for this system?',
    )
    expect(result.stdout).not.toContain(
      "What outcome justifies this system's existence?",
    )
  })

  it('falls back to the standard phrasing when a question has no askPlain', () => {
    writeFileSync(
      join(workspace, 'tiny.yaml'),
      `format: yarramate/question-catalogue/v1
id: tiny
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: only
    name: Only
questions:
  - id: states-question
    wave: only
    scope: workspace
    trigger:
      - condition: no-state-defined
    question: Should states be declared?
    materiality: States separate current from target intent.
    authority: human
    resolution: Declare states or decline them.
`,
      'utf8',
    )
    const result = runCli(
      ['design', 'workspace.yaml', '--catalogue', 'tiny.yaml', '--facilitate'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Should states be declared?')
  })

  it('round-trips askPlain through the JSON step with subject interpolation', () => {
    writeFileSync(
      join(workspace, 'plain.yaml'),
      `format: yarramate/question-catalogue/v1
id: plain
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: business
    name: Business
questions:
  - id: owner-missing
    wave: business
    scope: subject
    subjects:
      kinds:
        - "yarramate/core@0.1#applicationService"
    trigger:
      - condition: missing-claim
        predicate: yarramate/ownership/owner
    question: Who is accountable for {subject.name}?
    askPlain: If something goes wrong with {subject.name}, whose desk does it land on?
    materiality: Ownership decides who accepts changes.
    authority: either
    resolution: Add an owner reference.
`,
      'utf8',
    )
    // askPlain rides the envelope additively whether or not --facilitate
    // is passed; the flag is a human-rendering preference only.
    const result = runCli(
      ['design', 'workspace.yaml', '--catalogue', 'plain.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: { question: string; askPlain?: string }
    }
    expect(payload.step.question).toBe(
      'Who is accountable for Todo service?',
    )
    expect(payload.step.askPlain).toBe(
      'If something goes wrong with Todo service, whose desk does it land on?',
    )
    const validate = new Ajv2020({ allErrors: true }).compile(stepSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('lists --facilitate in the usage grammar', () => {
    const result = runCli(['design', '--facilitate'], workspace)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
    expect(result.stderr).toContain('[--facilitate]')
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(
      ['design', 'architecture/main.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'design requires an explicit workspace manifest',
    )
  })

  it('rejects unknown options with usage', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--wave', 'motivation'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })
})
