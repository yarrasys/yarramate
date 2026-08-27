import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { runImportCommand } from '../src/import-command.js'
import { keySheet, mergeSheet } from '../src/workbook-merge.js'
import { readWorkbook } from '../src/workbook-read.js'
import { writeXlsx, type WorkbookSheet } from '../src/workbook-xlsx.js'

const manifest = `format: yarramate/workspace/v1
id: rt
documents:
  - architecture/*.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

/** Comments and inline trailing comments, because keeping them is the point. */
const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
# A comment that must survive a round trip.
concepts:
  - id: user
    kind: businessActor
    name: User
    description: The person.   # trailing comment
relationships: []
`

const projection = `format: yarramate/projection/v1
id: all
version: "1.0"
query: {}
presentation:
  title: All
  description: Everything.
`

let workspace = ''

const documentPath = () => join(workspace, '.yarramate/architecture/main.yaml')

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'yarramate-workbook-import-'))
  mkdirSync(join(workspace, '.yarramate/architecture'), { recursive: true })
  writeFileSync(join(workspace, '.yarramate/workspace.yaml'), manifest, 'utf8')
  writeFileSync(documentPath(), document, 'utf8')
  writeFileSync(join(workspace, 'all.yaml'), projection, 'utf8')
  const exported = runCli(
    ['export', 'xlsx', 'all.yaml', '.yarramate/workspace.yaml', '--out', 'book.xlsx'],
    workspace,
  )
  expect(exported.exitCode).toBe(0)
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/** Reads the exported workbook and hands back its sheets, ready to edit. */
const openWorkbook = async (): Promise<Map<string, string[][]>> => {
  const read = await readWorkbook(
    new Uint8Array(readFileSync(join(workspace, 'book.xlsx'))),
  )
  if (!read.ok) throw new Error(read.reason)
  return new Map(
    [...read.sheets].map(([name, rows]) => [name, rows.map((row) => [...row])]),
  )
}

/** Writes edited sheets back, the way Excel would leave them. */
const saveWorkbook = (sheets: ReadonlyMap<string, string[][]>, name: string): void => {
  const parts: WorkbookSheet[] = [...sheets].map(([sheetName, rows]) => ({
    name: sheetName,
    rows,
    ...(sheetName === '~Baseline'
      ? { state: 'veryHidden' as const }
      : sheetName.startsWith('~')
        ? { state: 'hidden' as const }
        : {}),
  }))
  writeFileSync(join(workspace, name), writeXlsx(parts))
}

const editCell = (
  sheets: Map<string, string[][]>,
  sheet: string,
  id: string,
  column: string,
  value: string,
): void => {
  const rows = sheets.get(sheet)
  if (rows === undefined) throw new Error(`no sheet ${sheet}`)
  const at = rows[0]!.indexOf(column)
  const row = rows.find((one) => one[0] === id)
  if (row === undefined || at < 0) throw new Error(`no ${id}.${column}`)
  row[at] = value
}

describe('importing a workbook', () => {
  /**
   * The acceptance bar for "no information lost". An unedited round trip must
   * change nothing at all - not the values, not the comments, not the byte
   * count - or the workbook cannot be trusted with a model anyone cares about.
   */
  it('writes nothing at all when the workbook is unedited', async () => {
    const before = readFileSync(documentPath())
    const result = await runImportCommand(
      ['xlsx', 'book.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Nothing to import')
    expect(readFileSync(documentPath()).equals(before)).toBe(true)
  })

  it('applies an edit and keeps the comments around it', async () => {
    const sheets = await openWorkbook()
    editCell(sheets, '01 Concepts', 'user', 'Description', 'The person who signs in.')
    saveWorkbook(sheets, 'edited.xlsx')

    const result = await runImportCommand(
      ['xlsx', 'edited.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Imported 1 change')

    const after = readFileSync(documentPath(), 'utf8')
    expect(after).toContain('description: The person who signs in.')
    // Operations edit YAML surgically, which is the whole reason import is
    // not a rewrite: a regenerated document would drop both of these.
    expect(after).toContain('# A comment that must survive a round trip.')
    expect(after).toContain('# trailing comment')
  })

  it('adds a subject from a new row', async () => {
    const sheets = await openWorkbook()
    sheets.get('01 Concepts')!.push([
      'store',
      'yarramate/core@0.1#dataObject',
      'Store',
      'Where things live.',
      'current',
      '',
      '',
      '.yarramate/architecture/main.yaml',
    ])
    saveWorkbook(sheets, 'added.xlsx')

    const result = await runImportCommand(
      ['xlsx', 'added.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const after = readFileSync(documentPath(), 'utf8')
    // The workbook carries a qualified kind because the graph does; a document
    // declares the local name, so the profile prefix is dropped on the way in.
    expect(after).toContain('kind: dataObject')
    expect(after).toContain('id: store')
  })

  it('refuses a new row with no Document, naming the row', async () => {
    const sheets = await openWorkbook()
    sheets
      .get('01 Concepts')!
      .push(['nowhere', 'yarramate/core@0.1#dataObject', 'Nowhere', '', '', '', '', ''])
    saveWorkbook(sheets, 'homeless.xlsx')

    const result = await runImportCommand(
      ['xlsx', 'homeless.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('nowhere')
    expect(result.stdout).toContain('needs a Document')
    expect(readFileSync(documentPath(), 'utf8')).not.toContain('id: nowhere')
  })

  it('reports a removed row without deleting anything', async () => {
    const sheets = await openWorkbook()
    const rows = sheets.get('01 Concepts')!
    sheets.set(
      '01 Concepts',
      rows.filter((row) => row[0] !== 'user'),
    )
    saveWorkbook(sheets, 'removed.xlsx')

    const result = await runImportCommand(
      ['xlsx', 'removed.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('never a deletion')
    // A row deleted by accident in a spreadsheet has no symptom, so a missing
    // row is reported and never actioned.
    expect(readFileSync(documentPath(), 'utf8')).toContain('id: user')
  })

  it('refuses a workbook it did not produce, rather than guessing', async () => {
    writeFileSync(
      join(workspace, 'foreign.xlsx'),
      writeXlsx([{ name: '01 Concepts', rows: [['Concept ID'], ['user']] }]),
    )
    const result = await runImportCommand(
      ['xlsx', 'foreign.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    // Without the ancestor there is no way to tell an author's edit from the
    // repository's drift, and guessing silently discards one of them.
    expect(result.stderr).toContain('~Baseline')
  })

  it('refuses a file that is not a workbook', async () => {
    writeFileSync(join(workspace, 'notes.txt'), 'hello', 'utf8')
    const result = await runImportCommand(
      ['xlsx', 'notes.txt', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not a zip archive')
  })

  it('refuses when the same field moved in the workbook and in the workspace', async () => {
    const sheets = await openWorkbook()
    editCell(sheets, '01 Concepts', 'user', 'Description', 'The author wrote this.')
    saveWorkbook(sheets, 'conflicting.xlsx')

    // The repository moves on while the workbook is out being filled in.
    writeFileSync(
      documentPath(),
      document.replace('The person.', 'The repository wrote that.'),
      'utf8',
    )
    const before = readFileSync(documentPath())

    const result = await runImportCommand(
      ['xlsx', 'conflicting.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('The author wrote this.')
    expect(result.stderr).toContain('The repository wrote that.')
    // Apply is atomic, and a half-imported workbook is worse than a refused
    // one, so a conflict anywhere writes nothing anywhere.
    expect(readFileSync(documentPath()).equals(before)).toBe(true)
  })

  it('merges an edit the workspace did not touch, even after drift', async () => {
    const sheets = await openWorkbook()
    editCell(sheets, '01 Concepts', 'user', 'Description', 'The author wrote this.')
    saveWorkbook(sheets, 'disjoint.xlsx')

    // The repository changed a DIFFERENT field on the same subject.
    writeFileSync(documentPath(), document.replace('name: User', 'name: Renamed'), 'utf8')

    const result = await runImportCommand(
      ['xlsx', 'disjoint.xlsx', '.yarramate/workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const after = readFileSync(documentPath(), 'utf8')
    // Both survive. That is what the ancestor buys, and it is what makes a
    // week-long workbook cycle usable rather than an all-or-nothing gamble.
    expect(after).toContain('description: The author wrote this.')
    expect(after).toContain('name: Renamed')
  })
})

describe('the three-way merge', () => {
  const header = ['Concept ID', 'Name', 'Description', 'Document']
  const sheetOf = (rows: readonly (readonly string[])[]) =>
    keySheet([header, ...rows])
  const ancestor = sheetOf([['user', 'User', 'The person.', 'main.yaml']])

  it('does not call a convergent edit a conflict', () => {
    const report = mergeSheet(
      '01 Concepts',
      sheetOf([['user', 'User', 'Agreed text.', 'main.yaml']]),
      ancestor,
      sheetOf([['user', 'User', 'Agreed text.', 'main.yaml']]),
    )
    // Both moved it to the same place, so there is nothing to decide.
    expect(report.conflicts).toEqual([])
  })

  it('ignores a derived column, which is not the author to change', () => {
    const derived = ['Concept ID', '↳ Name (auto)', 'Document']
    const report = mergeSheet(
      '01 Concepts',
      keySheet([derived, ['user', 'edited by hand', 'main.yaml']]),
      keySheet([derived, ['user', 'User', 'main.yaml']]),
      keySheet([derived, ['user', 'User', 'main.yaml']]),
    )
    expect(report.changes).toEqual([])
  })
})
