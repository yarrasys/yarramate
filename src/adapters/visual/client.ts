import { lstat, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  VISUAL_PROTOCOL_VERSION,
  parseVisualDiagnosticResult,
  parseVisualEvent,
  parseVisualHandoff,
  parseVisualSessionDescriptor,
  parseVisualStatus,
  type ParseResult,
  type VisualDiagnostic,
  type VisualHandoff,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualStatus,
} from './protocol.js'
import {
  VISUAL_SERVER_LIMITS,
  type VisualEventDelivery,
  type VisualResponseAcceptance,
} from './session-server.js'
import {
  recoverVisualSession,
  removeVisualSession,
  visualSessionPaths,
} from './session-store.js'

/**
 * Document name reported by diagnostics the client itself raises — an
 * unreadable descriptor, an unreachable session server, or an answer that is
 * not the document the route promises.
 */
export const VISUAL_CLIENT_DOCUMENT = 'visual-session-client'

export const VISUAL_CLIENT_LIMITS = {
  /**
   * Ceiling on one agent request. It has to outlast the server's long poll,
   * which answers "still idle" only once its own window closes, or every idle
   * wait would be reported as a transport failure.
   */
  requestTimeoutMs: VISUAL_SERVER_LIMITS.agentPollMs + 5_000,
  /** How much of a refusal the diagnostic explaining it quotes back. */
  refusalBytes: 512,
} as const

/** Termination reason a one-shot `stop` asks the runtime to close under. */
const STOP_REASON = 'main-cancelled'

const AGENT_EVENTS = '/api/agent/events'
const AGENT_STATUS = '/api/agent/status'
const AGENT_RESPONSES = '/api/agent/responses'
const AGENT_STOP = '/api/agent/stop'

/**
 * Session store failures already carry the protocol code that explains them, so
 * they are surfaced under that code rather than flattened into one client code.
 */
const STORE_FAILURE = /^(YMVS[0-9]{3}): ([\s\S]+)$/

/**
 * `pointer` is an RFC 6901 pointer into the document being refused; a refusal
 * the client raised about the transport itself is rooted at `/`.
 */
export const visualClientDiagnostic = (
  code: string,
  message: string,
  pointer = '/',
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path: VISUAL_CLIENT_DOCUMENT,
  pointer,
  line: 1,
  column: 1,
})

const refused = <T>(
  diagnostics: readonly VisualDiagnostic[],
): ParseResult<T> => ({ ok: false, diagnostics })

export const visualFailureDiagnostics = (
  cause: unknown,
): readonly VisualDiagnostic[] => {
  const message = cause instanceof Error ? cause.message : String(cause)
  const named = STORE_FAILURE.exec(message)
  const code = named?.[1]
  const detail = named?.[2]
  return code === undefined || detail === undefined
    ? [visualClientDiagnostic('YMVS408', message)]
    : [visualClientDiagnostic(code, detail)]
}

const summarise = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value)
  const trimmed = text.trim().split('\n')[0] ?? ''
  return trimmed.length > VISUAL_CLIENT_LIMITS.refusalBytes
    ? `${trimmed.slice(0, VISUAL_CLIENT_LIMITS.refusalBytes)}…`
    : trimmed
}

/**
 * Reads an untrusted answer's own fields. Anything that is not a plain object
 * simply has no fields, so the field checks report the violation.
 */
const documentFields = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  )

/**
 * The agent's entry point into one live session, read the way a hostile file
 * has to be read. The descriptor is the only file carrying the agent
 * capability, so a redirected or planted one must never be spent.
 */
export const readVisualSessionDescriptor = async (
  path: string,
  cwd: string = process.cwd(),
): Promise<ParseResult<VisualSessionDescriptor>> => {
  const target = resolve(cwd, path)
  let raw: string
  try {
    // lstat, never stat: a symlinked descriptor is a redirected capability.
    const entry = await lstat(target)
    if (!entry.isFile()) {
      return refused([
        visualClientDiagnostic(
          'YMVS401',
          `Session descriptor "${target}" is not a regular file`,
        ),
      ])
    }
    raw = await readFile(target, 'utf8')
  } catch {
    return refused([
      visualClientDiagnostic(
        'YMVS401',
        `Session descriptor "${target}" cannot be read`,
      ),
    ])
  }
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return refused([
      visualClientDiagnostic(
        'YMVS402',
        `Session descriptor "${target}" is not JSON`,
      ),
    ])
  }
  const parsed = parseVisualSessionDescriptor(document)
  if (!parsed.ok) return parsed
  const paths = visualSessionPaths(parsed.value.sessionRoot)
  // A descriptor authorises work on the session it lives in and no other: this
  // is the same invariant the runtime enforced when it published the file, so a
  // copied or planted descriptor cannot direct a stop at another directory.
  if (paths.descriptor !== target || paths.journal !== parsed.value.journalPath) {
    return refused([
      visualClientDiagnostic(
        'YMVS403',
        `Session descriptor "${target}" names session artefacts outside its own directory`,
      ),
    ])
  }
  return parsed
}

/** One JSON document the agent hands to a command, read from the filesystem. */
export const readVisualJsonDocument = async (
  path: string,
  cwd: string = process.cwd(),
): Promise<ParseResult<unknown>> => {
  const target = resolve(cwd, path)
  try {
    return { ok: true, value: JSON.parse(await readFile(target, 'utf8')) }
  } catch {
    return refused([
      visualClientDiagnostic(
        'YMVS407',
        `Document "${target}" is not a readable JSON document`,
      ),
    ])
  }
}

interface AgentAnswer {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

/**
 * One bearer request to the loopback origin the descriptor names. The
 * descriptor schema confines that origin to 127.0.0.1, so the capability never
 * travels off the host that minted it.
 */
const agentRequest = async (
  descriptor: VisualSessionDescriptor,
  route: string,
  body?: string,
): Promise<ParseResult<AgentAnswer>> => {
  try {
    const response = await fetch(`${descriptor.origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${descriptor.agentCapability}`,
        ...(body === undefined
          ? {}
          : { 'Content-Type': 'application/json; charset=utf-8' }),
      },
      body,
      signal: AbortSignal.timeout(VISUAL_CLIENT_LIMITS.requestTimeoutMs),
    })
    return {
      ok: true,
      value: {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
      },
    }
  } catch (cause) {
    return refused([
      visualClientDiagnostic(
        'YMVS404',
        `Session server at ${descriptor.origin} did not answer ${route}: ${summarise(cause)}`,
      ),
    ])
  }
}

/**
 * Diagnostics a refusal carried as one of the server's own JSON documents. They
 * explain the refusal better than its status line ever could, but they arrive
 * over a trust boundary: anything that is not already a conforming
 * `visual-diagnostic-result/v1` payload is dropped rather than repaired, so a
 * protocol violation upstream is reported as the transport failure it is
 * instead of being laundered into this client's own output.
 */
const carriedDiagnostics = (
  answer: AgentAnswer,
): readonly VisualDiagnostic[] | undefined => {
  if (!answer.contentType.startsWith('application/json')) return undefined
  let document: unknown
  try {
    document = JSON.parse(answer.body)
  } catch {
    return undefined
  }
  const parsed = parseVisualDiagnosticResult({
    format: 'yarramate/visual-diagnostic-result/v1',
    diagnostics: documentFields(document).diagnostics,
  })
  return parsed.ok && parsed.value.diagnostics.length > 0
    ? parsed.value.diagnostics
    : undefined
}

const refusalDiagnostics = (
  answer: AgentAnswer,
  route: string,
): readonly VisualDiagnostic[] =>
  carriedDiagnostics(answer) ?? [
    visualClientDiagnostic(
      'YMVS405',
      `Session server refused ${route} with status ${answer.status}: ${summarise(answer.body)}`,
    ),
  ]

const malformed = <T>(route: string, detail: string): ParseResult<T> =>
  refused([
    visualClientDiagnostic(
      'YMVS406',
      `Session server answered ${route} with ${detail}`,
    ),
  ])

/** The 200 body of an agent route, decoded; any other status is a refusal. */
const decoded = (
  answer: AgentAnswer,
  route: string,
): ParseResult<unknown> => {
  if (answer.status !== 200) return refused(refusalDiagnostics(answer, route))
  try {
    return { ok: true, value: JSON.parse(answer.body) }
  } catch {
    return malformed(route, 'a body that is not JSON')
  }
}

/**
 * Long-polls for the next actionable event past `after`. The server holds the
 * request for its whole poll window before answering that the session is still
 * idle, which is why this is the client's longest-running call.
 */
export const waitForVisualEvent = async (
  descriptor: VisualSessionDescriptor,
  after: number,
): Promise<ParseResult<VisualEventDelivery>> => {
  const answered = await agentRequest(
    descriptor,
    `${AGENT_EVENTS}?after=${after}`,
  )
  if (!answered.ok) return answered
  const body = decoded(answered.value, AGENT_EVENTS)
  if (!body.ok) return body
  const fields = documentFields(body.value)
  const { lastSequence, pendingEvents } = fields
  if (typeof lastSequence !== 'number' || typeof pendingEvents !== 'number') {
    return malformed(AGENT_EVENTS, 'a document that is not an event delivery')
  }
  if (fields.waiting === true) {
    return { ok: true, value: { waiting: true, lastSequence, pendingEvents } }
  }
  if (fields.waiting !== false) {
    return malformed(AGENT_EVENTS, 'a document that is not an event delivery')
  }
  const event = parseVisualEvent(fields.event)
  if (!event.ok) return event
  return {
    ok: true,
    value: { waiting: false, event: event.value, lastSequence, pendingEvents },
  }
}

/**
 * Delivers one agent response. A response the runtime already journaled is
 * accepted again as a duplicate, so a retried delivery is never a second turn.
 */
export const sendVisualResponse = async (
  descriptor: VisualSessionDescriptor,
  response: VisualResponse,
): Promise<ParseResult<Extract<VisualResponseAcceptance, { accepted: true }>>> => {
  const answered = await agentRequest(
    descriptor,
    AGENT_RESPONSES,
    JSON.stringify(response),
  )
  if (!answered.ok) return answered
  const body = decoded(answered.value, AGENT_RESPONSES)
  if (!body.ok) return body
  const fields = documentFields(body.value)
  if (
    fields.accepted !== true ||
    typeof fields.duplicate !== 'boolean' ||
    typeof fields.lastSequence !== 'number' ||
    !Array.isArray(fields.diagnostics)
  ) {
    return malformed(
      AGENT_RESPONSES,
      'a document that is not a response acceptance',
    )
  }
  // Every discriminating field is checked above; `model` and `diagnostics` are
  // carried through unread from the runtime's own acceptance document.
  const acceptance = body.value as Extract<
    VisualResponseAcceptance,
    { accepted: true }
  >
  return { ok: true, value: acceptance }
}

/**
 * The status of a session whose runtime is gone: stopped, and reporting the
 * journal that outlived it. A marker that is absent went with the runtime; a
 * marker that is present and unusable is a fault the caller has to see.
 */
const localVisualStatus = async (
  descriptor: VisualSessionDescriptor,
): Promise<ParseResult<VisualStatus>> => {
  const paths = visualSessionPaths(descriptor.sessionRoot)
  let lastSequence = 0
  let transcriptBytes = 0
  try {
    lastSequence = (await recoverVisualSession(paths)).lastSequence
    transcriptBytes = (await stat(paths.journal)).size
  } catch (cause) {
    if (await exists(paths.marker)) {
      return refused(visualFailureDiagnostics(cause))
    }
  }
  return {
    ok: true,
    value: {
      format: 'yarramate/visual-status/v1',
      protocolVersion: VISUAL_PROTOCOL_VERSION,
      sessionId: descriptor.sessionId,
      lifecycle: 'stopped',
      alreadyStopped: true,
      server: { listening: false, origin: descriptor.origin },
      browser: { connected: false, connections: 0 },
      agent: { attached: false, inFlightEventId: null },
      queue: { pendingEvents: 0, lastSequence, frozen: false },
      // Every capability is the runtime's, and the runtime is gone.
      capabilities: {
        chat: false,
        choices: false,
        navigation: false,
        modelReplacement: false,
        transcript: false,
      },
      transcriptBytes,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Asks the runtime for its status, falling back to the local one when nothing
 * is listening: a session whose server died still has a status, and it is
 * stopped. A server that answers and refuses does not fall back — that is a
 * capability fault, not a dead session.
 */
export const fetchVisualStatus = async (
  descriptor: VisualSessionDescriptor,
): Promise<ParseResult<VisualStatus>> => {
  const answered = await agentRequest(descriptor, AGENT_STATUS)
  if (!answered.ok) return localVisualStatus(descriptor)
  const body = decoded(answered.value, AGENT_STATUS)
  if (!body.ok) return body
  return parseVisualStatus(body.value)
}

/**
 * Recovers the handoff from the journal. Recovery never asks the server: the
 * journal is the record, and it is written to outlive the runtime that kept it.
 */
export const recoverVisualSessionClient = async (
  descriptor: VisualSessionDescriptor,
  includeTranscript = false,
): Promise<ParseResult<VisualHandoff>> => {
  try {
    return {
      ok: true,
      value: await recoverVisualSession(
        visualSessionPaths(descriptor.sessionRoot),
        includeTranscript,
      ),
    }
  } catch (cause) {
    return refused(visualFailureDiagnostics(cause))
  }
}

/**
 * The handoff a runtime answered its own stop with. It is the terminal one —
 * journaled terminal event and all — so it supersedes what this client read
 * on the way in. Anything that is not a conforming handoff is dropped rather
 * than repaired: the pre-stop recovery is already a sound answer.
 */
const closedHandoff = (answer: AgentAnswer): VisualHandoff | undefined => {
  let document: unknown
  try {
    document = JSON.parse(answer.body)
  } catch {
    return undefined
  }
  const handoff = parseVisualHandoff(documentFields(document).handoff)
  return handoff.ok ? handoff.value : undefined
}

/**
 * Converges one session on stopped, whatever is left of it. Recovery runs
 * first, so no later step can be the one that loses confirmed state; the stop
 * request only returns once the runtime has journaled its terminal event,
 * drained, and removed the session it owns; and the local removal converges
 * the case where nothing was listening.
 *
 * `undefined` means the session was already gone, which is what makes a
 * repeated stop idempotent.
 */
export const stopVisualSessionClient = async (
  descriptor: VisualSessionDescriptor,
  includeTranscript = false,
): Promise<ParseResult<VisualHandoff | undefined>> => {
  const paths = visualSessionPaths(descriptor.sessionRoot)
  if (!(await exists(paths.root))) return { ok: true, value: undefined }
  const recovered = await recoverVisualSessionClient(
    descriptor,
    includeTranscript,
  )
  if (!recovered.ok) return recovered
  const answered = await agentRequest(
    descriptor,
    AGENT_STOP,
    JSON.stringify({ reason: STOP_REASON, includeTranscript }),
  )
  // A server that answered and refused is not this caller's to tear down.
  if (answered.ok && answered.value.status !== 200) {
    return refused(refusalDiagnostics(answered.value, AGENT_STOP))
  }
  const terminal = answered.ok ? closedHandoff(answered.value) : undefined
  try {
    await removeVisualSession(paths, includeTranscript)
  } catch (cause) {
    return refused(visualFailureDiagnostics(cause))
  }
  return { ok: true, value: terminal ?? recovered.value }
}
