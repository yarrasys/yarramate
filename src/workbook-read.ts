/**
 * Reading an `.xlsx` back, without a dependency (#355).
 *
 * Asymmetric with the writer on purpose. Writing uses stored entries and stays
 * synchronous; **reading cannot**, because a workbook that has been through
 * Excel comes back deflated. Verified against a real consulting template
 * rather than assumed: every part reports `Defl:N`, every cell is `t="s"`
 * against a `sharedStrings` part, and there is not one inline string left. So
 * the reader inflates through `DecompressionStream('deflate-raw')` - present
 * on Workers, in browsers and in Node 18+ - and resolves shared strings as
 * well as the inline ones this repository writes.
 *
 * Two details that are easy to miss and silently corrupt a row:
 *
 * - **Excel omits empty cells entirely.** A row is not a dense list, so a
 *   cell's column comes from its `r` reference (`C7`) and nowhere else.
 *   Reading positionally shifts every value after the first blank.
 * - **A zip carries directory entries** with zero length. They are not parts.
 */

const decoder = new TextDecoder()

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export const decodeXmlText = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    }
    return ENTITIES[entity] ?? whole
  })

/** `C7` -> 2. The letters are base-26 with no zero. */
export const columnIndexOf = (reference: string): number => {
  const letters = /^([A-Z]+)/.exec(reference)?.[1]
  if (letters === undefined) return 0
  let index = 0
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index - 1
}

const inflateRaw = async (bytes: Uint8Array): Promise<Uint8Array> => {
  // Fed through a stream rather than a Blob: `Blob` is not in the Node types
  // this package builds against, and a one-chunk ReadableStream is available
  // everywhere this has to run.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  // Cast at the seam: DOM lib types `DecompressionStream.writable` as
  // `WritableStream<BufferSource>`, which does not unify with the
  // `ReadableStream<Uint8Array>` above. The runtime contract is the one this
  // relies on, and it is the same on Workers, in browsers and in Node.
  const inflated = source.pipeThrough(
    new DecompressionStream('deflate-raw') as unknown as {
      readonly readable: ReadableStream<Uint8Array>
      readonly writable: WritableStream<Uint8Array>
    },
  )
  const parts: Uint8Array[] = []
  const reader = inflated.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value !== undefined) parts.push(value as Uint8Array)
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

export interface ZipReadFailure {
  readonly ok: false
  readonly reason: string
}

/**
 * Every part in the archive, by path. Directory entries are skipped, and an
 * unknown compression method is refused rather than guessed at: a part read
 * wrongly would parse as an empty sheet, which is the silent failure this
 * whole feature exists to avoid.
 */
export const unzipEntries = async (
  bytes: Uint8Array,
): Promise<
  { readonly ok: true; readonly entries: ReadonlyMap<string, Uint8Array> } | ZipReadFailure
> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let at = bytes.length - 22; at >= 0; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) return { ok: false, reason: 'not a zip archive' }

  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) {
      return { ok: false, reason: 'damaged central directory' }
    }
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localAt = view.getUint32(at + 42, true)
    const name = decoder.decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    )
    at += 46 + nameLength + extraLength + commentLength

    // A directory, not a part.
    if (name.endsWith('/')) continue

    if (view.getUint32(localAt, true) !== 0x04034b50) {
      return { ok: false, reason: `damaged entry ${name}` }
    }
    const localNameLength = view.getUint16(localAt + 26, true)
    const localExtraLength = view.getUint16(localAt + 28, true)
    const from = localAt + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(from, from + compressedSize)
    if (method === 0) {
      entries.set(name, raw)
    } else if (method === 8) {
      entries.set(name, await inflateRaw(raw))
    } else {
      return { ok: false, reason: `unsupported compression in ${name}` }
    }
  }
  return { ok: true, entries }
}

interface Tag {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly selfClosing: boolean
  readonly closing: boolean
}

/**
 * A scanner for the shapes SpreadsheetML uses, rather than a general XML
 * parser. OOXML is machine-generated and narrow, and a full parser is more
 * code than this file needs.
 */
const scan = (xml: string, onTag: (tag: Tag) => void, onText: (text: string) => void): void => {
  let at = 0
  while (at < xml.length) {
    const open = xml.indexOf('<', at)
    if (open < 0) break
    if (open > at) onText(xml.slice(at, open))
    if (xml.startsWith('<!--', open)) {
      const done = xml.indexOf('-->', open)
      at = done < 0 ? xml.length : done + 3
      continue
    }
    if (xml.startsWith('<?', open) || xml.startsWith('<!', open)) {
      const done = xml.indexOf('>', open)
      at = done < 0 ? xml.length : done + 1
      continue
    }
    const close = xml.indexOf('>', open)
    if (close < 0) break
    const body = xml.slice(open + 1, close)
    const closing = body.startsWith('/')
    const selfClosing = body.endsWith('/')
    const inner = body.slice(closing ? 1 : 0, selfClosing ? -1 : undefined)
    const name = /^([^\s/>]+)/.exec(inner)?.[1] ?? ''
    const attributes: Record<string, string> = {}
    for (const match of inner
      .slice(name.length)
      .matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      attributes[match[1]!] = decodeXmlText(match[2]!)
    }
    onTag({ name, attributes, selfClosing, closing })
    at = close + 1
  }
}

const localName = (name: string): string => {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

const sharedStringsOf = (xml: string): readonly string[] => {
  const strings: string[] = []
  let inItem = false
  let inText = false
  let current = ''
  scan(
    xml,
    (tag) => {
      const name = localName(tag.name)
      if (name === 'si') {
        if (tag.closing) {
          strings.push(current)
          inItem = false
        } else {
          inItem = true
          current = ''
          if (tag.selfClosing) {
            strings.push('')
            inItem = false
          }
        }
        return
      }
      // A shared string can be split into runs; `t` inside `r` still counts.
      if (name === 't') inText = !tag.closing && !tag.selfClosing
    },
    (text) => {
      if (inItem && inText) current += decodeXmlText(text)
    },
  )
  return strings
}

const rowsOf = (xml: string, shared: readonly string[]): readonly (readonly string[])[] => {
  const rows: string[][] = []
  let row: string[] | undefined
  let column = 0
  let type = ''
  let inValue = false
  let inInlineText = false
  let cell = ''
  scan(
    xml,
    (tag) => {
      const name = localName(tag.name)
      if (name === 'row') {
        if (tag.closing) {
          if (row !== undefined) rows.push(row)
          row = undefined
        } else {
          row = []
          if (tag.selfClosing) {
            rows.push(row)
            row = undefined
          }
        }
        return
      }
      if (name === 'c') {
        if (tag.closing || tag.selfClosing) {
          if (row !== undefined) {
            const resolved =
              type === 's' ? (shared[Number.parseInt(cell, 10)] ?? '') : cell
            while (row.length < column) row.push('')
            row[column] = resolved
          }
          cell = ''
          type = ''
          return
        }
        // Excel omits empty cells, so the column comes from `r` and nothing
        // else. Reading positionally shifts every value after a blank.
        column = tag.attributes.r === undefined ? row?.length ?? 0 : columnIndexOf(tag.attributes.r)
        type = tag.attributes.t ?? ''
        cell = ''
        return
      }
      if (name === 'v') inValue = !tag.closing && !tag.selfClosing
      if (name === 't') inInlineText = !tag.closing && !tag.selfClosing
    },
    (text) => {
      if (inValue || inInlineText) cell += decodeXmlText(text)
    },
  )
  return rows
}

export interface WorkbookRead {
  readonly ok: true
  /** Sheet name to rows, in workbook order. */
  readonly sheets: ReadonlyMap<string, readonly (readonly string[])[]>
}

/** The workbook's sheets, by name. Async, because a saved workbook is deflated. */
export const readWorkbook = async (
  bytes: Uint8Array,
): Promise<WorkbookRead | ZipReadFailure> => {
  const archive = await unzipEntries(bytes)
  if (!archive.ok) return archive
  const { entries } = archive

  const workbookPart = entries.get('xl/workbook.xml')
  if (workbookPart === undefined) {
    return { ok: false, reason: 'no xl/workbook.xml: not a workbook' }
  }
  const relsPart = entries.get('xl/_rels/workbook.xml.rels')
  const targets = new Map<string, string>()
  if (relsPart !== undefined) {
    scan(
      decoder.decode(relsPart),
      (tag) => {
        if (localName(tag.name) !== 'Relationship' || tag.closing) return
        const id = tag.attributes.Id
        const target = tag.attributes.Target
        if (id !== undefined && target !== undefined) targets.set(id, target)
      },
      () => {},
    )
  }

  const sharedPart = entries.get('xl/sharedStrings.xml')
  const shared =
    sharedPart === undefined ? [] : sharedStringsOf(decoder.decode(sharedPart))

  const sheets = new Map<string, readonly (readonly string[])[]>()
  const ordered: { name: string; target: string }[] = []
  scan(
    decoder.decode(workbookPart),
    (tag) => {
      if (localName(tag.name) !== 'sheet' || tag.closing) return
      const name = tag.attributes.name
      const relationship =
        tag.attributes['r:id'] ?? tag.attributes.id ?? tag.attributes['relId']
      if (name === undefined || relationship === undefined) return
      const target = targets.get(relationship)
      if (target !== undefined) ordered.push({ name, target })
    },
    () => {},
  )

  for (const { name, target } of ordered) {
    const path = target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/')
        ? target
        : `xl/${target}`
    const part = entries.get(path)
    if (part === undefined) continue
    sheets.set(name, rowsOf(decoder.decode(part), shared))
  }
  return { ok: true, sheets }
}
