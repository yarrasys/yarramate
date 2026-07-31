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

describe('interrogate command', () => {
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
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
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
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(after.exitCode).toBe(0)
    expect(after.stdout).toContain('closed goal-missing')
  })

  it('matches subject selectors through profile lineage by default', () => {
    // platform-team descends from businessActor, so the selector written
    // against the core kind must reach the derived concept too.
    const result = runCli(
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('actor-owner-missing (2 subjects)')
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
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('actor-owner-missing (1 subject)')
    expect(result.stdout).not.toContain('Platform team?')
  })

  it('emits a deterministic, schema-valid machine report', () => {
    const first = runCli(
      ['interrogate', 'catalogue.yaml', 'workspace.yaml', '--json'],
      workspace,
    )
    const second = runCli(
      ['interrogate', 'catalogue.yaml', 'workspace.yaml', '--json'],
      workspace,
    )
    expect(first.exitCode).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    const payload = JSON.parse(first.stdout) as {
      format: string
      workspace: string
      catalogue: string
      summary: { questions: number; openQuestions: number; open: number }
      waves: readonly {
        id: string
        questions: readonly {
          id: string
          open: boolean
          subjects?: readonly { id: string; question: string }[]
        }[]
      }[]
    }
    expect(payload.format).toBe('yarramate/interrogation-report/v1')
    expect(payload.workspace).toBe('interrogate-fixture')
    expect(payload.catalogue).toBe('fixture@1.0')
    expect(payload.summary).toEqual({ questions: 2, openQuestions: 2, open: 3 })
    const owners = payload.waves
      .find(({ id }) => id === 'hygiene')!
      .questions.find(({ id }) => id === 'actor-owner-missing')!
    expect(owners.subjects!.map(({ id }) => id)).toEqual([
      'main#customer',
      'main#platform',
    ])
    const validate = new Ajv2020({ allErrors: true }).compile(reportSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('locates a question referencing an undeclared wave', () => {
    writeFileSync(
      join(workspace, 'catalogue.yaml'),
      catalogue.replace('    wave: hygiene\n', '    wave: hygeine\n'),
      'utf8',
    )
    const result = runCli(
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
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
      ['interrogate', 'catalogue.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('extends')
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(
      ['interrogate', 'catalogue.yaml', 'architecture/main.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'interrogate requires an explicit workspace manifest',
    )
  })

  it('rejects unknown options with usage', () => {
    const result = runCli(
      ['interrogate', 'catalogue.yaml', 'workspace.yaml', '--budget'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })

  it('keeps the shipped catalogue fully closed on the repository self-model', () => {
    const result = runCli(
      [
        'interrogate',
        'catalogues/core-enrichment.yaml',
        '.yarramate/workspace.yaml',
        '--json',
      ],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      summary: { open: number }
    }
    expect(payload.summary.open).toBe(0)
    const validate = new Ajv2020({ allErrors: true }).compile(reportSchema)
    expect(validate(JSON.parse(result.stdout)), 'schema-valid').toBe(true)
  })
})
