import type {
  EvidenceLocator,
  EvidenceReport,
  EvidenceResult,
} from './evidence.js'

export interface ReconciliationFinding {
  readonly target: {
    readonly type: 'subject' | 'claim'
    readonly id: string
  }
  readonly result: Exclude<EvidenceResult, 'confirmed'>
  readonly provider: string
  readonly evidenceDocument: string
  readonly evidence: EvidenceLocator
}

export interface ReconciliationReport {
  readonly format: 'yarramate/reconciliation-report/v1'
  readonly workspace: string
  readonly summary: {
    readonly evidenceDocuments: number
    readonly observations: number
    readonly confirmed: number
    readonly findings: number
    readonly contradicted: number
    readonly unknown: number
    readonly notObserved: number
  }
  readonly findings: readonly ReconciliationFinding[]
}

export function reconcileEvidenceReports(
  workspace: string,
  reports: readonly EvidenceReport[],
): ReconciliationReport {
  const summary = {
    evidenceDocuments: reports.length,
    observations: 0,
    confirmed: 0,
    findings: 0,
    contradicted: 0,
    unknown: 0,
    notObserved: 0,
  }
  const findings: ReconciliationFinding[] = []
  for (const report of reports) {
    summary.observations += report.observations.length
    for (const observation of report.observations) {
      if (observation.result === 'confirmed') {
        summary.confirmed += 1
        continue
      }
      if (observation.result === 'not-observed') {
        summary.notObserved += 1
      } else {
        summary[observation.result] += 1
      }
      findings.push({
        target: 'subject' in observation
          ? { type: 'subject', id: observation.subject }
          : { type: 'claim', id: observation.claim },
        result: observation.result,
        provider: report.provider,
        evidenceDocument: report.evidence,
        evidence: observation.evidence,
      })
    }
  }
  findings.sort((left, right) =>
    left.target.id.localeCompare(right.target.id) ||
    left.target.type.localeCompare(right.target.type) ||
    left.provider.localeCompare(right.provider) ||
    left.evidenceDocument.localeCompare(right.evidenceDocument),
  )
  summary.findings = findings.length
  return {
    format: 'yarramate/reconciliation-report/v1',
    workspace,
    summary,
    findings,
  }
}
