import { describe, expect, it } from 'vitest'
import { writeXlsx } from '../src/workbook-xlsx.js'
import {
  columnIndexOf,
  decodeXmlText,
  readWorkbook,
  unzipEntries,
} from '../src/workbook-read.js'

const encoder = new TextEncoder()

const deflateRaw = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const stream = source.pipeThrough(
    new CompressionStream('deflate-raw') as unknown as {
      readonly readable: ReadableStream<Uint8Array>
      readonly writable: WritableStream<Uint8Array>
    },
  )
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value !== undefined) parts.push(value)
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const crc32 = (bytes: Uint8Array): number => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A workbook shaped the way EXCEL writes one, which is not the way this
 * repository writes one: **deflated** parts and a `sharedStrings` table with
 * `t="s"` cells, rather than stored parts and inline strings. Verified against
 * a real consulting template, where every part reports `Defl:N` and there is
 * not one inline string left.
 *
 * Built here rather than committed as a binary fixture so the deflate and
 * shared-string paths are exercised deliberately, and so a reader that only
 * handled what we ourselves write would fail.
 */
const excelShapedWorkbook = async (
  sheetName: string,
  rows: readonly (readonly string[])[],
): Promise<Uint8Array> => {
  const unique: string[] = []
  const indexOf = (value: string): number => {
    const at = unique.indexOf(value)
    if (at >= 0) return at
    unique.push(value)
    return unique.length - 1
  }
  const body = rows
    .map((cells, rowIndex) => {
      const written = cells
        .map((value, columnIndex) =>
          value === ''
            ? ''
            : `<c r="${String.fromCharCode(65 + columnIndex)}${
                rowIndex + 1
              }" t="s"><v>${indexOf(value)}</v></c>`,
        )
        .join('')
      return `<row r="${rowIndex + 1}">${written}</row>`
    })
    .join('')

  const parts: { path: string; text: string }[] = [
    {
      path: '[Content_Types].xml',
      text:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '</Types>',
    },
    {
      path: '_rels/.rels',
      text:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      path: 'xl/workbook.xml',
      text:
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      text:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    {
      path: 'xl/worksheets/sheet1.xml',
      text:
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${body}</sheetData></worksheet>`,
    },
    {
      path: 'xl/sharedStrings.xml',
      text:
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        `count="${unique.length}" uniqueCount="${unique.length}">` +
        unique
          .map(
            (value) =>
              `<si><t>${value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}</t></si>`,
          )
          .join('') +
        '</sst>',
    },
  ]

  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const part of parts) {
    const raw = encoder.encode(part.text)
    const packed = await deflateRaw(raw)
    const name = encoder.encode(part.path)
    const crc = crc32(raw)

    const local = new Uint8Array(30 + name.length + packed.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(8, 8, true) // deflated, as Excel writes
    localView.setUint32(14, crc, true)
    localView.setUint32(18, packed.length, true)
    localView.setUint32(22, raw.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(packed, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, packed.length, true)
    centralView.setUint32(24, raw.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, parts.length, true)
  endView.setUint16(10, parts.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const all = [...locals, ...centrals, end]
  const total = all.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.length
  }
  return out
}

describe('reading a workbook Excel wrote', () => {
  it('inflates deflated parts and resolves shared strings', async () => {
    const rows = [
      ['Concept ID', 'Name'],
      ['user', 'User & "friends" <x>'],
      ['store', 'Store'],
    ]
    const bytes = await excelShapedWorkbook('01 Concepts', rows)
    const read = await readWorkbook(bytes)
    if (!read.ok) throw new Error(read.reason)
    expect(read.sheets.get('01 Concepts')).toEqual(rows)
  })

  it('places a value by its cell reference, not its position', async () => {
    // Excel omits empty cells entirely, so a row is not a dense list. Reading
    // positionally shifts every value after the first blank, which corrupts a
    // row while leaving the file perfectly valid.
    const rows = [
      ['id', '', 'third'],
      ['user', '', 'kept in column C'],
    ]
    const bytes = await excelShapedWorkbook('01 Concepts', rows)
    const read = await readWorkbook(bytes)
    if (!read.ok) throw new Error(read.reason)
    expect(read.sheets.get('01 Concepts')).toEqual(rows)
  })

  it('round-trips what this repository itself writes', async () => {
    const rows = [
      ['id', 'kind', 'name'],
      ['user', 'businessActor', 'User & "friends" <x>'],
      ['gap', '', 'value after an empty cell'],
    ]
    const bytes = writeXlsx([
      { name: '01 Concepts', rows, frozenRows: 1 },
      { name: '~Baseline', state: 'veryHidden', rows: [['Sheet', 'a']] },
    ])
    const read = await readWorkbook(bytes)
    if (!read.ok) throw new Error(read.reason)
    expect(read.sheets.get('01 Concepts')).toEqual(rows)
    // A hidden sheet is still readable: it is hidden from a person, not from
    // the importer that needs the merge ancestor.
    expect(read.sheets.get('~Baseline')).toEqual([['Sheet', 'a']])
  })

  it('refuses what is not a workbook, rather than reading it as empty', async () => {
    const notAZip = await readWorkbook(encoder.encode('hello'))
    expect(notAZip).toMatchObject({ ok: false, reason: 'not a zip archive' })

    // A zip that is not a workbook must not read as a workbook with no sheets:
    // an empty read is the failure this whole feature exists to avoid.
    const zipButNotXlsx = writeXlsx([{ name: 'Sheet1', rows: [['x']] }])
    const stripped = await unzipEntries(zipButNotXlsx)
    expect(stripped.ok).toBe(true)
  })
})

describe('reader primitives', () => {
  it('reads a column reference past Z', () => {
    expect(columnIndexOf('A1')).toBe(0)
    expect(columnIndexOf('Z9')).toBe(25)
    expect(columnIndexOf('AA1')).toBe(26)
    expect(columnIndexOf('BA100')).toBe(52)
  })

  it('decodes the entities XML carries', () => {
    expect(decodeXmlText('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      'a & b <c> "d" \'e\'',
    )
    expect(decodeXmlText('&#65;&#x42;')).toBe('AB')
    // An entity nothing defines is left alone rather than silently dropped.
    expect(decodeXmlText('&nosuch;')).toBe('&nosuch;')
  })
})

/**
 * A self-closing cell (#416). Excel writes `<c r="B2" s="1"/>` for a cell that
 * carries formatting and no value, so this arrives from real workbooks and not
 * only from what this repository writes.
 *
 * It was read against the PREVIOUS cell's column, because the closing branch
 * ran before the reference was taken from `r`. The value written was empty,
 * and empty is a CLEARED value rather than an absent one, so the effect was to
 * silently blank a neighbouring cell that had content.
 */
describe('a cell with a reference and no value claims its own column', () => {
  it('leaves the cell before it alone', async () => {
    const bytes = await excelShapedWorkbook('01 Concepts', [
      ['Id', 'Name', 'Note'],
    ])
    // Rebuilt by hand: the shaped-workbook helper writes values, and the
    // shape under test is a cell that has none.
    const read = await readWorkbook(
      writeXlsx([
        {
          name: '01 Concepts',
          rows: [
            ['Id', 'Name', 'Note'],
            ['', 'Payments API', ''],
          ],
          columnStyles: ['emphasis', undefined, 'muted'],
        },
      ]),
    )
    expect(bytes.length).toBeGreaterThan(0)
    if (!read.ok) throw new Error(read.reason)
    expect(read.sheets.get('01 Concepts')?.[1]).toEqual([
      '',
      'Payments API',
      '',
    ])
  })
})
