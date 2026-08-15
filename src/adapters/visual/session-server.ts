import {
  createHash,
  createHmac,
  randomBytes as randomSource,
  timingSafeEqual,
} from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  VISUAL_LIMITS,
  VISUAL_PROTOCOL_VERSION,
  parseVisualBrowserInput,
  parseVisualResponse,
  parseVisualSessionStarted,
  parseVisualStatus,
  type VisualAuthority,
  type VisualBrowserInput,
  type VisualCapabilities,
  type VisualChoicePresentPayload,
  type VisualDiagnostic,
  type VisualEvent,
  type VisualFreezeReason,
  type VisualHandoff,
  type VisualLifecycle,
  type VisualResponse,
  type VisualSessionRequest,
  type VisualSessionStarted,
  type VisualStatus,
  type VisualTerminationReason,
} from './protocol.js'
import {
  appendTerminalEvent,
  appendVisualEvent,
  appendVisualResponse,
  createVisualSession,
  isActionableVisualEvent,
  recoverVisualSession,
  removeVisualSession,
  writeVisualSessionDescriptor,
  type TerminalEventDependencies,
  type VisualSessionPaths,
} from './session-store.js'
import type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
  VisualTranscriptRecord,
} from './wire.js'

// The browser application imports these from `./wire.js`; the server keeps
// publishing them so one import still covers the whole transport for an
// agent-side consumer.
export type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
  VisualTranscriptRecord,
}

/**
 * Document name reported by diagnostics the server itself raises — a refused
 * frame, a frozen queue, or a transport violation that no protocol document
 * owns.
 */
export const VISUAL_SERVER_DOCUMENT = 'visual-session-server'

/**
 * Returned on every response. The policy admits no external origin at all, so
 * neither a compromised model nor a hostile chat message can reach the network,
 * and the page can be neither framed nor used as a base for relative fetches.
 */
export const VISUAL_BROWSER_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
} as const

/**
 * This session's content policy. Every source stays `'self'`; the one addition
 * is a per-session nonce for inline style, because the diagram renderer injects
 * its own stylesheets at runtime. A nonce admits exactly the styles this
 * application emits, where `'unsafe-inline'` would admit anyone's.
 */
export const visualContentSecurityPolicy = (styleNonce: string) =>
  `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'nonce-${styleNonce}'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`

export const VISUAL_SERVER_LIMITS = {
  /** WebSocket frame ceiling: one 64 KiB chat message plus its envelope. */
  browserFrameBytes: VISUAL_LIMITS.messageBytes + 1024,
  /** Agent request body ceiling: one 5 MiB candidate model plus its envelope. */
  agentBodyBytes: VISUAL_LIMITS.modelBytes + 64 * 1024,
  /** Agent stop requests carry a termination reason and nothing else. */
  agentControlBytes: 4096,
  /** How long one agent long poll waits before answering "still idle". */
  agentPollMs: 30_000,
  /** Browser sockets one session serves at once. */
  browserConnections: 8,
} as const

export const VISUAL_SOCKET_PATH = '/socket'

const COOKIE_NAME = 'ym_visual'

/**
 * Assets are addressed by a single flat, hashed file name. Rejecting every
 * separator here means a traversal never reaches path resolution at all.
 */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** Response types that finish the agent turn an event opened. */
const TURN_COMPLETING: Readonly<Record<string, true>> = {
  'chat.response': true,
  'choice.present': true,
  'handoff.complete': true,
  diagnostic: true,
}

const TERMINATION_REASONS: Readonly<Record<string, true>> = {
  'user-ended': true,
  'child-failed': true,
  'browser-timeout': true,
  'main-cancelled': true,
  'server-failed': true,
  'compiler-failed': true,
}

/**
 * Which freezes are a runtime failing rather than a session closing.
 *
 * A ceiling the runtime enforced for itself means nothing more can be
 * journaled, so the conversation is over whether or not anyone asks it to
 * stop. `terminal-event` is already that ending, and a disconnected browser is
 * the reconnect grace's business, so neither ends a session a second time.
 */
const LIMIT_FREEZE: Readonly<Record<VisualFreezeReason, boolean>> = {
  'message-bytes': true,
  'model-bytes': true,
  'transcript-bytes': true,
  'pending-events': true,
  'browser-disconnected': false,
  'terminal-event': false,
}

/** Built browser application, beside the compiled adapter in `dist`. */
const DEFAULT_ASSET_ROOT = fileURLToPath(
  new URL('../../visual-app/', import.meta.url),
)

export type VisualEventDelivery =
  | {
      readonly waiting: false
      readonly event: VisualEvent
      readonly lastSequence: number
      readonly pendingEvents: number
    }
  | {
      readonly waiting: true
      readonly lastSequence: number
      readonly pendingEvents: number
    }

export type VisualResponseAcceptance =
  | {
      readonly accepted: true
      readonly duplicate: boolean
      readonly lastSequence: number
      readonly diagnostics: readonly VisualDiagnostic[]
    }
  | {
      readonly accepted: false
      readonly diagnostics: readonly VisualDiagnostic[]
    }

export interface VisualServerClosed {
  readonly reason: VisualTerminationReason
  readonly alreadyStopped: boolean
  readonly handoff: VisualHandoff | undefined
}

export interface VisualServerOptions {
  readonly request: VisualSessionRequest
  /** Directory that holds one directory per live session. */
  readonly baseDir: string
  /** Root of the self-contained browser application. */
  readonly assetRoot?: string
  readonly now?: () => Date
  readonly randomBytes?: (size: number) => Buffer
  readonly agentPollMs?: number
  /** Whether the handoff a stop returns carries the raw transcript. */
  readonly includeTranscript?: boolean
  /**
   * Arms the browser reconnect grace, and answers with the cancellation of the
   * window it armed. Injected so the exact window a session waits is
   * observable, and so it can elapse without waiting out five real minutes.
   */
  readonly schedule?: (task: () => Promise<void>, ms: number) => () => void
}

export interface VisualServerHandle {
  readonly started: VisualSessionStarted
  readonly closed: Promise<VisualServerClosed>
  status(): VisualStatus
  stop(reason: VisualTerminationReason): Promise<VisualServerClosed>
}

/**
 * The runtime half of one live session: everything the terminal transition
 * mutates, and the hooks it needs to quiet the rest down first.
 *
 * `lifecycle` is the whole admission gate — only a `running` session takes a
 * browser frame or an agent response — so freezing input is one assignment
 * rather than a second flag that could disagree with it.
 */
export interface ActiveVisualSession {
  readonly paths: VisualSessionPaths
  lifecycle: VisualLifecycle
  /** Records why the browser stopped being able to speak. */
  readonly freeze: (reason: VisualFreezeReason) => void
  /** Settles work already admitted, so recovery reads a quiet journal. */
  readonly quiesce: () => Promise<void>
  readonly terminalEvent: TerminalEventDependencies
  /** The transition in flight, so concurrent causes converge on one run. */
  terminating: Promise<VisualHandoff> | undefined
  /** What this session ended with, once it has ended. */
  handoff: VisualHandoff | undefined
}

/**
 * Takes one session terminal, whatever caused it: a reviewer's End, a child
 * that failed, a browser that never came back, a cancelling main agent, or a
 * runtime shutting itself down.
 *
 * The order is the invariant. Input freezes before anything is read; work
 * already admitted is still allowed to finish; exactly one terminal event is
 * journaled; and the handoff is recovered without deleting anything, so
 * `stop` — and only `stop` — is what removes the session directory.
 */
export const terminateVisualSession = (
  session: ActiveVisualSession,
  reason: VisualTerminationReason,
): Promise<VisualHandoff> => {
  session.terminating ??= (async () => {
    if (session.lifecycle !== 'stopped') session.lifecycle = 'draining'
    session.freeze('terminal-event')
    await session.quiesce()
    // A terminal event that cannot be journaled must not be why a session
    // stays up: `runVisualStart` waits on this to return, so a transition that
    // refuses to settle hangs the command and strands the directory. The
    // journal is then a runtime that died without saying why, and recovery
    // reports precisely that.
    await appendTerminalEvent(
      session.paths,
      reason,
      session.terminalEvent,
    ).catch(() => undefined)
    session.handoff = await recoverVisualSession(session.paths, false)
    return session.handoff
  })().catch((cause: unknown) => {
    // A transition that failed is not this session's outcome: the next
    // terminal cause has to be able to try it again.
    session.terminating = undefined
    throw cause
  })
  return session.terminating
}

interface VisualEventEnvelope {
  readonly format: 'yarramate/visual-event/v1'
  readonly sessionId: string
  readonly sequence: number
  readonly eventId: string
  readonly timestamp: string
}

interface PendingPoll {
  readonly after: number
  readonly settle: (delivery: VisualEventDelivery) => void
  readonly timer: NodeJS.Timeout
}

type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly message: string }

const serverError = (code: string, message: string) =>
  new Error(`${code}: ${message}`)

/**
 * `pointer` is an RFC 6901 pointer into the document being refused, rooted at
 * `/`, because these diagnostics are published in `visual-diagnostic-result/v1`
 * documents and read back by the one-shot agent clients.
 */
const serverDiagnostic = (
  code: string,
  message: string,
  pointer = '/',
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path: VISUAL_SERVER_DOCUMENT,
  pointer,
  line: 1,
  column: 1,
})

/**
 * Compares two capabilities without leaking where they differ, or how long the
 * presented one is: both sides are reduced to a fixed-width digest first, so
 * the comparison is over equal-length buffers by construction.
 */
const secretEquals = (expected: string, presented: string | undefined) => {
  if (presented === undefined) return false
  const digest = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(expected), digest(presented))
}

const cookieValue = (header: string | undefined, name: string) => {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const split = part.indexOf('=')
    if (split < 0) continue
    if (part.slice(0, split).trim() === name) {
      return part.slice(split + 1).trim()
    }
  }
  return undefined
}

const bearerToken = (header: string | undefined) =>
  header === undefined
    ? undefined
    : /^Bearer +([\x21-\x7e]+)$/.exec(header)?.[1]

const isJsonContent = (header: string | undefined) =>
  header !== undefined && /^application\/json\s*(;.*)?$/i.test(header.trim())

/**
 * Buffers at most `limit` bytes while always draining the request, so an
 * oversized body costs bounded memory and still gets a clean HTTP answer
 * instead of a severed connection.
 */
const readJsonBody = async (
  incoming: IncomingMessage,
  limit: number,
): Promise<BodyResult> => {
  if (!isJsonContent(incoming.headers['content-type'])) {
    incoming.resume()
    return {
      ok: false,
      status: 415,
      message: 'Request body must be application/json',
    }
  }
  const chunks: Buffer[] = []
  let bytes = 0
  let overflowed = false
  for await (const chunk of incoming) {
    const part = chunk as Buffer
    bytes += part.byteLength
    if (bytes > limit) {
      overflowed = true
      continue
    }
    chunks.push(part)
  }
  if (overflowed) {
    return {
      ok: false,
      status: 413,
      message: `Request body of ${bytes} bytes exceeds the ${limit} byte ceiling`,
    }
  }
  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }
  } catch {
    return { ok: false, status: 400, message: 'Request body is not JSON' }
  }
}

/**
 * Widens one validated browser input into the journaled event. The runtime owns
 * every field the browser is not allowed to choose.
 */
const eventFrom = (
  input: VisualBrowserInput,
  envelope: VisualEventEnvelope,
): VisualEvent => {
  switch (input.type) {
    case 'chat.message':
      return { ...envelope, type: input.type, payload: input.payload }
    case 'choice.selected':
      return { ...envelope, type: input.type, payload: input.payload }
    case 'view.navigate':
      return { ...envelope, type: input.type, payload: input.payload }
    case 'session.end':
      return { ...envelope, type: input.type, payload: input.payload }
  }
}

/**
 * Serves one authenticated visual session over loopback. The handle owns the
 * session directory it created: `stop` recovers the handoff before deleting it,
 * and answers every later call with that same outcome.
 */
export const startVisualServer = async (
  options: VisualServerOptions,
): Promise<VisualServerHandle> => {
  const now = options.now ?? (() => new Date())
  const randomBytes = options.randomBytes ?? randomSource
  const agentPollMs = options.agentPollMs ?? VISUAL_SERVER_LIMITS.agentPollMs
  const assetRoot = resolve(options.assetRoot ?? DEFAULT_ASSET_ROOT)
  const request = options.request

  const drawHex = (size: number) => {
    const drawn = randomBytes(size)
    if (drawn.byteLength < size) {
      throw serverError(
        'YMVS301',
        `Random source returned ${drawn.byteLength} bytes for a ${size}-byte draw`,
      )
    }
    return drawn.subarray(0, size).toString('hex')
  }
  const stamp = () => now().toISOString()

  const session = await createVisualSession(request, {
    baseDir: options.baseDir,
    now,
    randomBytes,
  })
  const paths = session.paths
  const sessionId = basename(paths.root)
  const cookieSigningKey = drawHex(32)
  // The browser stores only a derived bearer value; the signing key stays in
  // this server process and disappears with the session.
  const browserAuthenticator = createHmac('sha256', cookieSigningKey)
    .update(sessionId)
    .digest('hex')
  // Not a credential: it authorises inline style for this page, nothing else.
  const styleNonce = drawHex(16)
  const browserHeaders = {
    ...VISUAL_BROWSER_HEADERS,
    'Content-Security-Policy': visualContentSecurityPolicy(styleNonce),
  }

  /** Set once the loopback listener exists; a failed start has to close it. */
  let closeListener: (() => Promise<void>) | undefined

  // Past this point a session directory exists on disk; a failed start must not
  // leave one behind for the next run to prune, nor a listener for the process
  // to outlive.
  const abandon = async (cause: unknown): Promise<never> => {
    await closeListener?.().catch(() => undefined)
    await removeVisualSession(paths).catch(() => undefined)
    throw cause
  }

  // `request.initialModel.graph` is already a fully resolved graph — the
  // caller compiled it (`buildVisualModelGraph`) before invoking
  // `yarramate-visual start` — so there is no in-session compile step left;
  // rendering is a direct projection of the request onto the wire shape.
  const rendered: VisualRenderedModel = {
    authority: request.initialModel.authority,
    initialView: request.initialModel.initialView,
    graph: request.initialModel.graph,
  }

  const capabilities: VisualCapabilities = {
    chat: request.chatEnabled,
    choices: request.chatEnabled,
    navigation: true,
    modelReplacement: false,
    transcript: true,
  }

  let listening = false
  let bootstrapSpent = false
  let agentAttached = false
  let lastSequence = 0
  let transcriptBytes = 0
  let frozen: VisualFreezeReason | undefined
  let inFlight: VisualEvent | undefined
  let lastSeenAt: string | undefined
  let pending: VisualEvent[] = []
  /**
   * What the browser has seen said, in order. It is derived from the same
   * events and responses the journal takes, so a browser that reloads inside
   * the grace is handed back the conversation it left rather than a blank one.
   */
  const transcript: VisualTranscriptRecord[] = []
  /** Option labels the agent presented, so a selection restores as its label. */
  const choiceLabels = new Map<string, Map<string, string>>()
  /**
   * The choice the agent presented and nobody has answered. It is session
   * state, not transcript: the reviewer's browser can only render the buttons
   * again after a reload if the session hands the question back.
   */
  let pendingChoice: VisualChoicePresentPayload | null = null
  /**
   * A journaled End is the last thing this session takes from the reviewer, so
   * no later question can ever be answered. The lock outlives the clearing
   * below: an agent response still in flight when the End landed must not hand
   * a reloading browser buttons that lead nowhere.
   */
  let choicesClosed = false
  const connections = new Map<string, WebSocket>()
  let browserConnectionReservations = 0
  const polls = new Set<PendingPoll>()
  const httpSockets = new Set<Socket>()
  const unclassifiedHttpSockets = new Set<Socket>()
  const stopResponseSockets = new Set<Socket>()

  /** Every sequence assignment and queue mutation runs in call order. */
  let admission: Promise<unknown> = Promise.resolve()
  const admit = <T>(action: () => Promise<T>): Promise<T> => {
    const next = admission.then(action)
    admission = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /**
   * Waits until nothing is left on the admission chain. `admission` absorbs its
   * own rejections, and work can still enqueue while draining (it refuses
   * itself), so the tail is re-read until it stops moving.
   */
  const drainAdmission = async () => {
    for (let tail = admission; ; tail = admission) {
      await tail
      if (tail === admission) return
    }
  }

  /**
   * Ends a session that reached one of its own ceilings, exactly once.
   *
   * `freeze` is reached from inside the admission chain and the transition
   * drains that same chain, so the entry that detected the limit is allowed to
   * answer its sender first: starting the transition inline would be a session
   * waiting on itself. Nothing is truncated — every record already accepted
   * stands, and only the closing one is added.
   */
  let limitFailure: Promise<void> | undefined
  const failOnLimit = () => {
    limitFailure ??= (async () => {
      await drainAdmission()
      try {
        // `server-failed` is the truth of it: not the reviewer, not the child,
        // but the runtime is why the conversation stopped. Recovery reads that
        // back as a failed handoff carrying everything the session did accept.
        await terminateVisualSession(active, 'server-failed')
      } finally {
        // Whatever the journal managed, the child must not be left holding a
        // turn on a session that has stopped answering.
        settleAllPolls()
      }
    })().catch(() => undefined)
  }

  /**
   * The first limit a session reaches is the one it reports for good, and a
   * limit the runtime detected for itself also ends it.
   */
  const freeze = (reason: VisualFreezeReason) => {
    if (frozen !== undefined) return
    frozen = reason
    if (LIMIT_FREEZE[reason]) failOnLimit()
  }

  /**
   * Everything a terminal cause touches, in one place. The transition below is
   * the only thing that moves a live session off `running`.
   */
  const active: ActiveVisualSession = {
    paths,
    lifecycle: 'starting',
    freeze,
    quiesce: drainAdmission,
    terminalEvent: { now, randomBytes },
    terminating: undefined,
    handoff: undefined,
  }

  const schedule =
    options.schedule ??
    ((task, ms) => {
      const timer = setTimeout(() => void task().catch(() => undefined), ms)
      // A grace nobody is waiting on must never be why a process stays alive.
      timer.unref()
      return () => clearTimeout(timer)
    })

  /**
   * The reviewer's browser is gone and the session is holding the conversation
   * open for it. Reconnecting inside the window resumes exactly where it left
   * off; reaching the end of it is a terminal cause like any other.
   */
  let cancelGrace: (() => void) | undefined
  const armGrace = () => {
    if (cancelGrace !== undefined || active.lifecycle !== 'running') return
    cancelGrace = schedule(async () => {
      cancelGrace = undefined
      if (connections.size > 0 || active.lifecycle !== 'running') return
      await stop('browser-timeout')
    }, VISUAL_LIMITS.reconnectMs)
  }
  const disarmGrace = () => {
    cancelGrace?.()
    cancelGrace = undefined
  }

  /** A journaled browser event, as the line the reviewer sees. */
  const recordEvent = (event: VisualEvent) => {
    // A session on its way out waits on nobody, and asking past the question
    // is how a reviewer declines to answer it.
    if (event.type === 'chat.message' || event.type === 'session.end') {
      pendingChoice = null
    }
    if (event.type === 'session.end') choicesClosed = true
    if (event.type === 'chat.message') {
      transcript.push({
        id: event.eventId,
        speaker: 'reviewer',
        text: event.payload.text,
      })
      return
    }
    if (event.type !== 'choice.selected') return
    if (pendingChoice?.choiceId === event.payload.choiceId) pendingChoice = null
    // The reviewer chose a label, not an identifier, so that is what the
    // restored conversation says they chose.
    const label = choiceLabels
      .get(event.payload.choiceId)
      ?.get(event.payload.optionId)
    transcript.push({
      id: event.eventId,
      speaker: 'reviewer',
      text: label ?? event.payload.optionId,
    })
  }

  /** An accepted agent response, as the line the reviewer sees. */
  const recordResponse = (response: VisualResponse) => {
    if (response.type === 'choice.present') {
      if (!choicesClosed) pendingChoice = response.payload
      choiceLabels.set(
        response.payload.choiceId,
        new Map(
          response.payload.options.map((option) => [option.id, option.label]),
        ),
      )
      return
    }
    const text =
      response.type === 'chat.response'
        ? response.payload.text
        : response.type === 'handoff.complete'
          ? response.payload.summary
          : undefined
    if (text === undefined) return
    transcript.push({ id: response.responseId, speaker: 'agent', text })
  }

  const snapshot = (): VisualSessionSnapshot => ({
    protocolVersion: VISUAL_PROTOCOL_VERSION,
    sessionId,
    authority: request.authority,
    title: request.title,
    description: request.description,
    chatEnabled: request.chatEnabled,
    capabilities,
    webSocketUrl,
    model: rendered,
    transcript: [...transcript],
    agentTurnOpen: openTurn(),
    pendingChoice,
    styleNonce,
    lastSequence,
    frozen: frozen !== undefined,
  })

  const status = (): VisualStatus => {
    const value: VisualStatus = {
      format: 'yarramate/visual-status/v1',
      protocolVersion: VISUAL_PROTOCOL_VERSION,
      sessionId,
      lifecycle: active.lifecycle,
      alreadyStopped: active.lifecycle === 'stopped',
      server: { listening, origin },
      browser: {
        connected: connections.size > 0,
        connections: connections.size,
        ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
        // Only while one is actually armed: a session whose window already
        // elapsed is not still waiting for that browser, and must not say so.
        ...(cancelGrace !== undefined && lastSeenAt !== undefined
          ? {
              graceExpiresAt: new Date(
                Date.parse(lastSeenAt) + VISUAL_LIMITS.reconnectMs,
              ).toISOString(),
            }
          : {}),
      },
      agent: {
        attached: agentAttached,
        inFlightEventId: inFlight?.eventId ?? null,
      },
      queue: {
        pendingEvents: pending.length,
        lastSequence,
        frozen: frozen !== undefined,
        ...(frozen === undefined ? {} : { frozenReason: frozen }),
      },
      capabilities,
      transcriptBytes,
      updatedAt: stamp(),
    }
    // A status document that does not validate is a runtime defect, not
    // untrusted input: the agent must never have to parse a broken report.
    const validated = parseVisualStatus(value)
    if (!validated.ok) {
      throw serverError(
        validated.diagnostics[0]?.code ?? 'YMVS108',
        `Session status is invalid: ${
          validated.diagnostics[0]?.message ?? 'unknown violation'
        }`,
      )
    }
    return value
  }

  const sendFrame = (socket: WebSocket, frame: VisualServerFrame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
  }

  const broadcast = (frame: VisualServerFrame) => {
    for (const socket of connections.values()) sendFrame(socket, frame)
  }

  const idleDelivery = (): VisualEventDelivery => ({
    waiting: true,
    lastSequence,
    pendingEvents: pending.length,
  })

  /**
   * While a turn is outstanding the only event the agent may see is the one it
   * already owns, so a repeated poll replays it and a later chat message waits
   * for the current response.
   */
  const deliverable = (after: number) =>
    inFlight === undefined
      ? pending.find((event) => event.sequence > after)
      : inFlight.sequence > after
        ? inFlight
        : undefined

  const takeDelivery = (after: number): VisualEventDelivery => {
    const event = deliverable(after)
    if (event === undefined) return idleDelivery()
    inFlight = event
    return {
      waiting: false,
      event,
      lastSequence,
      pendingEvents: pending.length,
    }
  }

  const wakePolls = () => {
    for (const poll of [...polls]) {
      if (deliverable(poll.after) === undefined) continue
      polls.delete(poll)
      clearTimeout(poll.timer)
      poll.settle(takeDelivery(poll.after))
    }
  }

  const settleAllPolls = () => {
    for (const poll of [...polls]) {
      polls.delete(poll)
      clearTimeout(poll.timer)
      poll.settle(idleDelivery())
    }
  }

  const httpServer = createServer()
  httpServer.on('connection', (socket) => {
    httpSockets.add(socket)
    unclassifiedHttpSockets.add(socket)
    socket.on('close', () => {
      httpSockets.delete(socket)
      unclassifiedHttpSockets.delete(socket)
      stopResponseSockets.delete(socket)
    })
  })
  httpServer.on('clientError', (_error, socket) => socket.destroy())

  const bound = Promise.withResolvers<void>()
  httpServer.once('error', bound.reject)
  // Loopback only, on a kernel-assigned port: the session is never reachable
  // from another host, and never collides with a well-known service.
  httpServer.listen(0, '127.0.0.1', () => {
    httpServer.removeListener('error', bound.reject)
    bound.resolve()
  })
  await bound.promise.catch(abandon)

  const address = httpServer.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  const authority = `127.0.0.1:${address.port}`
  const webSocketUrl = `ws://${authority}${VISUAL_SOCKET_PATH}`
  listening = true

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: VISUAL_SERVER_LIMITS.browserFrameBytes,
  })

  // A start that fails after the port is bound has to give it back; nothing
  // has published this origin yet, so there is nothing to drain first.
  closeListener = async () => {
    listening = false
    sockets.close()
    for (const socket of httpSockets) socket.destroy()
    const shut = Promise.withResolvers<void>()
    httpServer.close(() => shut.resolve())
    await shut.promise
  }

  // ---------------------------------------------------------------- responses

  const respond = (
    server: ServerResponse,
    code: number,
    body: string | Buffer,
    contentType: string,
  ) => {
    server.writeHead(code, {
      ...browserHeaders,
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body),
      // A draining session must not leave a pooled connection behind that
      // outlives its listener.
      ...(active.lifecycle === 'running' ? {} : { Connection: 'close' }),
    })
    server.end(body)
  }

  const respondJson = (server: ServerResponse, code: number, value: unknown) =>
    respond(
      server,
      code,
      JSON.stringify(value),
      'application/json; charset=utf-8',
    )

  const refuse = (server: ServerResponse, code: number, message: string) =>
    respond(server, code, `${message}\n`, 'text/plain; charset=utf-8')

  // ------------------------------------------------------------ browser input

  const admitBrowserInput = async (
    socket: WebSocket,
    raw: RawData,
    binary: boolean,
  ) => {
    if (binary) {
      sendFrame(socket, {
        kind: 'rejected',
        diagnostics: [
          serverDiagnostic('YMVS303', 'Browser frames must be UTF-8 JSON text'),
        ],
      })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      sendFrame(socket, {
        kind: 'rejected',
        diagnostics: [
          serverDiagnostic('YMVS109', 'Browser frame is not a JSON document'),
        ],
      })
      return
    }
    const input = parseVisualBrowserInput(parsed)
    if (!input.ok) {
      sendFrame(socket, { kind: 'rejected', diagnostics: input.diagnostics })
      return
    }
    await admit(async () => {
      // A frame can already be on the chain when a stop begins. Recovery must
      // see a journal nothing is still writing to, so anything that has not
      // been journaled yet is refused rather than raced.
      if (active.lifecycle !== 'running') {
        sendFrame(socket, {
          kind: 'rejected',
          diagnostics: [
            serverDiagnostic(
              'YMVS306',
              `Session is ${active.lifecycle} and no longer accepts input`,
            ),
          ],
        })
        return
      }
      if (frozen !== undefined) {
        sendFrame(socket, {
          kind: 'rejected',
          frozen,
          diagnostics: [
            serverDiagnostic('YMVS304', `Session input is frozen: ${frozen}`),
          ],
        })
        return
      }
      // A session that was started without a conversation has no chat and no
      // choices to make; the diagram, and moving around it, is all it granted.
      const granted =
        input.value.type === 'chat.message'
          ? capabilities.chat
          : input.value.type === 'choice.selected'
            ? capabilities.choices
            : true
      if (!granted) {
        sendFrame(socket, {
          kind: 'rejected',
          diagnostics: [
            serverDiagnostic(
              'YMVS309',
              `Session did not grant the capability "${input.value.type}" needs`,
              '/type',
            ),
          ],
        })
        return
      }
      // A browser cannot have seen an acknowledgement the journal never issued.
      // A stale claim is ordinary — a reconnect mid-turn looks exactly like one
      // — but a claim ahead of the journal means this frame was composed against
      // a session state that does not exist, so it is refused rather than
      // journaled behind a sequence its sender never read.
      if (input.value.lastAcknowledgedSequence > lastSequence) {
        sendFrame(socket, {
          kind: 'rejected',
          diagnostics: [
            serverDiagnostic(
              'YMVS308',
              `Browser acknowledged sequence ${input.value.lastAcknowledgedSequence}, past the journal's ${lastSequence}`,
              '/lastAcknowledgedSequence',
            ),
          ],
        })
        return
      }
      const event = eventFrom(input.value, {
        format: 'yarramate/visual-event/v1',
        sessionId,
        sequence: lastSequence + 1,
        eventId: drawHex(16),
        timestamp: stamp(),
      })
      const actionable = isActionableVisualEvent(event)
      if (actionable && pending.length >= VISUAL_LIMITS.pendingEvents) {
        freeze('pending-events')
        sendFrame(socket, {
          kind: 'rejected',
          frozen,
          diagnostics: [
            serverDiagnostic(
              'YMVS305',
              `Queue already holds the ${VISUAL_LIMITS.pendingEvents} event maximum`,
              '/sequence',
            ),
          ],
        })
        return
      }
      const appended = await appendVisualEvent(paths, event)
      if (!appended.ok) {
        if (appended.freeze !== undefined) freeze(appended.freeze)
        sendFrame(socket, {
          kind: 'rejected',
          ...(frozen === undefined ? {} : { frozen }),
          diagnostics: appended.diagnostics,
        })
        return
      }
      lastSequence = appended.lastSequence
      transcriptBytes = appended.transcriptBytes
      recordEvent(event)
      if (actionable) pending.push(event)
      // A journaled end is the last input this session takes. The agent still
      // has to see it, so the queue freezes rather than the socket closing.
      if (event.type === 'session.end') freeze('terminal-event')
      sendFrame(socket, {
        kind: 'accepted',
        sequence: event.sequence,
        eventId: event.eventId,
      })
      wakePolls()
    })
  }

  /**
   * Journals one transport record the runtime owns outright: a browser was
   * admitted, or the socket it was admitted on went away. `closedWith` is the
   * close code for the second and absent for the first.
   *
   * The browser neither sends these nor waits on them. They are non-actionable,
   * so they open no agent turn and never join the pending queue; they take
   * their sequence, identifier, and timestamp from the same admission chain
   * every other record does, so a connection is always journaled ahead of the
   * frames it goes on to send. A session that is no longer taking input skips
   * them, because a shutdown closing its own sockets is not the reviewer
   * leaving. The append is deliberately answered to nobody: a socket callback
   * awaits nothing, so a failure here becomes a freeze rather than a rejection
   * the process never handles.
   */
  const journalConnection = (
    connectionId: string,
    closedWith?: number,
    onJournaled?: () => void,
  ): Promise<boolean> =>
    admit(async () => {
      if (active.lifecycle !== 'running' || frozen !== undefined) return false
      const envelope = {
        format: 'yarramate/visual-event/v1',
        sessionId,
        sequence: lastSequence + 1,
        eventId: drawHex(16),
        timestamp: stamp(),
      } as const
      const event: VisualEvent =
        closedWith === undefined
          ? { ...envelope, type: 'browser.connected', payload: { connectionId } }
          : {
              ...envelope,
              type: 'browser.disconnected',
              payload: { connectionId, code: closedWith },
            }
      const appended = await appendVisualEvent(paths, event)
      if (!appended.ok) {
        if (appended.freeze !== undefined) freeze(appended.freeze)
        return false
      }
      lastSequence = appended.lastSequence
      transcriptBytes = appended.transcriptBytes
      onJournaled?.()
      return true
    }).catch(() => false)

  const attachBrowser = (
    socket: WebSocket,
    releaseReservation: () => void,
  ) => {
    const connectionId = drawHex(16)
    let registered = false
    lastSeenAt = stamp()
    socket.on('message', (raw, binary) => {
      // Nothing awaits this handler, so a rejection here would reach the
      // process as an unhandled one and take the runtime down with it. The
      // browser is told its frame failed; the session stays up.
      admitBrowserInput(socket, raw, binary).catch((cause: unknown) => {
        try {
          sendFrame(socket, {
            kind: 'rejected',
            diagnostics: [
              serverDiagnostic(
                'YMVS307',
                `Admitting the browser frame failed: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              ),
            ],
          })
        } catch {
          socket.close(1011)
        }
      })
    })
    socket.on('error', (error) => {
      // ws refuses an oversized frame before buffering it, which is exactly the
      // byte ceiling the protocol calls a freeze.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined
      if (code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
        freeze('message-bytes')
      }
    })
    socket.on('close', (code: number) => {
      if (!registered) return
      connections.delete(connectionId)
      lastSeenAt = stamp()
      // The code the transport reported, held inside the range the journal
      // accepts: a socket that died without one still has to be recorded as
      // having gone, and 1006 is what that abnormal closure is called.
      void journalConnection(
        connectionId,
        Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 1006,
      )
      if (connections.size === 0) armGrace()
    })
    // Admission is one serialized operation: the connection is visible only
    // after its event is durable, so no frame can be accepted against a
    void journalConnection(connectionId, undefined, () => {
      registered = true
      connections.set(connectionId, socket)
      disarmGrace()
    }).then((journaled) => {
      releaseReservation()
      if (!journaled || socket.readyState !== socket.OPEN) {
        socket.close(1011)
        return
      }
      sendFrame(socket, { kind: 'ready', snapshot: snapshot() })
    })
  }

  // ------------------------------------------------------------- agent routes

  const answerPoll = (server: ServerResponse, query: URLSearchParams) => {
    const raw = query.get('after') ?? '0'
    const after = Number(raw)
    if (!Number.isSafeInteger(after) || after < 0) {
      refuse(server, 400, `Query "after" must be a sequence, not "${raw}"`)
      return
    }
    const immediate = takeDelivery(after)
    if (!immediate.waiting || active.lifecycle !== 'running') {
      respondJson(server, 200, immediate)
      return
    }
    const poll: PendingPoll = {
      after,
      settle: (result) => respondJson(server, 200, result),
      timer: setTimeout(() => {
        polls.delete(poll)
        respondJson(server, 200, idleDelivery())
      }, agentPollMs),
    }
    polls.add(poll)
    server.on('close', () => {
      if (polls.delete(poll)) clearTimeout(poll.timer)
    })
  }

  /**
   * Events a turn-completing response has already answered.
   *
   * `completeTurn` only retires an event the agent actually polled for, so an
   * answer that arrives before the poll leaves the event queued. The browser
   * still has to be told its turn is over, and it is pruned back to the queue
   * it describes so it cannot outgrow it.
   */
  const answered = new Set<string>()

  const openTurn = () =>
    (inFlight === undefined ? pending : [inFlight, ...pending]).some(
      (event) => !answered.has(event.eventId),
    )

  const markAnswered = (response: VisualResponse) => {
    if (TURN_COMPLETING[response.type] !== true) return
    answered.add(response.eventId)
    for (const eventId of answered) {
      const queued =
        inFlight?.eventId === eventId ||
        pending.some((event) => event.eventId === eventId)
      if (!queued) answered.delete(eventId)
    }
  }

  const completeTurn = (response: VisualResponse) => {
    if (TURN_COMPLETING[response.type] !== true) return
    if (inFlight?.eventId !== response.eventId) return
    pending = pending.filter((event) => event.eventId !== response.eventId)
    inFlight = undefined
    wakePolls()
  }

  const acceptResponse = async (
    server: ServerResponse,
    incoming: IncomingMessage,
  ) => {
    const body = await readJsonBody(
      incoming,
      VISUAL_SERVER_LIMITS.agentBodyBytes,
    )
    if (!body.ok) {
      refuse(server, body.status, body.message)
      return
    }
    const parsed = parseVisualResponse(body.value)
    if (!parsed.ok) {
      respondJson(server, 400, {
        accepted: false,
        diagnostics: parsed.diagnostics,
      } satisfies VisualResponseAcceptance)
      return
    }
    const response = parsed.value
    if (response.sessionId !== sessionId) {
      respondJson(server, 409, {
        accepted: false,
        diagnostics: [
          serverDiagnostic(
            'YMVS126',
            `Response belongs to session "${response.sessionId}", not "${sessionId}"`,
            '/sessionId',
          ),
        ],
      } satisfies VisualResponseAcceptance)
      return
    }
    // The agent cannot hold a conversation a diagram-only session never
    // offered; the browser has nowhere to show one.
    if (
      !capabilities.chat &&
      (response.type === 'chat.response' || response.type === 'choice.present')
    ) {
      respondJson(server, 409, {
        accepted: false,
        diagnostics: [
          serverDiagnostic(
            'YMVS309',
            `Session did not grant the capability "${response.type}" needs`,
            '/type',
          ),
        ],
      } satisfies VisualResponseAcceptance)
      return
    }
    const result = await admit(
      async (): Promise<{
        readonly code: number
        readonly body: VisualResponseAcceptance
      }> => {
        // Same race as a browser frame: a request already on the chain must not
        // append to a session recovery has begun reading.
        if (active.lifecycle !== 'running') {
          return {
            code: 503,
            body: {
              accepted: false,
              diagnostics: [
                serverDiagnostic(
                  'YMVS306',
                  `Session is ${active.lifecycle} and no longer accepts responses`,
                ),
              ],
            },
          }
        }
        const appended = await appendVisualResponse(paths, response)
        if (!appended.ok) {
          if (appended.freeze !== undefined) freeze(appended.freeze)
          return {
            code: 409,
            body: { accepted: false, diagnostics: appended.diagnostics },
          }
        }
        transcriptBytes = appended.transcriptBytes
        // A response the runtime already journaled must not be broadcast or
        // compiled twice: a retried delivery is not a second turn.
        if (appended.duplicate) {
          return {
            code: 200,
            body: {
              accepted: true,
              duplicate: true,
              lastSequence: appended.lastSequence,
              diagnostics: [],
            },
          }
        }
        recordResponse(response)
        markAnswered(response)
        broadcast({ kind: 'response', response })
        completeTurn(response)
        return {
          code: 200,
          body: {
            accepted: true,
            duplicate: false,
            lastSequence,
            diagnostics: [],
          },
        }
      },
    )
    respondJson(server, result.code, result.body)
  }

  const acceptStop = async (
    server: ServerResponse,
    incoming: IncomingMessage,
  ) => {
    const responseSocket = incoming.socket
    const body = await readJsonBody(
      incoming,
      VISUAL_SERVER_LIMITS.agentControlBytes,
    )
    if (!body.ok) {
      refuse(server, body.status, body.message)
      return
    }
    const asked =
      typeof body.value === 'object' && body.value !== null
        ? (body.value as Readonly<Record<string, unknown>>)
        : {}
    const reason = asked.reason
    if (typeof reason !== 'string' || TERMINATION_REASONS[reason] !== true) {
      refuse(server, 400, 'Stop requires a known termination reason')
      return
    }
    if (
      asked.includeTranscript !== undefined &&
      typeof asked.includeTranscript !== 'boolean'
    ) {
      refuse(server, 400, 'Stop takes a boolean "includeTranscript" or none')
      return
    }
    // Every stop response already in flight is protected from the shared
    // teardown. The response that wins the stop does not get to close its
    // concurrent callers before they can observe the same result.
    const closed = await stop(
      reason as VisualTerminationReason,
      asked.includeTranscript,
    )
    server.on('finish', () => responseSocket.end())
    respondJson(server, 200, closed)
  }

  const serveAgent = async (
    incoming: IncomingMessage,
    server: ServerResponse,
    pathname: string,
    query: URLSearchParams,
  ) => {
    // An agent is not a browser. A request carrying an Origin came from a page,
    // which must never be able to spend a leaked agent capability.
    if (incoming.headers.origin !== undefined) {
      refuse(server, 403, 'Agent routes reject browser-originated requests')
      return
    }
    if (
      !secretEquals(
        session.agentToken,
        bearerToken(incoming.headers.authorization),
      )
    ) {
      refuse(server, 401, 'Agent capability required')
      return
    }
    agentAttached = true
    if (pathname === '/api/agent/events') {
      if (incoming.method !== 'GET') return refuse(server, 405, 'Use GET')
      answerPoll(server, query)
      return
    }
    if (pathname === '/api/agent/status') {
      if (incoming.method !== 'GET') return refuse(server, 405, 'Use GET')
      respondJson(server, 200, status())
      return
    }
    if (pathname === '/api/agent/responses') {
      if (incoming.method !== 'POST') return refuse(server, 405, 'Use POST')
      await acceptResponse(server, incoming)
      return
    }
    if (pathname === '/api/agent/stop') {
      if (incoming.method !== 'POST') return refuse(server, 405, 'Use POST')
      await acceptStop(server, incoming)
      return
    }
    refuse(server, 404, 'No such route')
  }

  // ----------------------------------------------------------- browser routes

  const assetPath = (pathname: string) => {
    if (pathname === '/') return join(assetRoot, 'index.html')
    const prefix = '/assets/'
    if (!pathname.startsWith(prefix)) return undefined
    const name = pathname.slice(prefix.length)
    if (!ASSET_NAME.test(name)) return undefined
    const target = resolve(assetRoot, 'assets', name)
    // The name cannot carry a separator, so this only confirms what the pattern
    // already guaranteed — which is the point of having both.
    return target.startsWith(`${assetRoot}${sep}`) ? target : undefined
  }

  const serveAsset = async (server: ServerResponse, pathname: string) => {
    const target = assetPath(pathname)
    const contentType =
      target === undefined ? undefined : CONTENT_TYPES[extname(target)]
    if (target === undefined || contentType === undefined) {
      refuse(server, 404, 'No such asset')
      return
    }
    try {
      // lstat, never stat: a symlink inside the asset root is a link out of it.
      const entry = await lstat(target)
      if (!entry.isFile()) {
        refuse(server, 404, 'No such asset')
        return
      }
      respond(server, 200, await readFile(target), contentType)
    } catch {
      refuse(server, 404, 'No such asset')
    }
  }

  const serveBootstrap = (server: ServerResponse, query: URLSearchParams) => {
    const key = query.get('key') ?? undefined
    if (bootstrapSpent || !secretEquals(session.browserToken, key)) {
      refuse(server, 403, 'Bootstrap capability is not valid')
      return
    }
    // One-time by construction: the URL capability buys exactly one cookie, and
    // the cookie carries a different secret, so a leaked URL cannot be replayed
    // and a leaked cookie cannot be pasted into an address bar.
    bootstrapSpent = true
    server.writeHead(303, {
      ...browserHeaders,
      Location: '/',
      'Set-Cookie': `${COOKIE_NAME}=${browserAuthenticator}; HttpOnly; SameSite=Strict; Secure; Path=/`,
      'Content-Length': 0,
    })
    server.end()
  }

  const serveBrowser = async (
    incoming: IncomingMessage,
    server: ServerResponse,
    pathname: string,
    query: URLSearchParams,
  ) => {
    const sent = incoming.headers.origin
    if (sent !== undefined && sent !== origin) {
      refuse(server, 403, 'Origin is not this session')
      return
    }
    if (incoming.method !== 'GET') {
      refuse(server, 405, 'Use GET')
      return
    }
    if (pathname === '/bootstrap') {
      serveBootstrap(server, query)
      return
    }
    if (
      !secretEquals(
        browserAuthenticator,
        cookieValue(incoming.headers.cookie, COOKIE_NAME),
      )
    ) {
      refuse(server, 401, 'Session cookie required')
      return
    }
    if (pathname === '/api/session') {
      respondJson(server, 200, snapshot())
      return
    }
    await serveAsset(server, pathname)
  }

  httpServer.on('request', (incoming, server) => {
    const responseSocket = incoming.socket
    unclassifiedHttpSockets.delete(responseSocket)
    if ((incoming.url ?? '/').split('?')[0] === '/api/agent/stop') {
      stopResponseSockets.add(responseSocket)
      const releaseResponseSocket = () => {
        stopResponseSockets.delete(responseSocket)
      }
      server.once('finish', releaseResponseSocket)
      server.once('close', releaseResponseSocket)
    }
    void (async () => {
      try {
        // Rebinding defence: a request that reached this port under any other
        // name was routed here by something other than the browser we started.
        if (incoming.headers.host !== authority) {
          refuse(server, 403, 'Host is not the bound loopback authority')
          return
        }
        const [rawPath = '/', rawQuery = ''] = (incoming.url ?? '/').split('?')
        let pathname: string
        try {
          pathname = decodeURIComponent(rawPath)
        } catch {
          refuse(server, 400, 'Request target is not a valid URL path')
          return
        }
        if (pathname.includes('\0')) {
          refuse(server, 400, 'Request target is not a valid URL path')
          return
        }
        const query = new URLSearchParams(rawQuery)
        if (pathname.startsWith('/api/agent/')) {
          await serveAgent(incoming, server, pathname, query)
          return
        }
        await serveBrowser(incoming, server, pathname, query)
      } catch (cause) {
        if (server.headersSent) server.destroy(cause as Error)
        else refuse(server, 500, 'Session server failed')
      }
    })()
  })

  httpServer.on('upgrade', (incoming, socket: Duplex, head) => {
    const deny = (code: number, message: string) => {
      socket.write(
        `HTTP/1.1 ${code} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      )
      socket.destroy()
    }
    if (active.lifecycle !== 'running') return deny(503, 'Service Unavailable')
    if (incoming.headers.host !== authority) return deny(403, 'Forbidden')
    // An upgrade always carries an Origin, so it is checked without exception.
    if (incoming.headers.origin !== origin) return deny(403, 'Forbidden')
    const [rawPath = '/'] = (incoming.url ?? '/').split('?')
    if (rawPath !== VISUAL_SOCKET_PATH) return deny(404, 'Not Found')
    if (
      !secretEquals(
        browserAuthenticator,
        cookieValue(incoming.headers.cookie, COOKIE_NAME),
      )
    ) {
      return deny(401, 'Unauthorized')
    }
    if (
      connections.size + browserConnectionReservations >=
      VISUAL_SERVER_LIMITS.browserConnections
    ) {
      return deny(503, 'Service Unavailable')
    }
    browserConnectionReservations += 1
    try {
      sockets.handleUpgrade(incoming, socket, head, (browser) => {
        attachBrowser(browser, () => {
          browserConnectionReservations -= 1
        })
      })
    } catch (cause) {
      browserConnectionReservations -= 1
      throw cause
    }
  })

  // ----------------------------------------------------------------- shutdown

  const { promise: closed, resolve: announceClosed } =
    Promise.withResolvers<VisualServerClosed>()
  let stopping: Promise<VisualServerClosed> | undefined

  const stop = async (
    reason: VisualTerminationReason,
    includeTranscript = options.includeTranscript ?? false,
  ): Promise<VisualServerClosed> => {
    if (stopping !== undefined) {
      return { ...(await stopping), alreadyStopped: true }
    }
    const attempt = (async () => {
      // Frozen before anything is torn down: a request already on the wire
      // must not be journaled behind the recovery this stop is about to read.
      active.lifecycle = 'draining'
      listening = false
      disarmGrace()
      // Waiting agents are answered before any socket is torn down, so a poll
      // in flight during a stop still receives its non-terminal idle result.
      settleAllPolls()
      for (const socket of connections.values()) {
        sendFrame(socket, { kind: 'closing', reason })
        socket.close(1001)
      }
      sockets.close()
      // The one transition: freeze, cancel the compiler, let admitted work
      // finish, journal the terminal event, and recover — all without deleting
      // anything, so shutdown can never be the step that loses confirmed state.
      // A session that already ended answers with the handoff it ended with.
      const terminal = await terminateVisualSession(active, reason)
      // Keep the listener alive while stop requests already reaching the port
      // join the shared attempt. Closing it earlier resets accepted idle
      // sockets before Node has emitted their request events.
      httpServer.close()
      // Stop requests already on the wire, including accepted sockets whose
      // request event has not fired yet, must survive long enough to answer.
      for (const socket of httpSockets) {
        if (
          !stopResponseSockets.has(socket) &&
          !unclassifiedHttpSockets.has(socket)
        ) {
          socket.end()
        }
      }
      // The transcript is read once, here, and only if this stop asked for it;
      // the same read is what removes the marked root.
      const removed = await removeVisualSession(paths, includeTranscript)
      active.lifecycle = 'stopped'
      const outcome: VisualServerClosed = {
        reason,
        alreadyStopped: false,
        handoff: removed ?? terminal,
      }
      announceClosed(outcome)
      return outcome
    })()
    // Every step of a teardown is idempotent, and one that throws has left the
    // session directory behind for someone to finish. Forgetting the failed
    // attempt is what makes the next stop that fresh run rather than a replay
    // of the same rejection; observing it here is what keeps the cached promise
    // from being a rejection nothing ever handled.
    stopping = attempt
    attempt.catch(() => {
      if (stopping === attempt) stopping = undefined
    })
    return attempt
  }

  // Everything from here is publication, and every way it can fail — a
  // descriptor that will not write, a document that does not validate, a clock
  // that answers with nonsense — leaves a bound port and a session directory
  // behind unless it goes through `abandon`.
  let started: VisualSessionStarted
  try {
    await writeVisualSessionDescriptor(paths, {
      format: 'yarramate/visual-session-descriptor/v1',
      protocolVersion: VISUAL_PROTOCOL_VERSION,
      sessionId,
      origin,
      agentCapability: session.agentToken,
      sessionRoot: paths.root,
      journalPath: paths.journal,
      createdAt: stamp(),
    })
    started = {
      format: 'yarramate/visual-session-started/v1',
      protocolVersion: VISUAL_PROTOCOL_VERSION,
      sessionId,
      authority: request.authority,
      title: request.title,
      chatEnabled: request.chatEnabled,
      browserUrl: `${origin}/bootstrap?key=${session.browserToken}`,
      webSocketUrl,
      origin,
      descriptorPath: paths.descriptor,
      sessionRoot: paths.root,
      capabilities,
      startedAt: stamp(),
    }
    const validated = parseVisualSessionStarted(started)
    if (!validated.ok) {
      throw serverError(
        validated.diagnostics[0]?.code ?? 'YMVS102',
        `Started session is invalid: ${
          validated.diagnostics[0]?.message ?? 'unknown violation'
        }`,
      )
    }
  } catch (cause) {
    return abandon(cause)
  }
  active.lifecycle = 'running'

  return { started, closed, status, stop: (reason) => stop(reason) }
}
