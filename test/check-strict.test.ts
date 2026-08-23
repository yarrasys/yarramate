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

const checkResultSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-check-result.schema.json'),
    'utf8',
  ),
) as object

const document =
  'format: yarramate/v1\n' +
  'id: main\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: approve-order\n' +
  '    kind: capability\n' +
  '    name: Approve order\n' +
  '  - id: approval-api\n' +
  '    kind: applicationService\n' +
  '    name: Approval API\n' +
  'relationships:\n' +
  '  - id: api-realizes-approval\n' +
  '    kind: realization\n' +
  '    from: approval-api\n' +
  '    to: approve-order\n'

const manifest = (evidence: readonly string[]) =>
  'format: yarramate/workspace/v1\n' +
  'id: strict-fixture\n' +
  'documents:\n' +
  '  - architecture/main.yaml\n' +
  'profiles: []\n' +
  'projections: []\n' +
  'adapterMappings: []\n' +
  (evidence.length === 0
    ? 'evidence: []\n'
    : `evidence:\n${evidence.map((path) => `  - ${path}`).join('\n')}\n`)

const contradictedEvidence =
  'format: yarramate/evidence/v1\n' +
  'id: repository-scan\n' +
  'version: "1.0"\n' +
  'provider: import-audit\n' +
  'observations:\n' +
  '  - subject: approval-api\n' +
  '    result: confirmed\n' +
  '    evidence:\n' +
  '      uri: repo:src/approval-api.ts\n' +
  '  - claim: api-realizes-approval\n' +
  '    result: contradicted\n' +
  '    evidence:\n' +
  '      uri: repo:src/approval-api.ts\n' +
  '      message: no realization marker found in source\n'

const confirmedEvidence = contradictedEvidence.replace(
  'result: contradicted',
  'result: confirmed',
)

describe('check --strict', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-strict-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('keeps the default check passing over contradicted evidence', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'scan.evidence.yaml'),
      contradictedEvidence,
      'utf8',
    )

    const result = runCli(['check', 'workspace.yaml'], workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('no errors')
    expect(result.stdout).not.toContain('Strict:')
  })

  it('fails strict checks with a source-located contradiction diagnostic', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'scan.evidence.yaml'),
      contradictedEvidence,
      'utf8',
    )

    const result = runCli(['check', 'workspace.yaml', '--strict'], workspace)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('error YM901')
    expect(result.stdout).toContain(
      'Evidence contradicts claim "api-realizes-approval"',
    )
    expect(result.stdout).toContain(
      'the model asserts approval-api -> approve-order',
    )
    expect(result.stdout).toContain('provider "import-audit"')
    expect(result.stdout).toContain('no realization marker found in source')
    const [location] = result.stdout.split(' error ')
    expect(location).toMatch(/^architecture\/main\.yaml:\d+:\d+$/)
    const line = Number(location!.split(':')[1])
    expect(line).toBeGreaterThan(11)
  })

  it('emits a schema-valid strict failure in JSON mode', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'scan.evidence.yaml'),
      contradictedEvidence,
      'utf8',
    )

    const result = runCli(
      ['check', 'workspace.yaml', '--strict', '--json'],
      workspace,
    )

    expect(result.exitCode).toBe(1)
    const payload = JSON.parse(result.stdout) as {
      ok: boolean
      diagnostics: readonly { code: string; path: string }[]
      strict?: { observations: number; contradicted: number }
    }
    expect(payload.ok).toBe(false)
    expect(payload.diagnostics).toHaveLength(1)
    expect(payload.diagnostics[0]!.code).toBe('YM901')
    expect(payload.diagnostics[0]!.path).toBe('architecture/main.yaml')
    expect(payload.strict).toEqual({ observations: 2, contradicted: 1 })
    const validate = new Ajv2020({ allErrors: true }).compile(
      checkResultSchema,
    )
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('passes strict checks and reports what it evaluated', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'scan.evidence.yaml'),
      confirmedEvidence,
      'utf8',
    )

    const human = runCli(['check', 'workspace.yaml', '--strict'], workspace)
    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain('no errors')
    expect(human.stdout).toContain('Strict: 2 observations, 0 contradicted')

    const machine = runCli(
      ['check', 'workspace.yaml', '--strict', '--json'],
      workspace,
    )
    expect(machine.exitCode).toBe(0)
    const payload = JSON.parse(machine.stdout) as {
      ok: boolean
      strict?: { observations: number; contradicted: number }
    }
    expect(payload.ok).toBe(true)
    expect(payload.strict).toEqual({ observations: 2, contradicted: 0 })
    const validate = new Ajv2020({ allErrors: true }).compile(
      checkResultSchema,
    )
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
  })

  it('announces a vacuous strict gate when no evidence is declared', () => {
    writeFileSync(join(workspace, 'workspace.yaml'), manifest([]), 'utf8')

    const result = runCli(['check', 'workspace.yaml', '--strict'], workspace)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'Strict: no evidence observations to evaluate',
    )
  })

  it('anchors subject-targeted contradictions at the concept declaration', () => {
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['scan.evidence.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'scan.evidence.yaml'),
      'format: yarramate/evidence/v1\n' +
        'id: repository-scan\n' +
        'version: "1.0"\n' +
        'provider: import-audit\n' +
        'observations:\n' +
        '  - subject: approval-api\n' +
        '    result: contradicted\n' +
        '    evidence:\n' +
        '      uri: repo:src\n',
      'utf8',
    )

    const result = runCli(['check', 'workspace.yaml', '--strict'], workspace)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(
      'Evidence contradicts subject "approval-api"',
    )
    expect(result.stdout).toMatch(/^architecture\/main\.yaml:\d+:\d+ error YM901/)
  })
})
