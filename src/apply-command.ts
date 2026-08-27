import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import Ajv2020Module from 'ajv/dist/2020.js'
import { loadAdapterMapping } from './adapter-mapping.js'
import {
  compileWorkspace,
  withDiagnosticSubjects,
  type Diagnostic,
  type WorkspaceSource,
} from './compiler.js'
import { evaluateEvidence, loadEvidence } from './evidence.js'
import { emitYaml } from './yaml-emission.js'
import { loadProjection } from './projection.js'
import {
  loadSourceDocument,
  locateSourcePath,
} from './source-document.js'
import {
  declaredStateIds,
  rewriteSubjectReferences,
  scanSubjectReferences,
  type SubjectReferenceGroup,
} from './subject-references.js'
import type { ResolvedWorkspace } from './workspace.js'
import {
  type PendingWrite,
  type SourceStore,
  type WriteConflict,
} from './source-store.js'

/**
 * The directory part of a workspace path, in the `/`-separated terms a
 * manifest is written in rather than the platform's.
 *
 * Both separators by hand rather than `node:path`'s `sep`: this module is
 * reachable from a browser (#252), where there is no platform separator to
 * ask about, and a manifest path is `/`-separated wherever it is read.
 */
export const posixDirectoryOf = (path: string): string => {
  const normalised = path.split(/[\\/]/).join('/')
  const cut = normalised.lastIndexOf('/')
  return cut === -1 ? '' : normalised.slice(0, cut)
}
import operationsSchema from '../schema/yarramate-operations.schema.json' with {
  type: 'json',
}

import type {
  ConceptFields,
  ConstraintReference,
  IdentifiedReference,
  ObservationTarget,
  OperationsDocument,
  RelationshipFields,
  YarramateApplyResult,
  YarramateOperation,
} from './operations.js'

// `.default ?? module`, not a bare `.default`: NodeNext sees the raw CJS
// `module.exports` and a bundler sees the unwrapped class, and this file is
// reachable from a browser through `./apply-operations.js` (#252).
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
// `discriminator` routes a batch entry to the single branch its `op` names, so
// one malformed operation reports one fault instead of ten near-misses.
const validateOperations = new Ajv2020({
  allErrors: true,
  discriminator: true,
}).compile(operationsSchema)

// Scalar fields replace; list fields append; `remove` retracts (ADR 0062).
// An answer enriches what is there and may explicitly take back what it
// asserted — it never silently shrinks anything.
const SCALAR_CONCEPT_FIELDS = ['kind', 'name', 'description', 'status', 'owner'] as const
const LIST_CONCEPT_FIELDS = ['aka', 'constraints', 'references', 'presentIn', 'attestations', 'distinctFrom', 'supersedes'] as const
const SCALAR_RELATIONSHIP_FIELDS = ['kind', 'from', 'to', 'name', 'description', 'status', 'mode', 'content'] as const
const LIST_RELATIONSHIP_FIELDS = ['references', 'presentIn'] as const
// An overlay entry's address is the pair (target, key); everything else it
// carries is editable. `uri` and `message` sit one level down, inside the
// entry's own `evidence:` mapping.
const SCALAR_OBSERVATION_FIELDS = ['result', 'value'] as const
const EVIDENCE_FIELDS = ['uri', 'message'] as const

// ---------------------------------------------------------------------------
// The splice layer. Every operation becomes a minimal text edit against the
// document's current source, so bytes the batch never touched stay
// byte-identical — an apply diff is exactly the answer it landed (#114).
// The atomic compile gate below validates the spliced text itself, so any
// splice defect rejects the batch loudly instead of corrupting a document.

const lineStartOf = (source: string, offset: number): number =>
  source.lastIndexOf('\n', offset - 1) + 1

const indentAt = (source: string, offset: number): number =>
  offset - lineStartOf(source, offset)

// End of the last line a node occupies, extended through its newline.
const lineEndAfter = (source: string, offset: number): number => {
  const newline = source.indexOf('\n', Math.max(offset - 1, 0))
  return newline === -1 ? source.length : newline + 1
}

const reindent = (text: string, indent: number): string =>
  text.split('\n').join(`\n${' '.repeat(indent)}`)

// A plain value as YAML source. lineWidth 0 keeps strings we author on one
// line; genuinely multi-line strings become block scalars and are re-indented
// by the caller.
const valueText = (value: unknown): string =>
  emitYaml(value, { lineWidth: 0 }).trimEnd()

const pairFor = (
  map: YAMLMap,
  key: string,
): Pair | undefined =>
  map.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === key,
  ) as Pair | undefined

const nodeRange = (node: unknown): readonly [number, number, number] => {
  const range = (node as { range?: readonly [number, number, number] }).range
  if (range === undefined) {
    throw new Error('YAML node has no source range')
  }
  return range
}

// Renders `items` as block sequence entries at the given marker indent.
const sequenceEntries = (
  items: readonly unknown[],
  markerIndent: number,
): string => {
  const rendered = emitYaml(items, { lineWidth: 0 }).trimEnd()
  return `${' '.repeat(markerIndent)}${reindent(rendered, markerIndent)}`
}

const splice = (
  source: string,
  start: number,
  end: number,
  text: string,
): string => source.slice(0, start) + text + source.slice(end)

// Replaces a *value* range, keeping whatever line break the original occupied.
//
// A block scalar's range ends after its terminating newline; a plain scalar's
// ends at its last character. Splicing the range wholesale therefore swallows
// the line break behind every `>-` and `|-` value and glues the following
// field onto its line, producing `description: new    status: current`, which
// then fails to reparse as YM101 "Nested mappings are not allowed in compact
// mappings" - a document `check` accepts that `apply` refuses (#215). Putting
// the original trailing newlines back makes the two scalar styles behave
// identically.
const spliceValue = (
  source: string,
  start: number,
  end: number,
  text: string,
): string =>
  splice(source, start, end, text + (/\n*$/.exec(source.slice(start, end))?.[0] ?? ''))

// Insert a newline-terminated block at a line boundary, tolerating a
// source that does not end in a newline.
const insertBlock = (
  source: string,
  insertAt: number,
  block: string,
): string =>
  splice(
    source,
    insertAt,
    insertAt,
    insertAt > 0 && source[insertAt - 1] !== '\n' ? `\n${block}` : block,
  )

// Node ranges may extend past their trailing newline to the start of the
// next line; anchor insertions on the last CONTENT line instead.
const afterContentLine = (source: string, offset: number): number => {
  let anchor = offset
  while (anchor > 0 && source[anchor - 1] === '\n') anchor -= 1
  return lineEndAfter(source, anchor)
}

// Where a new field of an item lands: after the last line of the item's
// final pair.
const itemFieldInsertAt = (source: string, map: YAMLMap): number => {
  const lastPair = map.items[map.items.length - 1]!
  const anchor =
    lastPair.value === null || lastPair.value === undefined
      ? nodeRange(lastPair.key)[2]
      : nodeRange(lastPair.value)[1]
  return afterContentLine(source, anchor)
}

// Appends one item to a top-level block collection (`concepts:`,
// `relationships:` or an overlay's `observations:`), creating or converting
// the collection when needed.
const appendCollectionItem = (
  source: string,
  collection: string,
  item: Readonly<Record<string, unknown>>,
): string => {
  const document = parseDocument(source)
  const root = document.contents
  if (!isMap(root)) throw new Error('Document root is not a mapping')
  const pair = pairFor(root, collection)
  if (pair === undefined) {
    const base = source.endsWith('\n') ? source : `${source}\n`
    return `${base}${collection}:\n${sequenceEntries([item], 2)}\n`
  }
  const sequence = pair.value
  if (isSeq(sequence) && !sequence.flow && sequence.items.length > 0) {
    const lastItem = sequence.items[sequence.items.length - 1]
    const markerIndent = indentAt(source, nodeRange(lastItem)[0]) - 2
    const insertAt = lineEndAfter(source, nodeRange(lastItem)[2])
    return insertBlock(
      source,
      insertAt,
      `${sequenceEntries([item], markerIndent)}\n`,
    )
  }
  if (!isSeq(sequence)) {
    // `concepts:` with no value at all: append the block under the key.
    const insertAt = lineEndAfter(source, nodeRange(pair.key)[2])
    return insertBlock(source, insertAt, `${sequenceEntries([item], 2)}\n`)
  }
  // Empty or flow collection: replace the whole value with a block
  // sequence carrying any existing entries plus the new one, consuming
  // the space that separated it from the key.
  const existing =
    sequence.items.length > 0
      ? (sequence.toJSON() as readonly unknown[])
      : []
  let [start] = nodeRange(sequence)
  const valueEnd = nodeRange(sequence)[1]
  while (start > 0 && source[start - 1] === ' ') start -= 1
  return splice(
    source,
    start,
    valueEnd,
    `\n${sequenceEntries([...existing, item], 2)}`,
  )
}

type ItemFields = Readonly<Record<string, unknown>>
type ItemMatcher = (fields: ItemFields) => boolean

const byId =
  (id: string): ItemMatcher =>
  (fields) =>
    fields.id === id

// An overlay entry has no `id`: it is addressed by the pair (target, key) -
// what `reconcile` already treats as unique per document (ADR 0075, and the
// YM803 duplicate-target diagnostic). A keyless address matches the keyless
// entry, the presence claim for that target, and never stands in for every
// key the target carries.
const byObservation =
  (target: ObservationTarget): ItemMatcher =>
  (fields) =>
    fields.subject === target.subject &&
    fields.claim === target.claim &&
    fields.key === target.key

const observationAddress = (target: ObservationTarget): string =>
  `"${target.subject ?? target.claim}"${target.key === undefined ? '' : ` (${target.key})`}`

const itemMatching = (
  source: string,
  collection: string,
  matches: ItemMatcher,
): { readonly map: YAMLMap; readonly sequence: YAMLSeq } | undefined => {
  const document = parseDocument(source)
  const root = document.contents
  if (!isMap(root)) return undefined
  const pair = pairFor(root, collection)
  if (pair === undefined || !isSeq(pair.value)) return undefined
  const sequence = pair.value as YAMLSeq
  const found = sequence.items.find(
    (candidate) => isMap(candidate) && matches((candidate as YAMLMap).toJSON() as ItemFields),
  )
  return found === undefined
    ? undefined
    : { map: found as YAMLMap, sequence }
}

const itemMap = (
  source: string,
  collection: string,
  id: string,
): { readonly map: YAMLMap; readonly sequence: YAMLSeq } | undefined =>
  itemMatching(source, collection, byId(id))

// An observation's locator is a mapping inside the entry; edits descend into
// it so a changed URI splices that one line rather than re-rendering the
// entry around it.
const nestedMap = (map: YAMLMap, key: string): YAMLMap | undefined => {
  const pair = pairFor(map, key)
  return pair !== undefined && isMap(pair.value) ? (pair.value as YAMLMap) : undefined
}

// The indent item fields sit at, read off the item's own first field.
const fieldIndentOf = (source: string, map: YAMLMap): number =>
  indentAt(source, nodeRange(map.items[0]!.key)[0])

// A flow-style item (`- { id: x, ... }`) cannot take block field lines;
// splicing them after it corrupts the sequence (Codex dogfood finding,
// 2026-08-01). The whole item is rewritten as a block mapping with the
// mutation applied — churn confined to the item being edited.
const rewriteFlowItem = (
  source: string,
  map: YAMLMap,
  mutate: (
    fields: Record<string, unknown>,
  ) => Record<string, unknown>,
): string => {
  const mutated = mutate(map.toJSON() as Record<string, unknown>)
  const [start, valueEnd] = nodeRange(map)
  const fieldIndent = indentAt(source, start)
  const rendered = reindent(
    emitYaml(mutated, { lineWidth: 0 }).trimEnd(),
    fieldIndent,
  )
  return splice(source, start, valueEnd, rendered)
}

const setScalarField = (
  source: string,
  map: YAMLMap,
  key: string,
  value: unknown,
): string => {
  if (map.flow) {
    return rewriteFlowItem(source, map, (fields) => ({
      ...fields,
      [key]: value,
    }))
  }
  const indent = fieldIndentOf(source, map)
  const rendered = reindent(valueText(value), indent + 2)
  const pair = pairFor(map, key)
  if (pair === undefined) {
    return insertBlock(
      source,
      itemFieldInsertAt(source, map),
      `${' '.repeat(indent)}${key}: ${rendered}\n`,
    )
  }
  const [start, valueEnd] = nodeRange(pair.value)
  return spliceValue(source, start, valueEnd, rendered)
}

const appendListField = (
  source: string,
  map: YAMLMap,
  key: string,
  additions: readonly unknown[],
): string => {
  if (map.flow) {
    return rewriteFlowItem(source, map, (fields) => ({
      ...fields,
      [key]: [
        ...((fields[key] as readonly unknown[] | undefined) ?? []),
        ...additions,
      ],
    }))
  }
  const indent = fieldIndentOf(source, map)
  const pair = pairFor(map, key)
  if (pair === undefined) {
    return insertBlock(
      source,
      itemFieldInsertAt(source, map),
      `${' '.repeat(indent)}${key}:\n${sequenceEntries(additions, indent + 2)}\n`,
    )
  }
  const sequence = pair.value
  if (isSeq(sequence) && !sequence.flow && sequence.items.length > 0) {
    const lastItem = sequence.items[sequence.items.length - 1]
    const markerIndent = indentAt(source, nodeRange(lastItem)[0]) - 2
    const insertAt = lineEndAfter(source, nodeRange(lastItem)[2])
    return insertBlock(
      source,
      insertAt,
      `${sequenceEntries(additions, markerIndent)}\n`,
    )
  }
  const existing =
    isSeq(sequence) && sequence.items.length > 0
      ? (sequence.toJSON() as readonly unknown[])
      : []
  const merged = [...existing, ...additions]
  const [start, valueEnd] = isSeq(sequence)
    ? nodeRange(sequence)
    : nodeRange(pair.value)
  if (isSeq(sequence) && sequence.flow) {
    const flow = emitYaml(merged, {
      collectionStyle: 'flow',
      lineWidth: 0,
    }).trimEnd()
    return splice(source, start, valueEnd, flow)
  }
  return spliceValue(
    source,
    start,
    valueEnd,
    `\n${sequenceEntries(merged, indent + 2)}`,
  )
}

// Retraction (#115): delete the field's whole entry, from the start of its
// key line through the end of its value's last line. A flow item is
// rewritten instead — line-based deletion there would take the whole item
// with it.
const removeField = (
  source: string,
  map: YAMLMap,
  key: string,
): string | undefined => {
  const pair = pairFor(map, key)
  if (pair === undefined) return undefined
  if (map.flow) {
    return rewriteFlowItem(source, map, (fields) => {
      const { [key]: _removed, ...rest } = fields
      return rest
    })
  }
  const start = lineStartOf(source, nodeRange(pair.key)[0])
  const valueEnd =
    pair.value === null || pair.value === undefined
      ? nodeRange(pair.key)[2]
      : nodeRange(pair.value)[2]
  return splice(source, start, lineEndAfter(source, valueEnd), '')
}

// Whole-subject deletion (#123): remove the exact authored item range,
// marker line included. Unlike field removal — where line deletion on a
// flow item would silently take the whole item (the 0.8.1 regression) —
// deleting the whole item is precisely the intent here, so flow-style
// items in a block sequence share the line-based path. An item inside a
// flow collection rewrites the collection value instead, and removing
// the last item leaves an explicit empty collection: the document
// schema requires the key.
const removeCollectionItem = (
  source: string,
  collection: string,
  matches: ItemMatcher,
): string => {
  const { map, sequence } = itemMatching(source, collection, matches)!
  if (sequence.flow) {
    const remaining = (sequence.toJSON() as readonly ItemFields[]).filter(
      (item) => !matches(item),
    )
    const [start, valueEnd] = nodeRange(sequence)
    return splice(
      source,
      start,
      valueEnd,
      remaining.length === 0
        ? '[]'
        : emitYaml(remaining, {
            collectionStyle: 'flow',
            lineWidth: 0,
          }).trimEnd(),
    )
  }
  // Node ranges may extend past the trailing newline to the next line
  // start; afterContentLine anchors the removal on the item's own last
  // content line.
  const end = afterContentLine(source, nodeRange(map)[2])
  if (sequence.items.length === 1) {
    let valueStart = nodeRange(sequence)[0]
    while (
      valueStart > 0 &&
      (source[valueStart - 1] === ' ' || source[valueStart - 1] === '\n')
    ) {
      valueStart -= 1
    }
    return splice(source, valueStart, end, ' []\n')
  }
  return splice(source, lineStartOf(source, nodeRange(map)[0]), end, '')
}

// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | {
      readonly ok: true
      /**
       * The documents this batch changed, for the caller to write. Core
       * returns them rather than writing them, so the store's comparison is
       * the last thing that happens before bytes land (ADR 0100).
       */
      readonly sources: readonly WorkspaceSource[]
      readonly result: YarramateApplyResult
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

// The programmatic core, split out of the CLI wrapper below so a long-lived
// caller (the visual session server) can apply a batch without shelling
// out. Takes raw sources rather than a parsed array so loadSourceDocument /
// locateSourcePath keep producing diagnostics whose pointers read
// `/operations/<i>/<field>` — that pointer is how a caller maps a rejection
// back onto whatever authored the operation. No shell-out, no temp files,
// no process access, no module-level mutable state: safe to call
// repeatedly and concurrently against different workspaces.
/**
 * Everything `applyOperations` is allowed to know. The workspace is already
 * resolved and the sources are already read, because Core does not reach for
 * either (ADR 0100).
 */
export interface ApplyInput {
  /** The workspace this batch is addressed to, already resolved. */
  readonly workspace: ResolvedWorkspace
  /** Every source that workspace resolves to, keyed by its manifest path. */
  readonly sources: readonly WorkspaceSource[]
  /** The operations document itself. */
  readonly operations: WorkspaceSource
  /**
   * Where the manifest sits relative to the paths in `workspace`, so an
   * operation may address a document the way the manifest names it as well as
   * the way the workspace lists it (#216). String arithmetic, not a lookup.
   */
  readonly manifestDirectory: string
}

export const applyOperations = (
  input: ApplyInput,
): ApplyOutcome => {
  const { workspace: resolvedWorkspace, operations } = input
  // Every source the workspace resolves to, by its manifest path. Core reads
  // nothing: what is not here does not exist as far as this function is
  // concerned, which is what lets the same code serve a filesystem, an object
  // store and a database row (ADR 0100).
  const held = new Map(
    input.sources.map((source) => [source.path, source.source]),
  )
  const sourceOf = (path: string): string => held.get(path) ?? ''
  const failed = (diagnostics: readonly Diagnostic[]): ApplyOutcome => ({
    ok: false,
    diagnostics,
  })
  const loadedOperations = loadSourceDocument<OperationsDocument>(
    operations,
    validateOperations,
    'Operations',
  )
  if (!loadedOperations.ok) return failed(loadedOperations.diagnostics)
  const operationList = loadedOperations.document.value.operations
  const yaml = loadedOperations.document.yaml
  const lineCounter = loadedOperations.document.lineCounter
  const operationsPath = operations.path

  // Documents are addressed by their manifest paths; an operation aimed
  // anywhere else is rejected before anything is touched.
  const workspaceDocuments = new Map(
    resolvedWorkspace.documents.map((path): [string, string] => [path, path]),
  )
  // Overlay entries live in the workspace's evidence documents, addressed the
  // same way. The two sets stay apart: a concept operation aimed at an
  // overlay — or an observation aimed at a compiler document — is rejected
  // before anything is touched.
  const workspaceEvidence = new Map(
    resolvedWorkspace.evidence.map((path): [string, string] => [path, path]),
  )
  // A rename re-points references, and references live in four kinds of file,
  // so the write set is wider than the two above. Projections and adapter
  // mappings are never an operation's own target — they are only ever carried
  // along by a rename — but they are written, so they carry their manifest
  // path for the touched-document list and their group for the walker.
  const referenceFiles: ReadonlyArray<{
    readonly path: string
    readonly group: SubjectReferenceGroup
  }> = (
    [
      ['document', resolvedWorkspace.documents],
      ['projection', resolvedWorkspace.projections],
      ['evidence', resolvedWorkspace.evidence],
      ['adapter-mapping', resolvedWorkspace.adapterMappings],
    ] as ReadonlyArray<readonly [SubjectReferenceGroup, readonly string[]]>
  ).flatMap(([group, paths]) =>
    paths.map((path) => ({ path, group })),
  )
  const referenceFileOf = new Map(
    referenceFiles.map((file) => [file.path, file]),
  )
  const candidates = new Map<string, string>()
  const counts = {
    addedConcepts: 0,
    addedRelationships: 0,
    updatedConcepts: 0,
    updatedRelationships: 0,
    deletedConcepts: 0,
    deletedRelationships: 0,
    renamedConcepts: 0,
    renamedRelationships: 0,
    addedObservations: 0,
    updatedObservations: 0,
    deletedObservations: 0,
  }
  const deletions: Array<{
    readonly index: number
    readonly absolute: string
    readonly id: string
  }> = []
  // Addresses this batch moved off, so the residue walk below can prove none of
  // them survived anywhere.
  const renames: Array<{ readonly index: number; readonly from: string }> = []
  const locateOperation = (
    index: number,
    message: string,
    code = 'YM912',
  ): Diagnostic => ({
    severity: 'error',
    code,
    message,
    ...locateSourcePath(
      operationsPath,
      yaml,
      lineCounter,
      ['operations', index, 'document'],
      `/operations/${index}/document`,
    ),
  })
  // An operation names its document either the way the manifest names it
  // (relative to the manifest directory) or the way diagnostics print it
  // (relative to the working directory). Resolving only against `cwd` refused
  // the manifest-relative form outright whenever the manifest did not sit in
  // the working directory - the standard `.yarramate/` layout - and made the
  // same operations document apply from one directory and fail from another
  // (#216). Both readings are tried, and only a path that actually names a
  // document of this workspace is accepted, so admitting the second form
  // cannot make an address ambiguous.
  // Both readings an author may write, as workspace paths. #216 accepted the
  // manifest-relative form; expressing it as arithmetic rather than as a
  // second resolution against the working directory is what ADR 0100 said this
  // seam was the place to collapse.
  const joinPosix = (base: string, path: string): string => {
    const segments = base === '' || base === '.' ? [] : base.split('/')
    for (const segment of path.split('/')) {
      if (segment === '' || segment === '.') continue
      if (segment === '..') segments.pop()
      else segments.push(segment)
    }
    return segments.join('/')
  }
  for (const [index, operation] of operationList.entries()) {
    const overlay = operation.op.endsWith('-observation')
    const known = overlay ? workspaceEvidence : workspaceDocuments
    const readings = [
      joinPosix(input.manifestDirectory, operation.document),
      joinPosix('', operation.document),
    ]
    const absolute = readings.find((reading) => known.has(reading)) ?? readings[1]!
    const manifestPath = known.get(absolute)
    const locate = (message: string): Diagnostic =>
      locateOperation(index, message)
    if (manifestPath === undefined) {
      const accepted = [...known.values()].sort()
      const shown = accepted.slice(0, 5)
      const remainder =
        accepted.length > shown.length
          ? ` and ${accepted.length - shown.length} more`
          : ''
      return failed([
        locate(
          `Operation ${index} targets "${operation.document}", which is not ${
            overlay ? 'an evidence document' : 'a document'
          } of workspace "${resolvedWorkspace.id}". This workspace declares ${
            accepted.length === 0
              ? 'none'
              : `${shown.map((path) => `"${path}"`).join(', ')}${remainder}`
          }`,
        ),
      ])
    }
    let source = candidates.get(absolute)
    if (source === undefined) {
      source = sourceOf(absolute)
    }
    if (operation.op === 'add-concept') {
      source = appendCollectionItem(
        source,
        'concepts',
        operation.concept as unknown as Readonly<Record<string, unknown>>,
      )
      counts.addedConcepts += 1
    } else if (operation.op === 'add-relationship') {
      source = appendCollectionItem(
        source,
        'relationships',
        operation.relationship as unknown as Readonly<Record<string, unknown>>,
      )
      counts.addedRelationships += 1
    } else if (
      operation.op === 'delete-concept' ||
      operation.op === 'delete-relationship'
    ) {
      const collection =
        operation.op === 'delete-concept' ? 'concepts' : 'relationships'
      const id =
        operation.op === 'delete-concept'
          ? operation.concept.id
          : operation.relationship.id
      if (itemMap(source, collection, id) === undefined) {
        return failed([
          locate(
            `Operation ${index} deletes "${id}", which does not exist in ${operation.document}`,
          ),
        ])
      }
      source = removeCollectionItem(source, collection, byId(id))
      deletions.push({ index, absolute, id })
      if (operation.op === 'delete-concept') {
        counts.deletedConcepts += 1
      } else {
        counts.deletedRelationships += 1
      }
    } else if (
      operation.op === 'rename-concept' ||
      operation.op === 'rename-relationship'
    ) {
      const collection =
        operation.op === 'rename-concept' ? 'concepts' : 'relationships'
      const id =
        operation.op === 'rename-concept'
          ? operation.concept.id
          : operation.relationship.id
      if (itemMap(source, collection, id) === undefined) {
        return failed([
          locate(
            `Operation ${index} renames "${id}", which does not exist in ${operation.document}`,
          ),
        ])
      }
      // A rename that does not move the address would report every reference to
      // it as residue below, which reads as a rewrite fault rather than what it
      // is. Nothing would be written either, so `renamedConcepts: 1` over an
      // empty document list would be a false receipt.
      if (operation.to === id) {
        return failed([
          locate(
            `Operation ${index} renames "${id}" to itself, so no address moves`,
          ),
        ])
      }
      // A state shares the `document#local` spelling with a subject but not the
      // id space. A collision on either end would make one address name two
      // things, so it is refused rather than re-pointed by guess.
      const states = declaredStateIds(source)
      const collision = states.includes(id)
        ? id
        : states.includes(operation.to)
          ? operation.to
          : undefined
      if (collision !== undefined) {
        return failed([
          locate(
            `Operation ${index} renames "${id}" to "${operation.to}", but ${operation.document} declares a state "${collision}" — one address would name two things`,
          ),
        ])
      }
      const { documentId } = scanSubjectReferences(source, 'document')
      const rename = {
        from: id,
        to: operation.to,
      }
      // Total within the workspace: the declaration and every declarative
      // reference to it move in this one batch, so nothing is left addressing an
      // id that stopped existing. Staged text is the input, so a second rename
      // in the same batch reads the first one's result.
      for (const file of referenceFiles) {
        const before =
          candidates.get(file.path) ?? sourceOf(file.path)
        const rewrite = rewriteSubjectReferences(before, file.group, rename)
        if (!rewrite.ok) {
          return failed([
            locate(
              `Operation ${index} cannot move "${rename.from}": ${
                file.path
              } holds ${
                rewrite.aliases.length === 1 ? 'an alias' : 'aliases'
              } at ${rewrite.aliases.join(', ')}, which the rewrite cannot re-point`,
            ),
          ])
        }
        if (rewrite.source !== before) {
          candidates.set(file.path, rewrite.source)
        }
      }
      // The target document's own declaration moved in that same walk, so the
      // staged text is the authority from here on.
      source = candidates.get(absolute) ?? source
      renames.push({ index, from: rename.from })
      if (operation.op === 'rename-concept') {
        counts.renamedConcepts += 1
      } else {
        counts.renamedRelationships += 1
      }
    } else if (operation.op === 'add-observation') {
      const address = observationAddress(operation.observation)
      const matches = byObservation(operation.observation)
      if (itemMatching(source, 'observations', matches) !== undefined) {
        return failed([
          locate(
            `Operation ${index} adds an observation of ${address}, which ${operation.document} already records`,
          ),
        ])
      }
      source = appendCollectionItem(
        source,
        'observations',
        operation.observation as unknown as ItemFields,
      )
      counts.addedObservations += 1
    } else if (operation.op === 'update-observation') {
      const target = operation.observation
      const address = observationAddress(target)
      const matches = byObservation(target)
      const removals = operation.remove ?? []
      if (removals.includes('message') && target.evidence?.message !== undefined) {
        return failed([
          locate(`Operation ${index} both sets and removes "message" on ${address}`),
        ])
      }
      if (itemMatching(source, 'observations', matches) === undefined) {
        return failed([
          locate(
            `Operation ${index} updates an observation of ${address}, which does not exist in ${operation.document}`,
          ),
        ])
      }
      const fields = target as unknown as ItemFields
      for (const key of SCALAR_OBSERVATION_FIELDS) {
        if (fields[key] === undefined) continue
        source = setScalarField(
          source,
          itemMatching(source, 'observations', matches)!.map,
          key,
          fields[key],
        )
      }
      for (const key of EVIDENCE_FIELDS) {
        const value = target.evidence?.[key]
        if (value === undefined) continue
        const locator = nestedMap(
          itemMatching(source, 'observations', matches)!.map,
          'evidence',
        )
        if (locator === undefined) {
          return failed([
            locate(
              `Operation ${index} updates the evidence of ${address}, which ${operation.document} does not record as a mapping`,
            ),
          ])
        }
        source = setScalarField(source, locator, key, value)
      }
      for (const key of removals) {
        const locator = nestedMap(
          itemMatching(source, 'observations', matches)!.map,
          'evidence',
        )
        // Annotated: without it the assignment below feeds `source` back
        // into its own inferred type through this call.
        const removed: string | undefined =
          locator === undefined ? undefined : removeField(source, locator, key)
        if (removed === undefined) {
          return failed([
            locate(`Operation ${index} removes "${key}", which is not set on ${address}`),
          ])
        }
        source = removed
      }
      counts.updatedObservations += 1
    } else if (operation.op === 'delete-observation') {
      const address = observationAddress(operation.observation)
      const matches = byObservation(operation.observation)
      if (itemMatching(source, 'observations', matches) === undefined) {
        return failed([
          locate(
            `Operation ${index} deletes an observation of ${address}, which does not exist in ${operation.document}`,
          ),
        ])
      }
      // An overlay entry is nobody's reference target, so unlike a concept
      // deletion this stages no reference-integrity check.
      source = removeCollectionItem(source, 'observations', matches)
      counts.deletedObservations += 1
    } else {
      const collection =
        operation.op === 'update-concept' ? 'concepts' : 'relationships'
      const payload = (
        operation.op === 'update-concept'
          ? operation.concept
          : operation.relationship
      ) as unknown as Readonly<Record<string, unknown>>
      const scalars: readonly string[] =
        operation.op === 'update-concept'
          ? SCALAR_CONCEPT_FIELDS
          : SCALAR_RELATIONSHIP_FIELDS
      const lists: readonly string[] =
        operation.op === 'update-concept'
          ? LIST_CONCEPT_FIELDS
          : LIST_RELATIONSHIP_FIELDS
      const id = payload.id as string
      const removals = operation.remove ?? []
      const contradiction = removals.find(
        (key) => payload[key] !== undefined,
      )
      if (contradiction !== undefined) {
        return failed([
          locate(
            `Operation ${index} both sets and removes "${contradiction}" on "${id}"`,
          ),
        ])
      }
      const located = itemMap(source, collection, id)
      if (located === undefined) {
        return failed([
          locate(
            `Operation ${index} updates "${id}", which does not exist in ${operation.document}`,
          ),
        ])
      }
      for (const key of scalars) {
        if (payload[key] === undefined) continue
        source = setScalarField(
          source,
          itemMap(source, collection, id)!.map,
          key,
          payload[key],
        )
      }
      for (const key of lists) {
        const additions = payload[key] as readonly unknown[] | undefined
        if (additions === undefined || additions.length === 0) continue
        source = appendListField(
          source,
          itemMap(source, collection, id)!.map,
          key,
          additions,
        )
      }
      for (const key of removals) {
        const removed = removeField(
          source,
          itemMap(source, collection, id)!.map,
          key,
        )
        if (removed === undefined) {
          return failed([
            locate(
              `Operation ${index} removes "${key}", which is not set on "${id}"`,
            ),
          ])
        }
        source = removed
      }
      if (operation.op === 'update-concept') {
        counts.updatedConcepts += 1
      } else {
        counts.updatedRelationships += 1
      }
    }
    candidates.set(absolute, source)
  }

  // Reference integrity for deletes (#123), evaluated against the
  // post-batch state: stage everything first, then look, so a concept
  // deleted together with its referring relationships in one batch
  // succeeds while a target anything still points at rejects the
  // whole batch. Referring sites are relationship endpoints, owner,
  // constraint and identified references; projection selectors are
  // deliberately unchecked — they tolerate no-match by design. The
  // compile gate below stays the backstop.
  if (deletions.length > 0) {
    interface ReferringSite {
      readonly ref: string
      readonly subject: string
      readonly field: string
    }
    const staged = resolvedWorkspace.documents.map((path) => {
      return {
        absolute: path,
        value: parseDocument(
          candidates.get(path) ?? sourceOf(path),
        ).toJSON() as {
          readonly id?: string
          readonly concepts?: readonly ConceptFields[]
          readonly relationships?: readonly RelationshipFields[]
        } | null,
      }
    })
    const qualify = (documentId: string, reference: string): string =>
      reference
    const referrers: ReferringSite[] = staged.flatMap(({ value }) => {
      const documentId = value?.id
      if (documentId === undefined) return []
      const sites: ReferringSite[] = []
      for (const concept of value?.concepts ?? []) {
        const subject = concept.id
        if (concept.owner !== undefined) {
          sites.push({
            ref: qualify(documentId, concept.owner),
            subject,
            field: 'owner',
          })
        }
        for (const constraint of concept.constraints ?? []) {
          sites.push({
            ref: qualify(documentId, constraint.ref),
            subject,
            field: 'constraints',
          })
        }
        for (const reference of concept.references ?? []) {
          sites.push({
            ref: qualify(documentId, reference.ref),
            subject,
            field: 'references',
          })
        }
      }
      for (const relationship of value?.relationships ?? []) {
        const subject = relationship.id
        for (const endpoint of ['from', 'to'] as const) {
          const reference = relationship[endpoint]
          if (reference !== undefined) {
            sites.push({
              ref: qualify(documentId, reference),
              subject,
              field: endpoint,
            })
          }
        }
        for (const reference of relationship.references ?? []) {
          sites.push({
            ref: qualify(documentId, reference.ref),
            subject,
            field: 'references',
          })
        }
      }
      return sites
    })
    const documentIds = new Map(
      staged.map(({ absolute, value }) => [absolute, value?.id]),
    )
    const violations = deletions.flatMap((deletion) => {
      const documentId = documentIds.get(deletion.absolute)
      if (documentId === undefined) return []
      const target = deletion.id
      const referring = referrers.filter((site) => site.ref === target)
      if (referring.length === 0) return []
      return [
        locateOperation(
          deletion.index,
          `Operation ${deletion.index} deletes "${deletion.id}", which is still referenced by ${referring
            .map((site) => `"${site.subject}" (${site.field})`)
            .join(', ')}`,
        ),
      ]
    })
    if (violations.length > 0) return failed(violations)
  }

  // The atomic gate: the whole candidate workspace must compile before a
  // single byte is written; any diagnostic rejects the entire batch.
  const compiled = [
    ...resolvedWorkspace.profiles,
    // Without patterns this gate compiles a workspace the manifest does not
    // describe, so every commit against a workspace holding pattern instances
    // was refused with YM419 for a pattern that was declared (#268).
    ...resolvedWorkspace.patterns,
    ...resolvedWorkspace.documents,
  ].map((path) => ({
    path,
    source: candidates.get(path) ?? sourceOf(path),
  }))
  const compilation = compileWorkspace(compiled)
  // Subjects are derived here, against the sources this compile was shown,
  // because these are the only bytes whose array indices the pointers agree
  // with. A caller that derives them later reads the documents on disk, and a
  // refused batch never wrote to those: a subject the batch added sits past the
  // end of the authored array and resolves to nothing, so a canvas marks
  // nothing; and a batch that also deleted one shifts every index below it, so
  // the refusal names a subject the reviewer never touched while the one at
  // fault shows clean. Neither is a refusal a reviewer can act on (ADR 0102).
  if (!compilation.ok) {
    return failed(withDiagnosticSubjects(compilation.diagnostics, compiled))
  }

  // The overlay gate: an observation the batch authored must load and must
  // evaluate against the graph the batch just proved compiles, so an entry
  // naming a subject that does not exist is rejected here rather than
  // discovered later by `reconcile`. Only touched overlays are evaluated —
  // pre-existing drift elsewhere is reconcile's report to make, not this
  // batch's failure.
  for (const [absolute, path] of workspaceEvidence) {
    const source = candidates.get(absolute)
    if (source === undefined) continue
    const loaded = loadEvidence({ path, source })
    if (!loaded.ok) return failed(loaded.diagnostics)
    const evaluation = evaluateEvidence(compilation.graph, loaded.evidence)
    if (!evaluation.ok) return failed(evaluation.diagnostics)
  }

  // Totality is checked, not trusted: no file this batch touched may still name
  // an address a rename moved off. A splice that landed text re-parsing to the
  // old value refuses here rather than shipping a reference to an id that
  // stopped existing. A position the enumeration omits is invisible to this
  // walk - the schema-derived completeness test is what covers that.
  if (renames.length > 0) {
    const movedFrom = new Map(renames.map(({ from, index }) => [from, index]))
    const residue = referenceFiles.flatMap((file) => {
      const source = candidates.get(file.path)
      if (source === undefined) return []
      return scanSubjectReferences(source, file.group)
        .hits.filter((hit) => movedFrom.has(hit.address))
        .map((hit) => {
          const index = movedFrom.get(hit.address)!
          return locateOperation(
            index,
            `Operation ${index} moved "${hit.address}", but ${file.path} still names it at ${hit.pointer}`,
            'YM913',
          )
        })
    })
    if (residue.length > 0) return failed(residue)
  }

  // Projections and adapter mappings are not `compileWorkspace` input, so a
  // rewrite that produced an unreadable address is caught here rather than by
  // the next command to read the file.
  for (const file of referenceFiles) {
    const source = candidates.get(file.path)
    if (source === undefined) continue
    if (file.group === 'projection') {
      const loaded = loadProjection({ path: file.path, source })
      if (!loaded.ok) return failed(loaded.diagnostics)
    } else if (file.group === 'adapter-mapping') {
      const loaded = loadAdapterMapping({ path: file.path, source })
      if (!loaded.ok) return failed(loaded.diagnostics)
    }
  }

  // Nothing is written. The caller pairs each of these with the revision it
  // read and hands the batch to a store, which is where the comparison that
  // decides whether it lands belongs (ADR 0100).
  const written = [...candidates]
    .map(([path, source]) => ({ path, source }))
    .sort((left, right) => (left.path < right.path ? -1 : 1))
  const touched = written.map((source) => source.path)
  return {
    ok: true,
    sources: written,
    result: {
      format: 'yarramate/apply-result/v1',
      workspace: resolvedWorkspace.id,
      applied: counts,
      documents: touched,
    },
  }
}


export type PlannedOperations =
  | {
      readonly ok: true
      readonly outcome: ApplyOutcome & { readonly ok: true }
      /** What this batch would write, unwritten. Empty when it changes nothing. */
      readonly writes: readonly PendingWrite[]
    }
  | { readonly ok: false; readonly outcome: ApplyOutcome & { readonly ok: false } }

/**
 * Reads a workspace through a store and applies a batch, stopping short of
 * writing (ADR 0100).
 *
 * Separated from {@link landOperations} because a caller may have writes of
 * its own to land in the same batch: the visual runtime commits a projection
 * beside the model it belongs to, and one `writeAll` is what makes the two
 * arrive together or not at all (ADR 0103). A caller with nothing to add wants
 * `landOperations` and should not see this.
 */
export const planOperations = (
  store: SourceStore,
  input: {
    readonly workspace: ResolvedWorkspace
    readonly operations: WorkspaceSource
    readonly manifestDirectory: string
  },
): PlannedOperations => {
  const revisions = new Map<string, string>()
  const sources: WorkspaceSource[] = []
  for (const path of [
    // Profiles included, because `applyOperations` reads NOTHING: a source it
    // is not handed does not exist as far as it is concerned, and it compiles
    // the candidate workspace from `[...profiles, ...documents]`. Leaving them
    // out handed the compiler an empty string where a profile should be, which
    // parses to `null` and is not a document at all - every commit against a
    // workspace that declares a profile died on it. No operation can target a
    // profile, so they are read to be COMPILED against, never to be written.
    ...input.workspace.profiles,
    // Patterns are compiled against too, and are no more writable than a
    // profile: no operation can target one.
    ...input.workspace.patterns,
    ...input.workspace.documents,
    ...input.workspace.projections,
    ...input.workspace.evidence,
    ...input.workspace.adapterMappings,
  ]) {
    const stored = store.read(path)
    if (stored === undefined) continue
    revisions.set(path, stored.revision)
    sources.push({ path, source: stored.source })
  }

  const outcome = applyOperations({
    workspace: input.workspace,
    sources,
    operations: input.operations,
    manifestDirectory: input.manifestDirectory,
  })
  if (!outcome.ok) return { ok: false, outcome }

  // A document Core rewrote must still hold what Core was shown. One it
  // created must still not be there. There is no third case: a batch that
  // vouches for nothing would buy back the unconditional write by omission.
  return {
    ok: true,
    outcome,
    writes: outcome.sources.map((source) => ({
      path: source.path,
      source: source.source,
      expected: revisions.get(source.path) ?? null,
    })),
  }
}

/**
 * The diagnostics a refused `writeAll` becomes, in the workspace range
 * (ADR 0100). Shared so a caller that merges writes of its own into the batch
 * reports a conflict the same way the CLI does.
 */
export const writeConflictDiagnostics = (
  conflicts: readonly WriteConflict[],
  operationsPath: string,
): readonly Diagnostic[] =>
  conflicts.map((conflict) => ({
    severity: 'error' as const,
    code: conflict.reason === 'exists' ? 'YM705' : 'YM704',
    message:
      conflict.reason === 'exists'
        ? `Document "${conflict.path}" already exists; this batch expected to create it`
        : conflict.reason === 'missing'
          ? `Document "${conflict.path}" no longer exists; this batch was staged against it`
          : `Document "${conflict.path}" changed after this batch was staged`,
    path: operationsPath,
    // The conflict is about the batch rather than about any one line of it:
    // the operation that named the document is not what went wrong.
    pointer: '/',
    line: 1,
    column: 1,
  }))

/**
 * Reads a workspace through a store, applies a batch, and writes what changed
 * back only if every document still holds what was read (ADR 0100).
 *
 * This is the composition Core deliberately does not perform: `applyOperations`
 * is a pure function, and the comparison that decides whether a batch lands
 * belongs to the store.
 */
export const landOperations = (
  store: SourceStore,
  input: {
    readonly workspace: ResolvedWorkspace
    readonly operations: WorkspaceSource
    readonly manifestDirectory: string
  },
): ApplyOutcome => {
  const planned = planOperations(store, input)
  if (!planned.ok) return planned.outcome
  if (planned.writes.length === 0) return planned.outcome

  const written = store.writeAll(planned.writes)
  if (written.ok) return planned.outcome

  return {
    ok: false,
    diagnostics: writeConflictDiagnostics(
      written.conflicts,
      input.operations.path,
    ),
  }
}
