import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  watch,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  readVisualSessionDescriptor,
  recoverVisualSessionClient as clientRecover,
  sendVisualResponse as clientRespond,
  stopVisualSessionClient as clientStop,
} from '../src/adapters/visual/client.js'
import {
  VISUAL_LIMITS,
  type VisualBrowserInput,
  type VisualEvent,
  type VisualHandoff,
  type VisualHandoffSummary,
  type VisualModel,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualSessionRequest,
} from '../src/adapters/visual/protocol.js'
import {
  startVisualServer,
  type VisualServerFrame,
  type VisualServerHandle,
  type VisualServerOptions,
} from '../src/adapters/visual/session-server.js'
import {
  appendTerminalEvent,
  appendVisualEvent,
  createVisualSession,
  recoverVisualSession,
} from '../src/adapters/visual/session-store.js'

/**
 * The complete visual conversation, driven end to end over the real transport:
 * a real session server, a real browser socket, the real agent client, and the
 * trusted-compiler stand-in. Nothing is mocked, so every terminal cause below
 * converges through the one transition the runtime actually ships.
 */

const fixtures = fileURLToPath(new URL('./fixtures/visual/', import.meta.url))
const fakeCompiler = join(fixtures, 'fake-likec4.mjs')
const assetRoot = join(fixtures, 'browser-assets')

const modelWith = (marker?: string): VisualModel => ({
  format: 'yarramate/visual-model/v1',
  authority: 'ad-hoc',
  initialView: 'choices',
  sourceDigests: {},
  files: {
    'likec4.config.json': '{"name":"visual"}',
    // The fake compiler selects its behaviour from a marker comment inside a
    // staged source file, so a hanging compile is a property of the model.
    'model.likec4': `model { system = system "System" }${
      marker === undefined ? '' : `\n// fake:${marker}`
    }`,
    'views/choices.likec4': 'views { view choices { include * } }',
  },
})

const requestWith = (
  overrides: Partial<VisualSessionRequest> = {},
): VisualSessionRequest => ({
  format: 'yarramate/visual-session-request/v1',
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  compiler: { command: process.execPath, args: [fakeCompiler] },
  initialModel: modelWith(),
  ...overrides,
})

const identifier = (index: number) => index.toString(16).padStart(32, '0')

let responses = 0
const nextResponseId = () => identifier(0xa0000 + responses++)

// --------------------------------------------------------------- browser side

const chatMessage = (text: string): VisualBrowserInput => ({
  type: 'chat.message',
  lastAcknowledgedSequence: 0,
  payload: { text },
})

const choiceSelected = (optionId: string): VisualBrowserInput => ({
  type: 'choice.selected',
  lastAcknowledgedSequence: 0,
  payload: { choiceId: 'delivery', optionId },
})

const viewNavigate = (viewId: string): VisualBrowserInput => ({
  type: 'view.navigate',
  lastAcknowledgedSequence: 0,
  payload: { viewId, requiresAttention: false },
})

const sessionEnd = (): VisualBrowserInput => ({
  type: 'session.end',
  lastAcknowledgedSequence: 0,
  payload: { reason: 'user-ended' },
})

// ----------------------------------------------------------------- agent side

const responseTo = <Type extends VisualResponse['type']>(
  event: VisualEvent,
  type: Type,
  payload: Extract<VisualResponse, { readonly type: Type }>['payload'],
): VisualResponse =>
  ({
    format: 'yarramate/visual-response/v1',
    sessionId: event.sessionId,
    responseId: nextResponseId(),
    eventId: event.eventId,
    type,
    timestamp: '2026-08-08T00:00:02.000Z',
    payload,
  }) as VisualResponse

const chatReply = (event: VisualEvent, text: string) =>
  responseTo(event, 'chat.response', { text })

const choiceAcknowledged = (event: VisualEvent) =>
  responseTo(event, 'chat.response', { text: 'Recorded that choice.' })

const completeHandoff = (event: VisualEvent, summary: VisualHandoffSummary) =>
  responseTo(event, 'handoff.complete', summary)

// -------------------------------------------------------------------- harness

interface VisualFixture {
  readonly handle: VisualServerHandle
  readonly descriptorPath: string
  readonly sessionRoot: string
  readonly sessionId: string
  readonly origin: string
  /** Resolves with the reconnect window, in milliseconds, this session armed. */
  readonly graceScheduled: Promise<number>
  /** Windows that were cancelled before they could fire. */
  readonly cancelledGraces: number[]
  /** Elapses the armed reconnect window without waiting out real time. */
  readonly expireGrace: () => Promise<void>
}

let baseDir = ''
let compilerLog = ''
const running: VisualServerHandle[] = []

const startVisualFixture = async (
  overrides: Partial<VisualServerOptions> & {
    readonly chatEnabled?: boolean
  } = {},
): Promise<VisualFixture> => {
  const { chatEnabled = true, ...serverOverrides } = overrides
  const armed = Promise.withResolvers<number>()
  const cancelledGraces: number[] = []
  let pending: (() => Promise<void>) | undefined
  const handle = await startVisualServer({
    request: requestWith({ chatEnabled }),
    baseDir,
    assetRoot,
    // Long enough that an event racing a poll always wins.
    agentPollMs: 4000,
    // The reconnect grace is observed rather than waited out: the window the
    // session asks for is recorded, and the test decides when it elapses.
    schedule: (task, ms) => {
      pending = task
      armed.resolve(ms)
      return () => {
        cancelledGraces.push(ms)
        pending = undefined
      }
    },
    ...serverOverrides,
  })
  running.push(handle)
  return {
    handle,
    descriptorPath: handle.started.descriptorPath,
    sessionRoot: handle.started.sessionRoot,
    sessionId: handle.started.sessionId,
    origin: handle.started.origin,
    graceScheduled: armed.promise,
    cancelledGraces,
    expireGrace: async () => {
      const fire = pending
      if (fire === undefined) throw new Error('no reconnect grace is armed')
      pending = undefined
      await fire()
    },
  }
}

const buffered = new WeakMap<WebSocket, VisualServerFrame[]>()

const bootstrapCookie = async (visual: VisualFixture) => {
  const response = await fetch(visual.handle.started.browserUrl, {
    redirect: 'manual',
  })
  const header = response.headers.get('set-cookie')
  if (header === null) throw new Error('bootstrap returned no cookie')
  return header.split(';')[0] as string
}

const openBrowserSocket = async (visual: VisualFixture, cookie: string) => {
  const socket = new WebSocket(visual.handle.started.webSocketUrl, {
    headers: { Cookie: cookie, Origin: visual.origin },
  })
  const frames: VisualServerFrame[] = []
  buffered.set(socket, frames)
  socket.on('message', (data) => {
    frames.push(JSON.parse(String(data)) as VisualServerFrame)
  })
  await once(socket, 'open')
  return socket
}

const connectFixtureBrowser = async (visual: VisualFixture) =>
  openBrowserSocket(visual, await bootstrapCookie(visual))

/**
 * The next frame of one kind. The server sends `ready` the moment it accepts
 * the upgrade, which can land before a test starts listening, so frames are
 * buffered from construction and claimed here.
 */
const nextFrame = async <Kind extends VisualServerFrame['kind']>(
  socket: WebSocket,
  kind: Kind,
): Promise<Extract<VisualServerFrame, { kind: Kind }>> => {
  const frames = buffered.get(socket) ?? []
  for (;;) {
    const index = frames.findIndex((frame) => frame.kind === kind)
    if (index >= 0) {
      return frames.splice(index, 1)[0] as Extract<
        VisualServerFrame,
        { kind: Kind }
      >
    }
    await once(socket, 'message')
  }
}

const send = (socket: WebSocket, input: VisualBrowserInput) =>
  socket.send(JSON.stringify(input))

const closeSocket = async (socket: WebSocket) => {
  if (socket.readyState === socket.CLOSED) return
  const closed = once(socket, 'close')
  socket.close()
  await closed
}

// --------------------------------------------------------- agent-side clients

const descriptorAt = async (
  descriptorPath: string,
): Promise<VisualSessionDescriptor> => {
  const descriptor = await readVisualSessionDescriptor(descriptorPath)
  if (!descriptor.ok) {
    throw new Error(
      `descriptor "${descriptorPath}" is unusable: ${descriptor.diagnostics[0]?.message}`,
    )
  }
  return descriptor.value
}

const sendVisualResponse = async (
  descriptorPath: string,
  response: VisualResponse,
) => {
  const accepted = await clientRespond(
    await descriptorAt(descriptorPath),
    response,
  )
  if (!accepted.ok) {
    throw new Error(
      `response was refused: ${JSON.stringify(accepted.diagnostics)}`,
    )
  }
  return accepted.value
}

const recoverVisualSessionClient = async (
  descriptorPath: string,
  options: { readonly includeTranscript: boolean } = {
    includeTranscript: false,
  },
): Promise<VisualHandoff> => {
  const recovered = await clientRecover(
    await descriptorAt(descriptorPath),
    options.includeTranscript,
  )
  if (!recovered.ok) {
    throw new Error(
      `recovery was refused: ${JSON.stringify(recovered.diagnostics)}`,
    )
  }
  return recovered.value
}

const stopVisualSessionClient = async (
  descriptorPath: string,
  options: { readonly includeTranscript: boolean } = {
    includeTranscript: false,
  },
): Promise<VisualHandoff | undefined> => {
  const stopped = await clientStop(
    await descriptorAt(descriptorPath),
    options.includeTranscript,
  )
  if (!stopped.ok) {
    throw new Error(`stop was refused: ${JSON.stringify(stopped.diagnostics)}`)
  }
  return stopped.value
}

const agentFetch = async (
  descriptorPath: string,
  route: string,
  body?: unknown,
) => {
  const descriptor = await descriptorAt(descriptorPath)
  return fetch(`${descriptor.origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${descriptor.agentCapability}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

// ------------------------------------------------------------------- journals

const journalRecords = async (
  root: string,
): Promise<readonly (VisualEvent | VisualResponse)[]> =>
  (await readFile(join(root, 'journal.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as VisualEvent | VisualResponse)

/**
 * Waits for the journal a descriptor names to carry an event past `after`. The
 * journal is the record an out-of-process agent reads, so the wait is on the
 * file's own change events rather than on a guessed delay.
 */
const waitForVisualEvent = async (
  descriptorPath: string,
  after: number,
): Promise<VisualEvent> => {
  const { journalPath } = await descriptorAt(descriptorPath)
  // The journal exists from session creation, and the watcher buffers from
  // here, so an append racing the first read is still delivered below.
  const changes = watch(journalPath)
  const journaled = async () => {
    const lines = (await readFile(journalPath, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
    for (const line of lines) {
      const record = JSON.parse(line) as VisualEvent | VisualResponse
      if (
        record.format === 'yarramate/visual-event/v1' &&
        record.sequence > after
      ) {
        return record
      }
    }
    return undefined
  }
  const already = await journaled()
  if (already !== undefined) {
    await changes.return?.(undefined)
    return already
  }
  for await (const _change of changes) {
    const appended = await journaled()
    if (appended !== undefined) return appended
  }
  throw new Error(`no event past ${after} in "${journalPath}"`)
}

/**
 * Runs `action` and returns once the trusted compiler has been executed once
 * more than before it. The fake command records every execution before it does
 * anything else, so a run that appears here and does not finish is a compile
 * stage that is genuinely in flight.
 */
const whileCompiling = async (action: () => void) => {
  const executions = async () =>
    (await readFile(compilerLog, 'utf8')).split('\n').filter(Boolean).length
  const before = await executions()
  const changes = watch(compilerLog)
  action()
  for await (const _change of changes) {
    if ((await executions()) > before) return
  }
}

/** A session directory whose runtime is gone, as a restart finds it. */
const plantVisualSession = async (
  records: (sessionId: string) => readonly (VisualEvent | VisualResponse)[],
  torn = '',
) => {
  const created = await createVisualSession(requestWith(), {
    baseDir,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
    randomBytes,
  })
  const sessionId = basename(created.paths.root)
  await writeFile(
    created.paths.journal,
    `${records(sessionId)
      .map((record) => `${JSON.stringify(record)}\n`)
      .join('')}${torn}`,
  )
  return { paths: created.paths, sessionId }
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'yarramate-visual-journey-'))
  compilerLog = join(baseDir, 'compiler.log')
  await writeFile(compilerLog, '')
  process.env.YARRAMATE_FAKE_LIKEC4_LOG = compilerLog
})

afterEach(async () => {
  delete process.env.YARRAMATE_FAKE_LIKEC4_LOG
  for (const handle of running.splice(0)) {
    await handle.stop('main-cancelled').catch(() => undefined)
  }
  await rm(baseDir, { recursive: true, force: true })
})

describe('the complete visual conversation', () => {
  it('returns a summary, optionally exposes the transcript, and removes the session on End', async () => {
    const visual = await startVisualFixture({ chatEnabled: true })
    const browser = await connectFixtureBrowser(visual)

    send(browser, chatMessage('Explain option B'))
    const message = await waitForVisualEvent(visual.descriptorPath, 0)
    await sendVisualResponse(
      visual.descriptorPath,
      chatReply(message, 'Option B isolates rendering.'),
    )

    send(browser, choiceSelected('option-b'))
    await sendVisualResponse(
      visual.descriptorPath,
      choiceAcknowledged(await waitForVisualEvent(visual.descriptorPath, 1)),
    )

    send(browser, sessionEnd())
    const ending = await waitForVisualEvent(visual.descriptorPath, 2)
    await sendVisualResponse(
      visual.descriptorPath,
      completeHandoff(ending, {
        summary: 'Selected option B.',
        confirmedDecisions: ['option-b'],
        requestedChanges: [],
        unresolvedQuestions: [],
        finalViews: ['choices', 'option-b'],
      }),
    )

    expect(
      await recoverVisualSessionClient(visual.descriptorPath, {
        includeTranscript: false,
      }),
    ).toMatchObject({
      decision: 'completed',
      terminationReason: 'user-ended',
      summary: 'Selected option B.',
      confirmedDecisions: ['option-b'],
      transcript: undefined,
    })
    expect(
      await recoverVisualSessionClient(visual.descriptorPath, {
        includeTranscript: true,
      }),
    ).toMatchObject({ transcript: expect.any(Array) })
    // Recovery is a read: the raw transcript stays available until the stop.
    expect(existsSync(visual.sessionRoot)).toBe(true)

    await stopVisualSessionClient(visual.descriptorPath)
    expect(existsSync(visual.sessionRoot)).toBe(false)
    await expect(fetch(visual.origin)).rejects.toThrow()
    await closeSocket(browser)
  })

  it('journals the reviewer End once and hands it back as the terminal cause', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)

    send(browser, sessionEnd())
    // Sequence 1 is the arrival the runtime journaled for this browser.
    const ending = await waitForVisualEvent(visual.descriptorPath, 1)
    await sendVisualResponse(
      visual.descriptorPath,
      completeHandoff(ending, {
        summary: 'Ended without a decision.',
        confirmedDecisions: [],
        requestedChanges: [],
        unresolvedQuestions: [],
        finalViews: ['choices'],
      }),
    )
    const beforeStop = await journalRecords(visual.sessionRoot)
    expect(
      beforeStop.filter(
        (record) =>
          record.format === 'yarramate/visual-event/v1' &&
          record.type === 'session.end',
      ),
    ).toHaveLength(1)

    // The stop asks for `main-cancelled`, but the reviewer's End is already
    // this session's terminal event, and a session has exactly one.
    const closed = await visual.handle.stop('main-cancelled')
    expect(closed.handoff).toMatchObject({
      decision: 'completed',
      terminationReason: 'user-ended',
      lastSequence: ending.sequence,
    })
    await closeSocket(browser)
  })

  it('hands the raw transcript to the stop that asked for it', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)
    send(browser, chatMessage('one question'))
    await nextFrame(browser, 'accepted')

    const handoff = await stopVisualSessionClient(visual.descriptorPath, {
      includeTranscript: true,
    })
    // The runtime's own terminal record is in the transcript it hands over,
    // and the transcript is the last thing read before the directory goes.
    expect(handoff?.transcript?.map((record) => record.type)).toEqual([
      'browser.connected',
      'chat.message',
      'session.end',
    ])
    expect(handoff).toMatchObject({ terminationReason: 'main-cancelled' })
    expect(existsSync(visual.sessionRoot)).toBe(false)
    await closeSocket(browser)
  })
})

describe('the visual recovery matrix', () => {
  it('derives a partial summary when the child fails before the handoff', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)

    send(browser, viewNavigate('option-b'))
    await nextFrame(browser, 'accepted')
    send(browser, chatMessage('Why option B?'))
    await waitForVisualEvent(visual.descriptorPath, 1)

    // The child died without submitting a handoff, so the main agent closes
    // the session under the reason it observed.
    const stopped = await agentFetch(visual.descriptorPath, '/api/agent/stop', {
      reason: 'child-failed',
    })
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({
      reason: 'child-failed',
      alreadyStopped: false,
      handoff: {
        decision: 'failed',
        terminationReason: 'child-failed',
        summary: expect.stringContaining('reconstructed'),
        finalViews: ['option-b'],
      },
    })
    expect(existsSync(visual.sessionRoot)).toBe(false)
    await closeSocket(browser)
  })

  it('ends the session exactly five minutes after the browser disconnects', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)
    await nextFrame(browser, 'ready')

    await closeSocket(browser)
    expect(await visual.graceScheduled).toBe(VISUAL_LIMITS.reconnectMs)
    expect(VISUAL_LIMITS.reconnectMs).toBe(5 * 60 * 1000)
    // The session says, while it is still true, when it stops waiting.
    expect(visual.handle.status().browser.graceExpiresAt).toBe(
      new Date(
        Date.parse(visual.handle.status().browser.lastSeenAt as string) +
          VISUAL_LIMITS.reconnectMs,
      ).toISOString(),
    )

    await visual.expireGrace()

    expect((await journalRecords(visual.sessionRoot)).at(-1)).toMatchObject({
      format: 'yarramate/visual-event/v1',
      type: 'session.end',
      payload: { reason: 'browser-timeout' },
    })
    expect(visual.handle.status().queue).toMatchObject({
      frozen: true,
      frozenReason: 'terminal-event',
    })
    // The window is spent, so the session no longer claims to be holding one.
    expect(visual.handle.status().browser.graceExpiresAt).toBeUndefined()
    expect(
      await recoverVisualSessionClient(visual.descriptorPath),
    ).toMatchObject({ terminationReason: 'browser-timeout' })
  })

  it('cancels the disconnect grace when the browser reconnects inside it', async () => {
    const visual = await startVisualFixture()
    const cookie = await bootstrapCookie(visual)
    const first = await openBrowserSocket(visual, cookie)
    await nextFrame(first, 'ready')

    await closeSocket(first)
    expect(await visual.graceScheduled).toBe(VISUAL_LIMITS.reconnectMs)

    const second = await openBrowserSocket(visual, cookie)
    await nextFrame(second, 'ready')
    expect(visual.cancelledGraces).toEqual([VISUAL_LIMITS.reconnectMs])

    // Nothing terminal was journaled, so the reviewer can still speak.
    send(second, chatMessage('still here'))
    // Two arrivals and the departure between them are journaled ahead of it,
    // so the reviewer's first message is the fourth record either way.
    await expect(nextFrame(second, 'accepted')).resolves.toMatchObject({
      sequence: 4,
    })
    expect(visual.handle.status().lifecycle).toBe('running')
    await closeSocket(second)
  })

  it('aborts an active compiler process when the main agent cancels', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)
    send(browser, chatMessage('redraw it'))
    const asked = await nextFrame(browser, 'accepted')

    let posted: Promise<Response> | undefined
    await whileCompiling(() => {
      posted = agentFetch(visual.descriptorPath, '/api/agent/responses', {
        format: 'yarramate/visual-response/v1',
        sessionId: visual.sessionId,
        responseId: nextResponseId(),
        eventId: asked.eventId,
        type: 'model.replace',
        timestamp: '2026-08-08T00:00:03.000Z',
        // This candidate never finishes compiling on its own.
        payload: { model: modelWith('hang') },
      })
    })

    const started = Date.now()
    const closed = await visual.handle.stop('main-cancelled')
    // Cancelled, not waited out: the compiler's own budget is 30 seconds.
    expect(Date.now() - started).toBeLessThan(15_000)

    const body = (await (await posted)?.json()) as {
      readonly diagnostics: readonly { readonly code: string }[]
    }
    expect(body.diagnostics.map((entry) => entry.code)).toContain('YMVS204')
    expect(closed.handoff).toMatchObject({
      terminationReason: 'main-cancelled',
      decision: 'failed',
    })
    await closeSocket(browser)
  }, 45_000)

  it('recovers a restarted runtime from the journal without acknowledging a truncated record', async () => {
    const torn = '{"format":"yarramate/visual-event/v1","sessionId":"0000'
    const { paths, sessionId } = await plantVisualSession(
      (id) => [
        {
          format: 'yarramate/visual-event/v1',
          sessionId: id,
          sequence: 1,
          eventId: identifier(1),
          type: 'chat.message',
          timestamp: '2026-08-08T00:00:01.000Z',
          payload: { text: 'Compare the two designs' },
        },
        {
          format: 'yarramate/visual-response/v1',
          sessionId: id,
          responseId: identifier(2),
          eventId: identifier(1),
          type: 'chat.response',
          timestamp: '2026-08-08T00:00:02.000Z',
          payload: { text: 'They differ in delivery.' },
        },
      ],
      torn,
    )
    const size = (await stat(paths.journal)).size

    expect(await recoverVisualSession(paths)).toMatchObject({
      sessionId,
      lastSequence: 1,
      decision: 'failed',
      terminationReason: 'server-failed',
    })
    // Recovery is read-only: the torn tail is ignored, never acknowledged.
    expect((await stat(paths.journal)).size).toBe(size)

    // The restarted runtime closes the session it inherited.
    await appendTerminalEvent(paths, 'server-failed', {
      now: () => new Date('2026-08-08T00:05:00.000Z'),
      randomBytes,
    })
    const journal = await readFile(paths.journal, 'utf8')
    expect(journal).not.toContain(torn)
    const records = journal
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as VisualEvent | VisualResponse)
    expect(records).toHaveLength(3)
    expect(records.at(-1)).toMatchObject({
      type: 'session.end',
      sequence: 2,
      payload: { reason: 'server-failed' },
    })
    expect(await recoverVisualSession(paths)).toMatchObject({
      lastSequence: 2,
      terminationReason: 'server-failed',
    })
  })

  it('appends the terminal event exactly once however often it is asked', async () => {
    const { paths } = await plantVisualSession((id) => [
      {
        format: 'yarramate/visual-event/v1',
        sessionId: id,
        sequence: 1,
        eventId: identifier(1),
        type: 'chat.message',
        timestamp: '2026-08-08T00:00:01.000Z',
        payload: { text: 'Compare the two designs' },
      },
    ])
    const deps = { now: () => new Date('2026-08-08T00:05:00.000Z'), randomBytes }
    const first = await appendTerminalEvent(paths, 'child-failed', deps)
    expect(await appendTerminalEvent(paths, 'main-cancelled', deps)).toEqual(
      first,
    )
    expect(
      (await readFile(paths.journal, 'utf8')).split('\n').filter(Boolean),
    ).toHaveLength(2)

    // Nothing may follow a terminal event: the journal is closed.
    expect(
      await appendVisualEvent(paths, {
        format: 'yarramate/visual-event/v1',
        sessionId: first.sessionId,
        sequence: 3,
        eventId: identifier(7),
        type: 'chat.message',
        timestamp: '2026-08-08T00:06:00.000Z',
        payload: { text: 'one more thing' },
      }),
    ).toMatchObject({ ok: false })
    expect(
      (await readFile(paths.journal, 'utf8')).split('\n').filter(Boolean),
    ).toHaveLength(2)
  })

  it('answers a repeated stop as already stopped without recovering again', async () => {
    const visual = await startVisualFixture()
    // The agent holds its descriptor from before the stop; the file itself
    // goes with the session, credential and all.
    const descriptor = await descriptorAt(visual.descriptorPath)

    const first = await visual.handle.stop('user-ended')
    expect(first.alreadyStopped).toBe(false)
    expect(existsSync(visual.sessionRoot)).toBe(false)

    expect(await visual.handle.stop('child-failed')).toMatchObject({
      alreadyStopped: true,
      reason: 'user-ended',
      handoff: first.handoff,
    })

    // A session that is gone stops to nothing rather than to an invented
    // handoff, and leaves no credential-bearing remains behind.
    await expect(clientStop(descriptor)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(existsSync(visual.descriptorPath)).toBe(false)
  })

  it('refuses every write once the runtime has taken the session terminal', async () => {
    const visual = await startVisualFixture()
    const browser = await connectFixtureBrowser(visual)
    await nextFrame(browser, 'ready')

    await closeSocket(browser)
    await visual.graceScheduled
    await visual.expireGrace()
    const terminal = await journalRecords(visual.sessionRoot)

    const refused = await agentFetch(
      visual.descriptorPath,
      '/api/agent/responses',
      {
        format: 'yarramate/visual-response/v1',
        sessionId: visual.sessionId,
        responseId: nextResponseId(),
        eventId: identifier(9),
        type: 'chat.response',
        timestamp: '2026-08-08T00:00:09.000Z',
        payload: { text: 'too late' },
      },
    )
    expect(refused.status).toBe(503)
    expect(await journalRecords(visual.sessionRoot)).toEqual(terminal)
  })

  it('gives back the port and the directory when a started session cannot be published', async () => {
    // How many times a start that works reads the clock. The last of those
    // reads stamps the started document, which is published well after the
    // port is bound — so failing it is the post-listen abandon path.
    let reads = 0
    await startVisualFixture({
      now: () => {
        reads += 1
        return new Date('2026-08-08T00:00:00.000Z')
      },
    })
    const published = reads
    const listeners = () =>
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === 'TCPServerWrap').length
    const before = listeners()
    const roots = await readdir(baseDir)

    let taken = 0
    await expect(
      startVisualServer({
        request: requestWith(),
        baseDir,
        assetRoot,
        now: () => {
          taken += 1
          return taken < published
            ? new Date('2026-08-08T00:00:00.000Z')
            : new Date(Number.NaN)
        },
      }),
    ).rejects.toThrow()

    expect(listeners()).toBe(before)
    expect(await readdir(baseDir)).toEqual(roots)
  })

  it('keeps two sessions isolated across cookies, capabilities, and identifiers', async () => {
    const one = await startVisualFixture()
    const other = await startVisualFixture()
    const cookies = new Map([
      [one, await bootstrapCookie(one)],
      [other, await bootstrapCookie(other)],
    ])
    const cookieForOne = cookies.get(one) as string
    const descriptorOfOne = await descriptorAt(one.descriptorPath)

    // One session's browser cookie authenticates nothing in the other.
    const crossedCookie = await fetch(`${other.origin}/api/session`, {
      headers: { Cookie: cookieForOne, Origin: other.origin },
    })
    expect(crossedCookie.status).toBe(401)

    // Nor does its agent capability.
    const crossedCapability = await fetch(`${other.origin}/api/agent/status`, {
      headers: { Authorization: `Bearer ${descriptorOfOne.agentCapability}` },
    })
    expect(crossedCapability.status).toBe(401)

    // A response naming another session is refused whatever it carries.
    const foreign = await agentFetch(
      other.descriptorPath,
      '/api/agent/responses',
      {
        format: 'yarramate/visual-response/v1',
        sessionId: one.sessionId,
        responseId: identifier(0x11),
        eventId: identifier(0x12),
        type: 'chat.response',
        timestamp: '2026-08-08T00:00:04.000Z',
        payload: { text: 'crossing over' },
      },
    )
    expect(foreign.status).toBe(409)
    expect(await foreign.json()).toMatchObject({
      accepted: false,
      diagnostics: [{ code: 'YMVS126', pointer: '/sessionId' }],
    })

    // Identifiers are per-session namespaces: the same response id spends once
    // in each, and neither journal learns the other's event identifiers.
    const shared = identifier(0x21)
    for (const visual of [one, other]) {
      const browser = await openBrowserSocket(visual, cookies.get(visual) as string)
      send(browser, chatMessage('same question'))
      const asked = await nextFrame(browser, 'accepted')
      const accepted = await agentFetch(
        visual.descriptorPath,
        '/api/agent/responses',
        {
          format: 'yarramate/visual-response/v1',
          sessionId: visual.sessionId,
          responseId: shared,
          eventId: asked.eventId,
          type: 'chat.response',
          timestamp: '2026-08-08T00:00:05.000Z',
          payload: { text: 'same answer' },
        },
      )
      expect(await accepted.json()).toMatchObject({
        accepted: true,
        duplicate: false,
      })
      await closeSocket(browser)
    }

    const identifiersOf = async (root: string) =>
      (await journalRecords(root))
        .filter((record) => record.format === 'yarramate/visual-event/v1')
        .map((record) => record.eventId)
    const inOne = await identifiersOf(one.sessionRoot)
    const inOther = await identifiersOf(other.sessionRoot)
    // Every identifier is this session's alone, so the two journals share none.
    expect(inOne.length).toBeGreaterThan(0)
    expect(inOne.filter((id) => inOther.includes(id))).toEqual([])

    // An event identifier is one session's alone: presenting the other's, under
    // this session's own id and capability, buys nothing.
    const borrowed = await agentFetch(
      one.descriptorPath,
      '/api/agent/responses',
      {
        format: 'yarramate/visual-response/v1',
        sessionId: one.sessionId,
        responseId: nextResponseId(),
        eventId: inOther[0] as string,
        type: 'handoff.complete',
        timestamp: '2026-08-08T00:00:06.000Z',
        payload: {
          summary: 'Borrowed a turn that was never taken here.',
          confirmedDecisions: ['forged'],
          requestedChanges: [],
          unresolvedQuestions: [],
          finalViews: ['choices'],
        },
      },
    )
    expect(borrowed.status).toBe(409)
    expect(await borrowed.json()).toMatchObject({
      accepted: false,
      diagnostics: [{ code: 'YMVS131', pointer: '/eventId' }],
    })
    // Nothing forged reaches the handoff the main agent will read.
    expect(await recoverVisualSessionClient(one.descriptorPath)).toMatchObject({
      decision: 'failed',
      confirmedDecisions: [],
    })

    // And a descriptor recovers only the session it lives in.
    expect(await recoverVisualSessionClient(one.descriptorPath)).toMatchObject({
      sessionId: one.sessionId,
    })
  })

  it('rejects chat in a diagram-only session while navigation still journals', async () => {
    const visual = await startVisualFixture({ chatEnabled: false })
    const browser = await connectFixtureBrowser(visual)
    expect((await nextFrame(browser, 'ready')).snapshot.capabilities).toMatchObject(
      { chat: false, choices: false, navigation: true },
    )

    send(browser, chatMessage('let me talk'))
    expect(await nextFrame(browser, 'rejected')).toMatchObject({
      diagnostics: [{ code: 'YMVS309' }],
    })
    send(browser, choiceSelected('option-b'))
    expect(await nextFrame(browser, 'rejected')).toMatchObject({
      diagnostics: [{ code: 'YMVS309' }],
    })

    // Navigation is the capability a diagram-only session does grant.
    send(browser, viewNavigate('choices'))
    // Sequence 1 is this browser's arrival, so its first move is the second.
    expect(await nextFrame(browser, 'accepted')).toMatchObject({ sequence: 2 })

    // The agent cannot speak into a session that has no conversation either.
    const refused = await agentFetch(
      visual.descriptorPath,
      '/api/agent/responses',
      {
        format: 'yarramate/visual-response/v1',
        sessionId: visual.sessionId,
        responseId: nextResponseId(),
        eventId: identifier(9),
        type: 'chat.response',
        timestamp: '2026-08-08T00:00:06.000Z',
        payload: { text: 'talking anyway' },
      },
    )
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      diagnostics: [{ code: 'YMVS309' }],
    })

    const journal = await journalRecords(visual.sessionRoot)
    // The arrival, and the one move the session granted: nothing it refused.
    expect(journal.map((record) => record.type)).toEqual([
      'browser.connected',
      'view.navigate',
    ])
    await closeSocket(browser)
  })
})
