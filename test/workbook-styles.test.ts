import { describe, expect, it } from 'vitest'
import { writeXlsx, type WorkbookSheet } from '../src/workbook-xlsx.js'
import { readWorkbook } from '../src/workbook-read.js'

/** `readWorkbook` returns a union; a test that cannot read is a failed test. */
const read = async (bytes: Uint8Array) => {
  const result = await readWorkbook(bytes)
  if (!result.ok) throw new Error(result.reason)
  return result
}

// Named cell styles and column widths (#416), asked for by a workbook
// consumer whose columns fall into three classes — bound to the model,
// carried alongside it, or computed and ignored on the way back — which a
// consultant editing the file could not see until an import told them a cell
// could not be written back.

const ROWS = [
  ['Id', 'Name', 'Note'],
  ['orders-api', 'Orders API', 'first'],
  ['', 'Payments API', ''],
]

const plain: WorkbookSheet = { name: '01 Concepts', rows: ROWS }

describe('a caller that asks for no roles gets what it always got', () => {
  // The load-bearing claim of the whole change. Additive is a promise until
  // it is a test, and this is the test: same input, same bytes, styling
  // present in the writer or not.
  it('produces byte-identical output to an unstyled workbook', () => {
    const before = writeXlsx([plain])
    const again = writeXlsx([{ name: '01 Concepts', rows: ROWS }])
    expect(Array.from(again)).toEqual(Array.from(before))
  })

  it('emits no styles part and no style attribute', () => {
    const text = new TextDecoder().decode(writeXlsx([plain]))
    expect(text).not.toContain('styles.xml')
    expect(text).not.toContain(' s="')
  })

  it('emits no cols element when no widths are asked for', () => {
    expect(new TextDecoder().decode(writeXlsx([plain]))).not.toContain('<cols>')
  })
})

describe('a styled workbook carries the part exactly once', () => {
  const styled: WorkbookSheet = {
    ...plain,
    headerStyle: 'header',
    columnStyles: ['emphasis', 'emphasis', 'muted'],
    columnWidths: [18, 32, 60],
  }

  it('emits the styles part, its content type and its relationship', () => {
    const text = new TextDecoder().decode(writeXlsx([styled]))
    expect(text).toContain('xl/styles.xml')
    expect(text).toContain('spreadsheetml.styles+xml')
    expect(text).toContain('relationships/styles')
  })

  it('gives row 1 the header role and the rows below their column role', () => {
    const text = new TextDecoder().decode(writeXlsx([styled]))
    // header = 1, emphasis = 2, muted = 3.
    expect(text).toContain('<c r="A1" s="1"')
    expect(text).toContain('<c r="A2" s="2"')
    expect(text).toContain('<c r="C2" s="3"')
  })

  it('styles an empty cell in a styled column rather than omitting it', () => {
    // Otherwise a column reads as striped wherever a value happens to be
    // missing, which is worse than no styling at all.
    expect(new TextDecoder().decode(writeXlsx([styled]))).toContain(
      '<c r="A3" s="2"/>',
    )
  })

  it('writes the widths it was given and skips the ones it was not', () => {
    const text = new TextDecoder().decode(writeXlsx([styled]))
    expect(text).toContain('<col min="1" max="1" width="18" customWidth="1"/>')
    expect(text).toContain('<col min="3" max="3" width="60" customWidth="1"/>')
    expect(
      new TextDecoder()
        .decode(writeXlsx([{ ...plain, columnWidths: [0, 12] }]))
        .includes('min="1"'),
    ).toBe(false)
  })

  it('is deterministic: identical input, identical bytes', () => {
    // The property the whole file exists to hold, restated now that there is
    // a second part type whose ordering could drift.
    expect(Array.from(writeXlsx([styled]))).toEqual(
      Array.from(writeXlsx([styled])),
    )
  })
})

describe('formatting is not content', () => {
  // A styled column emits its empty cells, so a row can end with a trailing
  // blank where the unstyled workbook simply stopped. That is a length
  // difference and not a value one: every consumer of a row reads it as
  // `row[i] ?? ''` (`workbook-operations.ts`, `workbook-merge.ts`), so a
  // missing index and an empty string are the same cell downstream. Comparing
  // raw arrays would assert something stricter than the contract.
  const values = (rows: readonly (readonly string[])[] | undefined) =>
    (rows ?? []).map((row) => {
      const cells = [...row]
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      return cells
    })

  it('reads a styled workbook back with the same values as an unstyled one', async () => {
    // The round trip must not notice styling at all. A consumer regenerates
    // the workbook from the model, so if styling changed what came back the
    // producer would be editing the model by decorating it.
    const styled = await read(
      writeXlsx([
        {
          ...plain,
          headerStyle: 'header',
          columnStyles: ['emphasis', undefined, 'muted'],
          columnWidths: [18, 32, 60],
        },
      ]),
    )
    const bare = await read(writeXlsx([plain]))
    expect(values(styled.sheets.get('01 Concepts'))).toEqual(
      values(bare.sheets.get('01 Concepts')),
    )
  })

  it('keeps an empty styled cell empty rather than turning it into a value', () => {
    // A value-less `<c>` and an omitted cell must read back the same, or
    // styling a column would silently write blanks into the model.
    return read(
      writeXlsx([{ ...plain, columnStyles: ['emphasis', 'emphasis', 'muted'] }]),
    ).then((result) => {
      expect(result.sheets.get('01 Concepts')?.[2]).toEqual([
        '',
        'Payments API',
        '',
      ])
    })
  })
})
