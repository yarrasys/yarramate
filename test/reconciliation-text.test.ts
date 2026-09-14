import { describe, expect, it } from 'vitest'

import { reconciliationReportText } from '../src/reconciliation-text.js'
import type { ReconciliationReport } from '../src/reconciliation.js'

/**
 * The text form says exactly what the JSON says, in its order, one finding
 * per line (#526, ADR 0153). Built by hand so every finding kind and every
 * optional list is exercised without a fixture that happens to carry them.
 */
describe('reconciliationReportText', () => {
  const declared = {
    document: 'yarramate-product',
    path: '.yarramate/architecture/product.yaml',
    pointer: '/concepts/12/attestations/0/topic',
    line: 84,
    column: 16,
  }
  const report: ReconciliationReport = {
    format: 'yarramate/reconciliation-report/v1',
    workspace: 'yarramate',
    summary: {
      evidenceDocuments: 1,
      observations: 327,
      confirmed: 325,
      findings: 4,
      contradicted: 1,
      unknown: 1,
      notObserved: 0,
      unsupportedAbsences: 0,
      subjectsWithoutEvidence: 0,
      staleAttestations: 1,
      unconfirmedAttestations: 1,
      expectationsCompared: 1,
      expectationsWithoutObservation: 1,
      artifactsInScope: 165,
      unclaimedArtifacts: 2,
    },
    findings: [
      {
        target: { type: 'claim', id: 'billing-serves-run' },
        asserted: { from: 'billing', to: 'monthly-run', kind: 'serving' },
        result: 'contradicted',
        provider: 'repository-audit',
        evidenceDocument: 'yarramate-repository',
        evidence: { uri: 'repo:src/billing.ts', message: 'No serving found' },
      },
      {
        target: { type: 'subject', id: 'ledger' },
        expectation: {
          provider: 'metrics',
          key: 'latency',
          expected: '< 200ms',
          observed: '340ms',
          declared,
        },
        result: 'unknown',
        provider: 'metrics',
        evidenceDocument: 'yarramate-metrics',
        evidence: { uri: 'metrics:ledger' },
      },
      {
        target: { type: 'subject', id: 'tool-neutral-core' },
        result: 'stale-attestation',
        attestation: { topic: 'adequacy', by: 'maintainers', on: '2026-08-13' },
        provider: 'git',
        changedAt: '2026-09-01',
        evidence: { uri: 'git:abc123' },
      },
      {
        target: { type: 'subject', id: 'deterministic-correctness' },
        result: 'unconfirmed-attestation',
        attestation: {
          topic: 'adequacy',
          by: 'maintainers',
          recordedBy: 'claude',
          on: '2026-08-13',
        },
        provider: 'model',
        declared,
      },
    ],
    unobservedExpectations: [
      {
        claim: 'c1',
        subject: 'ledger',
        provider: 'metrics',
        key: 'uptime',
        expected: '99.9%',
        declared,
      },
    ],
    coverageScope: ['src/**/*.ts'],
    unclaimedArtifacts: ['src/fold-tree.ts', 'src/slots-model.ts'],
    notes: ['One note.'],
  }

  it('lays the summary out first, one labelled row per family of counts', () => {
    const text = reconciliationReportText(report)
    expect(text.split('\n').slice(0, 7)).toEqual([
      'reconciliation  yarramate',
      'observations    327  confirmed 325  contradicted 1  unknown 1  not observed 0  unsupported absences 0',
      'attestations    stale 1  unconfirmed 1',
      'expectations    compared 1  without observation 1',
      'subjects        without evidence 0',
      'artifacts       in scope 165  unclaimed 2',
      'findings        4',
    ])
  })

  it('gives every finding kind one line, with what each carries beneath it', () => {
    const text = reconciliationReportText(report)
    expect(text).toContain(
      '  contradicted            claim billing-serves-run  repository-audit, yarramate-repository  repo:src/billing.ts\n    asserts billing -serving-> monthly-run\n    No serving found\n',
    )
    expect(text).toContain(
      '  unknown                 ledger  metrics, yarramate-metrics  metrics:ledger\n    expected latency = < 200ms, observed 340ms  .yarramate/architecture/product.yaml:84\n',
    )
    expect(text).toContain(
      "  stale attestation       tool-neutral-core  adequacy, by maintainers on 2026-08-13; the subject's wording changed 2026-09-01  git:abc123\n",
    )
    expect(text).toContain(
      '  unconfirmed attestation deterministic-correctness  adequacy, by maintainers, recorded by claude on 2026-08-13  .yarramate/architecture/product.yaml:84\n',
    )
  })

  it('lists what follows only when it holds something, and closes with the notes', () => {
    const text = reconciliationReportText(report)
    expect(text).toContain('\nExpectations without observation\n  ledger  metrics/uptime expected 99.9%  .yarramate/architecture/product.yaml:84\n')
    expect(text).toContain('\nUnclaimed artifacts\n  src/fold-tree.ts\n  src/slots-model.ts\n')
    expect(text).toContain('\nCoverage scope\n  src/**/*.ts\n')
    expect(text.endsWith('\nNotes\n  One note.\n')).toBe(true)
    expect(text).not.toContain('Subjects without evidence')

    const bare = reconciliationReportText({
      format: 'yarramate/reconciliation-report/v1',
      workspace: 'empty',
      summary: {
        evidenceDocuments: 0,
        observations: 0,
        confirmed: 0,
        findings: 0,
        contradicted: 0,
        unknown: 0,
        notObserved: 0,
        subjectsWithoutEvidence: 0,
        expectationsCompared: 0,
        expectationsWithoutObservation: 0,
      },
      findings: [],
    })
    expect(bare).toBe(
      'reconciliation  empty\nobservations    0  confirmed 0  contradicted 0  unknown 0  not observed 0\nexpectations    compared 0  without observation 0\nsubjects        without evidence 0\nartifacts       not assessed\nfindings        0\n',
    )
  })
})
