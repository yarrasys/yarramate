import type {
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
} from './compiler.js'
import {
  ATTESTATION_PREDICATE_PREFIX,
  parseAttestationClaimValue,
} from './compiler.js'
import type { EvidenceReport, EvidenceResult } from './evidence.js'
import { coreLocalKind, isDeclaredNonGoal } from './brief.js'
import { conceptKinds } from './profile.js'

// The RTM is one derived reading of the graph: the chain
// driver -> goal -> requirement -> realizer -> evidence -> attestation
// already exists as claims with authored source locations, so every
// cell here is a citation of something the model declares, never new
// content (ADR 0071).

const motivationKindIds = new Set(
  conceptKinds
    .filter(({ layer }) => layer === 'motivation')
    .map(({ id }) => id),
)

const rowKinds = new Set(['requirement', 'constraint'])

export interface RtmSource {
  readonly path: string
  readonly line: number
}

export interface RtmEvidenceVerdict {
  readonly target: 'subject' | 'claim'
  readonly result: EvidenceResult
  readonly provider: string
  readonly evidenceDocument: string
  readonly uri: string
  readonly message?: string
}

export interface RtmLineageEntry {
  readonly relationship: string
  readonly role: 'realizes' | 'influences' | 'influenced-by'
  readonly subject: string
  readonly kind?: string
  readonly name?: string
  readonly source: RtmSource
}

export interface RtmRealizer {
  readonly subject: string
  readonly kind?: string
  readonly name?: string
  readonly status?: string
  readonly relationship: string
  readonly source: RtmSource
  readonly evidence: readonly RtmEvidenceVerdict[]
}

export interface RtmAttestation {
  readonly topic: string
  readonly by: string
  readonly recordedBy?: string
  readonly on: string
  readonly source: RtmSource
}

export interface RtmRow {
  readonly subject: string
  readonly kind: string
  readonly coreKind: 'requirement' | 'constraint'
  readonly name: string
  readonly description?: string
  readonly status?: string
  readonly gap: boolean
  readonly source: RtmSource
  readonly lineage: readonly RtmLineageEntry[]
  readonly realizers: readonly RtmRealizer[]
  readonly attestations: readonly RtmAttestation[]
}

export interface RtmContextEntry {
  readonly subject: string
  readonly kind: string
  readonly name: string
  readonly source: RtmSource
}

export interface RtmDescopedEntry {
  readonly subject: string
  readonly name: string
  /**
   * Why the row left the coverage arithmetic. A retired requirement is a
   * declared non-goal (ADR 0073); a retired constraint is deliberately
   * outside that set, because retiring one lifts a rule rather than
   * declining scope. Both are descoped, and a compliance reader needs to
   * know which happened.
   */
  readonly reason: 'non-goal' | 'lifted-constraint'
  readonly rationale?: string
  readonly source: RtmSource
}

export interface RequirementsTraceabilityMatrix {
  readonly format: 'yarramate/rtm/v1'
  readonly workspace: string
  readonly summary: {
    readonly rows: number
    readonly requirements: number
    readonly constraints: number
    readonly covered: number
    readonly gaps: number
    readonly descoped: number
    readonly realizers: number
    readonly realizersWithEvidence: number
    readonly attestedRows: number
  }
  readonly rows: readonly RtmRow[]
  readonly descoped: readonly RtmDescopedEntry[]
  readonly motivationContext: readonly RtmContextEntry[]
}

const documentOf = (subject: string): string =>
  subject.slice(0, subject.indexOf('#'))

const bySubjectOrder = (
  left: { readonly subject: string },
  right: { readonly subject: string },
): number =>
  documentOf(left.subject).localeCompare(documentOf(right.subject)) ||
  left.subject.localeCompare(right.subject)

const citation = (claim: GraphClaim): RtmSource => ({
  path: claim.source.path,
  line: claim.source.line,
})

export function buildRtm(
  workspace: string,
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext,
  evidenceReports: readonly EvidenceReport[],
): RequirementsTraceabilityMatrix {
  const conceptIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'concept')
      .map(({ id }) => id),
  )
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )

  const valueClaims = new Map<string, GraphClaim>()
  const attestationClaims = new Map<string, GraphClaim[]>()
  for (const claim of graph.claims) {
    if (!('value' in claim.object)) continue
    if (claim.predicate.startsWith(ATTESTATION_PREDICATE_PREFIX)) {
      attestationClaims.set(claim.subject, [
        ...(attestationClaims.get(claim.subject) ?? []),
        claim,
      ])
      continue
    }
    valueClaims.set(`${claim.subject}\u0000${claim.predicate}`, claim)
  }
  const valueClaim = (
    subject: string,
    predicate: string,
  ): GraphClaim | undefined =>
    valueClaims.get(`${subject}\u0000${predicate}`)
  const value = (subject: string, predicate: string): string | undefined => {
    const claim = valueClaim(subject, predicate)
    return claim !== undefined && 'value' in claim.object
      ? claim.object.value
      : undefined
  }

  const localConceptKind = (subject: string): string | undefined => {
    const kind = value(subject, 'yarramate/concept/kind')
    return kind === undefined
      ? undefined
      : coreLocalKind(kind, profileContext.conceptKindLineages)
  }

  // Evidence observations index: verdicts keyed by the observed subject
  // or claim identity, exactly as the overlay recorded them.
  const verdictsByTarget = new Map<string, RtmEvidenceVerdict[]>()
  for (const report of evidenceReports) {
    for (const observation of report.observations) {
      const target = 'subject' in observation ? 'subject' : 'claim'
      const id =
        'subject' in observation ? observation.subject : observation.claim
      const key = `${target}\u0000${id}`
      verdictsByTarget.set(key, [
        ...(verdictsByTarget.get(key) ?? []),
        {
          target,
          result: observation.result,
          provider: report.provider,
          evidenceDocument: report.evidence,
          uri: observation.evidence.uri,
          ...(observation.evidence.message === undefined
            ? {}
            : { message: observation.evidence.message }),
        },
      ])
    }
  }
  const verdicts = (
    target: 'subject' | 'claim',
    id: string,
  ): readonly RtmEvidenceVerdict[] =>
    verdictsByTarget.get(`${target}\u0000${id}`) ?? []

  interface Edge {
    readonly relationship: string
    readonly from: string
    readonly to: string
    readonly localKind: string | undefined
    readonly claim: GraphClaim
  }
  const edges: Edge[] = []
  for (const claim of graph.claims) {
    if (!relationshipIds.has(claim.id) || !('ref' in claim.object)) continue
    edges.push({
      relationship: claim.id,
      from: claim.subject,
      to: claim.object.ref,
      localKind: coreLocalKind(
        claim.predicate,
        profileContext.relationshipKindLineages,
      ),
      claim,
    })
  }

  const rowSubjects: string[] = []
  const descoped: RtmDescopedEntry[] = []
  const motivationContext: RtmContextEntry[] = []
  for (const id of [...conceptIds].sort()) {
    const local = localConceptKind(id)
    if (local === undefined || !motivationKindIds.has(local)) continue
    const kindClaim = valueClaim(id, 'yarramate/concept/kind')
    if (kindClaim === undefined) continue
    const name = value(id, 'yarramate/concept/name') ?? id
    if (!rowKinds.has(local)) {
      motivationContext.push({
        subject: id,
        kind: local,
        name,
        source: citation(kindClaim),
      })
      continue
    }
    const status = value(id, 'yarramate/lifecycle/status')
    if (status === 'retired') {
      // Retired rows are a closed question (ADR 0064): descoped honestly,
      // never silently dropped and never counted as gaps. Which kind of
      // closure it was comes from the shared non-goal predicate rather
      // than a second copy of the rule (ADR 0073): a retired requirement
      // declines scope, a retired constraint lifts a rule.
      const kindValue =
        'value' in kindClaim.object ? kindClaim.object.value : undefined
      const rationale = value(id, 'yarramate/concept/description')
      descoped.push({
        subject: id,
        name,
        reason: isDeclaredNonGoal(
          kindValue,
          status,
          profileContext.conceptKindLineages,
        )
          ? 'non-goal'
          : 'lifted-constraint',
        ...(rationale === undefined ? {} : { rationale }),
        source: citation(kindClaim),
      })
      continue
    }
    rowSubjects.push(id)
  }

  const rows: RtmRow[] = rowSubjects.map((subject) => {
    const kindClaim = valueClaim(subject, 'yarramate/concept/kind')!
    const kind = 'value' in kindClaim.object ? kindClaim.object.value : ''
    const coreKind = localConceptKind(subject) as 'requirement' | 'constraint'
    const name = value(subject, 'yarramate/concept/name') ?? subject
    const description = value(subject, 'yarramate/concept/description')
    const status = value(subject, 'yarramate/lifecycle/status')

    const lineage: RtmLineageEntry[] = []
    const realizers: RtmRealizer[] = []
    for (const edge of edges) {
      if (value(edge.relationship, 'yarramate/lifecycle/status') === 'retired')
        continue
      if (
        edge.from === subject &&
        (edge.localKind === 'realization' || edge.localKind === 'influence')
      ) {
        const counterpartKind = localConceptKind(edge.to)
        if (
          counterpartKind !== undefined &&
          motivationKindIds.has(counterpartKind)
        ) {
          lineage.push({
            relationship: edge.relationship,
            role: edge.localKind === 'realization' ? 'realizes' : 'influences',
            subject: edge.to,
            kind: counterpartKind,
            ...(value(edge.to, 'yarramate/concept/name') === undefined
              ? {}
              : { name: value(edge.to, 'yarramate/concept/name') }),
            source: citation(edge.claim),
          })
        }
      }
      if (edge.to === subject && edge.localKind === 'influence') {
        const counterpartKind = localConceptKind(edge.from)
        if (
          counterpartKind !== undefined &&
          motivationKindIds.has(counterpartKind)
        ) {
          lineage.push({
            relationship: edge.relationship,
            role: 'influenced-by',
            subject: edge.from,
            kind: counterpartKind,
            ...(value(edge.from, 'yarramate/concept/name') === undefined
              ? {}
              : { name: value(edge.from, 'yarramate/concept/name') }),
            source: citation(edge.claim),
          })
        }
      }
      if (edge.to === subject && edge.localKind === 'realization') {
        const realizerKind = localConceptKind(edge.from)
        const realizerName = value(edge.from, 'yarramate/concept/name')
        const realizerStatus = value(edge.from, 'yarramate/lifecycle/status')
        realizers.push({
          subject: edge.from,
          ...(realizerKind === undefined ? {} : { kind: realizerKind }),
          ...(realizerName === undefined ? {} : { name: realizerName }),
          ...(realizerStatus === undefined ? {} : { status: realizerStatus }),
          relationship: edge.relationship,
          source: citation(edge.claim),
          evidence: [
            ...verdicts('subject', edge.from),
            ...verdicts('claim', edge.relationship),
          ].sort(
            (left, right) =>
              left.provider.localeCompare(right.provider) ||
              left.evidenceDocument.localeCompare(right.evidenceDocument) ||
              left.uri.localeCompare(right.uri) ||
              left.target.localeCompare(right.target) ||
              left.result.localeCompare(right.result),
          ),
        })
      }
    }
    lineage.sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        bySubjectOrder(left, right) ||
        left.relationship.localeCompare(right.relationship),
    )
    realizers.sort(
      (left, right) =>
        bySubjectOrder(left, right) ||
        left.relationship.localeCompare(right.relationship),
    )

    const attestations: RtmAttestation[] = (
      attestationClaims.get(subject) ?? []
    )
      .flatMap((claim) => {
        if (!('value' in claim.object)) return []
        const parts = parseAttestationClaimValue(claim.object.value)
        if (parts === undefined) return []
        return [
          {
            topic: claim.predicate.slice(ATTESTATION_PREDICATE_PREFIX.length),
            ...parts,
            source: citation(claim),
          },
        ]
      })
      .sort((left, right) => left.topic.localeCompare(right.topic))

    // A gap is a requirement the model realizes with nothing that still
    // exists or is on the way: retired realizers keep their listing but
    // do not count as coverage.
    const gap =
      realizers.filter(({ status: s }) => s !== 'retired').length === 0

    return {
      subject,
      kind,
      coreKind,
      name,
      ...(description === undefined ? {} : { description }),
      ...(status === undefined ? {} : { status }),
      gap,
      source: citation(kindClaim),
      lineage,
      realizers,
      attestations,
    }
  })

  rows.sort(bySubjectOrder)
  descoped.sort(bySubjectOrder)
  motivationContext.sort(bySubjectOrder)

  const realizerCount = rows.reduce(
    (sum, row) => sum + row.realizers.length,
    0,
  )
  const realizersWithEvidence = rows.reduce(
    (sum, row) =>
      sum + row.realizers.filter(({ evidence }) => evidence.length > 0).length,
    0,
  )
  return {
    format: 'yarramate/rtm/v1',
    workspace,
    summary: {
      rows: rows.length,
      requirements: rows.filter(({ coreKind }) => coreKind === 'requirement')
        .length,
      constraints: rows.filter(({ coreKind }) => coreKind === 'constraint')
        .length,
      covered: rows.filter(({ gap }) => !gap).length,
      gaps: rows.filter(({ gap }) => gap).length,
      descoped: descoped.length,
      realizers: realizerCount,
      realizersWithEvidence,
      attestedRows: rows.filter(({ attestations }) => attestations.length > 0)
        .length,
    },
    rows,
    descoped,
    motivationContext,
  }
}

const escapeCell = (text: string): string =>
  text.replaceAll('|', '\\|').replaceAll('\n', ' ')

const cite = (source: RtmSource): string => `${source.path}:${source.line}`

const lineagePhrase = (entry: RtmLineageEntry): string => {
  const counterpart = `${entry.kind ?? 'subject'} "${entry.name ?? entry.subject}"`
  const phrase =
    entry.role === 'realizes'
      ? `realizes ${counterpart}`
      : entry.role === 'influences'
        ? `influences ${counterpart}`
        : `influenced by ${counterpart}`
  return `${phrase} (${cite(entry.source)})`
}

const realizerPhrase = (realizer: RtmRealizer): string => {
  const status = realizer.status === undefined ? '' : ` [${realizer.status}]`
  return `"${realizer.name ?? realizer.subject}"${status} (${cite(realizer.source)})`
}

const evidencePhrase = (realizer: RtmRealizer): string => {
  const label = `"${realizer.name ?? realizer.subject}"`
  if (realizer.evidence.length === 0) return `${label}: no evidence`
  const readings = realizer.evidence.map(
    ({ result, provider }) => `${result} (${provider})`,
  )
  return `${label}: ${readings.join(', ')}`
}

export function renderRtmMarkdown(
  rtm: RequirementsTraceabilityMatrix,
): string {
  const { summary } = rtm
  const lines: string[] = [
    `# Requirements traceability matrix: ${rtm.workspace}`,
    '',
    'Derived from the declared model and its evidence overlay; every cell',
    'cites its authored source as path:line. Do not edit; regenerate with',
    '`yarramate export rtm <workspace.yaml> --out <directory>`.',
    '',
    '## Summary',
    '',
    `- Rows: ${summary.rows} (${summary.requirements} requirements, ${summary.constraints} constraints)`,
    `- Covered: ${summary.covered}`,
    `- Gaps: ${summary.gaps}`,
    `- Descoped (retired): ${summary.descoped}`,
    `- Realizer links: ${summary.realizers} (${summary.realizersWithEvidence} with evidence)`,
    `- Attested rows: ${summary.attestedRows}`,
    '',
    '## Matrix',
    '',
    '| Requirement | Status | Motivation lineage | Realizers | Evidence | Attestations | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const row of rtm.rows) {
    const requirement =
      `**${escapeCell(row.name)}**<br>\`${row.subject}\`` +
      (row.coreKind === 'constraint' ? ' (constraint)' : '')
    const lineage =
      row.lineage.length === 0
        ? 'none'
        : row.lineage.map((entry) => escapeCell(lineagePhrase(entry))).join('<br>')
    const realizers = row.gap
      ? row.realizers.length === 0
        ? '**NONE (gap)**'
        : `**NONE current (gap)**<br>${row.realizers
            .map((realizer) => escapeCell(realizerPhrase(realizer)))
            .join('<br>')}`
      : row.realizers
          .map((realizer) => escapeCell(realizerPhrase(realizer)))
          .join('<br>')
    const evidence =
      row.realizers.length === 0
        ? 'none'
        : row.realizers
            .map((realizer) => escapeCell(evidencePhrase(realizer)))
            .join('<br>')
    const attestations =
      row.attestations.length === 0
        ? 'none'
        : row.attestations
            .map(
              (attestation) =>
                escapeCell(
                  `${attestation.topic}: ${attestation.by} on ${attestation.on}${
                    attestation.recordedBy === undefined
                      ? ''
                      : `, recorded by ${attestation.recordedBy}`
                  }`,
                ) + ` (${cite(attestation.source)})`,
            )
            .join('<br>')
    lines.push(
      `| ${requirement} | ${row.status ?? 'undeclared'} | ${lineage} | ${realizers} | ${evidence} | ${attestations} | ${cite(row.source)} |`,
    )
  }
  lines.push('', '## Gaps', '')
  if (summary.gaps === 0) {
    lines.push('None. Every row has at least one non-retired realizer.')
  } else {
    for (const row of rtm.rows.filter(({ gap }) => gap)) {
      lines.push(
        `- \`${row.subject}\` "${row.name}" (${cite(row.source)}) has no non-retired realizer.`,
      )
    }
  }
  lines.push('', '## Descoped (retired)', '')
  if (rtm.descoped.length === 0) {
    lines.push('None.')
  } else {
    lines.push(
      'Retired rows leave the coverage arithmetic entirely: they are',
      'neither covered nor gaps. A declared non-goal (ADR 0073) declines',
      'scope; a retired constraint lifts a rule.',
      '',
    )
    for (const entry of rtm.descoped) {
      const closure =
        entry.reason === 'non-goal'
          ? 'declared non-goal'
          : 'lifted constraint'
      const rationale =
        entry.rationale === undefined ? '' : ` Rationale: ${entry.rationale}`
      lines.push(
        `- \`${entry.subject}\` "${entry.name}" (${cite(entry.source)}) is a ${closure}.${rationale}`,
      )
    }
  }
  lines.push('', '## Motivation context', '')
  if (rtm.motivationContext.length === 0) {
    lines.push('No other motivation subjects are declared.')
  } else {
    for (const entry of rtm.motivationContext) {
      lines.push(
        `- ${entry.kind} "${entry.name}" \`${entry.subject}\` (${cite(entry.source)})`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}
