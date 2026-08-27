import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const reportSchema = JSON.parse(
  JSON.stringify(
    await import('../schema/yarramate-interrogation-report.schema.json', {
      with: { type: 'json' },
    }).then((module) => module.default),
  ),
) as object
const validateReport = new Ajv2020({ allErrors: true }).compile(reportSchema)

// A question the model never asked says so (#375, ADR 0132). The three
// states that used to be byte-identical (`open: false`): the selector
// matched nobody (never asked), subjects existed and every trigger was
// satisfied (answered), and subjects existed and fired (open). The field
// evidence was an empty ApertureX project reporting nine subject-scoped
// questions "answered" and its wave rail ticking them complete.

const catalogue = `format: yarramate/question-catalogue/v1
id: probe
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: probe-wave
    name: Probe
questions:
  - id: svc-doc
    wave: probe-wave
    scope: subject
    subjects:
      kinds:
        - yarramate/core@0.1#applicationService
    trigger:
      - condition: missing-claim
        predicate: yarramate/concept/description
    question: What does {subject.name} do?
    materiality: M
    resolution: R
    authority: either
`

const documentOf = (concepts: string) => `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:${concepts}
relationships: []
`

const EMPTY = ' []'
const SATISFIED = `
  - id: billing
    kind: applicationService
    name: Billing
    description: Settles the accounts.`
const FIRING = `
  - id: billing
    kind: applicationService
    name: Billing`

describe('a question the model never asked says so (#375)', () => {
  let workspace = ''
  const write = (relative: string, source: string) =>
    writeFileSync(join(workspace, relative), source, 'utf8')

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-never-asked-'))
    mkdirSync(join(workspace, '.yarramate', 'architecture'), {
      recursive: true,
    })
    mkdirSync(join(workspace, '.yarramate', 'questions'), { recursive: true })
    write(
      '.yarramate/workspace.yaml',
      'format: yarramate/workspace/v1\n' +
        'id: probe\n' +
        'documents:\n  - architecture/*.yaml\n' +
        'profiles: []\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'questions:\n  - questions/*.yaml\n',
    )
    write('.yarramate/questions/probe.yaml', catalogue)
  })

  afterEach(() => rmSync(workspace, { recursive: true, force: true }))

  const probeQuestion = (concepts: string) => {
    write('.yarramate/architecture/main.yaml', documentOf(concepts))
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { report } = JSON.parse(result.stdout) as {
      report: {
        waves: {
          id: string
          questions: Record<string, unknown>[]
        }[]
      }
    }
    expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(
      true,
    )
    const question = report.waves
      .flatMap(({ questions }) => questions)
      .find(({ id }) => id === 'probe#svc-doc')
    expect(question).toBeDefined()
    return question!
  }

  it('marks the never-asked state, and only that state', () => {
    // Selector matches nobody: never asked, and the report says so.
    const neverAsked = probeQuestion(EMPTY)
    expect(neverAsked.open).toBe(false)
    expect(neverAsked.asked).toBe(false)

    // Subjects exist and the trigger is satisfied: answered — and `asked`
    // is ABSENT, not true, so a report byte-changes only where the new
    // truth exists and existing readers keep their exact meaning.
    const satisfied = probeQuestion(SATISFIED)
    expect(satisfied.open).toBe(false)
    expect('asked' in satisfied).toBe(false)

    // Subjects exist and fire: open, `asked` absent.
    const open = probeQuestion(FIRING)
    expect(open.open).toBe(true)
    expect('asked' in open).toBe(false)
    expect(
      (open.subjects as { id: string }[]).map(({ id }) => id),
    ).toEqual(['billing'])
  })

  it('renders never-asked as unasked, never as closed', () => {
    write('.yarramate/architecture/main.yaml', documentOf(EMPTY))
    const text = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open'],
      workspace,
    )
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain(
      'unasked probe#svc-doc — nothing it selects exists yet',
    )
    expect(text.stdout).not.toContain('closed probe#svc-doc')

    // And the satisfied state still reads closed: the two lines must not
    // collapse back into each other from either side.
    write('.yarramate/architecture/main.yaml', documentOf(SATISFIED))
    const satisfied = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open'],
      workspace,
    )
    expect(satisfied.stdout).toContain('closed probe#svc-doc')
    expect(satisfied.stdout).not.toContain('unasked probe#svc-doc')
  })
})
