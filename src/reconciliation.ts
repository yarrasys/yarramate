import type { GraphClaim, SemanticGraph } from './compiler.js'
import {
  ATTESTATION_PREDICATE_PREFIX,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
} from './compiler.js'
import type {
  EvidenceLocator,
  EvidenceReport,
  EvidenceResult,
} from './evidence.js'
import type { ArtifactCoverage } from './artifact-coverage.js'

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

// A sign-off a machine transcribed is not the act the authority
// performed: the recorder is named in the model, so reconcile reports
// the gap between whose judgment this claims to be and whose hand wrote
// it. The model is the witness; no provider observed anything.
export interface UnconfirmedAttestationFinding {
  readonly target: {
    readonly type: 'subject'
    readonly id: string
  }
  readonly result: 'unconfirmed-attestation'
  readonly attestation: {
    readonly topic: string
    readonly by: string
    readonly recordedBy: string
    readonly on: string
  }
  readonly provider: 'model'
  readonly declared: DeclaredSource
}

export type ReconciliationFinding =
  | EvidenceFinding
  | StaleAttestationFinding
  | UnconfirmedAttestationFinding

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
    /**
     * `not-observed` observations naming no search. A negative claim about a
     * tree nobody read exhaustively is the one result whose message nothing
     * can check, so the ones offering a reader nothing to re-run are counted
     * rather than left to read like any other finding (ADR 0107).
     */
    readonly unsupportedAbsences?: number
    readonly subjectsWithoutEvidence: number
    readonly staleAttestations?: number
    readonly unconfirmedAttestations?: number
    readonly expectationsCompared: number
    readonly expectationsWithoutObservation: number
    /**
     * Files the declared coverage scope selected, and the ones no
     * observation's `repo:` locator claims (ADR 0130). Both appear exactly
     * when coverage was assessed, so a report without them is one that
     * never looked, not one that found nothing.
     */
    readonly artifactsInScope?: number
    readonly unclaimedArtifacts?: number
  }
  readonly findings: readonly ReconciliationFinding[]
  readonly unobservedSubjects?: readonly string[]
  readonly unobservedExpectations?: readonly UnobservedExpectation[]
  /**
   * The coverage patterns as the manifest declared them, echoed so the
   * report is honest about what it was asked to look at (ADR 0130).
   */
  readonly coverageScope?: readonly string[]
  /**
   * In-scope artifacts no observation claims, sorted. Absence, never
   * accusation: no finding is fabricated and `check --strict` never reads
   * this (ADR 0130), the line ADR 0049 drew for unobserved subjects.
   */
  readonly unclaimedArtifacts?: readonly string[]
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

// The compiler's parseConstraintExpectsValue is the sole authority for
// decoding the encoded value (ADR 0075). Provider and key admit no
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
  const parts = parseConstraintExpectsValue(claim.object.value)
  if (parts === undefined) return undefined
  return {
    claim: claim.id,
    subject: claim.subject,
    provider: parts.provider,
    key: parts.key,
    expected: parts.value,
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

// An observation claims an artifact when its locator is `repo:<path>`,
// read syntactically: any `#fragment` stripped, a directory claiming
// everything beneath it, any other scheme claiming nothing. Resolution
// and external validity stay with the provider (ADR 0130) — nothing here
// opens a file or checks one exists.
const claimedArtifactPaths = (
  reports: readonly EvidenceReport[],
): ReadonlySet<string> => {
  const claimed = new Set<string>()
  for (const report of reports) {
    for (const observation of report.observations) {
      const uri = observation.evidence.uri
      if (!uri.startsWith('repo:')) continue
      const located = uri.slice('repo:'.length)
      const fragment = located.indexOf('#')
      // Trailing slashes are stripped with a loop, not a regex: an
      // anchored /\/+$/ is polynomial on a locator of many slashes, and
      // locators are library input.
      let path = fragment === -1 ? located : located.slice(0, fragment)
      while (path.endsWith('/')) path = path.slice(0, -1)
      if (path.length > 0) claimed.add(path)
    }
  }
  return claimed
}

const isClaimed = (
  claimed: ReadonlySet<string>,
  artifact: string,
): boolean => {
  if (claimed.has(artifact)) return true
  for (const path of claimed) {
    if (artifact.startsWith(`${path}/`)) return true
  }
  return false
}

interface CoverageOutcome {
  readonly scope?: readonly string[]
  readonly artifacts?: number
  readonly unclaimed?: readonly string[]
  readonly notes: readonly string[]
}

const assessArtifactCoverage = (
  coverage: ArtifactCoverage | undefined,
  reports: readonly EvidenceReport[],
): CoverageOutcome => {
  // An absent argument is a caller that never looked (the strict gate);
  // an unassessed derivation is a reconcile that looked and could not,
  // and says why (ADR 0130, the ADR 0074 parallel).
  if (coverage === undefined) return { notes: [] }
  if (!coverage.assessed) {
    return {
      notes: [`Artifact coverage was not assessed: ${coverage.reason}.`],
    }
  }
  const notes: string[] = []
  if (coverage.scope.length === 0) {
    notes.push(
      'The workspace manifest declares an empty coverage scope, so no artifacts were assessed.',
    )
  }
  // A dead glob is indistinguishable from a typo, and silently
  // contributing nothing is how a mistyped pattern would report full
  // coverage. A note, not a refusal: a coverage scope is a lens, not
  // load-bearing input (ADR 0130).
  for (const { pattern, artifacts } of coverage.scope) {
    if (artifacts.length === 0) {
      notes.push(`Coverage pattern "${pattern}" matched no artifacts.`)
    }
  }
  const artifacts = [
    ...new Set(coverage.scope.flatMap(({ artifacts }) => artifacts)),
  ].sort((left, right) => left.localeCompare(right))
  const claimed = claimedArtifactPaths(reports)
  return {
    scope: coverage.scope.map(({ pattern }) => pattern),
    artifacts: artifacts.length,
    unclaimed: artifacts.filter((artifact) => !isClaimed(claimed, artifact)),
    notes,
  }
}

// A judgment a machine transcribed is not the act the authority
// performed. The recorder is in the model, so the difference is
// derivable here: an authority who wrote the record in their own hand
// names nobody else, and anything else is a claim awaiting confirmation.
const unconfirmedAttestations = (
  graph: SemanticGraph | undefined,
): readonly UnconfirmedAttestationFinding[] => {
  if (graph === undefined) return []
  return graph.claims.flatMap((claim) => {
    if (!claim.predicate.startsWith(ATTESTATION_PREDICATE_PREFIX)) return []
    if (!('value' in claim.object)) return []
    const parts = parseAttestationClaimValue(claim.object.value)
    const recordedBy = parts?.recordedBy
    if (parts === undefined || recordedBy === undefined) return []
    // The authority is qualified; a recorder naming the same subject,
    // long form or short, is that authority signing for themselves.
    const local = parts.by.slice(parts.by.indexOf('#') + 1)
    if (recordedBy === parts.by || recordedBy === local) return []
    return [
      {
        target: { type: 'subject', id: claim.subject } as const,
        result: 'unconfirmed-attestation' as const,
        attestation: {
          topic: claim.predicate.slice(ATTESTATION_PREDICATE_PREFIX.length),
          by: parts.by,
          recordedBy,
          on: parts.on,
        },
        provider: 'model' as const,
        declared: claim.source,
      },
    ]
  })
}

export function reconcileEvidenceReports(
  workspace: string,
  reports: readonly EvidenceReport[],
  graph?: SemanticGraph,
  staleness?: AttestationStaleness,
  coverage?: ArtifactCoverage,
): ReconciliationReport {
  const assertedByClaim = assertedRelationshipsByClaim(graph)
  const unobservedSubjects = unobservedCurrentConcepts(graph, reports)
  const expectations = compareExpectations(graph, reports)
  const unconfirmed = unconfirmedAttestations(graph)
  const assessedCoverage = assessArtifactCoverage(coverage, reports)
  const summary = {
    evidenceDocuments: reports.length,
    observations: 0,
    confirmed: 0,
    findings: 0,
    contradicted: 0,
    unknown: 0,
    notObserved: 0,
    unsupportedAbsences: 0,
    subjectsWithoutEvidence: unobservedSubjects.length,
    // Attestation staleness is assessed only when the caller derived it
    // (the reconcile command); the counter appears exactly then, so a
    // report without it is one that never looked, not one that found
    // nothing.
    ...(staleness === undefined
      ? {}
      : { staleAttestations: staleness.findings.length }),
    // Recorder disagreement is derived from the model alone, so the
    // counter appears whenever there was a graph to read.
    ...(graph === undefined
      ? {}
      : { unconfirmedAttestations: unconfirmed.length }),
    expectationsCompared: expectations.compared,
    expectationsWithoutObservation: expectations.unobserved.length,
    // Coverage counters appear exactly when the scope was assessed
    // (ADR 0130): a report without them never looked; a report carrying
    // zero looked and found everything claimed.
    ...(assessedCoverage.artifacts === undefined
      ? {}
      : {
          artifactsInScope: assessedCoverage.artifacts,
          unclaimedArtifacts: assessedCoverage.unclaimed?.length ?? 0,
        }),
  }
  const findings: ReconciliationFinding[] = [
    ...(staleness?.findings ?? []),
    ...unconfirmed,
  ]
  const absenceNotes: string[] = []
  for (const report of reports) {
    summary.observations += report.observations.length
    for (const observation of report.observations) {
      if (observation.result === 'confirmed') {
        summary.confirmed += 1
        continue
      }
      if (observation.result === 'not-observed') {
        summary.notObserved += 1
        // A not-observed asserts a negative, and is the only result whose
        // message nothing else in the pipeline can check: the locator it
        // carries points at what the author looked at, not at the absence
        // they claim. One naming no search offers a reader nothing to
        // re-run, so it is counted and named rather than left to read like
        // a checked finding (ADR 0107).
        if ((observation.searched ?? []).length === 0) {
          summary.unsupportedAbsences += 1
          const named =
            'subject' in observation ? observation.subject : observation.claim
          absenceNotes.push(
            `The not-observed observation for ${named} names no search, ` +
              `so nothing here can be re-run to test the absence it asserts.`,
          )
        }
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
  const notes = [
    ...(staleness?.notes ?? []),
    ...absenceNotes,
    ...assessedCoverage.notes,
  ]
  return {
    format: 'yarramate/reconciliation-report/v1',
    workspace,
    summary,
    findings,
    ...(unobservedSubjects.length === 0 ? {} : { unobservedSubjects }),
    ...(expectations.unobserved.length === 0
      ? {}
      : { unobservedExpectations: expectations.unobserved }),
    ...(assessedCoverage.scope === undefined
      ? {}
      : { coverageScope: assessedCoverage.scope }),
    ...(assessedCoverage.unclaimed === undefined ||
    assessedCoverage.unclaimed.length === 0
      ? {}
      : { unclaimedArtifacts: assessedCoverage.unclaimed }),
    ...(notes.length === 0 ? {} : { notes }),
  }
}
