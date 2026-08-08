import { posix } from 'node:path'
import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describeSchemaViolation } from '../../source-document.js'
import visualDiagnosticResultSchema from '../../../schema/yarramate-visual-diagnostic-result.schema.json' with {
  type: 'json',
}
import visualEventSchema from '../../../schema/yarramate-visual-event.schema.json' with {
  type: 'json',
}
import visualHandoffSchema from '../../../schema/yarramate-visual-handoff.schema.json' with {
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

export const VISUAL_PROTOCOL_VERSION = 'yarramate/visual-protocol/v1' as const

export const VISUAL_LIMITS = {
  messageBytes: 64 * 1024,
  modelBytes: 5 * 1024 * 1024,
  transcriptBytes: 5 * 1024 * 1024,
  pendingEvents: 32,
  reconnectMs: 5 * 60 * 1000,
  staleSessionMs: 24 * 60 * 60 * 1000,
} as const

export type VisualAuthority = 'canonical' | 'ad-hoc'

export interface VisualDiagnostic {
  readonly severity: 'error'
  readonly code: string
  readonly message: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export interface VisualDiagnosticResult {
  readonly format: 'yarramate/visual-diagnostic-result/v1'
  readonly diagnostics: readonly VisualDiagnostic[]
}

export interface VisualCapabilities {
  readonly chat: boolean
  readonly choices: boolean
  readonly navigation: boolean
  readonly modelReplacement: boolean
  readonly transcript: boolean
}

export interface VisualModel {
  readonly format: 'yarramate/visual-model/v1'
  readonly authority: VisualAuthority
  readonly initialView: string
  readonly sourceDigests: Readonly<Record<string, string>>
  readonly files: Readonly<Record<string, string>>
}

export interface VisualCompilerCommand {
  readonly command: string
  readonly args: readonly string[]
}

export interface VisualSessionRequest {
  readonly format: 'yarramate/visual-session-request/v1'
  readonly authority: VisualModel['authority']
  readonly title: string
  readonly description: string
  readonly chatEnabled: boolean
  readonly compiler: VisualCompilerCommand
  readonly initialModel: VisualModel
}

export interface VisualSessionStarted {
  readonly format: 'yarramate/visual-session-started/v1'
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION
  readonly sessionId: string
  readonly authority: VisualAuthority
  readonly title: string
  readonly chatEnabled: boolean
  readonly browserUrl: string
  readonly webSocketUrl: string
  readonly origin: string
  readonly descriptorPath: string
  readonly sessionRoot: string
  readonly capabilities: VisualCapabilities
  readonly startedAt: string
}

export interface VisualSessionDescriptor {
  readonly format: 'yarramate/visual-session-descriptor/v1'
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION
  readonly sessionId: string
  readonly origin: string
  readonly agentCapability: string
  readonly sessionRoot: string
  readonly journalPath: string
  readonly createdAt: string
}

export interface VisualChatMessagePayload {
  readonly text: string
}

export interface VisualChoiceSelectedPayload {
  readonly choiceId: string
  readonly optionId: string
}

export interface VisualViewNavigatePayload {
  readonly viewId: string
  readonly requiresAttention: boolean
}

export interface VisualSessionEndPayload {
  readonly reason: 'user-ended' | 'browser-timeout'
}

export interface VisualBrowserConnectedPayload {
  readonly connectionId: string
}

export interface VisualBrowserDisconnectedPayload {
  readonly connectionId: string
  readonly code: number
}

/**
 * Untrusted browser message. The runtime owns session identifiers, sequence
 * numbers, event identifiers, and timestamps, so the browser may send only a
 * discriminant and its payload.
 */
export type VisualBrowserInput =
  | {
      readonly type: 'chat.message'
      readonly payload: VisualChatMessagePayload
    }
  | {
      readonly type: 'choice.selected'
      readonly payload: VisualChoiceSelectedPayload
    }
  | {
      readonly type: 'view.navigate'
      readonly payload: VisualViewNavigatePayload
    }
  | { readonly type: 'session.end'; readonly payload: VisualSessionEndPayload }

interface VisualEventEnvelope<Type extends string, Payload> {
  readonly format: 'yarramate/visual-event/v1'
  readonly sessionId: string
  readonly sequence: number
  readonly eventId: string
  readonly type: Type
  readonly timestamp: string
  readonly payload: Payload
}

export type VisualEvent =
  | VisualEventEnvelope<'chat.message', VisualChatMessagePayload>
  | VisualEventEnvelope<'choice.selected', VisualChoiceSelectedPayload>
  | VisualEventEnvelope<'view.navigate', VisualViewNavigatePayload>
  | VisualEventEnvelope<'session.end', VisualSessionEndPayload>
  | VisualEventEnvelope<'browser.connected', VisualBrowserConnectedPayload>
  | VisualEventEnvelope<
      'browser.disconnected',
      VisualBrowserDisconnectedPayload
    >

export interface VisualChatResponsePayload {
  readonly text: string
}

export interface VisualAgentStatusPayload {
  readonly state: 'thinking' | 'compiling' | 'waiting' | 'idle'
  readonly detail?: string
}

export interface VisualChoiceOption {
  readonly id: string
  readonly label: string
  readonly description?: string
}

export interface VisualChoicePresentPayload {
  readonly choiceId: string
  readonly question: string
  readonly options: readonly VisualChoiceOption[]
}

export interface VisualModelReplacePayload {
  readonly model: VisualModel
}

export interface VisualHandoffSummary {
  readonly summary: string
  readonly confirmedDecisions: readonly string[]
  readonly requestedChanges: readonly string[]
  readonly unresolvedQuestions: readonly string[]
  readonly finalViews: readonly string[]
}

export interface VisualDiagnosticPayload {
  readonly diagnostics: readonly VisualDiagnostic[]
}

interface VisualResponseEnvelope<Type extends string, Payload> {
  readonly format: 'yarramate/visual-response/v1'
  readonly sessionId: string
  readonly responseId: string
  readonly eventId: string
  readonly type: Type
  readonly timestamp: string
  readonly payload: Payload
}

export type VisualResponse =
  | VisualResponseEnvelope<'chat.response', VisualChatResponsePayload>
  | VisualResponseEnvelope<'agent.status', VisualAgentStatusPayload>
  | VisualResponseEnvelope<'choice.present', VisualChoicePresentPayload>
  | VisualResponseEnvelope<'model.replace', VisualModelReplacePayload>
  | VisualResponseEnvelope<'handoff.complete', VisualHandoffSummary>
  | VisualResponseEnvelope<'diagnostic', VisualDiagnosticPayload>

export type VisualHandoffDecision = 'completed' | 'cancelled' | 'failed'

export type VisualTerminationReason =
  | 'user-ended'
  | 'child-failed'
  | 'browser-timeout'
  | 'main-cancelled'
  | 'server-failed'
  | 'compiler-failed'

export interface VisualHandoff extends VisualHandoffSummary {
  readonly format: 'yarramate/visual-handoff/v1'
  readonly sessionId: string
  readonly authority: VisualAuthority
  readonly decision: VisualHandoffDecision
  readonly terminationReason: VisualTerminationReason
  readonly lastSequence: number
  readonly transcriptPath: string
  readonly transcript?: readonly (VisualEvent | VisualResponse)[]
  readonly completedAt: string
}

export type VisualLifecycle = 'starting' | 'running' | 'draining' | 'stopped'

export type VisualFreezeReason =
  | 'message-bytes'
  | 'model-bytes'
  | 'transcript-bytes'
  | 'pending-events'
  | 'browser-disconnected'
  | 'terminal-event'

export interface VisualStatus {
  readonly format: 'yarramate/visual-status/v1'
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION
  readonly sessionId: string
  readonly lifecycle: VisualLifecycle
  readonly alreadyStopped: boolean
  readonly server: {
    readonly listening: boolean
    readonly origin: string
  }
  readonly browser: {
    readonly connected: boolean
    readonly connections: number
    readonly lastSeenAt?: string
    readonly graceExpiresAt?: string
  }
  readonly agent: {
    readonly attached: boolean
    readonly inFlightEventId: string | null
  }
  readonly queue: {
    readonly pendingEvents: number
    readonly lastSequence: number
    readonly frozen: boolean
    readonly frozenReason?: VisualFreezeReason
  }
  readonly capabilities: VisualCapabilities
  readonly transcriptBytes: number
  readonly updatedAt: string
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] }

const Ajv2020 = Ajv2020Module.default
const ajv = new Ajv2020({ allErrors: true })
ajv.addSchema([
  visualDiagnosticResultSchema,
  visualModelSchema,
  visualEventSchema,
  visualResponseSchema,
  visualSessionRequestSchema,
  visualSessionStartedSchema,
  visualSessionDescriptorSchema,
  visualHandoffSchema,
  visualStatusSchema,
])

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
const validateVisualBrowserInput = visualValidator(
  'visual-browser-input/v1',
  'https://yarramate.org/schema/visual-event/v1#/$defs/browserInput',
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

const MODEL_ROOT_CONFIG = 'likec4.config.json'
const MODEL_SOURCE_EXTENSIONS = ['.c4', '.likec4'] as const

/**
 * Relative POSIX path confined to the candidate root. Absolute paths, parent
 * traversal, empty segments, dot-prefixed segments (how a staged symlink or
 * metadata entry would be smuggled in), Windows separators, and NUL bytes are
 * all rejected.
 */
const isConfinedRelativePath = (candidate: string): boolean => {
  if (candidate.length === 0 || candidate.length > 1024) return false
  if (candidate.includes('\\') || candidate.includes('\u0000')) return false
  if (posix.isAbsolute(candidate)) return false
  if (posix.normalize(candidate) !== candidate) return false
  return candidate
    .split('/')
    .every((segment) => segment.length > 0 && !segment.startsWith('.'))
}

export const isSafeVisualModelPath = (candidate: string): boolean => {
  if (!isConfinedRelativePath(candidate)) return false
  if (candidate === MODEL_ROOT_CONFIG) return true
  const extension = posix.extname(candidate)
  return MODEL_SOURCE_EXTENSIONS.some((allowed) => allowed === extension)
}

const modelSemantics = (
  input: unknown,
  path: string,
  prefix: string,
): readonly VisualDiagnostic[] => {
  const fields = documentFields(input)
  const diagnostics: VisualDiagnostic[] = []

  const files = documentFields(fields.files)
  const fileKeys = Object.keys(files)
  if (fileKeys.length > 0) {
    let sources = 0
    for (const key of fileKeys) {
      if (!isSafeVisualModelPath(key)) {
        diagnostics.push(
          visualDiagnostic(
            'YMVS113',
            `Model file "${key}" escapes the candidate root or is not a LikeC4 source`,
            path,
            `${prefix}/files/${pointerSegment(key)}`,
          ),
        )
        continue
      }
      if (key !== MODEL_ROOT_CONFIG) sources += 1
    }
    if (sources === 0) {
      diagnostics.push(
        visualDiagnostic(
          'YMVS114',
          'A visual model requires at least one .c4 or .likec4 source file',
          path,
          `${prefix}/files`,
        ),
      )
    }
  }

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
  if (fields.authority === 'ad-hoc' && digestKeys.length > 0) {
    diagnostics.push(
      visualDiagnostic(
        'YMVS112',
        'An ad-hoc visual model must not claim canonical source digests',
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
  if (fields.type === 'model.replace') {
    return modelSemantics(
      documentFields(fields.payload).model,
      path,
      '/payload/model',
    )
  }
  return []
}

const handoffSemantics = (
  input: unknown,
  path: string,
): readonly VisualDiagnostic[] => {
  const transcript = documentFields(input).transcript
  if (
    transcript === undefined ||
    jsonBytes(transcript) <= VISUAL_LIMITS.transcriptBytes
  ) {
    return []
  }
  return [
    visualDiagnostic(
      'YMVS115',
      `A raw transcript must not exceed ${VISUAL_LIMITS.transcriptBytes} bytes`,
      path,
      '/transcript',
    ),
  ]
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

const parseWith = <T>(
  validate: ValidateFunction,
  input: unknown,
  code: string,
): ParseResult<T> => {
  const path = documentPaths.get(validate) ?? 'visual-document'
  const semantics = semanticsByDocument[path]
  const diagnostics = [
    ...(validate(input)
      ? []
      : schemaDiagnostics(validate.errors ?? [], code, path)),
    ...(semantics ? semantics(input, path) : []),
  ].sort(visualDiagnosticOrder)
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

export const parseVisualBrowserInput = (
  input: unknown,
): ParseResult<VisualBrowserInput> =>
  parseWith(validateVisualBrowserInput, input, 'YMVS109')

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
