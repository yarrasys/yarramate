import type { GraphClaim } from './compiler.js'
import type { ProjectionResult } from './projection.js'
import { writeXlsx, type WorkbookSheet } from './workbook-xlsx.js'

/**
 * The model as a workbook an architect can work in (#355).
 *
 * The shape is borrowed from a real consulting workbook rather than invented:
 * identity is columnar and readability is derived. A stable id in column A,
 * foreign keys inline, and an adjacent `(auto)` column carrying the referenced
 * subject's NAME so a sheet reads without hunting across tabs. The id is what
 * round-trips; the `(auto)` column is a convenience and is ignored on import.
 *
 * Losslessness does not depend on this file enumerating every predicate
 * correctly. Well-known predicates become columns because a person needs them
 * to be columns; **everything else lands in `07 Other Facts` verbatim**, so a
 * predicate added to the compiler after this was written still survives a
 * round trip. A mapping that silently dropped what it did not recognise is the
 * failure this design exists to avoid.
 */

export const WORKBOOK_FORMAT = 'yarramate/workbook/v1'

/** Consumed into a column on `01 Concepts`, in this order. */
const CONCEPT_COLUMNS = [
  ['yarramate/concept/kind', 'Kind'],
  ['yarramate/concept/name', 'Name'],
  ['yarramate/concept/description', 'Description'],
  ['yarramate/lifecycle/status', 'Status'],
  ['yarramate/ownership/owner', 'Owner'],
  ['yarramate/organisation/folder', 'Folder'],
] as const

/** Consumed into a column on `02 Relationships`, in this order. */
const RELATIONSHIP_COLUMNS = [
  ['yarramate/relationship/name', 'Name'],
  ['yarramate/relationship/description', 'Description'],
  ['yarramate/access/mode', 'Mode'],
  ['yarramate/flow/content', 'Content'],
  ['yarramate/lifecycle/status', 'Status'],
] as const

/**
 * Consumed into a column on `03 States`.
 *
 * `concept/kind` is here as well as on `01 Concepts` because a state IS a
 * concept: it carries an ordinary kind (`plateau`) alongside its state type
 * (`baseline`, `transition`, `target`). Omitting it dropped four kind claims
 * into the overflow sheet, which round-tripped correctly and read as though
 * the mapping had not recognised them.
 */
const STATE_COLUMNS = [
  ['yarramate/concept/kind', 'Kind'],
  ['yarramate/state/type', 'State kind'],
  ['yarramate/concept/name', 'Name'],
  ['yarramate/concept/description', 'Description'],
] as const

/** Ref-valued predicates that get their own sheet rather than the overflow. */
const REFERENCE_PREDICATES = new Set([
  'yarramate/reference/refers-to',
  'yarramate/lineage/supersedes',
  'yarramate/lineage/supersedes-respect',
  'yarramate/identity/distinct-from',
  'yarramate/constraint/requires',
  'yarramate/constraint/expects',
])

const ALIAS_PREDICATE = 'yarramate/concept/alias'
const PRESENT_IN_PREDICATE = 'yarramate/state/present-in'
const STATE_TYPE_PREDICATE = 'yarramate/state/type'
const STATE_AFTER_PREDICATE = 'yarramate/state/after'
const KIND_PREDICATE = 'yarramate/concept/kind'
const NAME_PREDICATE = 'yarramate/concept/name'

export interface WorkbookProvenance {
  readonly workspace: string
  readonly yarramateVersion: string
  /** What the graph was compiled from, the pin a later import checks. */
  readonly sourceDigests: Readonly<Record<string, string>>
  /** Vocabulary for the dropdown lists, taken from the compiled profile. */
  readonly conceptKinds: readonly string[]
  readonly relationshipKinds: readonly string[]
  readonly statuses: readonly string[]
}

const valueOf = (claim: GraphClaim): string =>
  'value' in claim.object ? claim.object.value : claim.object.ref

const isRef = (claim: GraphClaim): boolean => 'ref' in claim.object

/**
 * A relationship IS a claim: its `id` is the relationship id, its `subject` is
 * the source, its `predicate` is the kind and its object refs the target.
 * Claims ABOUT a relationship carry that id as their own subject.
 */
const relationshipClaims = (
  result: ProjectionResult,
): readonly GraphClaim[] => {
  const relationshipIds = new Set(
    result.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  return result.claims.filter((claim) => relationshipIds.has(claim.id))
}

export const buildWorkbookSheets = (
  result: ProjectionResult,
  provenance: WorkbookProvenance,
): readonly WorkbookSheet[] => {
  const conceptIds = new Set(
    result.subjects.filter(({ type }) => type === 'concept').map(({ id }) => id),
  )
  const relationshipIds = new Set(
    result.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )

  const bySubject = new Map<string, GraphClaim[]>()
  for (const claim of result.claims) {
    const held = bySubject.get(claim.subject)
    if (held === undefined) bySubject.set(claim.subject, [claim])
    else held.push(claim)
  }

  const nameOf = (id: string): string => {
    const claim = bySubject
      .get(id)
      ?.find(({ predicate }) => predicate === NAME_PREDICATE)
    return claim === undefined ? '' : valueOf(claim)
  }
  const first = (id: string, predicate: string): string => {
    const claim = bySubject.get(id)?.find((held) => held.predicate === predicate)
    return claim === undefined ? '' : valueOf(claim)
  }

  // A state is an ordinary concept carrying state predicates, so it is lifted
  // onto its own sheet rather than being a second kind of thing.
  const stateIds = new Set(
    [...conceptIds].filter(
      (id) =>
        bySubject
          .get(id)
          ?.some(({ predicate }) => predicate === STATE_TYPE_PREDICATE) === true,
    ),
  )

  /** Every claim a column or a named sheet has already carried. */
  const consumed = new Set<string>()
  const consume = (id: string, predicate: string): void => {
    const claim = bySubject.get(id)?.find((held) => held.predicate === predicate)
    if (claim !== undefined) consumed.add(claim.id)
  }

  const conceptRows: string[][] = [
    ['Concept ID', ...CONCEPT_COLUMNS.map(([, label]) => label)],
  ]
  for (const id of [...conceptIds].filter((one) => !stateIds.has(one)).sort()) {
    for (const [predicate] of CONCEPT_COLUMNS) consume(id, predicate)
    conceptRows.push([
      id,
      ...CONCEPT_COLUMNS.map(([predicate]) => first(id, predicate)),
    ])
  }

  const relationshipRows: string[][] = [
    [
      'Relationship ID',
      'Kind',
      'From',
      '↳ From name (auto)',
      'To',
      '↳ To name (auto)',
      ...RELATIONSHIP_COLUMNS.map(([, label]) => label),
    ],
  ]
  for (const claim of [...relationshipClaims(result)].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    consumed.add(claim.id)
    for (const [predicate] of RELATIONSHIP_COLUMNS) consume(claim.id, predicate)
    const target = 'ref' in claim.object ? claim.object.ref : ''
    relationshipRows.push([
      claim.id,
      claim.predicate,
      claim.subject,
      nameOf(claim.subject),
      target,
      nameOf(target),
      ...RELATIONSHIP_COLUMNS.map(([predicate]) => first(claim.id, predicate)),
    ])
  }

  const stateRows: string[][] = [
    [
      'State ID',
      ...STATE_COLUMNS.map(([, label]) => label),
      'After',
      '↳ After name (auto)',
    ],
  ]
  for (const id of [...stateIds].sort()) {
    for (const [predicate] of STATE_COLUMNS) consume(id, predicate)
    consume(id, STATE_AFTER_PREDICATE)
    const after = first(id, STATE_AFTER_PREDICATE)
    stateRows.push([
      id,
      ...STATE_COLUMNS.map(([predicate]) => first(id, predicate)),
      after,
      nameOf(after),
    ])
  }

  const presentInRows: string[][] = [
    ['Subject ID', '↳ Subject name (auto)', 'State ID', '↳ State name (auto)'],
  ]
  const referenceRows: string[][] = [
    ['Subject ID', '↳ Subject name (auto)', 'Predicate', 'Target ID', '↳ Target name (auto)'],
  ]
  const aliasRows: string[][] = [['Subject ID', '↳ Subject name (auto)', 'Also known as']]
  const otherRows: string[][] = [['Subject ID', 'Predicate', 'Value', 'Target ID']]

  for (const claim of result.claims) {
    if (consumed.has(claim.id)) continue
    if (relationshipIds.has(claim.id)) continue
    if (claim.predicate === PRESENT_IN_PREDICATE) {
      const state = valueOf(claim)
      presentInRows.push([claim.subject, nameOf(claim.subject), state, nameOf(state)])
      continue
    }
    if (claim.predicate === ALIAS_PREDICATE) {
      aliasRows.push([claim.subject, nameOf(claim.subject), valueOf(claim)])
      continue
    }
    if (REFERENCE_PREDICATES.has(claim.predicate)) {
      const target = valueOf(claim)
      referenceRows.push([
        claim.subject,
        nameOf(claim.subject),
        claim.predicate,
        target,
        nameOf(target),
      ])
      continue
    }
    // The overflow, and the reason a round trip stays lossless when the
    // compiler grows a predicate this file has never heard of.
    otherRows.push([
      claim.subject,
      claim.predicate,
      isRef(claim) ? '' : valueOf(claim),
      isRef(claim) ? valueOf(claim) : '',
    ])
  }

  const readMe: string[][] = [
    ['YarraMate workbook'],
    [],
    ['Workspace', provenance.workspace],
    ['Projection', result.projection],
    ['Built by', `yarramate ${provenance.yarramateVersion}`],
    [],
    ['How to use this'],
    ['1.', 'Edit the numbered sheets. Column A is the identity of the row and is what the model is keyed on.'],
    ['2.', 'A column marked (auto) is derived for readability. Edits to it are ignored.'],
    ['3.', 'Add a row with a new ID to add a subject. Kind and Status are dropdowns.'],
    ['4.', 'Deleting a row does NOT delete anything. Removals are reported, never applied.'],
    ['5.', 'Send the file back and import it. Your edits are merged; only a field changed on both sides is refused.'],
    [],
    ['Sheets beginning ~ are machinery. Do not edit them.'],
  ]

  const listColumns: readonly (readonly string[])[] = [
    ['Concept kind', ...provenance.conceptKinds],
    ['Relationship kind', ...provenance.relationshipKinds],
    ['Status', ...provenance.statuses],
  ]
  const listHeight = Math.max(...listColumns.map((column) => column.length))
  const listRows: string[][] = []
  for (let row = 0; row < listHeight; row += 1) {
    listRows.push(listColumns.map((column) => column[row] ?? ''))
  }

  const metaRows: string[][] = [
    ['Key', 'Value'],
    ['Format', WORKBOOK_FORMAT],
    ['Workspace', provenance.workspace],
    ['Projection', result.projection],
    ['YarraMate version', provenance.yarramateVersion],
    ...Object.entries(provenance.sourceDigests)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([path, digest]) => [`Digest ${path}`, digest]),
  ]

  const working: readonly WorkbookSheet[] = [
    { name: '00 Read Me', rows: readMe },
    { name: '01 Concepts', rows: conceptRows, frozenRows: 1 },
    { name: '02 Relationships', rows: relationshipRows, frozenRows: 1 },
    { name: '03 States', rows: stateRows, frozenRows: 1 },
    { name: '04 Present In', rows: presentInRows, frozenRows: 1 },
    { name: '05 References', rows: referenceRows, frozenRows: 1 },
    { name: '06 Aliases', rows: aliasRows, frozenRows: 1 },
    { name: '07 Other Facts', rows: otherRows, frozenRows: 1 },
  ]

  // The merge ancestor. Never edited, never updated: it records what the model
  // looked like when this workbook was made, so import can tell an FDE's edit
  // from a change the repository made underneath since. Each row carries its
  // sheet name so one sheet can hold them all.
  const baselineRows: string[][] = [['Sheet', 'Cells...']]
  for (const sheet of working) {
    if (sheet.name === '00 Read Me') continue
    for (const row of sheet.rows) baselineRows.push([sheet.name, ...row])
  }

  return [
    ...working,
    { name: '~Lists', state: 'hidden', rows: listRows },
    { name: '~Meta', state: 'hidden', rows: metaRows },
    { name: '~Baseline', state: 'veryHidden', rows: baselineRows },
  ]
}

/** The workbook, as bytes. Synchronous and deterministic. */
export const workbookFrom = (
  result: ProjectionResult,
  provenance: WorkbookProvenance,
): Uint8Array => writeXlsx(buildWorkbookSheets(result, provenance))
