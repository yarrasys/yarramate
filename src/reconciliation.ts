import type { GraphClaim, SemanticGraph } from './compiler.js'
import type {
  EvidenceLocator,
  EvidenceReport,
  EvidenceResult,
} from './evidence.js'

export interface AssertedRelationship {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly name?: string
}

export interface DeclaredSource {
  readonly document: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export interface ExpectationComparison {
  readonly provider: string
  readonly key: string
  readonly expected: string
  readonly observed: string
  readonly declared: DeclaredSource
}

export interface UnobservedExpectation {
  readonly claim: string
  readonly subject: string
  readonly provider: string
  readonly key: string
  readonly expected: string
  readonly declared: DeclaredSource
}

export interface EvidenceFinding {
  readonly target: {
    readonly type: 'subject' | 'claim'
    readonly id: string
  }
  readonly asserted?: AssertedRelationship
  readonly expectation?: ExpectationComparison
  readonly result: Exclude<EvidenceResult, 'confirmed'>
  readonly provider: string
  readonly evidenceDocument: string
  readonly evidence: EvidenceLocator
}

// A stale attestation is a finding with git provenance (ADR 0074): the
// sign-off predates the current wording of the attested subject. It has
// no evidence document because no provider authored it; git is the
// witness.
export interface StaleAttestationFinding {
  readonly target: {
    readonly type: 'subject'
    readonly id: string
  }
  readonly result: 'stale-attestation'
  readonly attestation: {
    readonly topic: string
    readonly by: string
    readonly on: string
  }
  readonly provider: 'git'
  readonly changedAt?: string
  readonly evidence: EvidenceLocator
}

export type ReconciliationFinding = EvidenceFinding | StaleAttestationFinding

export interface AttestationStaleness {
  readonly findings: readonly StaleAttestationFinding[]
  readonly notes: readonly string[]
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
    readonly subjectsWithoutEvidence: number
    readonly staleAttestations?: number
    readonly expectationsCompared: number
    readonly expectationsWithoutObservation: number
  }
  readonly findings: readonly ReconciliationFinding[]
  readonly unobservedSubjects?: readonly string[]
  readonly unobservedExpectations?: readonly UnobservedExpectation[]
  readonly notes?: readonly string[]
}

const assertedRelationshipsByClaim = (
  graph: SemanticGraph | undefined,
): ReadonlyMap<string, AssertedRelationship> => {
  const asserted = new Map<string, AssertedRelationship>()
  if (graph === undefined) return asserted
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const names = new Map<string, string>()
  for (const claim of graph.claims) {
    if (
      claim.predicate === 'yarramate/relationship/name' &&
      'value' in claim.object
    ) {
      names.set(claim.subject, claim.object.value)
    }
  }
  for (const claim of graph.claims) {
    if (!relationshipIds.has(claim.id) || !('ref' in claim.object)) continue
    const name = names.get(claim.id)
    asserted.set(claim.id, {
      from: claim.subject,
      to: claim.object.ref,
      kind: claim.predicate,
      ...(name === undefined ? {} : { name }),
    })
  }
  return asserted
}

export const constraintExpectsPredicate = 'yarramate/constraint/expects'

// A finding is now a union (ADR 0074); only the evidence arm can carry an
// expectation, so ordering reads it through one narrowing helper.
const expectationOf = (
  finding: ReconciliationFinding,
): ExpectationComparison | undefined =>
  'expectation' in finding ? finding.expectation : undefined

interface DeclaredExpectation extends UnobservedExpectation {}

// Mirrors the compiler encoding (ADR 0075). Provider and key admit no
// whitespace, so the first two spaces delimit them and everything after the
// second space is the expected value verbatim, spaces included.
const parseExpectation = (
  claim: GraphClaim,
): DeclaredExpectation | undefined => {
  if (
    claim.predicate !== constraintExpectsPredicate ||
    !('value' in claim.object)
  ) {
    return undefined
  }
  const match = /^(\S+) (\S+) ([\s\S]+)$/.exec(claim.object.value)
  if (match === null) return undefined
  return {
    claim: claim.id,
    subject: claim.subject,
    provider: match[1]!,
    key: match[2]!,
    expected: match[3]!,
    declared: {
      document: claim.source.document,
      path: claim.source.path,
      pointer: claim.source.pointer,
      line: claim.source.line,
      column: claim.source.column,
    },
  }
}

interface ExpectationOutcome {
  readonly findings: readonly EvidenceFinding[]
  readonly unobserved: readonly UnobservedExpectation[]
  readonly compared: number
}

// A declared expectation is matched to observations by provider and key. The
// observation's own target anchors its provenance but does not narrow the
// match: a keyed value is a fact about the project ("this deployment's region
// is X"), and several constraints on different subjects may legitimately
// expect the same fact. Comparison is string equality, deliberately; a
// provider that needs richer matching normalizes before it reports.
const compareExpectations = (
  graph: SemanticGraph | undefined,
  reports: readonly EvidenceReport[],
): ExpectationOutcome => {
  if (graph === undefined) {
    return { findings: [], unobserved: [], compared: 0 }
  }
  const findings: EvidenceFinding[] = []
  const unobserved: UnobservedExpectation[] = []
  let compared = 0
  for (const claim of graph.claims) {
    const expectation = parseExpectation(claim)
    if (expectation === undefined) continue
    let matched = false
    for (const report of reports) {
      if (report.provider !== expectation.provider) continue
      for (const observation of report.observations) {
        if (
          observation.key !== expectation.key ||
          observation.value === undefined
        ) {
          continue
        }
        matched = true
        if (observation.value === expectation.expected) continue
        findings.push({
          target: { type: 'claim', id: expectation.claim },
          expectation: {
            provider: expectation.provider,
            key: expectation.key,
            expected: expectation.expected,
            observed: observation.value,
            declared: expectation.declared,
          },
          result: 'contradicted',
          provider: report.provider,
          evidenceDocument: report.evidence,
          evidence: observation.evidence,
        })
      }
    }
    if (!matched) unobserved.push(expectation)
    else compared += 1
  }
  return {
    findings,
    unobserved: [...unobserved].sort(
      (left, right) =>
        left.claim.localeCompare(right.claim) ||
        left.key.localeCompare(right.key),
    ),
    compared,
  }
}

const unobservedCurrentConcepts = (
  graph: SemanticGraph | undefined,
  reports: readonly EvidenceReport[],
): readonly string[] => {
  if (graph === undefined) return []
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const claimsById = new Map(graph.claims.map((claim) => [claim.id, claim]))
  const observed = new Set<string>()
  for (const report of reports) {
    for (const observation of report.observations) {
      if ('subject' in observation) {
        observed.add(observation.subject)
        continue
      }
      const claim = claimsById.get(observation.claim)
      if (claim === undefined) continue
      observed.add(claim.subject)
      if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
        observed.add(claim.object.ref)
      }
    }
  }
  const conceptIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'concept')
      .map(({ id }) => id),
  )
  return graph.claims
    .filter(
      (claim) =>
        claim.predicate === 'yarramate/lifecycle/status' &&
        'value' in claim.object &&
        claim.object.value === 'current' &&
        conceptIds.has(claim.subject) &&
        !observed.has(claim.subject),
    )
    .map(({ subject }) => subject)
    .sort((left, right) => left.localeCompare(right))
}

export function reconcileEvidenceReports(
  workspace: string,
  reports: readonly EvidenceReport[],
  graph?: SemanticGraph,
  staleness?: AttestationStaleness,
): ReconciliationReport {
  const assertedByClaim = assertedRelationshipsByClaim(graph)
  const unobservedSubjects = unobservedCurrentConcepts(graph, reports)
  const expectations = compareExpectations(graph, reports)
  const summary = {
    evidenceDocuments: reports.length,
    observations: 0,
    confirmed: 0,
    findings: 0,
    contradicted: 0,
    unknown: 0,
    notObserved: 0,
    subjectsWithoutEvidence: unobservedSubjects.length,
    // Attestation staleness is assessed only when the caller derived it
    // (the reconcile command); the counter appears exactly then, so a
    // report without it is one that never looked, not one that found
    // nothing.
    ...(staleness === undefined
      ? {}
      : { staleAttestations: staleness.findings.length }),
    expectationsCompared: expectations.compared,
    expectationsWithoutObservation: expectations.unobserved.length,
  }
  const findings: ReconciliationFinding[] = [...(staleness?.findings ?? [])]
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
      const target =
        'subject' in observation
          ? ({ type: 'subject', id: observation.subject } as const)
          : ({ type: 'claim', id: observation.claim } as const)
      const asserted =
        target.type === 'claim' ? assertedByClaim.get(target.id) : undefined
      findings.push({
        target,
        ...(asserted === undefined ? {} : { asserted }),
        result: observation.result,
        provider: report.provider,
        evidenceDocument: report.evidence,
        evidence: observation.evidence,
      })
    }
  }
  // A disagreeing expectation is an ordinary contradicted finding: same
  // taxonomy, same counters, same strict-check consequence (ADR 0075).
  for (const finding of expectations.findings) {
    summary.contradicted += 1
    findings.push(finding)
  }
  findings.sort((left, right) =>
    left.target.id.localeCompare(right.target.id) ||
    left.target.type.localeCompare(right.target.type) ||
    left.provider.localeCompare(right.provider) ||
    ('evidenceDocument' in left ? left.evidenceDocument : '').localeCompare(
      'evidenceDocument' in right ? right.evidenceDocument : '',
    ) ||
    ('attestation' in left ? left.attestation.topic : '').localeCompare(
      'attestation' in right ? right.attestation.topic : '',
    ) ||
    (expectationOf(left)?.key ?? '').localeCompare(
      expectationOf(right)?.key ?? '',
    ) ||
    (expectationOf(left)?.observed ?? '').localeCompare(
      expectationOf(right)?.observed ?? '',
    ),
  )
  summary.findings = findings.length
  const notes = staleness?.notes ?? []
  return {
    format: 'yarramate/reconciliation-report/v1',
    workspace,
    summary,
    findings,
    ...(unobservedSubjects.length === 0 ? {} : { unobservedSubjects }),
    ...(expectations.unobserved.length === 0
      ? {}
      : { unobservedExpectations: expectations.unobserved }),
    ...(notes.length === 0 ? {} : { notes }),
  }
}
