import type {
  ReconciliationFinding,
  ReconciliationReport,
} from './reconciliation.js'

/**
 * The reconciliation report for a person (#526, ADR 0153).
 *
 * The JSON report is the contract (EVIDENCE.md) and stays the verb's
 * default; this is the same report said in lines, in the same order, with
 * nothing added and nothing judged. Every count the summary carries is on
 * the first lines; every finding is one line, plus its message where the
 * provider left one; the lists that follow appear only when they hold
 * something, and the notes close, because they are what the report says
 * about its own limits.
 */
export const reconciliationReportText = (
  report: ReconciliationReport,
): string => {
  const { summary } = report
  const lines: string[] = []
  const row = (label: string, ...cells: readonly string[]): void => {
    lines.push(`${label.padEnd(16)}${cells.join('  ')}`)
  }
  row('reconciliation', report.workspace)
  row(
    'observations',
    String(summary.observations),
    `confirmed ${summary.confirmed}`,
    `contradicted ${summary.contradicted}`,
    `unknown ${summary.unknown}`,
    `not observed ${summary.notObserved}`,
    ...(summary.unsupportedAbsences === undefined
      ? []
      : [`unsupported absences ${summary.unsupportedAbsences}`]),
  )
  if (
    summary.staleAttestations !== undefined ||
    summary.unconfirmedAttestations !== undefined
  ) {
    row(
      'attestations',
      `stale ${summary.staleAttestations ?? 0}`,
      `unconfirmed ${summary.unconfirmedAttestations ?? 0}`,
    )
  }
  row(
    'expectations',
    `compared ${summary.expectationsCompared}`,
    `without observation ${summary.expectationsWithoutObservation}`,
  )
  row('subjects', `without evidence ${summary.subjectsWithoutEvidence}`)
  row(
    'artifacts',
    ...(summary.artifactsInScope === undefined
      ? ['not assessed']
      : [
          `in scope ${summary.artifactsInScope}`,
          `unclaimed ${summary.unclaimedArtifacts ?? 0}`,
        ]),
  )
  row('findings', String(summary.findings))

  const section = (title: string, body: readonly string[]): void => {
    if (body.length === 0) return
    lines.push('', title)
    lines.push(...body)
  }
  section(
    'Findings',
    report.findings.flatMap((finding) => findingLines(finding)),
  )
  section(
    'Subjects without evidence',
    (report.unobservedSubjects ?? []).map((id) => `  ${id}`),
  )
  section(
    'Expectations without observation',
    (report.unobservedExpectations ?? []).map(
      (expectation) =>
        `  ${expectation.subject}  ${expectation.provider}/${expectation.key} expected ${expectation.expected}  ${expectation.declared.path}:${expectation.declared.line}`,
    ),
  )
  section(
    'Unclaimed artifacts',
    (report.unclaimedArtifacts ?? []).map((path) => `  ${path}`),
  )
  section(
    'Coverage scope',
    (report.coverageScope ?? []).map((pattern) => `  ${pattern}`),
  )
  section(
    'Notes',
    (report.notes ?? []).map((note) => `  ${note}`),
  )
  return `${lines.join('\n')}\n`
}

const findingLines = (finding: ReconciliationFinding): readonly string[] => {
  const label = finding.result.replace(/-/g, ' ').padEnd(24)
  if (finding.result === 'stale-attestation') {
    const changed =
      finding.changedAt === undefined
        ? ''
        : `; the subject's wording changed ${finding.changedAt}`
    return [
      `  ${label}${finding.target.id}  ${finding.attestation.topic}, by ${finding.attestation.by} on ${finding.attestation.on}${changed}  ${finding.evidence.uri}`,
    ]
  }
  if (finding.result === 'unconfirmed-attestation') {
    return [
      `  ${label}${finding.target.id}  ${finding.attestation.topic}, by ${finding.attestation.by}, recorded by ${finding.attestation.recordedBy} on ${finding.attestation.on}  ${finding.declared.path}:${finding.declared.line}`,
    ]
  }
  const head = `  ${label}${finding.target.type === 'claim' ? 'claim ' : ''}${finding.target.id}  ${finding.provider}, ${finding.evidenceDocument}  ${finding.evidence.uri}`
  const detail: string[] = []
  if (finding.asserted !== undefined) {
    detail.push(
      `    asserts ${finding.asserted.from} -${finding.asserted.kind}-> ${finding.asserted.to}`,
    )
  }
  if (finding.expectation !== undefined) {
    detail.push(
      `    expected ${finding.expectation.key} = ${finding.expectation.expected}, observed ${finding.expectation.observed}  ${finding.expectation.declared.path}:${finding.expectation.declared.line}`,
    )
  }
  if (finding.evidence.message !== undefined) {
    detail.push(`    ${finding.evidence.message}`)
  }
  return [head, ...detail]
}
