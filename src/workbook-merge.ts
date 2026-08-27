import type { WorkbookSheet } from './workbook-xlsx.js'

/**
 * Turning an edited workbook back into operations (#355, ADR 0127).
 *
 * The workbook carries its own ancestor. `~Baseline` is a copy of the working
 * rows exactly as exported, never edited and never updated, and it is what
 * makes this a THREE-way merge rather than an overwrite: without it, "this
 * cell differs from the model" cannot distinguish *the author changed it* from
 * *the repository moved underneath since the workbook was made*, and the
 * second is silently clobbered.
 *
 * So the comparison is run twice:
 *
 *   working vs baseline  ->  what the author did
 *   current vs baseline  ->  what the repository did since
 *
 * A cell both changed is a conflict and is refused, naming the field and both
 * values. Everything else merges. Nothing is written for a conflict, because
 * `apply` is atomic and a half-applied workbook is worse than a refused one.
 */

/** A sheet reduced to rows keyed by the id in column A. */
export interface KeyedSheet {
  readonly header: readonly string[]
  readonly rows: ReadonlyMap<string, readonly string[]>
}

export interface CellChange {
  readonly sheet: string
  readonly id: string
  readonly column: string
  readonly from: string
  readonly to: string
}

export interface Conflict extends CellChange {
  /** What the repository moved the same field to since the export. */
  readonly theirs: string
}

export interface MergeReport {
  readonly changes: readonly CellChange[]
  readonly added: readonly { readonly sheet: string; readonly id: string }[]
  readonly conflicts: readonly Conflict[]
  /**
   * Rows the workbook no longer has. Reported, never actioned: a row deleted
   * by accident in a spreadsheet has no symptom, and deletion is not a thing
   * this import does.
   */
  readonly missing: readonly { readonly sheet: string; readonly id: string }[]
}

/** A column whose value is derived for readability and ignored on the way back. */
export const isDerivedColumn = (label: string): boolean => label.startsWith('↳')

export const keySheet = (rows: readonly (readonly string[])[]): KeyedSheet => {
  const header = rows[0] ?? []
  const keyed = new Map<string, readonly string[]>()
  for (const row of rows.slice(1)) {
    const id = row[0] ?? ''
    if (id === '') continue
    keyed.set(id, row)
  }
  return { header, rows: keyed }
}

/**
 * The baseline sheet holds every working row prefixed by its sheet name, so
 * one hidden sheet can carry them all. This puts them back.
 */
export const baselineSheets = (
  rows: readonly (readonly string[])[],
): ReadonlyMap<string, readonly (readonly string[])[]> => {
  const sheets = new Map<string, (readonly string[])[]>()
  for (const row of rows.slice(1)) {
    const name = row[0] ?? ''
    if (name === '') continue
    const held = sheets.get(name)
    if (held === undefined) sheets.set(name, [row.slice(1)])
    else held.push(row.slice(1))
  }
  return sheets
}

const cellsOf = (
  header: readonly string[],
  row: readonly string[] | undefined,
): ReadonlyMap<string, string> => {
  const cells = new Map<string, string>()
  if (row === undefined) return cells
  header.forEach((label, index) => {
    if (isDerivedColumn(label)) return
    cells.set(label, row[index] ?? '')
  })
  return cells
}

/**
 * Three-way merge over one sheet.
 *
 * `current` is the sheet as it would be exported from the model right now, so
 * drift is measured in exactly the terms the author edited in rather than
 * against the YAML.
 */
export const mergeSheet = (
  sheet: string,
  working: KeyedSheet,
  baseline: KeyedSheet,
  current: KeyedSheet,
): MergeReport => {
  const changes: CellChange[] = []
  const added: { sheet: string; id: string }[] = []
  const conflicts: Conflict[] = []
  const missing: { sheet: string; id: string }[] = []

  for (const [id, row] of working.rows) {
    const before = baseline.rows.get(id)
    if (before === undefined) {
      added.push({ sheet, id })
      continue
    }
    const mine = cellsOf(working.header, row)
    const ancestor = cellsOf(baseline.header, before)
    const theirs = cellsOf(current.header, current.rows.get(id))

    for (const [column, value] of mine) {
      const was = ancestor.get(column) ?? ''
      if (value === was) continue
      const now = theirs.get(column) ?? was
      if (now !== was && now !== value) {
        // Both moved, and not to the same place.
        conflicts.push({ sheet, id, column, from: was, to: value, theirs: now })
        continue
      }
      changes.push({ sheet, id, column, from: was, to: value })
    }
  }

  for (const id of baseline.rows.keys()) {
    if (!working.rows.has(id)) missing.push({ sheet, id })
  }

  return { changes, added, conflicts, missing }
}

const EMPTY: KeyedSheet = { header: [], rows: new Map() }

/**
 * Merge every working sheet the workbook and the model share.
 *
 * A sheet present in one and not the other is skipped rather than guessed at:
 * the machinery sheets are not working data, and a sheet the model no longer
 * produces is not something an import should invent operations for.
 */
export const mergeWorkbook = (
  working: ReadonlyMap<string, readonly (readonly string[])[]>,
  baseline: ReadonlyMap<string, readonly (readonly string[])[]>,
  current: readonly WorkbookSheet[],
): MergeReport => {
  const currentByName = new Map(
    current.map((sheet) => [sheet.name, sheet.rows] as const),
  )
  const reports: MergeReport[] = []
  for (const [name, rows] of working) {
    if (name.startsWith('~') || name === '00 Read Me') continue
    const ancestor = baseline.get(name)
    if (ancestor === undefined) continue
    reports.push(
      mergeSheet(
        name,
        keySheet(rows),
        keySheet(ancestor),
        currentByName.has(name) ? keySheet(currentByName.get(name)!) : EMPTY,
      ),
    )
  }
  return {
    changes: reports.flatMap(({ changes }) => changes),
    added: reports.flatMap(({ added }) => added),
    conflicts: reports.flatMap(({ conflicts }) => conflicts),
    missing: reports.flatMap(({ missing }) => missing),
  }
}
