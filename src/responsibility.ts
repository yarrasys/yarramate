/**
 * The responsibility matrix (#557, ADR 0159): RACI over the model, derived
 * the way the RTM is derived and never authored. Rows are subjects; columns
 * are the people the model holds; a cell is the letters one person carries
 * on one row, each letter with the claim that put it there.
 *
 * Accountable is the `yarramate/ownership/owner` claim. Responsible,
 * Consulted and Informed are the three `yarramate/policy@0.2` relationship
 * kinds, read through the lineage so a profile's own subkind counts. A
 * person named as `by` on an attestation of a subject was consulted on it:
 * derived into the cell with the topic and the date, never written back as
 * an edge, and never counted toward a gap.
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
  OWNER_PREDICATE,
  isPeopleKind,
  responsibilityLetterOf,
  type ResponsibilityLetter,
} from './responsibility-kinds.js'

export type RaciLetter = 'A' | ResponsibilityLetter

/** Where a letter came from: an authored line a reader can open. */
export interface ResponsibilitySource {
  readonly path: string
  readonly line: number
}

export type ResponsibilityCellSource =
  | { readonly kind: 'owner'; readonly source: ResponsibilitySource }
  | {
      readonly kind: 'relationship'
      readonly relationship: string
      readonly relationshipKind: string
      readonly source: ResponsibilitySource
    }
  | {
      readonly kind: 'attestation'
      readonly topic: string
      readonly on: string
      readonly source: ResponsibilitySource
    }

export interface ResponsibilityCell {
  /** In A, R, C, I order, each at most once. */
  readonly letters: readonly RaciLetter[]
  readonly sources: readonly ResponsibilityCellSource[]
}

export interface ResponsibilityPerson {
  readonly id: string
  readonly name: string
  readonly kind: string
  /**
   * Whether something serves this person. A served actor with no letter is
   * a consumer, not a responsibility holder; `idle` carries the flag so a
   * renderer can leave consumers out.
   */
  readonly served: boolean
}

export interface ResponsibilityRow {
  readonly subject: string
  readonly name: string
  readonly kind: string
  /** By person id; only people with a letter on this row appear. */
  readonly cells: Readonly<Record<string, ResponsibilityCell>>
}

export interface ResponsibilityMatrix {
  readonly format: 'yarramate/responsibility/v1'
  readonly workspace: string
  /** The projection the rows came from, when they came from one. */
  readonly projection?: string
  readonly summary: {
    readonly rows: number
    readonly people: number
    readonly cells: number
    readonly noAccountable: number
    readonly noResponsible: number
    readonly idle: number
  }
  readonly people: readonly ResponsibilityPerson[]
  readonly rows: readonly ResponsibilityRow[]
  readonly gaps: {
    /** Rows with no A. */
    readonly noAccountable: readonly string[]
    /** Rows with no R. A derived C never fills either. */
    readonly noResponsible: readonly string[]
  }
  /** People with no letter on any row of this matrix. */
  readonly idle: readonly ResponsibilityPerson[]
}

export interface ResponsibilityOptions {
  /**
   * The subjects that get a row, in any order; absent, every concept that is
   * not a person. A projection's subjects are the usual source.
   */
  readonly rows?: readonly string[]
  readonly projection?: string
}

const LETTER_ORDER: readonly RaciLetter[] = ['A', 'R', 'C', 'I']

// A subject id is qualified (`doc#local`) only where the local id alone is
// ambiguous, so the document half is empty for most ids.
const documentOf = (subject: string): string => {
  const hash = subject.indexOf('#')
  return hash === -1 ? '' : subject.slice(0, hash)
}

const bySubjectOrder = (left: string, right: string): number =>
  documentOf(left).localeCompare(documentOf(right)) ||
  left.localeCompare(right)

const citation = (claim: GraphClaim): ResponsibilitySource => ({
  path: claim.source.path,
  line: claim.source.line,
})

const localKind = (kind: string): string => kind.slice(kind.indexOf('#') + 1)

interface CellDraft {
  readonly letters: Set<RaciLetter>
  readonly sources: ResponsibilityCellSource[]
}

export function buildResponsibilityMatrix(
  workspace: string,
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext,
  options: ResponsibilityOptions = {},
): ResponsibilityMatrix {
  const conceptIds = new Set(
    graph.subjects.filter(({ type }) => type === 'concept').map(({ id }) => id),
  )
  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const values = new Map<string, string>()
  const ownerClaims = new Map<string, GraphClaim>()
  const attestations = new Map<string, GraphClaim[]>()
  const definingClaims: GraphClaim[] = []
  for (const claim of graph.claims) {
    if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
      definingClaims.push(claim)
      continue
    }
    if (claim.predicate === OWNER_PREDICATE && 'ref' in claim.object) {
      ownerClaims.set(claim.subject, claim)
      continue
    }
    if (!('value' in claim.object)) continue
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
  const kindOf = (subject: string): string =>
    value(subject, 'yarramate/concept/kind') ?? ''
  const nameOf = (subject: string): string =>
    value(subject, 'yarramate/concept/name') ?? subject
  const isPerson = (subject: string): boolean => {
    const kind = kindOf(subject)
    return isPeopleKind(profileContext.conceptKindLineages.get(kind), kind)
  }
  const isServing = (kind: string): boolean =>
    (profileContext.relationshipKindLineages.get(kind) ?? [kind])[0] ===
    'yarramate/core@0.1#serving'

  const served = new Set<string>()
  for (const claim of definingClaims) {
    if (isServing(claim.predicate) && 'ref' in claim.object) {
      served.add(claim.object.ref)
    }
  }

  const rowIds = (options.rows ?? [...conceptIds])
    .filter((id) => conceptIds.has(id) && !isPerson(id))
    .sort(bySubjectOrder)
  const rowSet = new Set(rowIds)

  // Every person the model holds is a column; anyone else who carries a
  // letter joins them, so the matrix says what the model says.
  const columns = new Set<string>([...conceptIds].filter(isPerson))
  const cells = new Map<string, Map<string, CellDraft>>()
  const cell = (row: string, person: string): CellDraft => {
    columns.add(person)
    const byPerson = cells.get(row) ?? new Map<string, CellDraft>()
    cells.set(row, byPerson)
    const draft = byPerson.get(person) ?? {
      letters: new Set<RaciLetter>(),
      sources: [],
    }
    byPerson.set(person, draft)
    return draft
  }

  // Owners first, then the edges, then the attestations, so a cell's
  // sources read in the order a person would look for them.
  for (const row of rowIds) {
    const owner = ownerClaims.get(row)
    if (owner === undefined || !('ref' in owner.object)) continue
    const draft = cell(row, owner.object.ref)
    draft.letters.add('A')
    draft.sources.push({ kind: 'owner', source: citation(owner) })
  }
  for (const claim of definingClaims) {
    if (!('ref' in claim.object) || !rowSet.has(claim.object.ref)) continue
    const letter = responsibilityLetterOf(
      profileContext.relationshipKindLineages.get(claim.predicate),
      claim.predicate,
    )
    if (letter === null) continue
    const draft = cell(claim.object.ref, claim.subject)
    draft.letters.add(letter)
    draft.sources.push({
      kind: 'relationship',
      relationship: claim.id,
      relationshipKind: claim.predicate,
      source: citation(claim),
    })
  }
  for (const row of rowIds) {
    for (const attestation of attestations.get(row) ?? []) {
      if (!('value' in attestation.object)) continue
      const parts = parseAttestationClaimValue(attestation.object.value)
      if (parts === undefined) continue
      const draft = cell(row, parts.by)
      draft.letters.add('C')
      draft.sources.push({
        kind: 'attestation',
        topic: attestation.predicate.slice(ATTESTATION_PREDICATE_PREFIX.length),
        on: parts.on,
        source: citation(attestation),
      })
    }
  }

  const personOf = (id: string): ResponsibilityPerson => ({
    id,
    name: nameOf(id),
    kind: kindOf(id),
    served: served.has(id),
  })
  const people = [...columns].sort(bySubjectOrder).map(personOf)
  const lettered = new Set<string>()
  let cellCount = 0
  const rows: ResponsibilityRow[] = rowIds.map((subject) => {
    const byPerson = cells.get(subject) ?? new Map<string, CellDraft>()
    const entries = [...byPerson.entries()].sort(([left], [right]) =>
      bySubjectOrder(left, right),
    )
    const finished: Record<string, ResponsibilityCell> = {}
    for (const [person, draft] of entries) {
      lettered.add(person)
      cellCount += 1
      finished[person] = {
        letters: LETTER_ORDER.filter((letter) => draft.letters.has(letter)),
        sources: draft.sources,
      }
    }
    return {
      subject,
      name: nameOf(subject),
      kind: kindOf(subject),
      cells: finished,
    }
  })
  const has = (row: ResponsibilityRow, letter: RaciLetter): boolean =>
    Object.values(row.cells).some(({ letters }) => letters.includes(letter))
  const noAccountable = rows
    .filter((row) => !has(row, 'A'))
    .map(({ subject }) => subject)
  const noResponsible = rows
    .filter((row) => !has(row, 'R'))
    .map(({ subject }) => subject)
  const idle = people.filter(({ id }) => !lettered.has(id))
  return {
    format: 'yarramate/responsibility/v1',
    workspace,
    ...(options.projection === undefined
      ? {}
      : { projection: options.projection }),
    summary: {
      rows: rows.length,
      people: people.length,
      cells: cellCount,
      noAccountable: noAccountable.length,
      noResponsible: noResponsible.length,
      idle: idle.length,
    },
    people,
    rows,
    gaps: { noAccountable, noResponsible },
    idle,
  }
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|')

const list = (ids: readonly string[]): string =>
  ids.length === 0 ? 'none' : ids.map((id) => `\`${id}\``).join(', ')

/**
 * The matrix as one markdown table a person reads, with the gaps and the
 * idle people under it. A C that comes only from attestations wears an
 * asterisk, so a standing role and a recorded judgement read differently.
 */
export function renderResponsibilityMarkdown(
  matrix: ResponsibilityMatrix,
): string {
  const lines: string[] = ['# Responsibility matrix', '']
  const where =
    matrix.projection === undefined
      ? ''
      : `, projection \`${matrix.projection}\``
  const rowsWord = matrix.summary.rows === 1 ? 'row' : 'rows'
  const peopleWord = matrix.summary.people === 1 ? 'person' : 'people'
  lines.push(
    `Workspace \`${matrix.workspace}\`${where}: ${matrix.summary.rows} ${rowsWord}, ${matrix.summary.people} ${peopleWord}. Derived from the record; edit the native documents, not this file.`,
    '',
  )
  if (matrix.rows.length === 0) {
    lines.push('_No rows._', '')
  } else {
    const header = [
      'Subject',
      'Kind',
      ...matrix.people.map(({ name }) => escapeCell(name)),
    ]
    lines.push(
      `| ${header.join(' | ')} |`,
      `|${header.map(() => '---').join('|')}|`,
    )
    let attested = false
    for (const row of matrix.rows) {
      const cells = matrix.people.map(({ id }) => {
        const cell = row.cells[id]
        if (cell === undefined) return ''
        return cell.letters
          .map((letter) => {
            if (letter !== 'C') return letter
            if (cell.sources.some(({ kind }) => kind === 'relationship')) {
              return 'C'
            }
            attested = true
            return 'C*'
          })
          .join(' ')
      })
      lines.push(
        `| ${escapeCell(row.name)} (\`${row.subject}\`) | ${localKind(row.kind)} | ${cells.join(' | ')} |`,
      )
    }
    lines.push('')
    if (attested) {
      lines.push(
        '\\* consulted by attestation: a recorded judgement, not a standing role.',
        '',
      )
    }
  }
  lines.push(
    '## Gaps',
    '',
    `- No accountable: ${list(matrix.gaps.noAccountable)}`,
    `- No responsible: ${list(matrix.gaps.noResponsible)}`,
    '',
    '## Idle',
    '',
  )
  if (matrix.idle.length === 0) {
    lines.push('_Everyone holds a letter._')
  } else {
    for (const person of matrix.idle) {
      lines.push(
        `- ${escapeCell(person.name)} (\`${person.id}\`)${person.served ? ', served' : ''}`,
      )
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}
