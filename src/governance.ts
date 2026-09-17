/**
 * The governance log (#560, ADR 0160): the RAID log's risks and
 * assumptions as the model holds them, derived the way the responsibility
 * matrix is derived and never authored. One row per risk or assumption:
 * its owner and status, what it threatens or bears on, what mitigates it,
 * the latest review attestation, what it supersedes, and the groupings it
 * aggregates into (an adopter's severity or likelihood classes, which the
 * engine carries without knowing the scale). Issues and open questions are
 * the adopter's and the interrogation's; the engine never sees an issue.
 *
 * Deterministic: identical inputs give identical bytes, so CI can diff it.
 */
import type {
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
} from './compiler.js'
import {
  ATTESTATION_PREDICATE_PREFIX,
  parseAttestationClaimValue,
} from './graph-claims.js'
import {
  REVIEW_TOPICS,
  governanceTypeOf,
  type GovernanceType,
} from './governance-kinds.js'

export interface GovernanceSource {
  readonly path: string
  readonly line: number
}

export interface GovernanceRef {
  readonly id: string
  readonly name: string
}

/** The latest review attestation on a row, by date. */
export interface GovernanceReview {
  readonly topic: string
  readonly on: string
  readonly by: string
  readonly source: GovernanceSource
}

export interface GovernanceRow {
  readonly subject: string
  readonly name: string
  readonly kind: string
  readonly type: GovernanceType
  readonly status: string | null
  readonly description?: string
  readonly owner: GovernanceRef | null
  /** A risk's outgoing `influence` targets: what it threatens. */
  readonly threatens: readonly GovernanceRef[]
  /** An assumption's outgoing `association` targets: what it bears on. */
  readonly bearsOn: readonly GovernanceRef[]
  /** Incoming `influence` or `association` sources on a risk: what mitigates it. */
  readonly mitigatedBy: readonly GovernanceRef[]
  readonly review: GovernanceReview | null
  readonly supersedes: readonly string[]
  /** The groupings that aggregate this row: an adopter's rating classes. */
  readonly groupedBy: readonly GovernanceRef[]
}

export interface GovernanceLog {
  readonly format: 'yarramate/governance/v1'
  readonly workspace: string
  readonly summary: {
    readonly rows: number
    readonly risks: number
    readonly assumptions: number
    readonly unowned: number
    readonly unmitigated: number
    readonly unconfirmed: number
    readonly unreviewed: number
  }
  readonly rows: readonly GovernanceRow[]
  readonly gaps: {
    /** Rows with no owner. */
    readonly unowned: readonly string[]
    /** Current risks nothing mitigates. */
    readonly unmitigated: readonly string[]
    /** Assumptions with no `assumption-confirmed` attestation. */
    readonly unconfirmed: readonly string[]
    /** Risks with no `risk-reviewed` attestation. How old is too old is the adopter's. */
    readonly unreviewed: readonly string[]
  }
}

export interface GovernanceOptions {
  /** The subjects that may get a row; absent, every risk and assumption. */
  readonly rows?: readonly string[]
}

const CORE = 'yarramate/core@0.1#'

const documentOf = (subject: string): string => {
  const hash = subject.indexOf('#')
  return hash === -1 ? '' : subject.slice(0, hash)
}

const bySubjectOrder = (left: string, right: string): number =>
  documentOf(left).localeCompare(documentOf(right)) ||
  left.localeCompare(right)

const citation = (claim: GraphClaim): GovernanceSource => ({
  path: claim.source.path,
  line: claim.source.line,
})

export function buildGovernanceLog(
  workspace: string,
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext,
  options: GovernanceOptions = {},
): GovernanceLog {
  const conceptIds = new Set(
    graph.subjects.filter(({ type }) => type === 'concept').map(({ id }) => id),
  )
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const values = new Map<string, string>()
  const refs = new Map<string, string[]>()
  const attestations = new Map<string, GraphClaim[]>()
  const definingClaims: GraphClaim[] = []
  for (const claim of graph.claims) {
    if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
      definingClaims.push(claim)
      continue
    }
    if ('ref' in claim.object) {
      const key = `${claim.subject} ${claim.predicate}`
      refs.set(key, [...(refs.get(key) ?? []), claim.object.ref])
      continue
    }
    if (claim.predicate.startsWith(ATTESTATION_PREDICATE_PREFIX)) {
      attestations.set(claim.subject, [
        ...(attestations.get(claim.subject) ?? []),
        claim,
      ])
      continue
    }
    values.set(`${claim.subject} ${claim.predicate}`, claim.object.value)
  }
  const value = (subject: string, predicate: string): string | undefined =>
    values.get(`${subject} ${predicate}`)
  const refsOf = (subject: string, predicate: string): readonly string[] =>
    refs.get(`${subject} ${predicate}`) ?? []
  const kindOf = (subject: string): string =>
    value(subject, 'yarramate/concept/kind') ?? ''
  const nameOf = (subject: string): string =>
    value(subject, 'yarramate/concept/name') ?? subject
  const refOf = (id: string): GovernanceRef => ({ id, name: nameOf(id) })
  const typeOf = (subject: string): GovernanceType | null => {
    const kind = kindOf(subject)
    return governanceTypeOf(profileContext.conceptKindLineages.get(kind), kind)
  }
  const coreKindOf = (relationshipKind: string): string =>
    (profileContext.relationshipKindLineages.get(relationshipKind) ?? [
      relationshipKind,
    ])[0]!

  const rowIds = (options.rows ?? [...conceptIds])
    .filter((id) => conceptIds.has(id) && typeOf(id) !== null)
    .sort(bySubjectOrder)
  const rowSet = new Set(rowIds)

  const outgoing = new Map<string, { core: string; to: string }[]>()
  const incoming = new Map<string, { core: string; from: string }[]>()
  for (const claim of definingClaims) {
    if (!('ref' in claim.object)) continue
    const core = coreKindOf(claim.predicate)
    if (rowSet.has(claim.subject)) {
      outgoing.set(claim.subject, [
        ...(outgoing.get(claim.subject) ?? []),
        { core, to: claim.object.ref },
      ])
    }
    if (rowSet.has(claim.object.ref)) {
      incoming.set(claim.object.ref, [
        ...(incoming.get(claim.object.ref) ?? []),
        { core, from: claim.subject },
      ])
    }
  }
  const targets = (subject: string, core: string): readonly GovernanceRef[] =>
    (outgoing.get(subject) ?? [])
      .filter((edge) => edge.core === `${CORE}${core}`)
      .map(({ to }) => to)
      .sort(bySubjectOrder)
      .map(refOf)
  const sources = (subject: string, cores: readonly string[]): readonly GovernanceRef[] =>
    (incoming.get(subject) ?? [])
      .filter((edge) => cores.some((core) => edge.core === `${CORE}${core}`))
      .map(({ from }) => from)
      .sort(bySubjectOrder)
      .map(refOf)
  const latestReview = (
    subject: string,
    topic: string,
  ): GovernanceReview | null => {
    let latest: GovernanceReview | null = null
    for (const claim of attestations.get(subject) ?? []) {
      if (claim.predicate !== `${ATTESTATION_PREDICATE_PREFIX}${topic}`) continue
      if (!('value' in claim.object)) continue
      const parts = parseAttestationClaimValue(claim.object.value)
      if (parts === undefined) continue
      if (latest === null || parts.on >= latest.on) {
        latest = { topic, on: parts.on, by: parts.by, source: citation(claim) }
      }
    }
    return latest
  }

  const rows: GovernanceRow[] = rowIds.map((subject) => {
    const type = typeOf(subject)!
    const owner = refsOf(subject, 'yarramate/ownership/owner')[0]
    const description = value(subject, 'yarramate/concept/description')
    return {
      subject,
      name: nameOf(subject),
      kind: kindOf(subject),
      type,
      status: value(subject, 'yarramate/lifecycle/status') ?? null,
      ...(description === undefined ? {} : { description }),
      owner: owner === undefined ? null : refOf(owner),
      threatens: type === 'risk' ? targets(subject, 'influence') : [],
      bearsOn: type === 'assumption' ? targets(subject, 'association') : [],
      mitigatedBy:
        type === 'risk' ? sources(subject, ['influence', 'association']) : [],
      review: latestReview(subject, REVIEW_TOPICS[type]),
      supersedes: [...refsOf(subject, 'yarramate/lineage/supersedes')].sort(),
      groupedBy: sources(subject, ['aggregation']),
    }
  })
  const ids = (predicate: (row: GovernanceRow) => boolean): string[] =>
    rows.filter(predicate).map(({ subject }) => subject)
  const unowned = ids((row) => row.owner === null)
  const unmitigated = ids(
    (row) =>
      // Every risk still open, whatever its status says or does not say. The
      // first cut counted only `status: current`, so a risk nobody had given a
      // status, which is every freshly authored one, was never here and the
      // tile read 0 over a log where every risk was unmitigated (#564). The
      // engine's word for "open" is not-retired: that is what keeps unstatused
      // subjects in a projection with `excludeStatuses: [retired]` and what
      // the interrogation applies by default. A planned risk is asked for its
      // mitigation too; a mitigation can be planned.
      row.type === 'risk' && row.status !== 'retired' && row.mitigatedBy.length === 0,
  )
  const unconfirmed = ids((row) => row.type === 'assumption' && row.review === null)
  const unreviewed = ids((row) => row.type === 'risk' && row.review === null)
  return {
    format: 'yarramate/governance/v1',
    workspace,
    summary: {
      rows: rows.length,
      risks: rows.filter(({ type }) => type === 'risk').length,
      assumptions: rows.filter(({ type }) => type === 'assumption').length,
      unowned: unowned.length,
      unmitigated: unmitigated.length,
      unconfirmed: unconfirmed.length,
      unreviewed: unreviewed.length,
    },
    rows,
    gaps: { unowned, unmitigated, unconfirmed, unreviewed },
  }
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|')

const names = (entries: readonly GovernanceRef[]): string =>
  entries.map(({ name }) => escapeCell(name)).join(', ')

const list = (ids: readonly string[]): string =>
  ids.length === 0 ? 'none' : ids.map((id) => `\`${id}\``).join(', ')

/** The log as one markdown table a person reads, with the gaps under it. */
export function renderGovernanceMarkdown(log: GovernanceLog): string {
  const lines: string[] = ['# Governance log', '']
  lines.push(
    `Workspace \`${log.workspace}\`: ${log.summary.risks} risk${
      log.summary.risks === 1 ? '' : 's'
    }, ${log.summary.assumptions} assumption${
      log.summary.assumptions === 1 ? '' : 's'
    }. Derived from the record; edit the native documents, not this file.`,
    '',
  )
  if (log.rows.length === 0) {
    lines.push('_No rows._', '')
  } else {
    lines.push(
      '| Subject | Type | Status | Owner | Threatens / bears on | Mitigated by | Review | Grouped by |',
      '|---|---|---|---|---|---|---|---|',
    )
    for (const row of log.rows) {
      const review =
        row.review === null ? '' : `${row.review.topic} ${row.review.on} by ${escapeCell(row.review.by)}`
      lines.push(
        `| ${escapeCell(row.name)} (\`${row.subject}\`) | ${row.type} | ${row.status ?? ''} | ${
          row.owner === null ? '' : escapeCell(row.owner.name)
        } | ${names(row.type === 'risk' ? row.threatens : row.bearsOn)} | ${names(
          row.mitigatedBy,
        )} | ${review} | ${names(row.groupedBy)} |`,
      )
    }
    lines.push('')
  }
  lines.push(
    '## Gaps',
    '',
    `- Unowned: ${list(log.gaps.unowned)}`,
    `- Unmitigated risks: ${list(log.gaps.unmitigated)}`,
    `- Unconfirmed assumptions: ${list(log.gaps.unconfirmed)}`,
    `- Unreviewed risks: ${list(log.gaps.unreviewed)}`,
    '',
  )
  return `${lines.join('\n')}\n`
}
