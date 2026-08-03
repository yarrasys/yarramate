import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import { compileWorkspace, type Diagnostic } from './compiler.js'
import {
  loadSourceDocument,
  locateSourcePath,
} from './source-document.js'
import { loadWorkspaceManifest } from './workspace.js'
import operationsSchema from '../schema/yarramate-operations.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateOperations = new Ajv2020({ allErrors: true }).compile(
  operationsSchema,
)

interface IdentifiedReference {
  readonly id: string
  readonly ref: string
}

interface ConceptFields {
  readonly id: string
  readonly kind?: string
  readonly name?: string
  readonly description?: string
  readonly status?: string
  readonly owner?: string
  readonly constraints?: readonly IdentifiedReference[]
  readonly references?: readonly IdentifiedReference[]
  readonly presentIn?: readonly string[]
  readonly attestations?: ReadonlyArray<{
    readonly topic: string
    readonly by: string
    readonly on: string
  }>
}

interface RelationshipFields {
  readonly id: string
  readonly kind?: string
  readonly from?: string
  readonly to?: string
  readonly name?: string
  readonly description?: string
  readonly status?: string
  readonly mode?: string
  readonly content?: string
  readonly references?: readonly IdentifiedReference[]
  readonly presentIn?: readonly string[]
}

type Operation =
  | { readonly op: 'add-concept'; readonly document: string; readonly concept: ConceptFields }
  | { readonly op: 'add-relationship'; readonly document: string; readonly relationship: RelationshipFields }
  | {
      readonly op: 'update-concept'
      readonly document: string
      readonly concept: ConceptFields
      readonly remove?: readonly string[]
    }
  | {
      readonly op: 'update-relationship'
      readonly document: string
      readonly relationship: RelationshipFields
      readonly remove?: readonly string[]
    }
  | {
      readonly op: 'delete-concept'
      readonly document: string
      readonly concept: { readonly id: string }
    }
  | {
      readonly op: 'delete-relationship'
      readonly document: string
      readonly relationship: { readonly id: string }
    }

interface OperationsDocument {
  readonly format: 'yarramate/operations/v1'
  readonly operations: readonly Operation[]
}

// Scalar fields replace; list fields append; `remove` retracts (ADR 0062).
// An answer enriches what is there and may explicitly take back what it
// asserted — it never silently shrinks anything.
const SCALAR_CONCEPT_FIELDS = ['kind', 'name', 'description', 'status', 'owner'] as const
const LIST_CONCEPT_FIELDS = ['constraints', 'references', 'presentIn', 'attestations'] as const
const SCALAR_RELATIONSHIP_FIELDS = ['kind', 'from', 'to', 'name', 'description', 'status', 'mode', 'content'] as const
const LIST_RELATIONSHIP_FIELDS = ['references', 'presentIn'] as const

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
  stringify(value, { lineWidth: 0 }).trimEnd()

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
  const rendered = stringify(items, { lineWidth: 0 }).trimEnd()
  return `${' '.repeat(markerIndent)}${reindent(rendered, markerIndent)}`
}

const splice = (
  source: string,
  start: number,
  end: number,
  text: string,
): string => source.slice(0, start) + text + source.slice(end)

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

// Appends one item to a top-level block collection (`concepts:` or
// `relationships:`), creating or converting the collection when needed.
const appendCollectionItem = (
  source: string,
  collection: 'concepts' | 'relationships',
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

const itemMap = (
  source: string,
  collection: string,
  id: string,
): { readonly map: YAMLMap; readonly sequence: YAMLSeq } | undefined => {
  const document = parseDocument(source)
  const root = document.contents
  if (!isMap(root)) return undefined
  const pair = pairFor(root, collection)
  if (pair === undefined || !isSeq(pair.value)) return undefined
  const sequence = pair.value as YAMLSeq
  const found = sequence.items.find(
    (candidate) =>
      isMap(candidate) &&
      (candidate as YAMLMap).items.some(
        (field) =>
          isScalar(field.key) &&
          field.key.value === 'id' &&
          isScalar(field.value) &&
          field.value.value === id,
      ),
  )
  return found === undefined
    ? undefined
    : { map: found as YAMLMap, sequence }
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
    stringify(mutated, { lineWidth: 0 }).trimEnd(),
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
  return splice(source, start, valueEnd, rendered)
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
    const flow = stringify(merged, {
      collectionStyle: 'flow',
      lineWidth: 0,
    }).trimEnd()
    return splice(source, start, valueEnd, flow)
  }
  return splice(
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
  collection: 'concepts' | 'relationships',
  id: string,
): string => {
  const { map, sequence } = itemMap(source, collection, id)!
  if (sequence.flow) {
    const remaining = (
      sequence.toJSON() as ReadonlyArray<Readonly<Record<string, unknown>>>
    ).filter((item) => item.id !== id)
    const [start, valueEnd] = nodeRange(sequence)
    return splice(
      source,
      start,
      valueEnd,
      remaining.length === 0
        ? '[]'
        : stringify(remaining, {
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

export function runApplyCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const rest = options.filter((option) => option !== '--json')
  const [operationsPath, workspacePath] = rest
  if (
    rest.length !== 2 ||
    operationsPath === undefined ||
    workspacePath === undefined ||
    rest.some((option) => option.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(resolve(cwd, workspacePath), 'utf8')
    if (
      parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'apply requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: json ? diagnosticJson(diagnostics) : humanDiagnostics(diagnostics),
      stderr: '',
    })
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace

    const operationsSource = readFileSync(resolve(cwd, operationsPath), 'utf8')
    const loadedOperations = loadSourceDocument<OperationsDocument>(
      { path: operationsPath, source: operationsSource },
      validateOperations,
      'Operations',
    )
    if (!loadedOperations.ok) return failed(loadedOperations.diagnostics)
    const operations = loadedOperations.document.value.operations
    const yaml = loadedOperations.document.yaml
    const lineCounter = loadedOperations.document.lineCounter

    // Documents are addressed by their manifest paths; an operation aimed
    // anywhere else is rejected before anything is touched.
    const workspaceDocuments = new Map(
      workspace.documents.map((path) => [resolve(cwd, path), path]),
    )
    const candidates = new Map<string, string>()
    const counts = {
      addedConcepts: 0,
      addedRelationships: 0,
      updatedConcepts: 0,
      updatedRelationships: 0,
      deletedConcepts: 0,
      deletedRelationships: 0,
    }
    const deletions: Array<{
      readonly index: number
      readonly absolute: string
      readonly id: string
    }> = []
    const locateOperation = (index: number, message: string): Diagnostic => ({
      severity: 'error',
      code: 'YM912',
      message,
      ...locateSourcePath(
        operationsPath,
        yaml,
        lineCounter,
        ['operations', index, 'document'],
        `/operations/${index}/document`,
      ),
    })
    for (const [index, operation] of operations.entries()) {
      const absolute = resolve(cwd, operation.document)
      const manifestPath = workspaceDocuments.get(absolute)
      const locate = (message: string): Diagnostic =>
        locateOperation(index, message)
      if (manifestPath === undefined) {
        return failed([
          locate(
            `Operation ${index} targets "${operation.document}", which is not a document of workspace "${workspace.id}"`,
          ),
        ])
      }
      let source = candidates.get(absolute)
      if (source === undefined) {
        source = readFileSync(absolute, 'utf8')
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
        source = removeCollectionItem(source, collection, id)
        deletions.push({ index, absolute, id })
        if (operation.op === 'delete-concept') {
          counts.deletedConcepts += 1
        } else {
          counts.deletedRelationships += 1
        }
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
      const staged = workspace.documents.map((path) => {
        const absolute = resolve(cwd, path)
        return {
          absolute,
          value: parseDocument(
            candidates.get(absolute) ?? readFileSync(absolute, 'utf8'),
          ).toJSON() as {
            readonly id?: string
            readonly concepts?: readonly ConceptFields[]
            readonly relationships?: readonly RelationshipFields[]
          } | null,
        }
      })
      const qualify = (documentId: string, reference: string): string =>
        reference.includes('#') ? reference : `${documentId}#${reference}`
      const referrers: ReferringSite[] = staged.flatMap(({ value }) => {
        const documentId = value?.id
        if (documentId === undefined) return []
        const sites: ReferringSite[] = []
        for (const concept of value?.concepts ?? []) {
          const subject = `${documentId}#${concept.id}`
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
          const subject = `${documentId}#${relationship.id}`
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
        const target = `${documentId}#${deletion.id}`
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
    const compilation = compileWorkspace(
      [...workspace.profiles, ...workspace.documents].map((path) => {
        const absolute = resolve(cwd, path)
        return {
          path,
          source: candidates.get(absolute) ?? readFileSync(absolute, 'utf8'),
        }
      }),
    )
    if (!compilation.ok) return failed(compilation.diagnostics)

    for (const [absolute, source] of candidates) {
      writeFileSync(absolute, source, 'utf8')
    }
    const touched = [...candidates.keys()]
      .map((absolute) => workspaceDocuments.get(absolute)!)
      .sort()
    if (json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(
          {
            format: 'yarramate/apply-result/v1',
            workspace: workspace.id,
            applied: counts,
            documents: touched,
          },
          null,
          2,
        )}\n`,
        stderr: '',
      }
    }
    const applied =
      counts.addedConcepts +
      counts.addedRelationships +
      counts.updatedConcepts +
      counts.updatedRelationships +
      counts.deletedConcepts +
      counts.deletedRelationships
    return {
      exitCode: 0,
      stdout: `Applied ${applied} operation${applied === 1 ? '' : 's'} to ${touched.join(', ')}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
