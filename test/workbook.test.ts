import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { evaluateProjection } from '../src/projection.js'
import type { ProjectionDefinition } from '../src/projection.js'
import { buildWorkbookSheets, workbookFrom } from '../src/workbook.js'
import { columnName, escapeXml, writeXlsx } from '../src/workbook-xlsx.js'

/**
 * A document reaching for every field the workbook has to carry, so
 * losslessness is measured against the whole surface rather than the subset a
 * convenient fixture happens to use.
 */
const document = `format: yarramate/v1
id: fixture
profile: yarramate/core@0.1
states:
  - id: today
    kind: baseline
    name: Today
    description: Where we are.
  - id: tomorrow
    kind: target
    name: Tomorrow
    description: Where we are going.
    after: today
concepts:
  - id: platform-team
    kind: businessActor
    name: Platform team
  - id: user
    kind: businessActor
    name: User
    description: The person.
    status: current
    owner: platform-team
    aka:
      - customer
    presentIn:
      - today
      - tomorrow
    attestations:
      - topic: adequacy
        by: platform-team
        on: "2026-08-26"
  - id: other-user
    kind: businessActor
    name: Other user
    distinctFrom:
      - user
  - id: store
    kind: dataObject
    name: Store
    status: planned
  - id: service
    kind: applicationService
    name: Service
    description: Serves the user.
    presentIn:
      - tomorrow
relationships:
  - id: service-serves-user
    kind: serving
    from: service
    to: user
    name: Serves
    description: The service serves the user.
    status: current
    presentIn:
      - tomorrow
  - id: service-reads-store
    kind: access
    from: service
    to: store
    mode: read
`

const profileContextOf = () => {
  const compiled = compileWorkspaceWithProfileContext([
    { path: 'main.yaml', source: document },
  ])
  if (!compiled.ok) {
    throw new Error(
      `fixture did not compile: ${compiled.diagnostics
        .map(({ message }) => message)
        .join('; ')}`,
    )
  }
  return compiled
}

const projectionOf = (
  query: ProjectionDefinition['query'],
): ProjectionDefinition => ({
  format: 'yarramate/projection/v1',
  id: 'everything',
  version: '1.0',
  query,
  presentation: { title: 'Everything', description: 'All of it.' },
})

const provenance = {
  workspace: 'fixture',
  yarramateVersion: '0.0.0-test',
  sourceDigests: { 'main.yaml': 'a'.repeat(64) },
  conceptKinds: ['yarramate/core@0.1#businessActor'],
  relationshipKinds: ['yarramate/core@0.1#serving'],
  statuses: ['planned', 'current', 'retired'],
}

const sheetsFor = (query: ProjectionDefinition['query']) => {
  const compiled = profileContextOf()
  const result = evaluateProjection(
    compiled.graph,
    projectionOf(query),
    compiled.profileContext,
  )
  return {
    result,
    sheets: buildWorkbookSheets(result, provenance),
  }
}

const named = (
  sheets: ReturnType<typeof buildWorkbookSheets>,
  name: string,
): readonly (readonly string[])[] => {
  const sheet = sheets.find((one) => one.name === name)
  if (sheet === undefined) throw new Error(`no sheet ${name}`)
  return sheet.rows
}

describe('the workbook carries every claim', () => {
  /**
   * The acceptance bar for "no information lost" on the export side. A claim
   * the workbook does not carry cannot come back, and the failure is silent:
   * the file opens, the sheets read correctly, and a subject quietly loses a
   * field. Counting is the only way to see it.
   */
  it('accounts for every claim in the model', () => {
    const { result, sheets } = sheetsFor({})
    const relationshipIds = new Set(
      result.subjects
        .filter(({ type }) => type === 'relationship')
        .map(({ id }) => id),
    )

    const carried = new Set<string>()
    const carry = (subject: string, predicate: string): void => {
      carried.add(`${subject} | ${predicate}`)
    }
    const readColumns = (
      rows: readonly (readonly string[])[],
      columns: readonly (readonly [string, string])[],
    ): void => {
      const header = rows[0] ?? []
      for (const row of rows.slice(1)) {
        for (const [label, predicate] of columns) {
          const at = header.indexOf(label)
          if (at >= 0 && (row[at] ?? '') !== '') carry(row[0] ?? '', predicate)
        }
      }
    }

    readColumns(named(sheets, '01 Concepts'), [
      ['Kind', 'yarramate/concept/kind'],
      ['Name', 'yarramate/concept/name'],
      ['Description', 'yarramate/concept/description'],
      ['Status', 'yarramate/lifecycle/status'],
      ['Owner', 'yarramate/ownership/owner'],
      ['Folder', 'yarramate/organisation/folder'],
    ])
    readColumns(named(sheets, '03 States'), [
      ['Kind', 'yarramate/concept/kind'],
      ['State kind', 'yarramate/state/type'],
      ['Name', 'yarramate/concept/name'],
      ['Description', 'yarramate/concept/description'],
      ['After', 'yarramate/state/after'],
    ])
    readColumns(named(sheets, '02 Relationships'), [
      ['Name', 'yarramate/relationship/name'],
      ['Description', 'yarramate/relationship/description'],
      ['Mode', 'yarramate/access/mode'],
      ['Content', 'yarramate/flow/content'],
      ['Status', 'yarramate/lifecycle/status'],
    ])
    for (const row of named(sheets, '04 Present In').slice(1)) {
      carry(row[0] ?? '', 'yarramate/state/present-in')
    }
    for (const row of named(sheets, '05 References').slice(1)) {
      carry(row[0] ?? '', row[2] ?? '')
    }
    for (const row of named(sheets, '06 Aliases').slice(1)) {
      carry(row[0] ?? '', 'yarramate/concept/alias')
    }
    for (const row of named(sheets, '07 Other Facts').slice(1)) {
      carry(row[0] ?? '', row[1] ?? '')
    }

    const missing = result.claims.filter(
      (claim) =>
        // A relationship IS a claim, and its own row carries it.
        !relationshipIds.has(claim.id) &&
        !carried.has(`${claim.subject} | ${claim.predicate}`),
    )
    expect(
      missing.map(({ subject, predicate }) => `${subject} ${predicate}`),
    ).toEqual([])
    expect(result.claims.length).toBeGreaterThan(20)
  })

  it('gives every relationship a row, with both endpoints named', () => {
    const { result, sheets } = sheetsFor({})
    const rows = named(sheets, '02 Relationships')
    const relationships = result.subjects.filter(
      ({ type }) => type === 'relationship',
    )
    expect(rows.length - 1).toBe(relationships.length)

    const serving = rows.find((row) => row[0] === 'service-serves-user')
    // The `(auto)` columns are what let a sheet read without hunting across
    // tabs: the id round-trips, the name is there to be read.
    expect(serving).toEqual([
      'service-serves-user',
      'yarramate/core@0.1#serving',
      'service',
      'Service',
      'user',
      'User',
      'Serves',
      'The service serves the user.',
      '',
      '',
      'current',
    ])
  })

  it('lifts states onto their own sheet, keeping their concept kind', () => {
    const { sheets } = sheetsFor({})
    const rows = named(sheets, '03 States')
    const tomorrow = rows.find((row) => row[0] === 'tomorrow')
    expect(tomorrow?.[1]).toBe('yarramate/core@0.1#plateau')
    expect(tomorrow?.[2]).toBe('target')
    expect(tomorrow?.slice(5)).toEqual(['today', 'Today'])
    // A state is a concept, and would otherwise appear twice.
    expect(
      named(sheets, '01 Concepts')
        .slice(1)
        .map((row) => row[0]),
    ).not.toContain('tomorrow')
  })
})

describe('the workbook is scoped by the projection', () => {
  /**
   * The answer to "can the user pick which version to export": a projection
   * query already has a `states` facet, so the workbook inherits state
   * selection rather than growing a flag that competes with it.
   */
  it('carries only the subjects a state-scoped projection selects', () => {
    const { sheets } = sheetsFor({ states: ['today'] })
    const ids = named(sheets, '01 Concepts')
      .slice(1)
      .map((row) => row[0])
    expect(ids).toContain('user')
    // `service` is present only in tomorrow.
    expect(ids).not.toContain('service')
  })
})

describe('the baseline is the merge ancestor', () => {
  it('mirrors the working sheets and is hidden from the UI', () => {
    const { sheets } = sheetsFor({})
    const baseline = sheets.find((one) => one.name === '~Baseline')
    // `veryHidden` cannot be unhidden from Excel's UI, which is what stops a
    // reviewer editing the ancestor their own edits are measured against.
    expect(baseline?.state).toBe('veryHidden')

    const concepts = named(sheets, '01 Concepts')
    const mirrored = named(sheets, '~Baseline')
      .slice(1)
      .filter((row) => row[0] === '01 Concepts')
      .map((row) => row.slice(1))
    expect(mirrored).toEqual(concepts)
  })

  it('keeps the Read Me out of the ancestor, since nothing imports prose', () => {
    const { sheets } = sheetsFor({})
    const sheetNames = named(sheets, '~Baseline')
      .slice(1)
      .map((row) => row[0])
    expect(new Set(sheetNames)).not.toContain('00 Read Me')
  })
})

describe('the xlsx container', () => {
  it('writes identical bytes for identical input', () => {
    const { result } = sheetsFor({})
    const once = workbookFrom(result, provenance)
    const twice = workbookFrom(result, provenance)
    // `export rtm` already holds this line: identical inputs produce identical
    // bytes, so CI can diff the output and a review is possible at all.
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true)
  })

  it('is a zip whose entries checksum correctly', () => {
    const { result } = sheetsFor({})
    const bytes = workbookFrom(result, provenance)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    // Walk the local headers and verify each stored entry against its own CRC,
    // which is what an unzip implementation does before trusting the bytes.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      table[index] = value >>> 0
    }
    const crcOf = (part: Uint8Array): number => {
      let crc = 0xffffffff
      for (const byte of part) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
      return (crc ^ 0xffffffff) >>> 0
    }

    let at = 0
    let entries = 0
    while (view.getUint32(at, true) === 0x04034b50) {
      const declared = view.getUint32(at + 14, true)
      const size = view.getUint32(at + 22, true)
      const nameLength = view.getUint16(at + 26, true)
      const extraLength = view.getUint16(at + 28, true)
      const start = at + 30 + nameLength + extraLength
      expect(crcOf(bytes.subarray(start, start + size))).toBe(declared)
      entries += 1
      at = start + size
    }
    // Content types, root rels, workbook, workbook rels, and one per sheet.
    expect(entries).toBe(4 + buildWorkbookSheets(result, provenance).length)
  })

  it('escapes what XML cannot carry, and drops what it cannot represent', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    )
    // A NUL reaching a spreadsheet is the failure that silently defeats every
    // text tool downstream, and XML 1.0 cannot represent it at all.
    expect(escapeXml('before\u0000after')).toBe('beforeafter')
    expect(escapeXml('keep\ttabs\nand newlines')).toBe('keep\ttabs\nand newlines')
  })

  it('names columns past Z', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(51)).toBe('AZ')
    expect(columnName(52)).toBe('BA')
  })

  it('refuses a sheet name Excel would reject', () => {
    expect(() => writeXlsx([{ name: 'a/b', rows: [['x']] }])).toThrow(
      /Illegal sheet name/,
    )
    expect(() =>
      writeXlsx([{ name: 'x'.repeat(32), rows: [['x']] }]),
    ).toThrow(/Illegal sheet name/)
    expect(() =>
      writeXlsx([
        { name: 'Same', rows: [['x']] },
        { name: 'same', rows: [['x']] },
      ]),
    ).toThrow(/distinct/)
  })
})
