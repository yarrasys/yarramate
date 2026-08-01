import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isSeq, parseDocument, type Document } from 'yaml'
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
  | { readonly op: 'update-concept'; readonly document: string; readonly concept: ConceptFields }
  | { readonly op: 'update-relationship'; readonly document: string; readonly relationship: RelationshipFields }

interface OperationsDocument {
  readonly format: 'yarramate/operations/v1'
  readonly operations: readonly Operation[]
}

// Scalar fields replace; list fields append. An answer enriches what is
// there — it never silently shrinks it (removals stay Git edits).
const SCALAR_CONCEPT_FIELDS = ['kind', 'name', 'description', 'status', 'owner'] as const
const LIST_CONCEPT_FIELDS = ['constraints', 'references', 'presentIn', 'attestations'] as const
const SCALAR_RELATIONSHIP_FIELDS = ['kind', 'from', 'to', 'name', 'description', 'status', 'mode', 'content'] as const
const LIST_RELATIONSHIP_FIELDS = ['references', 'presentIn'] as const

const appendBlockItem = (
  document: Document,
  collection: 'concepts' | 'relationships',
  item: Readonly<Record<string, unknown>>,
) => {
  document.addIn([collection], item)
  const sequence = document.getIn([collection], true)
  if (isSeq(sequence)) {
    sequence.flow = false
  }
}

const findItem = (document: Document, collection: string, id: string) => {
  const sequence = document.get(collection, true)
  if (!isSeq(sequence)) return undefined
  return sequence.items.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'get' in item &&
      (item as { get(key: string): unknown }).get('id') === id,
  ) as { get(key: string, keepScalar?: boolean): unknown; set(key: string, value: unknown): void } | undefined
}

const applyFields = (
  document: Document,
  item: { get(key: string): unknown; set(key: string, value: unknown): void },
  fields: Readonly<Record<string, unknown>>,
  scalars: readonly string[],
  lists: readonly string[],
) => {
  for (const key of scalars) {
    if (fields[key] !== undefined) item.set(key, fields[key])
  }
  for (const key of lists) {
    const additions = fields[key] as readonly unknown[] | undefined
    if (additions === undefined || additions.length === 0) continue
    const existing = item.get(key)
    if (existing === undefined) {
      item.set(key, additions)
    } else if (isSeq(existing)) {
      for (const entry of additions) {
        existing.items.push(document.createNode(entry))
      }
    }
  }
}

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
    const parsed = new Map<string, Document>()
    const counts = {
      addedConcepts: 0,
      addedRelationships: 0,
      updatedConcepts: 0,
      updatedRelationships: 0,
    }
    for (const [index, operation] of operations.entries()) {
      const absolute = resolve(cwd, operation.document)
      const manifestPath = workspaceDocuments.get(absolute)
      const locate = (message: string): Diagnostic => ({
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
      if (manifestPath === undefined) {
        return failed([
          locate(
            `Operation ${index} targets "${operation.document}", which is not a document of workspace "${workspace.id}"`,
          ),
        ])
      }
      let document = parsed.get(absolute)
      if (document === undefined) {
        document = parseDocument(readFileSync(absolute, 'utf8'))
        parsed.set(absolute, document)
      }
      if (operation.op === 'add-concept') {
        appendBlockItem(
          document,
          'concepts',
          operation.concept as unknown as Readonly<Record<string, unknown>>,
        )
        counts.addedConcepts += 1
      } else if (operation.op === 'add-relationship') {
        appendBlockItem(
          document,
          'relationships',
          operation.relationship as unknown as Readonly<Record<string, unknown>>,
        )
        counts.addedRelationships += 1
      } else {
        const collection =
          operation.op === 'update-concept' ? 'concepts' : 'relationships'
        const payload =
          operation.op === 'update-concept'
            ? operation.concept
            : operation.relationship
        const item = findItem(document, collection, payload.id)
        if (item === undefined) {
          return failed([
            locate(
              `Operation ${index} updates "${payload.id}", which does not exist in ${operation.document}`,
            ),
          ])
        }
        applyFields(
          document,
          item,
          payload as unknown as Readonly<Record<string, unknown>>,
          operation.op === 'update-concept'
            ? SCALAR_CONCEPT_FIELDS
            : SCALAR_RELATIONSHIP_FIELDS,
          operation.op === 'update-concept'
            ? LIST_CONCEPT_FIELDS
            : LIST_RELATIONSHIP_FIELDS,
        )
        if (operation.op === 'update-concept') {
          counts.updatedConcepts += 1
        } else {
          counts.updatedRelationships += 1
        }
      }
    }

    // The atomic gate: the whole candidate workspace must compile before a
    // single byte is written; any diagnostic rejects the entire batch.
    const candidates = new Map(
      [...parsed.entries()].map(([absolute, document]) => [
        absolute,
        document.toString({ lineWidth: 0 }),
      ]),
    )
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
    const touched = [...parsed.keys()]
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
      counts.updatedRelationships
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
