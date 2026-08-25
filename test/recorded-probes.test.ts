import Ajv2020Module from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadEvidence, reconcileEvidenceReports } from '../src/index.js'
import type { EvidenceReport } from '../src/evidence.js'

// A `not-observed` is the only result that asserts a NEGATIVE about a tree
// nobody read exhaustively, and the only one whose message nothing else in the
// pipeline can check: its locator points at what the author looked at, not at
// the absence they claim. So an observation that names no search is counted
// and named, and one that records what it searched is not (ADR 0107).

const Ajv2020 = Ajv2020Module.default
const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const evidenceSchema = JSON.parse(
  readFileSync(join(repositoryRoot, 'schema/yarramate-evidence.schema.json'), 'utf8'),
) as object
const validateEvidence = new Ajv2020({ allErrors: true }).compile(evidenceSchema)

const reportOf = (observations: EvidenceReport['observations']): EvidenceReport => ({
  format: 'yarramate/evidence-report/v1',
  evidence: 'repository',
  provider: 'repository-inspection',
  summary: { confirmed: 0, contradicted: 0, unknown: 0, notObserved: observations.length },
  observations,
})

describe('a not-observed that names no search is counted', () => {
  it('counts and names an unsupported absence', () => {
    const report = reconcileEvidenceReports('w', [
      reportOf([
        {
          subject: 'praefect',
          result: 'not-observed',
          evidence: { uri: 'repo:GITALY_SERVER_VERSION', message: 'no pin, directory or client exists' },
        },
      ]),
    ])
    expect(report.summary.unsupportedAbsences).toBe(1)
    expect(report.notes?.join('\n')).toContain('praefect')
    expect(report.notes?.join('\n')).toContain('names no search')
  })

  it('does not count one that records what it searched', () => {
    const report = reconcileEvidenceReports('w', [
      reportOf([
        {
          subject: 'praefect',
          result: 'not-observed',
          searched: [{ glob: 'PRAEFECT_*' }, { grep: 'Praefect', paths: ['lib/', 'app/'] }],
          evidence: { uri: 'repo:doc/development/architecture.md', message: 'declared upstream, absent here' },
        },
      ]),
    ])
    expect(report.summary.unsupportedAbsences).toBe(0)
    expect(report.notes ?? []).toEqual([])
  })

  it('leaves a confirmed observation alone', () => {
    const report = reconcileEvidenceReports('w', [
      reportOf([
        { subject: 'gitaly', result: 'confirmed', evidence: { uri: 'repo:GITALY_SERVER_VERSION' } },
      ]),
    ])
    expect(report.summary.unsupportedAbsences).toBe(0)
  })
})

describe('the evidence document carries recorded probes', () => {
  const document = (body: string) =>
    'format: yarramate/evidence/v1\n' +
    'id: repository\n' +
    'version: "1.0"\n' +
    'provider: repository-inspection\n' +
    'observations:\n' +
    body

  it('accepts a searched entry and a measured figure', () => {
    const source = document(
      '  - subject: praefect\n' +
        '    result: not-observed\n' +
        '    searched:\n' +
        "      - glob: 'PRAEFECT_*'\n" +
        '      - grep: Praefect\n' +
        '        paths: ["lib/", "app/"]\n' +
        '    evidence:\n' +
        '      uri: repo:doc/development/architecture.md\n' +
        '      message: Declared upstream, absent here.\n' +
        '  - subject: pipeline-processing\n' +
        '    result: confirmed\n' +
        '    measured:\n' +
        "      - value: '68'\n" +
        "        method: find app/services/ci -maxdepth 1 -name '*.rb' | wc -l\n" +
        '    evidence:\n' +
        '      uri: repo:app/services/ci\n' +
        '      message: 68 service objects directly under the directory.\n',
    )
    const loaded = loadEvidence({ path: 'evidence/repository.yaml', source })
    expect(loaded.ok, JSON.stringify('diagnostics' in loaded ? loaded.diagnostics : [])).toBe(true)
  })

  it('refuses a search probe that names neither a glob nor a grep', () => {
    const invalid = {
      format: 'yarramate/evidence/v1',
      id: 'repository',
      version: '1.0',
      provider: 'repository-inspection',
      observations: [
        {
          subject: 'praefect',
          result: 'not-observed',
          searched: [{ paths: ['lib/'] }],
          evidence: { uri: 'repo:x' },
        },
      ],
    }
    expect(validateEvidence(invalid)).toBe(false)
  })

  it('refuses a measurement missing its method', () => {
    const invalid = {
      format: 'yarramate/evidence/v1',
      id: 'repository',
      version: '1.0',
      provider: 'repository-inspection',
      observations: [
        {
          subject: 'x',
          result: 'confirmed',
          measured: [{ value: '68' }],
          evidence: { uri: 'repo:x' },
        },
      ],
    }
    expect(validateEvidence(invalid)).toBe(false)
  })
})
