import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020Module from 'ajv/dist/2020.js'
import {
  describeSchemaViolation,
  readableSchemaErrors,
} from '../../source-document.js'
import visualDiagnosticResultSchema from '../../../schema/yarramate-visual-diagnostic-result.schema.json' with {
  type: 'json',
}
import visualEventSchema from '../../../schema/yarramate-visual-event.schema.json' with {
  type: 'json',
}
import visualGraphSchema from '../../../schema/yarramate-visual-graph.schema.json' with {
  type: 'json',
}
import applyResultSchema from '../../../schema/yarramate-apply-result.schema.json' with {
  type: 'json',
}
import operationsSchema from '../../../schema/yarramate-operations.schema.json' with {
  type: 'json',
}
import projectionSchema from '../../../schema/yarramate-projection.schema.json' with {
  type: 'json',
}
import visualHandoffSchema from '../../../schema/yarramate-visual-handoff.schema.json' with {
  type: 'json',
}
import visualLayoutSchema from '../../../schema/yarramate-visual-layout.schema.json' with {
  type: 'json',
}
import visualModelSchema from '../../../schema/yarramate-visual-model.schema.json' with {
  type: 'json',
}
import visualResponseSchema from '../../../schema/yarramate-visual-response.schema.json' with {
  type: 'json',
}
import visualSessionDescriptorSchema from '../../../schema/yarramate-visual-session-descriptor.schema.json' with {
  type: 'json',
}
import visualSessionRequestSchema from '../../../schema/yarramate-visual-session-request.schema.json' with {
  type: 'json',
}
import visualSessionStartedSchema from '../../../schema/yarramate-visual-session-started.schema.json' with {
  type: 'json',
}
import visualStatusSchema from '../../../schema/yarramate-visual-status.schema.json' with {
  type: 'json',
}
import {
  VISUAL_LIMITS,
  type ParseResult,
  type VisualBrowserInput,
  type VisualDiagnostic,
  type VisualDiagnosticResult,
  type VisualEvent,
  type VisualHandoff,
  type VisualModel,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualSessionRequest,
  type VisualSessionStarted,
  type VisualStatus,
} from './protocol-contract.js'

// One import site for the whole protocol: the declarations this module
// validates travel with the validators.
export * from './protocol-contract.js'

const Ajv2020 = Ajv2020Module.default
// `discriminator` on Core's operation union routes a staged edit to the branch
// its `op` names, so a browser changeset reports the fault the reviewer made
// rather than one near-miss per operation kind.
const ajv = new Ajv2020({ allErrors: true, discriminator: true })
ajv.addSchema([
  visualDiagnosticResultSchema,
  visualEventSchema,
  visualGraphSchema,
  visualHandoffSchema,
  visualModelSchema,
  visualResponseSchema,
  visualSessionDescriptorSchema,
  visualSessionRequestSchema,
  visualSessionStartedSchema,
  visualStatusSchema,
  visualLayoutSchema,
  projectionSchema,
  // The commit path's event and response documents reference Core's operations
  // and apply-result shapes rather than restating them, so Ajv needs both
  // resolvable before it compiles the visual validators.
  operationsSchema,
  applyResultSchema,
])

/**
 * The one way this adapter mints a source digest.
 *
 * `visual-model/v1` requires a canonical model to record the digests it was
 * derived from (`YMVS112`) and pins their shape to 64 lowercase hex characters,
 * so the value lives beside the validator that enforces it: the request builder
 * mints them for the initial model, the session server re-mints them on every
 * recompile and checks a commit's pins against the files on disk, and all three
 * are the same hash by construction rather than by three matching literals.
 */
export const digestOf = (source: string): string =>
  createHash('sha256').update(source).digest('hex')

// Diagnostics report the document they came from rather than a source file,
// because visual protocol documents arrive as parsed JSON over the wire.
const documentPaths = new WeakMap<ValidateFunction, string>()

const visualValidator = (
  document: string,
  reference = `https://yarramate.org/schema/${document}`,
) => {
  const compiled = ajv.getSchema(reference)
  if (!compiled) throw new Error(`Unknown visual schema reference: ${reference}`)
  documentPaths.set(compiled, document)
  return compiled
}

const validateVisualModel = visualValidator('visual-model/v1')
const validateVisualSessionRequest = visualValidator(
  'visual-session-request/v1',
)
const validateVisualSessionStarted = visualValidator(
  'visual-session-started/v1',
)
const validateVisualSessionDescriptor = visualValidator(
  'visual-session-descriptor/v1',
)
const BROWSER_INPUT_REFERENCE =
  'https://yarramate.org/schema/visual-event/v1#/$defs/browserInput'
const validateVisualBrowserInput = visualValidator(
  'visual-browser-input/v1',
  BROWSER_INPUT_REFERENCE,
)

/**
 * One validator per input type, keyed by the `type` its branch fixes.
 *
 * The union reports every branch it tried, so a `changeset.commit` that gets
 * one field wrong arrives as that one violation buried under seven other
 * types' missing properties - unreadable, and it is the reviewer who has to
 * read it. An input that names a type the protocol knows is answered against
 * that type alone. The vocabulary is read off the schema rather than restated
 * here, so a new input type cannot be added without one.
 */
const browserInputBranches = new Map<string, ValidateFunction>(
  visualEventSchema.$defs.browserInput.oneOf.map((branch, index) => [
    branch.properties.type.const,
    visualValidator(
      'visual-browser-input/v1',
      `${BROWSER_INPUT_REFERENCE}/oneOf/${index}`,
    ),
  ]),
)
const validateVisualEvent = visualValidator('visual-event/v1')
const validateVisualResponse = visualValidator('visual-response/v1')
const validateVisualHandoff = visualValidator('visual-handoff/v1')
const validateVisualStatus = visualValidator('visual-status/v1')
const validateVisualDiagnosticResult = visualValidator(
  'visual-diagnostic-result/v1',
)

/**
 * Reads an untrusted document's own fields. Semantic checks run beside schema
 * validation on raw input, so anything that is not a plain object simply has
 * no fields to inspect and the schema reports the type violation.
 */
const documentFields = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const pointerSegment = (segment: string) =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1')

const visualDiagnostic = (
  code: string,
  message: string,
  path: string,
  pointer: string,
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path,
  pointer,
  line: 1,
  column: 1,
})

const visualDiagnosticOrder = (
  left: VisualDiagnostic,
  right: VisualDiagnostic,
) =>
  left.pointer.localeCompare(right.pointer) ||
  left.code.localeCompare(right.code) ||
  left.message.localeCompare(right.message)

const jsonBytes = (value: unknown): number => {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return 0
  return Buffer.byteLength(encoded, 'utf8')
}

/**
 * Relative POSIX path confined to the candidate root. Absolute paths, parent
 * traversal, empty segments, `.`/`..` segments, Windows separators, and NUL
 * bytes are all rejected. A dot-prefixed directory is not an escape and is
 * kept: every workspace keeps its documents under `.yarramate/`, so the
 * digests of a canonical model are unrepresentable without it.
 */
const isConfinedRelativePath = (candidate: string): boolean => {
  if (candidate.length === 0 || candidate.length > 1024) return false
  if (candidate.includes('\\') || candidate.includes('\u0000')) return false
  if (posix.isAbsolute(candidate)) return false
  if (posix.normalize(candidate) !== candidate) return false
  return candidate
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 && segment !== '.' && segment !== '..',
    )
}

/**
 * Every absolute path on the wire is forward-slash, on every platform,
 * matching the rule `isConfinedRelativePath` already holds relative paths
 * to: a backslash is never a wire separator, POSIX host or not. `join`/
 * `resolve` answer in the platform's own separator, so a Windows caller
 * building `sessionRoot`, `descriptorPath`, `journalPath`, or
 * `transcriptPath` produces a native path that must be converted before it
 * is placed in a schema-checked document. The conversion is unconditional
 * rather than gated on the running platform's `path.sep`, so it behaves
 * identically under test on any host. Node's own `fs`/`path` APIs accept
 * forward slashes back on Windows, so the conversion loses nothing a later
 * read needs.
 */
export const toWireAbsolutePath = (native: string): string =>
  native.replace(/\\/g, '/')

const modelSemantics = (
  input: unknown,
  path: string,
  prefix: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  const diagnostics: VisualDiagnostic[] = []

  const digestKeys = Object.keys(documentFields(fields.sourceDigests))
  for (const key of digestKeys) {
    if (isConfinedRelativePath(key)) continue
    diagnostics.push(
      visualDiagnostic(
        'YMVS113',
        `Source digest "${key}" escapes the candidate root`,
        path,
        `${prefix}/sourceDigests/${pointerSegment(key)}`,
      ),
    )
  }
  if (fields.authority === 'canonical' && digestKeys.length === 0) {
    diagnostics.push(
      visualDiagnostic(
        'YMVS112',
        'A canonical visual model must record the source digests it was derived from',
        path,
        `${prefix}/sourceDigests`,
      ),
    )
  }

  if (jsonBytes(input) > VISUAL_LIMITS.modelBytes) {
    diagnostics.push(
      visualDiagnostic(
        'YMVS115',
        `A visual model must not exceed ${VISUAL_LIMITS.modelBytes} bytes`,
        path,
        prefix === '' ? '/' : prefix,
      ),
    )
  }

  return diagnostics
}

const chatTextSemantics = (
  payload: unknown,
  path: string,
  prefix: string,
): readonly VisualDiagnostic[] => {
  const text = documentFields(payload).text
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text, 'utf8') <= VISUAL_LIMITS.messageBytes
  ) {
    return []
  }
  return [
    visualDiagnostic(
      'YMVS115',
      `A chat message must not exceed ${VISUAL_LIMITS.messageBytes} bytes`,
      path,
      `${prefix}/text`,
    ),
  ]
}

const sessionRequestSemantics = (
  input: unknown,
  path: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  const modelAuthority = documentFields(fields.initialModel).authority
  const diagnostics = [
    ...modelSemantics(fields.initialModel, path, '/initialModel'),
  ]
  if (
    typeof fields.authority === 'string' &&
    typeof modelAuthority === 'string' &&
    fields.authority !== modelAuthority
  ) {
    diagnostics.push(
      visualDiagnostic(
        'YMVS111',
        `Session authority "${fields.authority}" does not match the initial model authority "${modelAuthority}"`,
        path,
        '/initialModel/authority',
      ),
    )
  }
  return diagnostics
}

const chatCarryingSemantics = (
  input: unknown,
  path: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  if (fields.type !== 'chat.message') return []
  return chatTextSemantics(fields.payload, path, '/payload')
}

const responseSemantics = (
  input: unknown,
  path: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  if (fields.type === 'chat.response') {
    return chatTextSemantics(fields.payload, path, '/payload')
  }
  return []
}

/**
 * A handoff is one session's record. The schema validates each transcript entry
 * as a well-formed event or response but cannot relate it to the document that
 * carries it, so the one cross-session check the nine documents would otherwise
 * be missing is made here: every entry names the session the handoff does.
 */
const handoffSemantics = (
  input: unknown,
  path: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  const transcript = fields.transcript
  if (transcript === undefined) return []
  const diagnostics: VisualDiagnostic[] = []
  if (jsonBytes(transcript) > VISUAL_LIMITS.transcriptBytes) {
    diagnostics.push(
      visualDiagnostic(
        'YMVS115',
        `A raw transcript must not exceed ${VISUAL_LIMITS.transcriptBytes} bytes`,
        path,
        '/transcript',
      ),
    )
  }
  if (Array.isArray(transcript)) {
    for (const [index, entry] of transcript.entries()) {
      const owner = documentFields(entry).sessionId
      if (owner === fields.sessionId) continue
      diagnostics.push(
        visualDiagnostic(
          'YMVS116',
          `Transcript entry ${index} belongs to session "${String(owner)}", not "${String(fields.sessionId)}"`,
          path,
          `/transcript/${index}/sessionId`,
        ),
      )
    }
  }
  return diagnostics
}

type DocumentSemantics = (
  input: unknown,
  path: string,
) => readonly VisualDiagnostic[]

// Byte limits and path confinement are enforced here as well as in the schemas
// so a schema regression cannot silently widen the untrusted input surface.
const semanticsByDocument: Readonly<Record<string, DocumentSemantics>> = {
  'visual-model/v1': (input, path) => modelSemantics(input, path, ''),
  'visual-session-request/v1': sessionRequestSemantics,
  'visual-browser-input/v1': chatCarryingSemantics,
  'visual-event/v1': chatCarryingSemantics,
  'visual-response/v1': responseSemantics,
  'visual-handoff/v1': handoffSemantics,
}

const schemaDiagnostics = (
  errors: readonly ErrorObject[],
  code: string,
  path: string,
): readonly VisualDiagnostic[] =>
  errors.map((error) => {
    const property =
      error.keyword === 'additionalProperties'
        ? String(error.params.additionalProperty)
        : undefined
    const pointer = property
      ? `${error.instancePath}/${pointerSegment(property)}`
      : error.instancePath || '/'
    return visualDiagnostic(
      code,
      property
        ? `Property "${property}" is not allowed`
        : `${path} schema violation: ${describeSchemaViolation(error)}`,
      path,
      pointer,
    )
  })

/**
 * The same violation, reported once.
 *
 * A union reports the branches it tried, and sibling branches that share a
 * requirement each raise it - the reviewer reads one document, not the
 * validator's search. Diagnostics are already sorted, so identical neighbours
 * are adjacent; nothing that differs in code, pointer, or message is lost.
 */
const distinct = (
  diagnostics: readonly VisualDiagnostic[],
): readonly VisualDiagnostic[] =>
  diagnostics.filter((diagnostic, index) => {
    if (index === 0) return true
    const previous = diagnostics[index - 1]
    return (
      previous === undefined ||
      visualDiagnosticOrder(previous, diagnostic) !== 0
    )
  })

const parseWith = <T>(
  validate: ValidateFunction,
  input: unknown,
  code: string,
): ParseResult<T> => {
  const path = documentPaths.get(validate) ?? 'visual-document'
  const semantics = semanticsByDocument[path]
  const diagnostics = distinct(
    [
      ...(validate(input)
        ? []
        : schemaDiagnostics(readableSchemaErrors(validate.errors ?? []), code, path)),
      ...(semantics ? semantics(input, path) : []),
    ].sort(visualDiagnosticOrder),
  )
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return { ok: true, value: input as T }
}

export const parseVisualModel = (input: unknown): ParseResult<VisualModel> =>
  parseWith(validateVisualModel, input, 'YMVS106')

export const parseVisualSessionRequest = (
  input: unknown,
): ParseResult<VisualSessionRequest> =>
  parseWith(validateVisualSessionRequest, input, 'YMVS101')

export const parseVisualSessionStarted = (
  input: unknown,
): ParseResult<VisualSessionStarted> =>
  parseWith(validateVisualSessionStarted, input, 'YMVS102')

export const parseVisualSessionDescriptor = (
  input: unknown,
): ParseResult<VisualSessionDescriptor> =>
  parseWith(validateVisualSessionDescriptor, input, 'YMVS103')

/**
 * The type an untrusted frame claims to be, when the protocol has that type.
 *
 * A refusal has to say what it refused, and the browser is holding a control
 * open until it does. The claim is worth reporting before the document is
 * known to be valid because the frame that named it is the one that failed.
 */
export const visualBrowserInputType = (
  input: unknown,
): VisualBrowserInput['type'] | undefined => {
  const claimed = documentFields(input).type
  return typeof claimed === 'string' && browserInputBranches.has(claimed)
    ? (claimed as VisualBrowserInput['type'])
    : undefined
}

export const parseVisualBrowserInput = (
  input: unknown,
): ParseResult<VisualBrowserInput> => {
  const claimed = visualBrowserInputType(input)
  const validate =
    claimed === undefined
      ? validateVisualBrowserInput
      : // The branch is in the map because `claimed` came out of it.
        (browserInputBranches.get(claimed) as ValidateFunction)
  return parseWith(validate, input, 'YMVS109')
}

export const parseVisualEvent = (input: unknown): ParseResult<VisualEvent> =>
  parseWith(validateVisualEvent, input, 'YMVS104')

export const parseVisualResponse = (
  input: unknown,
): ParseResult<VisualResponse> =>
  parseWith(validateVisualResponse, input, 'YMVS105')

export const parseVisualHandoff = (
  input: unknown,
): ParseResult<VisualHandoff> =>
  parseWith(validateVisualHandoff, input, 'YMVS107')

export const parseVisualStatus = (input: unknown): ParseResult<VisualStatus> =>
  parseWith(validateVisualStatus, input, 'YMVS108')

export const parseVisualDiagnosticResult = (
  input: unknown,
): ParseResult<VisualDiagnosticResult> =>
  parseWith(validateVisualDiagnosticResult, input, 'YMVS110')

