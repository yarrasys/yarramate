import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
// The barrel import is the point (the composeCatalogues lesson): the one
// call a host makes to assess its own tree must be reachable from the
// published entry, not only from the module that defines it.
import { deriveArtifactCoverage } from '../src/index.js'

const Ajv2020 = Ajv2020Module.default

const reconciliationSchema = JSON.parse(
  JSON.stringify(
    await import('../schema/yarramate-reconciliation-report.schema.json', {
      with: { type: 'json' },
    }).then((module) => module.default),
  ),
) as object

const validateReport = new Ajv2020({ allErrors: true }).compile(
  reconciliationSchema,
)

// Coverage is assessed against what git can see, so the assessed fixtures
// run `git init` — deliberately with no commit: an untracked file is
// exactly the newest-artifact shape the feature exists to catch, and it
// must count (ADR 0130).
const writeFixture = (options: {
  readonly coverage?: string
  readonly git: boolean
}) => {
  const parent = mkdtempSync(join(tmpdir(), 'yarramate-coverage-'))
  mkdirSync(join(parent, '.yarramate', 'architecture'), { recursive: true })
  mkdirSync(join(parent, '.yarramate', 'evidence'), { recursive: true })
  mkdirSync(join(parent, 'src', 'legacy'), { recursive: true })
  mkdirSync(join(parent, 'src', 'generated'), { recursive: true })
  writeFileSync(
    join(parent, '.yarramate', 'workspace.yaml'),
    'format: yarramate/workspace/v1\n' +
      'id: shop\n' +
      'documents:\n' +
      '  - architecture/*.yaml\n' +
      'profiles: []\n' +
      'projections: []\n' +
      'adapterMappings: []\n' +
      'evidence:\n' +
      '  - evidence/*.yaml\n' +
      (options.coverage ?? ''),
  )
  writeFileSync(
    join(parent, '.yarramate', 'architecture', 'shop.yaml'),
    'format: yarramate/v1\n' +
      'id: shop\n' +
      'profile: yarramate/core@0.1\n' +
      'concepts:\n' +
      '  - id: api-service\n' +
      '    kind: applicationService\n' +
      '    name: Api\n' +
      '    status: current\n' +
      '  - id: legacy-store\n' +
      '    kind: dataObject\n' +
      '    name: Legacy store\n' +
      '    status: current\n' +
      'relationships: []\n',
  )
  // One locator carries a fragment and one names a directory: stripping
  // the fragment and claiming beneath the directory are each load-bearing
  // for the expected unclaimed set below.
  writeFileSync(
    join(parent, '.yarramate', 'evidence', 'repository.yaml'),
    'format: yarramate/evidence/v1\n' +
      'id: shop-repository\n' +
      'version: "1.0"\n' +
      'provider: repository-inspection\n' +
      'observations:\n' +
      '  - subject: api-service\n' +
      '    result: confirmed\n' +
      '    evidence:\n' +
      '      uri: repo:src/api.ts#L1\n' +
      '  - subject: legacy-store\n' +
      '    result: confirmed\n' +
      '    evidence:\n' +
      '      uri: repo:src/legacy\n',
  )
  writeFileSync(join(parent, 'src', 'api.ts'), 'export const api = 1\n')
  writeFileSync(
    join(parent, 'src', 'legacy', 'old.ts'),
    'export const old = 1\n',
  )
  writeFileSync(
    join(parent, 'src', 'orphan.ts'),
    'export const orphan = 1\n',
  )
  writeFileSync(
    join(parent, 'src', 'generated', 'gen.ts'),
    'export const gen = 1\n',
  )
  writeFileSync(join(parent, '.gitignore'), 'src/generated/\n')
  if (options.git) {
    const initialized = spawnSync('git', ['init'], {
      cwd: parent,
      encoding: 'utf8',
    })
    expect(initialized.status).toBe(0)
  }
  return parent
}

const declaredScope =
  'coverage:\n' + '  - src/**/*.ts\n' + '  - missing/**/*.ts\n'

describe('artifact coverage in reconciliation', () => {
  it('lists in-scope artifacts no observation claims', () => {
    const parent = writeFixture({ coverage: declaredScope, git: true })
    try {
      const result = runCli(
        ['reconcile', '.yarramate/workspace.yaml'],
        parent,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout)
      // Three artifacts, not four: src/generated/gen.ts sits inside the
      // glob and is asserted out of scope because git ignores it — the
      // intersection is what bounds a broad glob (ADR 0130).
      expect(report.summary.artifactsInScope).toBe(3)
      expect(report.summary.unclaimedArtifacts).toBe(1)
      expect(report.unclaimedArtifacts).toEqual(['src/orphan.ts'])
      expect(report.coverageScope).toEqual([
        'src/**/*.ts',
        'missing/**/*.ts',
      ])
      expect(report.notes).toContain(
        'Coverage pattern "missing/**/*.ts" matched no artifacts.',
      )
      expect(validateReport(report)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports the same coverage wherever the command is invoked', () => {
    const parent = writeFixture({ coverage: declaredScope, git: true })
    try {
      const fromRoot = JSON.parse(
        runCli(['reconcile', '.yarramate/workspace.yaml'], parent).stdout,
      )
      // The #216 bug shape is coverage that changes with the invocation
      // directory; the anchor is the manifest's git toplevel instead.
      const fromSubdirectory = JSON.parse(
        runCli(
          ['reconcile', join('..', '.yarramate', 'workspace.yaml')],
          join(parent, 'src'),
        ).stdout,
      )
      expect(fromSubdirectory.summary.artifactsInScope).toBe(
        fromRoot.summary.artifactsInScope,
      )
      expect(fromSubdirectory.unclaimedArtifacts).toEqual(
        fromRoot.unclaimedArtifacts,
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('says coverage was not assessed when no scope is declared', () => {
    const parent = writeFixture({ git: true })
    try {
      const report = JSON.parse(
        runCli(['reconcile', '.yarramate/workspace.yaml'], parent).stdout,
      )
      expect(report.notes).toContain(
        'Artifact coverage was not assessed: the workspace manifest declares no coverage scope.',
      )
      // The counters appear exactly when coverage was assessed: absent
      // means never looked, and must not read as zero unclaimed.
      expect('artifactsInScope' in report.summary).toBe(false)
      expect('unclaimedArtifacts' in report.summary).toBe(false)
      expect('coverageScope' in report).toBe(false)
      expect('unclaimedArtifacts' in report).toBe(false)
      expect(validateReport(report)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('says coverage was not assessed outside a git repository', () => {
    const parent = writeFixture({ coverage: declaredScope, git: false })
    try {
      const report = JSON.parse(
        runCli(['reconcile', '.yarramate/workspace.yaml'], parent).stdout,
      )
      expect(report.notes).toContain(
        'Artifact coverage was not assessed: the workspace does not live in a git repository.',
      )
      expect('artifactsInScope' in report.summary).toBe(false)
      expect(validateReport(report)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('assesses a declared empty scope honestly', () => {
    const parent = writeFixture({ coverage: 'coverage: []\n', git: true })
    try {
      const report = JSON.parse(
        runCli(['reconcile', '.yarramate/workspace.yaml'], parent).stdout,
      )
      expect(report.summary.artifactsInScope).toBe(0)
      expect(report.summary.unclaimedArtifacts).toBe(0)
      expect(report.coverageScope).toEqual([])
      expect('unclaimedArtifacts' in report).toBe(false)
      expect(report.notes).toContain(
        'The workspace manifest declares an empty coverage scope, so no artifacts were assessed.',
      )
      expect(validateReport(report)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses a coverage pattern that escapes the repository', () => {
    const parent = writeFixture({
      coverage: 'coverage:\n  - ../escape/*.ts\n',
      git: true,
    })
    try {
      const result = runCli(
        ['reconcile', '.yarramate/workspace.yaml'],
        parent,
      )
      expect(result.exitCode).toBe(1)
      const output = JSON.parse(result.stdout)
      expect(output.diagnostics).toEqual([
        expect.objectContaining({
          code: 'YM701',
          pointer: '/coverage/0',
          message:
            'Workspace coverage pattern "../escape/*.ts" must be a relative path beneath the repository root',
        }),
      ])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('exposes the derivation through the package barrel', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-coverage-api-'))
    try {
      expect(deriveArtifactCoverage(parent, undefined)).toEqual({
        assessed: false,
        reason: 'the workspace manifest declares no coverage scope',
      })
      expect(deriveArtifactCoverage(parent, ['src/**/*.ts'])).toEqual({
        assessed: false,
        reason: 'the workspace does not live in a git repository',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('never fails check --strict on unclaimed artifacts', () => {
    const parent = writeFixture({ coverage: declaredScope, git: true })
    try {
      // The same workspace reconcile reports one unclaimed artifact for;
      // a coverage signal is not a contradiction (ADR 0130).
      const result = runCli(
        ['check', '.yarramate/workspace.yaml', '--strict'],
        parent,
      )
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
