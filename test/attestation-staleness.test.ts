import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const reconciliationSchema = JSON.parse(
  JSON.stringify(
    await import('../schema/yarramate-reconciliation-report.schema.json', {
      with: { type: 'json' },
    }).then((module) => module.default),
  ),
) as object

const validateReconciliation = new Ajv2020({ allErrors: true }).compile(
  reconciliationSchema,
)

// Attestation staleness derives from git (ADR 0074): the fixture is a real
// git repository whose commit timestamps are pinned, so the date boundary
// is exercised against git rather than a stub.
const git = (cwd: string, date: string | undefined, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test',
      ...(date === undefined
        ? {}
        : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
    },
  })

const manifest =
  'format: yarramate/workspace/v1\n' +
  'id: policy\n' +
  'documents:\n' +
  '  - architecture/*.yaml\n' +
  'profiles: []\n' +
  'projections: []\n' +
  'adapterMappings: []\n' +
  'evidence: []\n'

const document = (description: string, attestedOn: string) =>
  'format: yarramate/v1\n' +
  'id: policy\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: refund-rule\n' +
  '    kind: businessProcess\n' +
  '    name: Refund rule\n' +
  '    status: current\n' +
  `    description: ${description}\n` +
  '    attestations:\n' +
  '      - topic: signed-off\n' +
  '        by: Dana Okafor\n' +
  `        on: "${attestedOn}"\n` +
  'relationships: []\n'

const workspaces: string[] = []

/** A repository whose base commit carries the sign-off and whose second
 *  commit reworded the attested description at `changedAt`. */
const buildFixture = (options: {
  readonly attestedOn: string
  readonly baseAt: string
  readonly changedAt?: string
}): string => {
  const workspace = mkdtempSync(join(tmpdir(), 'yarramate-attest-'))
  workspaces.push(workspace)
  mkdirSync(join(workspace, 'architecture'))
  writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  writeFileSync(
    join(workspace, 'architecture/policy.yaml'),
    document('Refunds are approved by a human.', options.attestedOn),
    'utf8',
  )
  git(workspace, undefined, 'init', '-q')
  git(workspace, undefined, 'add', '-A')
  git(workspace, options.baseAt, 'commit', '-q', '-m', 'sign off the rule')
  if (options.changedAt !== undefined) {
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      document('Refunds under $50 are approved automatically.', options.attestedOn),
      'utf8',
    )
    git(workspace, undefined, 'add', '-A')
    git(workspace, options.changedAt, 'commit', '-q', '-m', 'reword the rule')
  }
  return workspace
}

const reconcile = (workspace: string) => {
  const result = runCli(['reconcile', 'workspace.yaml'], workspace)
  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout) as {
    summary: Record<string, number>
    findings: ReadonlyArray<{
      target: { type: string; id: string }
      result: string
      provider: string
      changedAt?: string
      attestation?: { topic: string; by: string; on: string }
      evidence: { uri: string; message?: string }
    }>
    notes?: readonly string[]
  }
}

const staleFindings = (report: ReturnType<typeof reconcile>) =>
  report.findings.filter(({ result }) => result === 'stale-attestation')

afterEach(() => {
  while (workspaces.length > 0) {
    rmSync(workspaces.pop()!, { recursive: true, force: true })
  }
})

describe('stale attestations', () => {
  it('reports a sign-off that predates the current wording', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const report = reconcile(workspace)
    const stale = staleFindings(report)

    expect(stale).toHaveLength(1)
    const finding = stale[0]!
    expect(finding.target).toEqual({ type: 'subject', id: 'policy#refund-rule' })
    expect(finding.provider).toBe('git')
    expect(finding.attestation).toEqual({
      topic: 'signed-off',
      by: 'Dana Okafor',
      on: '2026-01-15',
    })
    // The commit date of the later change is named, not guessed.
    expect(finding.changedAt).toMatch(/^2026-06-01T12:00:00/)
    expect(finding.evidence.uri).toMatch(/^git:[0-9a-f]{40}$/)
    expect(finding.evidence.message).toContain(
      'Attestation "signed-off" by Dana Okafor on 2026-01-15 predates the current wording of policy#refund-rule',
    )
    expect(finding.evidence.message).toContain('the description changed in commit')
    expect(report.summary.staleAttestations).toBe(1)
    expect(report.notes).toBeUndefined()
  })

  it('stays silent when the sign-off came after the change', () => {
    const workspace = buildFixture({
      attestedOn: '2026-07-01',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const report = reconcile(workspace)

    expect(staleFindings(report)).toEqual([])
    expect(report.summary.staleAttestations).toBe(0)
  })

  it('reports nothing when the attested wording never changed', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
    })
    const report = reconcile(workspace)

    expect(staleFindings(report)).toEqual([])
    expect(report.summary.staleAttestations).toBe(0)
  })

  it('covers commits up to the end of the attestation day in UTC', () => {
    // The last instant of the `on` day is covered by the sign-off.
    const covered = buildFixture({
      attestedOn: '2026-06-01',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T23:59:59+0000',
    })
    expect(staleFindings(reconcile(covered))).toEqual([])

    // Midnight UTC the next day is strictly after it.
    const past = buildFixture({
      attestedOn: '2026-06-01',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-02T00:00:00+0000',
    })
    const stale = staleFindings(reconcile(past))
    expect(stale).toHaveLength(1)
    expect(stale[0]!.changedAt).toMatch(/^2026-06-02T00:00:00/)
  })

  it('reads the day boundary in UTC, not in the committer timezone', () => {
    // 2026-06-02T08:00+10:00 is 2026-06-01T22:00Z, inside the covered day.
    const workspace = buildFixture({
      attestedOn: '2026-06-01',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-02T08:00:00+1000',
    })
    expect(staleFindings(reconcile(workspace))).toEqual([])
  })

  it('notices a rewording that is only in the working tree', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
    })
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      document('Refunds are automatic.', '2026-01-15'),
      'utf8',
    )
    const stale = staleFindings(reconcile(workspace))

    expect(stale).toHaveLength(1)
    expect(stale[0]!.evidence.uri).toBe('git:worktree')
    expect(stale[0]!.evidence.message).toContain(
      'uncommitted working tree edits',
    )
    expect(stale[0]!.changedAt).toBeUndefined()
  })

  it('notices a renamed subject, not only a reworded description', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
    })
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      document('Refunds are approved by a human.', '2026-01-15').replace(
        'name: Refund rule',
        'name: Refund policy',
      ),
      'utf8',
    )
    const stale = staleFindings(reconcile(workspace))

    expect(stale).toHaveLength(1)
    expect(stale[0]!.evidence.message).toContain('the name changed')
  })

  it('ignores edits outside the name and description spans', () => {
    // v1 granularity: only the attested wording counts. Adding an
    // unrelated concept must not reopen the sign-off.
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
    })
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      document('Refunds are approved by a human.', '2026-01-15').replace(
        'relationships: []',
        '  - id: refund-desk\n' +
          '    kind: businessActor\n' +
          '    name: Refund desk\n' +
          'relationships: []',
      ),
      'utf8',
    )
    expect(staleFindings(reconcile(workspace))).toEqual([])
  })

  it('degrades to a note outside a git repository', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    rmSync(join(workspace, '.git'), { recursive: true, force: true })
    const report = reconcile(workspace)

    expect(staleFindings(report)).toEqual([])
    expect(report.summary.staleAttestations).toBe(0)
    expect(report.notes).toEqual([
      'Attestation staleness was not assessed: the workspace is not inside a git repository.',
    ])
  })

  it('degrades to a note when the document is untracked', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
    })
    writeFileSync(
      join(workspace, 'architecture/extra.yaml'),
      'format: yarramate/v1\n' +
        'id: extra\n' +
        'profile: yarramate/core@0.1\n' +
        'concepts:\n' +
        '  - id: draft-rule\n' +
        '    kind: businessProcess\n' +
        '    name: Draft rule\n' +
        '    description: Not committed yet.\n' +
        '    attestations:\n' +
        '      - topic: signed-off\n' +
        '        by: Dana Okafor\n' +
        '        on: "2026-01-15"\n' +
        'relationships: []\n',
      'utf8',
    )
    const report = reconcile(workspace)

    expect(staleFindings(report)).toEqual([])
    expect(report.notes).toEqual([
      'Attestation staleness was not assessed for architecture/extra.yaml: the file has no committed history.',
    ])
  })

  it('degrades to a note when the sign-off predates all committed history', () => {
    const workspace = buildFixture({
      attestedOn: '2020-01-01',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const report = reconcile(workspace)

    expect(staleFindings(report)).toEqual([])
    expect(report.notes).toEqual([
      'Attestation "signed-off" on policy#refund-rule predates the earliest committed history of architecture/policy.yaml; staleness was not assessed.',
    ])
  })

  it('emits the same report on repeated runs', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const first = runCli(['reconcile', 'workspace.yaml'], workspace)
    const second = runCli(['reconcile', 'workspace.yaml'], workspace)

    expect(first.stdout).toBe(second.stdout)
  })

  it('adds the finding without disturbing the report contract', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const report = reconcile(workspace)

    expect(
      validateReconciliation(report),
      JSON.stringify(validateReconciliation.errors),
    ).toBe(true)
    expect(report.summary.findings).toBe(report.findings.length)
    // Every pre-existing summary field still reports evidence only.
    expect(report.summary.evidenceDocuments).toBe(0)
    expect(report.summary.observations).toBe(0)
    expect(report.summary.contradicted).toBe(0)
    expect(report.summary.unknown).toBe(0)
    expect(report.summary.notObserved).toBe(0)
  })

  it('leaves the check gate untouched: staleness is not a contradiction', () => {
    const workspace = buildFixture({
      attestedOn: '2026-01-15',
      baseAt: '2026-01-15T09:00:00+0000',
      changedAt: '2026-06-01T12:00:00+0000',
    })
    const strict = runCli(
      ['check', 'workspace.yaml', '--strict', '--json'],
      workspace,
    )

    expect(strict.exitCode).toBe(0)
    expect(JSON.parse(strict.stdout).ok).toBe(true)
  })
})
