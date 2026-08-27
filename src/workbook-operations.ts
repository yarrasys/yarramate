import type { MergeReport } from './workbook-merge.js'
import { keySheet } from './workbook-merge.js'

/**
 * Merged workbook edits, as `yarramate/operations/v1` (#355, ADR 0127).
 *
 * Operations rather than a rewrite, because `applyOperations` edits YAML
 * SURGICALLY: comments, key order and formatting survive an import, and a
 * workbook imported with no edits produces no diff at all. Regenerating the
 * documents would be simpler and would destroy the rationale the models carry.
 *
 * It also means every edit passes the atomic compile gate on the way in. A
 * workbook that would produce an uncompilable model is refused whole, rather
 * than half-written.
 */

/** Column label to the field name `conceptFields` / `relationshipFields` uses. */
const CONCEPT_FIELDS: Readonly<Record<string, string>> = {
  Kind: 'kind',
  Name: 'name',
  Description: 'description',
  Status: 'status',
  Owner: 'owner',
}

const RELATIONSHIP_FIELDS: Readonly<Record<string, string>> = {
  Kind: 'kind',
  From: 'from',
  To: 'to',
  Name: 'name',
  Description: 'description',
  Status: 'status',
  Mode: 'mode',
  Content: 'content',
}

const CONCEPT_SHEETS = new Set(['01 Concepts', '03 States'])
const RELATIONSHIP_SHEET = '02 Relationships'

export interface OperationsResult {
  readonly operations: readonly Record<string, unknown>[]
  /** Rows that cannot be turned into an operation, with the reason. */
  readonly refusals: readonly string[]
}

/**
 * A kind is written as a qualified identity in the workbook
 * (`yarramate/core@0.1#serving`) because that is what the graph carries, and a
 * document declares the LOCAL name (`serving`). The profile prefix is dropped
 * on the way back rather than written into a document that would then not
 * compile.
 */
const localKind = (value: string): string => {
  const hash = value.indexOf('#')
  return hash < 0 ? value : value.slice(hash + 1)
}

export const operationsFrom = (
  report: MergeReport,
  working: ReadonlyMap<string, readonly (readonly string[])[]>,
): OperationsResult => {
  const operations: Record<string, unknown>[] = []
  const refusals: string[] = []

  const sheets = new Map(
    [...working].map(([name, rows]) => [name, keySheet(rows)] as const),
  )
  const documentOf = (sheet: string, id: string): string => {
    const keyed = sheets.get(sheet)
    if (keyed === undefined) return ''
    const at = keyed.header.indexOf('Document')
    if (at < 0) return ''
    return keyed.rows.get(id)?.[at] ?? ''
  }
  const cell = (sheet: string, id: string, column: string): string => {
    const keyed = sheets.get(sheet)
    if (keyed === undefined) return ''
    const at = keyed.header.indexOf(column)
    if (at < 0) return ''
    return keyed.rows.get(id)?.[at] ?? ''
  }

  // Updates, grouped so one subject with three edited cells is one operation
  // rather than three.
  const updates = new Map<string, Record<string, unknown>>()
  for (const change of report.changes) {
    const isConcept = CONCEPT_SHEETS.has(change.sheet)
    const isRelationship = change.sheet === RELATIONSHIP_SHEET
    if (!isConcept && !isRelationship) {
      // The satellite sheets carry list-valued facts, which are a different
      // shape of edit and are not attempted here.
      refusals.push(
        `${change.sheet} row "${change.id}": editing ${change.column} on this sheet is not supported yet`,
      )
      continue
    }
    const fields = isConcept ? CONCEPT_FIELDS : RELATIONSHIP_FIELDS
    const field = fields[change.column]
    if (field === undefined) {
      if (change.column !== 'Document') {
        refusals.push(
          `${change.sheet} row "${change.id}": ${change.column} cannot be written back`,
        )
      }
      continue
    }
    const document = documentOf(change.sheet, change.id)
    if (document === '') {
      refusals.push(
        `${change.sheet} row "${change.id}": no Document, so there is nowhere to write it`,
      )
      continue
    }
    const key = `${change.sheet}|${change.id}`
    const held = updates.get(key) ?? {
      op: isConcept ? 'update-concept' : 'update-relationship',
      document,
      [isConcept ? 'concept' : 'relationship']: { id: change.id },
    }
    const target = held[isConcept ? 'concept' : 'relationship'] as Record<
      string,
      unknown
    >
    target[field] = field === 'kind' ? localKind(change.to) : change.to
    updates.set(key, held)
  }
  operations.push(...updates.values())

  for (const { sheet, id } of report.added) {
    const isConcept = CONCEPT_SHEETS.has(sheet)
    const isRelationship = sheet === RELATIONSHIP_SHEET
    if (!isConcept && !isRelationship) {
      refusals.push(`${sheet} row "${id}": adding a row to this sheet is not supported yet`)
      continue
    }
    const document = documentOf(sheet, id)
    if (document === '') {
      refusals.push(
        `${sheet} row "${id}": a new row needs a Document saying which file it belongs to`,
      )
      continue
    }
    const fields = isConcept ? CONCEPT_FIELDS : RELATIONSHIP_FIELDS
    const body: Record<string, unknown> = { id }
    for (const [column, field] of Object.entries(fields)) {
      const value = cell(sheet, id, column)
      if (value === '') continue
      body[field] = field === 'kind' ? localKind(value) : value
    }
    if (body.kind === undefined) {
      refusals.push(`${sheet} row "${id}": a new row needs a Kind`)
      continue
    }
    operations.push({
      op: isConcept ? 'add-concept' : 'add-relationship',
      document,
      [isConcept ? 'concept' : 'relationship']: body,
    })
  }

  return { operations, refusals }
}

/** The operations document `apply` takes. */
export const operationsDocument = (
  operations: readonly Record<string, unknown>[],
): Record<string, unknown> => ({
  format: 'yarramate/operations/v1',
  operations,
})
