import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

/**
 * Every place a subject address can appear on disk, and the surgery that moves
 * one. A rename is only honest if it is total: an address left behind is a
 * dangling reference or, worse, a selector that silently stops matching. The
 * enumeration below is the single statement of where those addresses live, and
 * `test/subject-references.test.ts` derives the same set from the JSON Schemas
 * so a new reference field cannot be added without landing here too.
 */

/** The four on-disk document kinds that can name a subject. */
export type SubjectReferenceGroup =
  | 'document'
  | 'projection'
  | 'evidence'
  | 'adapter-mapping'

/**
 * How the address is spelled at a position.
 * - `declaration`: the subject's own local id, always bare, in its own document.
 * - `reference`: bare local id (meaning "this document") or fully qualified.
 * - `qualified`: always `document#local`, optionally with a `~aspect` suffix
 *   (claim addresses are minted that way - see `compiler.ts`).
 */
export type SubjectReferenceForm = 'declaration' | 'reference' | 'qualified'

export interface SubjectReferencePosition {
  readonly group: SubjectReferenceGroup
  /** Key path from the document root; `*` matches every sequence index. */
  readonly path: readonly string[]
  readonly form: SubjectReferenceForm
}

export const SUBJECT_REFERENCE_POSITIONS: readonly SubjectReferencePosition[] =
  [
    { group: 'document', path: ['concepts', '*', 'id'], form: 'declaration' },
    { group: 'document', path: ['concepts', '*', 'owner'], form: 'reference' },
    {
      group: 'document',
      path: ['concepts', '*', 'distinctFrom', '*'],
      form: 'reference',
    },
    {
      group: 'document',
      path: ['concepts', '*', 'supersedes', '*'],
      form: 'reference',
    },
    // The scoped succession form, `{ subject, inRespectOf }` (ADR 0109). A
    // rename has to move this one too, or a scoped succession would silently
    // keep pointing at the old address while the bare form beside it moved.
    {
      group: 'document',
      path: ['concepts', '*', 'supersedes', '*', 'subject'],
      form: 'reference',
    },
    {
      group: 'document',
      path: ['concepts', '*', 'constraints', '*', 'ref'],
      form: 'reference',
    },
    {
      group: 'document',
      path: ['concepts', '*', 'references', '*', 'ref'],
      form: 'reference',
    },
    {
      group: 'document',
      path: ['concepts', '*', 'attestations', '*', 'by'],
      form: 'reference',
    },
    {
      group: 'document',
      path: ['relationships', '*', 'id'],
      form: 'declaration',
    },
    {
      group: 'document',
      path: ['relationships', '*', 'from'],
      form: 'reference',
    },
    { group: 'document', path: ['relationships', '*', 'to'], form: 'reference' },
    {
      group: 'document',
      path: ['relationships', '*', 'references', '*', 'ref'],
      form: 'reference',
    },
    {
      group: 'projection',
      path: ['query', 'subjects', '*'],
      form: 'qualified',
    },
    {
      group: 'projection',
      path: ['query', 'exclude', '*'],
      form: 'qualified',
    },
    { group: 'projection', path: ['query', 'owners', '*'], form: 'qualified' },
    {
      group: 'projection',
      path: ['query', 'constraints', '*'],
      form: 'qualified',
    },
    {
      group: 'evidence',
      path: ['observations', '*', 'subject'],
      form: 'qualified',
    },
    {
      group: 'evidence',
      path: ['observations', '*', 'claim'],
      form: 'qualified',
    },
    {
      group: 'adapter-mapping',
      path: ['mappings', '*', 'native'],
      form: 'qualified',
    },
  ]

/**
 * Positions that carry reference *syntax* but are not subject addresses, with
 * the reason. Kept as data because the schema-derived completeness test asserts
 * that the two lists together account for every reference-typed position: an
 * omission has to be argued for here rather than forgotten.
 */
export const EXCLUDED_REFERENCE_POSITIONS: readonly {
  readonly group: SubjectReferenceGroup
  readonly path: readonly string[]
  readonly reason: string
}[] = [
  {
    group: 'document',
    path: ['states', '*', 'after'],
    reason: 'architecture state address, a separate id space',
  },
  {
    group: 'document',
    path: ['concepts', '*', 'presentIn', '*'],
    reason: 'architecture state address, a separate id space',
  },
  {
    group: 'document',
    path: ['relationships', '*', 'presentIn', '*'],
    reason: 'architecture state address, a separate id space',
  },
  {
    group: 'projection',
    path: ['query', 'states', '*'],
    reason: 'architecture state address, a separate id space',
  },
  {
    group: 'document',
    path: ['concepts', '*', 'constraints', '*', 'expects', 'key'],
    reason: 'observation key: provider vocabulary, not an address',
  },
  {
    group: 'evidence',
    path: ['observations', '*', 'key'],
    reason: 'observation key: provider vocabulary, not an address',
  },
]

export interface SubjectReferenceHit {
  /** JSON pointer into the document, for diagnostics. */
  readonly pointer: string
  /** Qualified address with any `~aspect` suffix removed. */
  readonly address: string
  readonly form: SubjectReferenceForm
  /** Source offsets of the scalar's own bytes, quotes included. */
  readonly start: number
  readonly end: number
  /** The scalar exactly as written, quotes included. */
  readonly raw: string
}

export interface SubjectReferenceScan {
  /** The document's own id, `''` when it declares none. */
  readonly documentId: string
  readonly hits: readonly SubjectReferenceHit[]
  /**
   * Pointers at reference positions that hold an alias node. The walker cannot
   * re-point one, so a rename refuses rather than silently leaving it behind.
   */
  readonly aliases: readonly string[]
}

const qualify = (documentId: string, value: string): string =>
  value

const localOf = (qualified: string): string =>
  qualified.slice(qualified.indexOf('#') + 1)

/** Walks one position pattern and collects what it reaches. */
const collect = (
  node: unknown,
  path: readonly string[],
  pointer: string,
  form: SubjectReferenceForm,
  documentId: string,
  source: string,
  hits: SubjectReferenceHit[],
  aliases: string[],
): void => {
  if (path.length === 0) {
    if (isAlias(node)) {
      aliases.push(pointer)
      return
    }
    if (!isScalar(node) || typeof node.value !== 'string') return
    const range = node.range
    if (range === null || range === undefined) return
    const [start, end] = range
    const aspect = node.value.indexOf('~')
    const base = aspect === -1 ? node.value : node.value.slice(0, aspect)
    hits.push({
      pointer,
      address: form === 'qualified' ? base : qualify(documentId, base),
      form,
      start,
      end,
      raw: source.slice(start, end),
    })
    return
  }
  const [segment, ...rest] = path as [string, ...string[]]
  if (segment === '*') {
    if (!isSeq(node)) return
    for (const [index, item] of node.items.entries()) {
      collect(
        item,
        rest,
        `${pointer}/${index}`,
        form,
        documentId,
        source,
        hits,
        aliases,
      )
    }
    return
  }
  if (!isMap(node)) return
  collect(
    node.get(segment, true),
    rest,
    `${pointer}/${segment}`,
    form,
    documentId,
    source,
    hits,
    aliases,
  )
}

/**
 * Every subject address a file of this group holds. Pure read: the parse is
 * thrown away, so callers stay free to splice the original bytes.
 */
export const scanSubjectReferences = (
  source: string,
  group: SubjectReferenceGroup,
): SubjectReferenceScan => {
  const root = parseDocument(source).contents
  const id = isMap(root) ? root.get('id', true) : undefined
  const documentId =
    isScalar(id) && typeof id.value === 'string' ? id.value : ''
  const hits: SubjectReferenceHit[] = []
  const aliases: string[] = []
  for (const position of SUBJECT_REFERENCE_POSITIONS) {
    if (position.group !== group) continue
    collect(
      root,
      position.path,
      '',
      position.form,
      documentId,
      source,
      hits,
      aliases,
    )
  }
  return { documentId, hits, aliases }
}

export interface SubjectRename {
  /** Qualified address as declared today. */
  readonly from: string
  /** Qualified address it should have had; the document part never moves. */
  readonly to: string
}

export type SubjectRewriteResult =
  | {
      readonly ok: true
      readonly source: string
      /** Pointers this rewrite moved, in document order. */
      readonly moved: readonly string[]
    }
  | { readonly ok: false; readonly aliases: readonly string[] }

/** The quote character a scalar was written with, `''` when it was plain. */
const quoteOf = (raw: string): string =>
  (raw.startsWith("'") && raw.endsWith("'")) ||
  (raw.startsWith('"') && raw.endsWith('"'))
    ? raw[0]!
    : ''

/**
 * Re-points every reference to `rename.from` in one file. Only the matched
 * scalars' own bytes change - nothing is re-rendered, so byte identity holds
 * everywhere else, a bare reference stays bare, a qualified one stays
 * qualified, a `~aspect` suffix survives, and the original quoting is kept.
 */
export const rewriteSubjectReferences = (
  source: string,
  group: SubjectReferenceGroup,
  rename: SubjectRename,
): SubjectRewriteResult => {
  const scan = scanSubjectReferences(source, group)
  if (scan.aliases.length > 0) return { ok: false, aliases: scan.aliases }
  const matches = scan.hits.filter((hit) => hit.address === rename.from)
  if (matches.length === 0) return { ok: true, source, moved: [] }
  let rewritten = source
  // Back to front, so an earlier splice never shifts a later offset.
  const ordered = [...matches].sort((left, right) => right.start - left.start)
  for (const hit of ordered) {
    const quote = quoteOf(hit.raw)
    const written = quote === '' ? hit.raw : hit.raw.slice(1, -1)
    const aspect = written.indexOf('~')
    const suffix = aspect === -1 ? '' : written.slice(aspect)
    const moved = written.includes('#') ? rename.to : localOf(rename.to)
    rewritten =
      rewritten.slice(0, hit.start) +
      `${quote}${moved}${suffix}${quote}` +
      rewritten.slice(hit.end)
  }
  return {
    ok: true,
    source: rewritten,
    moved: matches.map((hit) => hit.pointer),
  }
}

/**
 * Local ids of the architecture states a document declares. States share the
 * `document#local` spelling with subjects but not the id space, so a rename
 * whose old or new id collides with one cannot be re-pointed unambiguously and
 * is refused instead.
 */
export const declaredStateIds = (source: string): readonly string[] => {
  const root = parseDocument(source).contents
  const states = isMap(root) ? root.get('states', true) : undefined
  if (!isSeq(states)) return []
  const ids: string[] = []
  for (const item of states.items) {
    if (!isMap(item)) continue
    const id = item.get('id', true)
    if (isScalar(id) && typeof id.value === 'string') ids.push(id.value)
  }
  return ids
}
