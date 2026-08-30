/**
 * A minimal OPC/xlsx container, written by hand.
 *
 * An `.xlsx` file is a zip of XML parts, so this needs no dependency at all -
 * which is the point. The workbook has to be produced inside a Cloudflare
 * Worker (#355), where `fs` and Node streams do not exist and bundle size is a
 * budget, and every xlsx library on npm is both larger than this file and
 * built for Node.
 *
 * Entries are written with the **stored** method rather than deflated. Excel
 * accepts stored entries, and it keeps writing SYNCHRONOUS: the only
 * compressor available in a Worker is `CompressionStream`, which is async, and
 * an async writer would infect every caller including ApertureX's synchronous
 * `SourceStore` seam (ADR 0100). Reading is a different matter and is async,
 * because Excel re-saves deflated.
 *
 * Timestamps are fixed rather than current, so identical input produces
 * identical bytes. `export rtm` already holds that line - "the output carries
 * no timestamp, so identical inputs produce identical bytes and CI can diff
 * it" - and a workbook that differs on every run could not be reviewed.
 */

/** How a sheet appears in Excel's tab strip. */
export type SheetState = 'visible' | 'hidden' | 'veryHidden'

/**
 * A cell's ROLE, not its appearance (#416).
 *
 * The set is closed on purpose, and named for roles so that it stays closed:
 * a caller asking for a fourth should be asking for a fourth ROLE — "this
 * cell is stale", "this cell is derived" — and the test for admitting one is
 * whether it can be named without reference to how it looks. A request for
 * `blue`, or for a shade matching a client's deck, is the request that turns
 * a style vocabulary into a styling engine, and refusing it is the closed
 * set doing its job.
 *
 * Three will be wrong eventually. It should be wrong LOUDLY, by someone
 * filing for a role, rather than quietly by callers approximating a missing
 * role with the nearest available one — which is how `muted` would come to
 * mean two things.
 *
 * Named rather than given as colours for a second reason: the styles part is
 * then a CONSTANT, so "identical inputs produce identical bytes" stays
 * trivially true instead of becoming something a reviewer has to re-derive.
 */
export type CellStyle = 'header' | 'muted' | 'emphasis'

export interface WorkbookSheet {
  readonly name: string
  /** Defaults to visible. `veryHidden` cannot be unhidden from Excel's UI. */
  readonly state?: SheetState
  /** Rows of cells. Every value is written as an inline string. */
  readonly rows: readonly (readonly string[])[]
  /** Rows to keep on screen when scrolling, usually 1 for a header. */
  readonly frozenRows?: number
  /**
   * Applied to every row BELOW the first, by column index. Row 1 takes
   * `headerStyle` instead, so a header band is not overwritten by the column
   * role beneath it.
   */
  readonly columnStyles?: readonly (CellStyle | undefined)[]
  /** Applied to row 1 only. */
  readonly headerStyle?: CellStyle
  /** Column widths in characters, by column index. */
  readonly columnWidths?: readonly number[]
}

/**
 * Index into `cellXfs` below. `0` is the default format, which is why an
 * unstyled workbook needs no `s` attribute and no styles part at all.
 */
const STYLE_INDEX: Record<CellStyle, number> = {
  header: 1,
  emphasis: 2,
  muted: 3,
}

/**
 * The whole styles part, as a constant.
 *
 * Excel is particular about the first two fills: index 0 must be `none` and
 * index 1 `gray125`, whether or not either is used. `cellStyleXfs` likewise
 * has to exist before `cellXfs` can reference it.
 */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><color rgb="FF6B7280"/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF1F3"/>' +
  '<bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '</styleSheet>'

/** Whether any sheet asked for anything the styles part exists to serve. */
const usesStyles = (sheets: readonly WorkbookSheet[]): boolean =>
  sheets.some(
    (sheet) =>
      sheet.headerStyle !== undefined ||
      (sheet.columnStyles ?? []).some((style) => style !== undefined),
  )

const FIXED_DOS_TIME = 0
/** 1980-01-01, the zero of DOS date encoding. */
const FIXED_DOS_DATE = 33

const encoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * XML text escaping.
 *
 * Control characters are dropped rather than escaped: XML 1.0 cannot represent
 * most of them at all, and a NUL reaching a spreadsheet is the failure mode
 * that silently defeats every text tool downstream.
 */
export const escapeXml = (value: string): string =>
  value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** `0 -> A`, `26 -> AA`, the spreadsheet column alphabet. */
export const columnName = (index: number): string => {
  let name = ''
  let remaining = index
  for (;;) {
    name = String.fromCharCode(65 + (remaining % 26)) + name
    if (remaining < 26) return name
    remaining = Math.floor(remaining / 26) - 1
  }
}

/**
 * Excel forbids these in a sheet name, and caps it at 31 characters. A name
 * that collides after truncation would produce a workbook Excel refuses to
 * open, so callers keep their names short and distinct rather than relying on
 * repair here.
 */
export const sheetNameIsLegal = (name: string): boolean =>
  name.length > 0 && name.length <= 31 && !/[\\/?*[\]:]/.test(name)

const sheetXml = (sheet: WorkbookSheet): string => {
  // Row 1 takes the header role and everything below takes its column's, so a
  // header band is not overwritten by the column role sitting under it.
  const styleOf = (rowIndex: number, columnIndex: number): number | undefined => {
    const style =
      rowIndex === 0
        ? sheet.headerStyle
        : (sheet.columnStyles ?? [])[columnIndex]
    return style === undefined ? undefined : STYLE_INDEX[style]
  }
  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const row = rowIndex + 1
      const written = cells
        .map((value, columnIndex) => {
          const style = styleOf(rowIndex, columnIndex)
          const attribute = style === undefined ? '' : ` s="${style}"`
          // An empty cell in a styled column still carries the style, or the
          // column reads as striped wherever a value happens to be missing.
          // A value-less `<c>` reads back as an empty string, which is what
          // an omitted cell reads back as, so the round trip is unmoved.
          if (value === '') {
            return style === undefined
              ? ''
              : `<c r="${columnName(columnIndex)}${row}"${attribute}/>`
          }
          return (
            `<c r="${columnName(columnIndex)}${row}"${attribute} t="inlineStr">` +
            `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
          )
        })
        .join('')
      return `<row r="${row}">${written}</row>`
    })
    .join('')
  // Widths are per column and independent of the styles part, so a caller may
  // ask for them without asking for roles.
  const cols =
    sheet.columnWidths === undefined || sheet.columnWidths.length === 0
      ? ''
      : '<cols>' +
        sheet.columnWidths
          .map((width, index) =>
            width <= 0
              ? ''
              : `<col min="${index + 1}" max="${index + 1}" ` +
                `width="${width}" customWidth="1"/>`,
          )
          .join('') +
        '</cols>' 
  const pane =
    sheet.frozenRows === undefined || sheet.frozenRows <= 0
      ? '<sheetView workbookViewId="0"/>'
      : `<sheetView workbookViewId="0"><pane ySplit="${sheet.frozenRows}" ` +
        `topLeftCell="A${sheet.frozenRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews>${pane}</sheetViews>` +
    cols +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  )
}

const workbookXml = (sheets: readonly WorkbookSheet[]): string => {
  const entries = sheets
    .map((sheet, index) => {
      const state =
        sheet.state === undefined || sheet.state === 'visible'
          ? ''
          : ` state="${sheet.state === 'veryHidden' ? 'veryHidden' : 'hidden'}"`
      return (
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"` +
        `${state} r:id="rId${index + 1}"/>`
      )
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${entries}</sheets>` +
    '</workbook>'
  )
}

interface ZipEntry {
  readonly path: string
  readonly bytes: Uint8Array
}

const zip = (entries: readonly ZipEntry[]): Uint8Array => {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const crc = crc32(entry.bytes)
    const size = entry.bytes.length

    const local = new Uint8Array(30 + name.length + size)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true) // stored
    localView.setUint16(10, FIXED_DOS_TIME, true)
    localView.setUint16(12, FIXED_DOS_DATE, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, size, true)
    localView.setUint32(22, size, true)
    localView.setUint16(26, name.length, true)
    localView.setUint16(28, 0, true)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true) // stored
    centralView.setUint16(12, FIXED_DOS_TIME, true)
    centralView.setUint16(14, FIXED_DOS_DATE, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * The workbook, as bytes. Synchronous, dependency-free, and deterministic:
 * the same sheets always produce the same bytes.
 */
export const writeXlsx = (sheets: readonly WorkbookSheet[]): Uint8Array => {
  if (sheets.length === 0) {
    throw new Error('A workbook needs at least one sheet')
  }
  for (const sheet of sheets) {
    if (!sheetNameIsLegal(sheet.name)) {
      throw new Error(`Illegal sheet name: ${JSON.stringify(sheet.name)}`)
    }
  }
  const names = new Set(sheets.map(({ name }) => name.toLowerCase()))
  if (names.size !== sheets.length) {
    throw new Error('Sheet names must be distinct, case-insensitively')
  }

  // The whole additive claim rests on this: a caller that asks for no roles
  // gets exactly the parts, attributes and bytes it got before styling
  // existed. The styles part is emitted only when something references it.
  const styled = usesStyles(sheets)

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join('') +
    (styled
      ? '<Override PartName="/xl/styles.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      : '') +
    '</Types>'

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_sheet, index) =>
          `<Relationship Id="rId${index + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          `Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('') +
    (styled
      ? `<Relationship Id="rId${sheets.length + 1}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
        'Target="styles.xml"/>'
      : '') +
    '</Relationships>'

  return zip([
    { path: '[Content_Types].xml', bytes: encoder.encode(contentTypes) },
    { path: '_rels/.rels', bytes: encoder.encode(rootRels) },
    { path: 'xl/workbook.xml', bytes: encoder.encode(workbookXml(sheets)) },
    { path: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(workbookRels) },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: encoder.encode(sheetXml(sheet)),
    })),
    ...(styled
      ? [{ path: 'xl/styles.xml', bytes: encoder.encode(STYLES_XML) }]
      : []),
  ])
}
