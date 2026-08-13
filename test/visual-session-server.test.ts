import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { watch as watchEagerly } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  watch,
  writeFile,
} from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  VISUAL_LIMITS,
  parseVisualDiagnosticResult,
  parseVisualSessionDescriptor,
  type VisualDiagnostic,
  type VisualEvent,
  type VisualModel,
  type VisualResponse,
  type VisualSessionRequest,
} from '../src/adapters/visual/protocol.js'
import {
  VISUAL_BROWSER_HEADERS,
  VISUAL_SERVER_LIMITS,
  visualContentSecurityPolicy,
  startVisualServer,
  type VisualServerFrame,
  type VisualServerHandle,
  type VisualServerOptions,
} from '../src/adapters/visual/session-server.js'

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
    // staged source file, so an invalid candidate is a property of the model.
    'model.likec4': `model { system = system "System" }${
      marker === undefined ? '' : `\n// fake:${marker}`
    }`,
    'views/choices.likec4': 'views { view choices { include * } }',
  },
})

const request: VisualSessionRequest = {
  format: 'yarramate/visual-session-request/v1',
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  compiler: { command: process.execPath, args: [fakeCompiler] },
  initialModel: modelWith(),
}

const chatEventInput = {
  type: 'chat.message',
  lastAcknowledgedSequence: 0,
  payload: { text: 'Compare the two delivery designs' },
} as const

const identifier = (index: number) => index.toString(16).padStart(32, '0')

let baseDir = ''
const running: VisualServerHandle[] = []

const start = async (overrides: Partial<VisualServerOptions> = {}) => {
  const handle = await startVisualServer({
    request,
    baseDir,
    assetRoot,
    // Long enough that an event racing a poll always wins; the idle tests set
    // their own ceiling.
    agentPollMs: 4000,
    ...overrides,
  })
  running.push(handle)
  return handle
}

/**
 * Reads the private descriptor through the protocol parser, so a test that
 * depends on one of its fields also asserts the document is valid.
 */
const readDescriptor = async (descriptorPath: string) => {
  const parsed = parseVisualSessionDescriptor(
    JSON.parse(await readFile(descriptorPath, 'utf8')),
  )
  if (!parsed.ok) {
    throw new Error(
      `descriptor "${descriptorPath}" is invalid: ${parsed.diagnostics[0]?.message}`,
    )
  }
  return parsed.value
}

/** The agent capability lives only in the mode 0600 descriptor. */
const capabilityOf = async (handle: VisualServerHandle) =>
  (await readDescriptor(handle.started.descriptorPath)).agentCapability

const bootstrap = async (handle: VisualServerHandle) => {
  const response = await fetch(handle.started.browserUrl, {
    redirect: 'manual',
  })
  const header = response.headers.get('set-cookie')
  if (header === null) throw new Error('bootstrap returned no cookie')
  return { response, cookie: header.split(';')[0] as string }
}

/**
 * Every frame the socket has received and no assertion has claimed yet. The
 * server sends `ready` the moment it accepts the upgrade, which can land before
 * the test gets a chance to listen, so frames are buffered from construction.
 */
const buffered = new WeakMap<WebSocket, VisualServerFrame[]>()

const openBrowserSocket = async (
  handle: VisualServerHandle,
  cookie: string,
) => {
  const socket = new WebSocket(handle.started.webSocketUrl, {
    headers: { Cookie: cookie, Origin: handle.started.origin },
  })
  const frames: VisualServerFrame[] = []
  buffered.set(socket, frames)
  socket.on('message', (data) => {
    frames.push(JSON.parse(String(data)) as VisualServerFrame)
  })
  await once(socket, 'open')
  return socket
}

const nextFrame = async <Kind extends VisualServerFrame['kind']>(
  socket: WebSocket,
  kind: Kind,
  match: (frame: Extract<VisualServerFrame, { kind: Kind }>) => boolean = () =>
    true,
): Promise<Extract<VisualServerFrame, { kind: Kind }>> => {
  const frames = buffered.get(socket) ?? []
  const take = () => {
    const index = frames.findIndex(
      (frame) =>
        frame.kind === kind &&
        match(frame as Extract<VisualServerFrame, { kind: Kind }>),
    )
    return index < 0
      ? undefined
      : (frames.splice(index, 1)[0] as Extract<
          VisualServerFrame,
          { kind: Kind }
        >)
  }
  for (;;) {
    const found = take()
    if (found !== undefined) return found
    await once(socket, 'message')
  }
}

const sendChat = (socket: WebSocket, text: string) => {
  const accepted = nextFrame(socket, 'accepted')
  socket.send(JSON.stringify({
    type: 'chat.message',
    lastAcknowledgedSequence: 0,
    payload: { text },
  }))
  return accepted
}

const agentFetch = (
  handle: VisualServerHandle,
  capability: string,
  path: string,
  init: RequestInit = {},
) =>
  fetch(`${handle.started.origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${capability}`,
      ...(init.headers ?? {}),
    },
  })

const postResponse = (
  handle: VisualServerHandle,
  capability: string,
  response: VisualResponse,
) =>
  agentFetch(handle, capability, '/api/agent/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  })

/**
 * The success path of `postResponse`. A refusal is never what a test that goes
 * on to read session state meant to exercise, so a vacuous POST is caught here
 * rather than surviving as a silently skipped transition.
 */
const postAcceptedResponse = async (
  handle: VisualServerHandle,
  capability: string,
  response: VisualResponse,
) => {
  const posted = await postResponse(handle, capability, response)
  expect(posted.status).toBe(200)
  const body = (await posted.json()) as { readonly accepted: boolean }
  expect(body.accepted).toBe(true)
  return body
}

/** The question this session is still holding, as a reloading browser reads it. */
const pendingChoiceOf = async (handle: VisualServerHandle, cookie: string) => {
  const session = (await (
    await fetch(`${handle.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    })
  ).json()) as { readonly pendingChoice: unknown }
  return session.pendingChoice
}

const deliveryQuestion = {
  choiceId: 'delivery',
  question: 'Which delivery design should we keep?',
  options: [
    { id: 'shared-queue', label: 'Shared queue' },
    { id: 'isolated-worker', label: 'Isolated worker' },
  ],
} as const

const choicePresent = (
  handle: VisualServerHandle,
  eventId: string,
  index: number,
): VisualResponse => ({
  format: 'yarramate/visual-response/v1',
  sessionId: handle.started.sessionId,
  responseId: identifier(index),
  eventId,
  type: 'choice.present',
  timestamp: '2026-08-08T00:00:02.000Z',
  payload: deliveryQuestion,
})

const chatResponse = (
  handle: VisualServerHandle,
  eventId: string,
  index: number,
  text = 'Design A isolates delivery; design B shares it.',
): VisualResponse => ({
  format: 'yarramate/visual-response/v1',
  sessionId: handle.started.sessionId,
  responseId: identifier(index),
  eventId,
  type: 'chat.response',
  timestamp: '2026-08-08T00:00:02.000Z',
  payload: { text },
})

/**
 * Waits for the next event the journal named by a session descriptor carries
 * past `after`, and answers only if it is the `type` the caller is correlating
 * against. The descriptor is the agent's only entry point into the session, so
 * the helper reads the journal the way an out-of-process agent would, and it
 * waits on the file's own change events rather than on a guessed delay.
 *
 * Naming the type is what makes the wait a correlation rather than a cursor:
 * the runtime journals records of its own, and a wait that took whatever came
 * next would hand one of those back as the event under test.
 */
const waitForVisualEvent = async <Type extends VisualEvent['type']>(
  descriptorPath: string,
  after: number,
  type: Type,
): Promise<Extract<VisualEvent, { readonly type: Type }>> => {
  const { journalPath } = await readDescriptor(descriptorPath)
  // The callback watcher, not `fs/promises.watch`: the promise form is an async
  // generator that registers nothing until its first iteration, so it cannot be
  // armed ahead of the read the way this window needs. This one is watching
  // from the moment it is constructed, and every change it sees is counted, so
  // an append landing during the read below is observed rather than lost.
  let changes = 0
  let changed = Promise.withResolvers<void>()
  const watcher = watchEagerly(journalPath, () => {
    changes += 1
    changed.resolve()
    changed = Promise.withResolvers<void>()
  })
  try {
    for (;;) {
      const seen = changes
      const lines = (await readFile(journalPath, 'utf8'))
        .split('\n')
        .filter((line) => line.length > 0)
      for (const line of lines) {
        const record = JSON.parse(line) as VisualEvent | VisualResponse
        if (record.format !== 'yarramate/visual-event/v1') continue
        if (record.sequence <= after) continue
        if (record.type !== type) {
          throw new Error(
            `journal holds ${record.type} at sequence ${record.sequence}, not the ${type} this wait is for`,
          )
        }
        return record as Extract<VisualEvent, { readonly type: Type }>
      }
      // Nothing since the read began, so there is a change worth waiting for.
      if (changes === seen) await changed.promise
    }
  } finally {
    watcher.close()
  }
}

const journalOf = async (handle: VisualServerHandle) =>
  (await readFile(join(handle.started.sessionRoot, 'journal.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as VisualEvent | VisualResponse)

/** One event-loop turn, so an observed in-process condition can be re-read. */
const tick = async () => {
  const turn = Promise.withResolvers<void>()
  setImmediate(turn.resolve)
  await turn.promise
}

/**
 * Resolves once the session has admitted an agent request. Authenticating the
 * capability and registering the long poll are one synchronous step, so an
 * attached agent is exactly a poll the server is already holding: an observed
 * condition in this process rather than a guessed delay, and nothing the
 * runtime carries for the test.
 */
const waitForAttachedAgent = async (handle: VisualServerHandle) => {
  while (!handle.status().agent.attached) await tick()
}

/**
 * Resolves once the session has journaled up to `sequence`. The runtime moves
 * its own queue cursor one statement *after* the append resolves, so a wait on
 * the journal file can see a record the server has not finished accounting
 * for. This is the stronger of the two waits — it implies the file too — and it
 * is what anything that then reads server state has to wait on.
 */
const waitForSequence = async (
  handle: VisualServerHandle,
  sequence: number,
) => {
  while (handle.status().queue.lastSequence < sequence) await tick()
}

/**
 * Rejections raised by fire-and-forget socket work never reach a test's
 * `await`, so they are collected from the process the way Node would see
 * them: an empty list is the assertion that nothing crashed the runtime.
 */
const collectRejections = () => {
  const seen: unknown[] = []
  const observe = (reason: unknown) => seen.push(reason)
  process.on('unhandledRejection', observe)
  return {
    seen,
    settled: async () => {
      // A rejection is reported a macrotask after it is raised, so give the
      // loop two turns before deciding nothing was left unobserved.
      await tick()
      await tick()
      process.off('unhandledRejection', observe)
      return seen
    },
  }
}

/** Raw request/response text, so Host and unnormalised paths stay verbatim. */
const rawRequest = (origin: string, lines: readonly string[]) =>
  new Promise<string>((resolve, reject) => {
    const port = Number(new URL(origin).port)
    const socket = connect(port, '127.0.0.1', () => {
      socket.write([...lines, '', ''].join('\r\n'))
    })
    let text = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      text += chunk
    })
    socket.on('end', () => resolve(text))
    socket.on('error', reject)
  })

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'yarramate-visual-server-'))
})

afterEach(async () => {
  for (const handle of running.splice(0)) {
    await handle.stop('main-cancelled')
  }
  await rm(baseDir, { recursive: true, force: true })
})

describe('startVisualServer bootstrap and browser authentication', () => {
  it('exchanges the bootstrap token and accepts an authenticated browser socket', async () => {
    const server = await start()
    const response = await fetch(server.started.browserUrl, {
      redirect: 'manual',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('set-cookie')).toMatch(
      /^ym_visual=[^;]+; HttpOnly; SameSite=Strict; Secure; Path=\/$/,
    )

    const socket = await openBrowserSocket(
      server,
      (response.headers.get('set-cookie') as string).split(';')[0] as string,
    )
    socket.send(JSON.stringify(chatEventInput))
    await expect(
      // Sequence 1 is the connection the runtime journaled for this socket.
      waitForVisualEvent(server.started.descriptorPath, 1, 'chat.message'),
    ).resolves.toMatchObject({ sequence: 2 })
    socket.close()
  })

  it('never returns the bootstrap token in the cookie it mints', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const token = new URL(server.started.browserUrl).searchParams.get('key')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(cookie).not.toContain(token as string)
  })

  it('stores only a derived browser authenticator in the cookie', async () => {
    const generatedSecrets: string[] = []
    let draw = 0
    const server = await start({
      randomBytes: (size) => {
        draw += 1
        const secret = Buffer.alloc(size, draw)
        generatedSecrets.push(secret.toString('hex'))
        return secret
      },
    })
    const { cookie } = await bootstrap(server)
    const value = cookie.slice('ym_visual='.length)
    expect(generatedSecrets).not.toContain(value)
  })

  it('refuses a replayed bootstrap token', async () => {
    const server = await start()
    await bootstrap(server)
    const replay = await fetch(server.started.browserUrl, {
      redirect: 'manual',
    })
    expect(replay.status).toBe(403)
    expect(replay.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a bootstrap key that is not the browser capability', async () => {
    const server = await start()
    const forged = new URL(server.started.browserUrl)
    forged.searchParams.set('key', 'a'.repeat(64))
    const response = await fetch(forged, { redirect: 'manual' })
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('serves the browser application only to a cookie-bearing request', async () => {
    const server = await start()
    const anonymous = await fetch(`${server.started.origin}/`)
    expect(anonymous.status).toBe(401)

    const { cookie } = await bootstrap(server)
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    await expect(page.text()).resolves.toContain('/assets/app-1a2b3c4d.js')
  })

  it('returns the exact browser security headers on every browser response', async () => {
    const server = await start()
    const { response, cookie } = await bootstrap(server)
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    })
    const asset = await fetch(
      `${server.started.origin}/assets/app-1a2b3c4d.js`,
      { headers: { Cookie: cookie } },
    )
    const denied = await fetch(`${server.started.origin}/`)
    for (const checked of [response, page, asset, denied]) {
      for (const [name, value] of Object.entries(VISUAL_BROWSER_HEADERS)) {
        expect(checked.headers.get(name)).toBe(value)
      }
    }
  })

  it('admits inline style only under this session own nonce', async () => {
    const server = await start()
    const { response, cookie } = await bootstrap(server)
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    })
    const snapshot = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { readonly styleNonce: string }

    expect(snapshot.styleNonce).toMatch(/^[0-9a-f]{32}$/)
    for (const checked of [response, page]) {
      const policy = checked.headers.get('content-security-policy') as string
      expect(policy).toBe(visualContentSecurityPolicy(snapshot.styleNonce))
      expect(policy).toContain(`style-src 'self' 'nonce-${snapshot.styleNonce}'`)
      // A nonce admits the styles this application ships and nothing else.
      expect(policy).not.toContain('unsafe-inline')
      expect(policy).toContain(`script-src 'self'`)
      expect(policy).toContain(`frame-ancestors 'none'`)
    }
  })

  it('mints a nonce no other session can use', async () => {
    const first = await start()
    const second = await start()
    const nonceOf = async (server: VisualServerHandle) => {
      const { cookie } = await bootstrap(server)
      const snapshot = (await (
        await fetch(`${server.started.origin}/api/session`, {
          headers: { Cookie: cookie },
        })
      ).json()) as { readonly styleNonce: string }
      return snapshot.styleNonce
    }
    expect(await nonceOf(first)).not.toBe(await nonceOf(second))
  })

  it('restores the conversation to a browser that reloads', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Why is option B cheaper?')
    await postResponse(
      server,
      capability,
      chatResponse(server, asked.eventId, 3, 'It reuses the intake path.'),
    )
    socket.close()
    // The reload is read after the runtime has accounted for the socket it
    // replaces, so the sequence the snapshot reports is settled, not raced.
    await waitForSequence(server, 3)

    const session = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      readonly transcript: readonly { readonly text: string }[]
      readonly lastSequence: number
    }

    expect(session.transcript).toEqual([
      {
        id: asked.eventId,
        speaker: 'reviewer',
        text: 'Why is option B cheaper?',
      },
      {
        id: identifier(3),
        speaker: 'agent',
        text: 'It reuses the intake path.',
      },
    ])
    expect(session.lastSequence).toBe(3)
  })

  it('tells a reconnecting browser whether the agent still owes an answer', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const snapshotNow = async () => {
      const body = (await (
        await fetch(`${server.started.origin}/api/session`, {
          headers: { Cookie: cookie },
        })
      ).json()) as { readonly agentTurnOpen: boolean }
      return body.agentTurnOpen
    }

    expect(await snapshotNow()).toBe(false)
    const asked = await sendChat(socket, 'Why is option B cheaper?')
    expect(await snapshotNow()).toBe(true)

    await postResponse(
      server,
      capability,
      chatResponse(server, asked.eventId, 5, 'It reuses the intake path.'),
    )
    // The turn the browser opened is closed, whether or not it was connected to
    // see the answer land.
    expect(await snapshotNow()).toBe(false)
    socket.close()
  })

  it('restores a selected choice by the label the reviewer read', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Which option?')
    await postResponse(server, capability, {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(4),
      eventId: asked.eventId,
      type: 'choice.present',
      timestamp: '2026-08-08T00:00:02.000Z',
      payload: {
        choiceId: 'delivery',
        question: 'Which delivery design should we keep?',
        options: [
          { id: 'shared-queue', label: 'Shared queue' },
          { id: 'isolated-worker', label: 'Isolated worker' },
        ],
      },
    })
    const chosen = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'choice.selected',
        lastAcknowledgedSequence: 1,
        payload: { choiceId: 'delivery', optionId: 'shared-queue' },
      }),
    )
    await chosen
    socket.close()

    const session = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      readonly transcript: readonly { readonly text: string }[]
    }
    // The record says what the reviewer chose, not the identifier they clicked.
    expect(session.transcript.at(-1)).toMatchObject({
      speaker: 'reviewer',
      text: 'Shared queue',
    })
  })

  it('restores a choice the agent is still waiting on', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Which option?')

    expect(await pendingChoiceOf(server, cookie)).toBe(null)
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    )
    // The question lives in the agent's response, never in the transcript, so
    // a browser that reloads reads it here or cannot answer at all.
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion)

    const chosen = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'choice.selected',
        lastAcknowledgedSequence: 1,
        payload: { choiceId: 'delivery', optionId: 'shared-queue' },
      }),
    )
    await chosen
    expect(await pendingChoiceOf(server, cookie)).toBe(null)
    socket.close()
  })

  it('drops a waiting choice the reviewer asked past', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Which option?')
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    )
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion)

    // Asking something else is how a reviewer declines to choose, and the
    // browser closes the buttons on itself when it sends one.
    await sendChat(socket, 'What does the queue cost?')

    expect(await pendingChoiceOf(server, cookie)).toBe(null)
    socket.close()
  })

  it('waits on nothing once the reviewer has ended the session', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Which option?')
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    )
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion)

    const ended = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'session.end',
        lastAcknowledgedSequence: 1,
        payload: { reason: 'user-ended' },
      }),
    )
    await ended

    // A session on its way out is waiting on nobody, so a browser that comes
    // back to it is not asked a question again.
    expect(await pendingChoiceOf(server, cookie)).toBe(null)
    socket.close()
  })

  it('holds no question the agent presented after the reviewer ended', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const asked = await sendChat(socket, 'Which option?')

    const ended = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'session.end',
        lastAcknowledgedSequence: 1,
        payload: { reason: 'user-ended' },
      }),
    )
    const end = await ended

    // The agent was still composing when the End landed, so its question
    // answers an event whose reviewer has already walked away.
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    )
    // The handoff a terminating session waits for is still the agent's to
    // send, so a response after an End stays admissible.
    await postAcceptedResponse(server, capability, {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(5),
      eventId: end.eventId,
      type: 'handoff.complete',
      timestamp: '2026-08-08T00:00:05.000Z',
      payload: {
        summary: 'The reviewer ended before choosing a delivery design.',
        confirmedDecisions: [],
        requestedChanges: [],
        unresolvedQuestions: ['Which delivery design should we keep?'],
        finalViews: ['choices'],
      },
    })

    // A browser that reloads into an ended session is never handed buttons it
    // can no longer press.
    expect(await pendingChoiceOf(server, cookie)).toBe(null)
    socket.close()
  })

  it('never puts model sources or credentials in a restored conversation', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'anything')
    socket.close()
    const body = await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).text()
    expect(body).not.toContain('model.likec4')
    expect(body).not.toContain(await capabilityOf(server))
    const secret = cookie.split('=')[1] ?? ''
    expect(secret.length).toBeGreaterThan(0)
    expect(body).not.toContain(secret)
  })

  it('rejects a request whose Host header is not the bound loopback authority', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const text = await rawRequest(server.started.origin, [
      'GET / HTTP/1.1',
      'Host: visual.attacker.example',
      `Cookie: ${cookie}`,
      'Connection: close',
    ])
    expect(text.split('\r\n')[0]).toContain('403')
  })

  it('rejects a browser request from a foreign origin', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(`${server.started.origin}/api/session`, {
      headers: { Cookie: cookie, Origin: 'http://attacker.example' },
    })
    expect(response.status).toBe(403)
  })

  it('rejects a WebSocket upgrade without the session cookie', async () => {
    const server = await start()
    const socket = new WebSocket(server.started.webSocketUrl, {
      headers: { Origin: server.started.origin },
    })
    const [error] = (await once(socket, 'error')) as [Error]
    expect(error.message).toContain('401')
  })

  it('rejects a WebSocket upgrade from a foreign origin', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = new WebSocket(server.started.webSocketUrl, {
      headers: { Cookie: cookie, Origin: 'http://attacker.example' },
    })
    const [error] = (await once(socket, 'error')) as [Error]
    expect(error.message).toContain('403')
  })

  it('reserves the browser connection limit before journaling admission', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const opened: WebSocket[] = []
    const attempts = Array.from(
      { length: VISUAL_SERVER_LIMITS.browserConnections + 4 },
      () =>
        new Promise<number>((resolve, reject) => {
          const socket = new WebSocket(server.started.webSocketUrl, {
            headers: { Cookie: cookie, Origin: server.started.origin },
          })
          socket.once('open', () => {
            opened.push(socket)
            resolve(101)
          })
          socket.once('unexpected-response', (_request, response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          })
          socket.once('error', reject)
        }),
    )

    const outcomes = await Promise.all(attempts)
    for (const socket of opened) socket.close()

    expect(outcomes.filter((status) => status === 101)).toHaveLength(
      VISUAL_SERVER_LIMITS.browserConnections,
    )
    expect(outcomes.filter((status) => status !== 101)).toEqual(
      Array(4).fill(503),
    )
  })

  it('rejects a cookie minted by another session', async () => {
    const first = await start()
    const second = await start()
    const { cookie } = await bootstrap(first)
    const response = await fetch(`${second.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(401)
  })

  it('reports the rendered session to an authenticated browser', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(`${server.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      sessionId: server.started.sessionId,
      title: 'Choose a delivery design',
      chatEnabled: true,
      lastSequence: 0,
      frozen: false,
      model: {
        candidate: '000001',
        initialView: 'choices',
        views: ['choices', 'detailNightly', 'detailStreaming', 'index'],
      },
    })
  })

  it('reports the compiled LikeC4 model the browser has to render', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(`${server.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    })
    const session = (await response.json()) as {
      readonly model: { readonly compiled: Record<string, unknown> }
    }
    // The compiled export is what `createLikeC4Model` consumes: without it the
    // browser has view identifiers and nothing to draw.
    expect(session.model.compiled).toMatchObject({
      _stage: 'layouted',
      views: { choices: { id: 'choices' } },
    })
  })
})

describe('startVisualServer agent capability separation', () => {
  it('rejects an agent route without a bearer capability', async () => {
    const server = await start()
    const response = await fetch(`${server.started.origin}/api/agent/status`)
    expect(response.status).toBe(401)
  })

  it('rejects the browser capability presented as an agent bearer token', async () => {
    const server = await start()
    const token = new URL(server.started.browserUrl).searchParams.get(
      'key',
    ) as string
    const response = await agentFetch(server, token, '/api/agent/status')
    expect(response.status).toBe(401)
  })

  it('rejects a browser cookie presented to an agent route', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(`${server.started.origin}/api/agent/status`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(401)
  })

  it('rejects an agent request that carries a browser origin', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await agentFetch(server, capability, '/api/agent/status', {
      headers: { Origin: server.started.origin },
    })
    expect(response.status).toBe(403)
  })

  it('rejects an agent capability minted by another session', async () => {
    const first = await start()
    const second = await start()
    const capability = await capabilityOf(first)
    const response = await agentFetch(second, capability, '/api/agent/status')
    expect(response.status).toBe(401)
  })

  it('reports session status to the agent', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await agentFetch(server, capability, '/api/agent/status')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      format: 'yarramate/visual-status/v1',
      sessionId: server.started.sessionId,
      lifecycle: 'running',
      alreadyStopped: false,
      server: { listening: true, origin: server.started.origin },
      agent: { attached: true, inFlightEventId: null },
      queue: { pendingEvents: 0, lastSequence: 0, frozen: false },
    })
  })
})

describe('startVisualServer event queue and long polling', () => {
  it('answers an idle long poll with a non-terminal waiting result', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const response = await agentFetch(
      server,
      capability,
      '/api/agent/events?after=0',
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      waiting: true,
      lastSequence: 0,
      pendingEvents: 0,
    })
    expect(server.status().lifecycle).toBe('running')
  })

  it('releases a waiting long poll with the event the browser just sent', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)

    const polled = agentFetch(server, capability, '/api/agent/events?after=0')
    await sendChat(socket, 'Compare the two delivery designs')
    const body = (await (await polled).json()) as {
      readonly waiting: boolean
      readonly event: VisualEvent
    }
    expect(body.waiting).toBe(false)
    expect(body.event).toMatchObject({
      type: 'chat.message',
      sequence: 2,
      sessionId: server.started.sessionId,
      payload: { text: 'Compare the two delivery designs' },
    })
    socket.close()
  })

  it('replays the in-flight event to a repeated poll', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'Compare the two delivery designs')

    const first = (await (
      await agentFetch(server, capability, '/api/agent/events?after=0')
    ).json()) as { readonly event: VisualEvent }
    const replay = (await (
      await agentFetch(server, capability, '/api/agent/events?after=0')
    ).json()) as { readonly event: VisualEvent }
    expect(replay.event.eventId).toBe(first.event.eventId)
    expect(server.status().agent.inFlightEventId).toBe(first.event.eventId)
    socket.close()
  })

  it('holds a later chat event while one response is outstanding', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'first')
    await sendChat(socket, 'second')

    const first = (await (
      await agentFetch(server, capability, '/api/agent/events?after=0')
    ).json()) as { readonly event: VisualEvent }
    expect(first.event.sequence).toBe(2)
    await expect(
      (await agentFetch(server, capability, '/api/agent/events?after=2')).json(),
    ).resolves.toMatchObject({ waiting: true })
    expect(server.status().queue.pendingEvents).toBe(2)
    socket.close()
  })

  it('releases the queued chat event once the turn is answered', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'first')
    await sendChat(socket, 'second')

    const first = (await (
      await agentFetch(server, capability, '/api/agent/events?after=0')
    ).json()) as { readonly event: VisualEvent }
    const answered = await postResponse(
      server,
      capability,
      chatResponse(server, first.event.eventId, 1),
    )
    expect(answered.status).toBe(200)

    const second = (await (
      await agentFetch(server, capability, '/api/agent/events?after=2')
    ).json()) as { readonly waiting: boolean; readonly event: VisualEvent }
    expect(second.waiting).toBe(false)
    expect(second.event.sequence).toBe(3)
    expect(second.event.payload).toEqual({ text: 'second' })
    socket.close()
  })

  it('keeps navigation local unless the browser requests agent attention', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'view.navigate',
        lastAcknowledgedSequence: 0,
        payload: { viewId: 'choices', requiresAttention: false },
      }),
    )
    await accepted

    await expect(
      (await agentFetch(server, capability, '/api/agent/events?after=0')).json(),
    ).resolves.toMatchObject({ waiting: true, lastSequence: 2 })
    const journal = await journalOf(server)
    expect(journal.at(-1)).toMatchObject({ type: 'view.navigate' })
    socket.close()
  })

  it('delivers navigation that explicitly requests agent attention', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'view.navigate',
        lastAcknowledgedSequence: 0,
        payload: { viewId: 'choices', requiresAttention: true },
      }),
    )
    await accepted

    await expect(
      (await agentFetch(server, capability, '/api/agent/events?after=0')).json(),
    ).resolves.toMatchObject({
      waiting: false,
      event: { type: 'view.navigate' },
    })
    socket.close()
  })

  it('freezes the queue once the pending bound is reached', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`)
    }
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'one more' },
      }),
    )
    expect(await rejected).toMatchObject({ frozen: 'pending-events' })

    expect(server.status().queue).toMatchObject({
      pendingEvents: VISUAL_LIMITS.pendingEvents,
      lastSequence: VISUAL_LIMITS.pendingEvents + 1,
      frozen: true,
      frozenReason: 'pending-events',
    })
    const events = (await journalOf(server)).filter(
      (record) => record.type === 'chat.message',
    )
    expect(events).toHaveLength(VISUAL_LIMITS.pendingEvents)
    socket.close()
  })

  it('rejects a chat message longer than the protocol ceiling', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'x'.repeat(VISUAL_LIMITS.messageBytes + 1) },
      }),
    )
    expect((await rejected).diagnostics[0]?.code).toBe('YMVS109')
    const events = (await journalOf(server)).filter(
      (record) => record.type === 'chat.message',
    )
    expect(events).toHaveLength(0)
    socket.close()
  })

  it('drops a browser frame beyond the transport ceiling and freezes on bytes', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'x'.repeat(VISUAL_SERVER_LIMITS.browserFrameBytes) },
      }),
    )
    const [code] = (await once(socket, 'close')) as [number]
    expect(code).toBe(1009)
    expect(server.status().queue.frozenReason).toBe('message-bytes')
    const events = (await journalOf(server)).filter(
      (record) => record.type === 'chat.message',
    )
    expect(events).toHaveLength(0)
  })

  it('rejects a browser frame that is not a valid browser input', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejected = nextFrame(socket, 'rejected')
    socket.send('{"type":"chat.message"')
    expect((await rejected).diagnostics[0]?.code).toBe('YMVS109')
    socket.close()
  })

  it('rejects a browser input that names a runtime-only event type', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    // The connection is journaled before the frame that forges one arrives.
    await nextFrame(socket, 'ready')
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'browser.connected',
        payload: { connectionId: 'forged' },
      }),
    )
    expect((await rejected).diagnostics[0]?.code).toBe('YMVS109')
    // The one connection record this session has is the one the runtime wrote.
    expect(await journalOf(server)).toMatchObject([
      { type: 'browser.connected' },
    ])
    expect(server.status().queue.lastSequence).toBe(1)
    socket.close()
  })

  it('rejects a browser event whose minted identifier repeats', async () => {
    let narrow = 0
    let wide = 0
    const server = await start({
      // 16-byte draws mint the session id, the style nonce, the connection id,
      // the record the runtime writes for that connection, and then every
      // browser event id; pinning the draws from the first browser event
      // forces an identifier collision.
      randomBytes: (size: number) => {
        if (size !== 16) {
          wide += 1
          return Buffer.alloc(size, wide)
        }
        narrow += 1
        return Buffer.alloc(16, Math.min(narrow, 5))
      },
    })
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'first')
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'second' },
      }),
    )
    expect((await rejected).diagnostics[0]?.code).toBe('YMVS127')

    const events = (await journalOf(server)).filter(
      (record) => record.type === 'chat.message',
    )
    expect(events).toHaveLength(1)
    socket.close()
  })

  it('refuses a browser frame acknowledging a sequence the journal never reached', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 4,
        payload: { text: 'I have seen the future' },
      }),
    )
    expect((await rejected).diagnostics[0]?.code).toBe('YMVS308')
    expect(await journalOf(server)).toMatchObject([
      { type: 'browser.connected' },
    ])
    expect(server.status().queue.lastSequence).toBe(1)
    socket.close()
  })

  it('admits a browser frame whose acknowledgement is merely stale', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    expect((await sendChat(socket, 'first')).sequence).toBe(2)

    // The browser is a sequence behind, which is what a reconnect mid-turn
    // looks like; admission still owns the sequence it assigns.
    const accepted = nextFrame(socket, 'accepted')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'second' },
      }),
    )
    expect((await accepted).sequence).toBe(3)
    socket.close()
  })
})

describe('startVisualServer limit failures', () => {
  /**
   * A limit the runtime detects for itself is a runtime that can no longer
   * carry the conversation, so it takes the same terminal transition every
   * other cause takes: once, under a reason that is true of it, with every
   * record the session already accepted left standing.
   */
  const terminals = (records: readonly (VisualEvent | VisualResponse)[]) =>
    records.filter(
      (record) =>
        record.format === 'yarramate/visual-event/v1' &&
        record.type === 'session.end',
    )

  it('ends a session whose queue reached the pending bound', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejections = collectRejections()
    await nextFrame(socket, 'ready')
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`)
    }
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'one more' },
      }),
    )
    expect(await rejected).toMatchObject({ frozen: 'pending-events' })

    // Sequence 1 is the connection, so the bound is reached at 1 + 32 and the
    // terminal record is the one past it.
    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      VISUAL_LIMITS.pendingEvents + 1,
      'session.end',
    )
    expect(terminal).toMatchObject({
      sequence: VISUAL_LIMITS.pendingEvents + 2,
      payload: { reason: 'server-failed' },
    })
    const journal = await journalOf(server)
    // Nothing the session had already accepted was lost to the failure, and
    // the transition ran exactly once.
    expect(
      journal.filter((record) => record.type === 'chat.message'),
    ).toHaveLength(VISUAL_LIMITS.pendingEvents)
    expect(terminals(journal)).toHaveLength(1)

    const closed = await server.stop('server-failed')
    expect(closed.handoff).toMatchObject({
      decision: 'failed',
      terminationReason: 'server-failed',
      lastSequence: VISUAL_LIMITS.pendingEvents + 2,
    })
    expect(await rejections.settled()).toEqual([])
  })

  it('unblocks a waiting agent when a browser frame passes the transport ceiling', async () => {
    // Long enough that a poll the failure never settles cannot pass by timing
    // out on its own.
    const server = await start({ agentPollMs: 60_000 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejections = collectRejections()
    await nextFrame(socket, 'ready')
    const polled = agentFetch(server, capability, '/api/agent/events?after=0')
    await waitForAttachedAgent(server)

    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'x'.repeat(VISUAL_SERVER_LIMITS.browserFrameBytes) },
      }),
    )
    const [code] = (await once(socket, 'close')) as [number]
    expect(code).toBe(1009)

    // The child is not left holding a turn on a session that can no longer
    // answer it.
    await expect((await polled).json()).resolves.toMatchObject({
      waiting: true,
    })
    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      1,
      'session.end',
    )
    expect(terminal).toMatchObject({
      sequence: 2,
      payload: { reason: 'server-failed' },
    })
    expect(server.status().queue.frozenReason).toBe('message-bytes')
    // The socket the ceiling closed is shutdown, not conversation.
    expect(
      (await journalOf(server)).filter(
        (record) => record.type === 'browser.disconnected',
      ),
    ).toHaveLength(0)
    expect(await rejections.settled()).toEqual([])
  })

  it('ends a session whose journal refuses another response', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejections = collectRejections()
    const asked = await sendChat(socket, 'fill the journal')

    // Responses are the only record a session can grow without bound: the
    // pending queue stops the browser long before 5 MiB of chat.
    const filler = 'x'.repeat(VISUAL_LIMITS.messageBytes)
    let refused: Response | undefined
    for (let index = 0; refused === undefined && index < 128; index += 1) {
      const posted = await postResponse(
        server,
        capability,
        chatResponse(server, asked.eventId, 1000 + index, filler),
      )
      if (posted.status === 200) await posted.json()
      else refused = posted
    }
    expect(refused?.status).toBe(409)
    await expect(refused?.json()).resolves.toMatchObject({
      accepted: false,
      diagnostics: [{ code: 'YMVS122' }],
    })

    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      2,
      'session.end',
    )
    expect(terminal).toMatchObject({
      sequence: 3,
      payload: { reason: 'server-failed' },
    })
    expect(server.status().queue.frozenReason).toBe('transcript-bytes')
    const closed = await server.stop('server-failed')
    expect(closed.handoff).toMatchObject({
      decision: 'failed',
      terminationReason: 'server-failed',
    })
    expect(await rejections.settled()).toEqual([])
    socket.close()
  }, 120_000)
})

describe('startVisualServer agent responses', () => {
  it('journals and broadcasts an agent response to the browser', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'first')

    const broadcast = nextFrame(socket, 'response')
    const posted = await postResponse(
      server,
      capability,
      chatResponse(server, accepted.eventId, 1),
    )
    expect(posted.status).toBe(200)
    await expect(posted.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
    })
    expect((await broadcast).response).toMatchObject({ type: 'chat.response' })
    socket.close()
  })

  it('suppresses a duplicate agent response', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'first')
    const response = chatResponse(server, accepted.eventId, 1)

    await postResponse(server, capability, response)
    const repeated = await postResponse(server, capability, response)
    expect(repeated.status).toBe(200)
    await expect(repeated.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    })
    const journaled = (await journalOf(server)).filter(
      (record) => record.format === 'yarramate/visual-response/v1',
    )
    expect(journaled).toHaveLength(1)
    socket.close()
  })

  it('rejects a response body that is not JSON content', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await agentFetch(
      server,
      capability,
      '/api/agent/responses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'chat.response',
      },
    )
    expect(response.status).toBe(415)
    expect(await journalOf(server)).toHaveLength(0)
  })

  it('rejects a response body beyond the byte ceiling', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await agentFetch(
      server,
      capability,
      '/api/agent/responses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"padding":"${'x'.repeat(VISUAL_SERVER_LIMITS.agentBodyBytes)}"}`,
      },
    )
    expect(response.status).toBe(413)
    expect(await journalOf(server)).toHaveLength(0)
  })

  it('rejects a response that violates the protocol schema', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const empty: VisualResponse = {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(1),
      eventId: identifier(9),
      type: 'chat.response',
      timestamp: '2026-08-08T00:00:02.000Z',
      // Empty text violates the schema's minLength, which no type can catch.
      payload: { text: '' },
    }
    const response = await postResponse(server, capability, empty)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ accepted: false })
    expect(await journalOf(server)).toHaveLength(0)
  })

  it('rejects a response belonging to another session', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await postResponse(server, capability, {
      ...chatResponse(server, identifier(9), 1),
      sessionId: identifier(7),
    })
    expect(response.status).toBe(409)
    expect(await journalOf(server)).toHaveLength(0)
  })

  it('rejects a response that answers an event this session never journaled', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'first')

    // The capability is this session's, and so is the session id; the event
    // being answered is not.
    const response = await postResponse(
      server,
      capability,
      chatResponse(server, identifier(0xbad), 1),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      diagnostics: [{ code: 'YMVS131', pointer: '/eventId' }],
    })
    // The connection this browser opened, and the one message it sent.
    expect(await journalOf(server)).toHaveLength(2)
    socket.close()
  })

  it('promotes a valid model replacement and tells the browser', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'redraw it')

    const rendered = nextFrame(socket, 'model')
    const posted = await postResponse(server, capability, {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(3),
      eventId: accepted.eventId,
      type: 'model.replace',
      timestamp: '2026-08-08T00:00:03.000Z',
      payload: { model: modelWith() },
    })
    expect(posted.status).toBe(200)
    await expect(posted.json()).resolves.toMatchObject({
      accepted: true,
      model: { candidate: '000002', initialView: 'choices' },
    })
    const broadcast = await rendered
    expect(broadcast.model.candidate).toBe('000002')
    // A promoted candidate reaches the browser with its own compiled export,
    // so the diagram it renders is never one candidate behind.
    expect(broadcast.model.compiled).toMatchObject({ _stage: 'layouted' })

    const active: unknown = JSON.parse(
      await readFile(
        join(server.started.sessionRoot, 'active-model.json'),
        'utf8',
      ),
    )
    expect(active).toMatchObject({ candidate: '000002' })
    socket.close()
  })

  it('keeps the last good rendering when a replacement fails to compile', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'redraw it badly')
    // The replacement has to answer a turn the agent is actually holding, or
    // the failed compile has nothing to finish.
    const turn = (await (
      await agentFetch(server, capability, '/api/agent/events?after=0')
    ).json()) as { readonly event: VisualEvent }
    expect(turn.event.eventId).toBe(accepted.eventId)

    const diagnosed = nextFrame(
      socket,
      'response',
      (frame) => frame.response.type === 'diagnostic',
    )
    const posted = await postResponse(server, capability, {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(4),
      eventId: accepted.eventId,
      type: 'model.replace',
      timestamp: '2026-08-08T00:00:04.000Z',
      payload: { model: modelWith('invalid') },
    })
    expect(posted.status).toBe(200)
    const body = (await posted.json()) as {
      readonly model?: unknown
      readonly diagnostics: readonly { readonly code: string }[]
    }
    expect(body.model).toBeUndefined()
    expect(body.diagnostics[0]?.code).toBe('YMVS201')
    expect((await diagnosed).response).toMatchObject({ type: 'diagnostic' })

    const active: unknown = JSON.parse(
      await readFile(
        join(server.started.sessionRoot, 'active-model.json'),
        'utf8',
      ),
    )
    expect(active).toMatchObject({ candidate: '000001' })
    const session = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { readonly model: { readonly candidate: string } }
    expect(session.model.candidate).toBe('000001')

    // A compile that failed still ends the turn its response answered, so the
    // reviewer's next message reaches the agent instead of queueing behind a
    // turn nobody owns any more.
    expect(server.status().agent.inFlightEventId).toBe(null)
    await sendChat(socket, 'try the other one')
    const next = (await (
      await agentFetch(server, capability, '/api/agent/events?after=2')
    ).json()) as { readonly waiting: boolean; readonly event: VisualEvent }
    expect(next.waiting).toBe(false)
    expect(next.event.payload).toEqual({ text: 'try the other one' })
    socket.close()
  })
})

describe('startVisualServer static asset confinement', () => {
  it('denies a percent-encoded traversal out of the asset root', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(
      `${server.started.origin}/assets/%2e%2e%2f%2e%2e%2ffake-likec4.mjs`,
      { headers: { Cookie: cookie } },
    )
    expect(response.status).toBe(404)
  })

  it('denies a traversal that lands back inside the asset root', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    // The resolved path is a served file and its extension is whitelisted, so
    // only the flat-name rule can refuse this one.
    const response = await fetch(
      `${server.started.origin}/assets/%2e%2e%2findex.html`,
      { headers: { Cookie: cookie } },
    )
    expect(response.status).toBe(404)
  })

  it('denies an unnormalised traversal sent on the wire', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const text = await rawRequest(server.started.origin, [
      'GET /assets/../../fake-likec4.mjs HTTP/1.1',
      `Host: 127.0.0.1:${new URL(server.started.origin).port}`,
      `Cookie: ${cookie}`,
      'Connection: close',
    ])
    expect(text.split('\r\n')[0]).toContain('404')
    expect(text).not.toContain('fake-likec4:')
  })

  it('denies a symlinked asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yarramate-visual-assets-'))
    const outside = join(root, 'secret.txt')
    await writeFile(outside, 'agent capability', { mode: 0o600 })
    const served = join(root, 'browser-assets')
    await mkdir(join(served, 'assets'), { recursive: true })
    await writeFile(join(served, 'index.html'), '<!doctype html>')
    await symlink(outside, join(served, 'assets', 'leak-0000.js'))

    const server = await start({ assetRoot: served })
    const { cookie } = await bootstrap(server)
    const response = await fetch(
      `${server.started.origin}/assets/leak-0000.js`,
      { headers: { Cookie: cookie } },
    )
    expect(response.status).toBe(404)
    await rm(root, { recursive: true, force: true })
  })

  it('denies an unknown route', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const response = await fetch(`${server.started.origin}/admin`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(404)
  })
})

describe('startVisualServer lifecycle', () => {
  it('writes a private descriptor carrying only the agent capability', async () => {
    const server = await start()
    const descriptor: unknown = JSON.parse(
      await readFile(server.started.descriptorPath, 'utf8'),
    )
    expect(descriptor).toMatchObject({
      format: 'yarramate/visual-session-descriptor/v1',
      protocolVersion: 'yarramate/visual-protocol/v1',
      sessionId: server.started.sessionId,
      origin: server.started.origin,
      sessionRoot: server.started.sessionRoot,
    })
    const token = new URL(server.started.browserUrl).searchParams.get(
      'key',
    ) as string
    expect(JSON.stringify(descriptor)).not.toContain(token)
    if (process.platform !== 'win32') {
      expect((await stat(server.started.descriptorPath)).mode & 0o777).toBe(
        0o600,
      )
    }
  })

  it('binds only the loopback interface on an ephemeral port', async () => {
    const server = await start()
    expect(server.started.origin).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/)
    expect(server.started.webSocketUrl).toMatch(
      /^ws:\/\/127\.0\.0\.1:[0-9]{1,5}\/socket$/,
    )
    expect(Number(new URL(server.started.origin).port)).toBeGreaterThan(0)
  })

  it('refuses to start when the initial model does not compile', async () => {
    await expect(
      startVisualServer({
        request: { ...request, initialModel: modelWith('invalid') },
        baseDir,
        assetRoot,
      }),
    ).rejects.toThrow(/YMVS201/)
  })

  it('recovers the handoff before deleting the session', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'first')
    await postResponse(
      server,
      capability,
      chatResponse(server, accepted.eventId, 1),
    )
    const root = server.started.sessionRoot

    const closed = await server.stop('user-ended')
    expect(closed).toMatchObject({
      reason: 'user-ended',
      alreadyStopped: false,
    })
    expect(closed.handoff).toMatchObject({
      format: 'yarramate/visual-handoff/v1',
      sessionId: server.started.sessionId,
      // The reviewer's own End was never journaled here, so the shutdown's
      // terminal event is the record past the chat it recovered.
      lastSequence: accepted.sequence + 1,
    })
    await expect(stat(root)).rejects.toThrow()
    await expect(server.closed).resolves.toMatchObject({ reason: 'user-ended' })
  })

  it('answers a repeated stop idempotently', async () => {
    const server = await start()
    const first = await server.stop('user-ended')
    const second = await server.stop('main-cancelled')
    expect(second.alreadyStopped).toBe(true)
    expect(second.reason).toBe('user-ended')
    expect(second.handoff?.sessionId).toBe(first.handoff?.sessionId)
    expect(server.status()).toMatchObject({
      lifecycle: 'stopped',
      alreadyStopped: true,
      server: { listening: false },
    })
  })

  it('stops on the agent stop route and closes the listener', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await agentFetch(server, capability, '/api/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user-ended' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'user-ended',
      alreadyStopped: false,
      handoff: { format: 'yarramate/visual-handoff/v1' },
    })
    await server.closed
    await expect(
      fetch(`${server.started.origin}/api/agent/status`),
    ).rejects.toThrow()
  })

  it('answers every concurrent agent stop request before closing sockets', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const port = Number(new URL(server.started.origin).port)
    const sockets = Array.from({ length: 4 }, () =>
      connect(port, '127.0.0.1'),
    )
    await Promise.all(sockets.map((socket) => once(socket, 'connect')))
    const body = JSON.stringify({ reason: 'user-ended' })
    const responses = sockets.map(
      (socket) =>
        new Promise<string>((resolve, reject) => {
          let response = ''
          socket.setEncoding('utf8')
          socket.on('data', (chunk) => {
            response += chunk
          })
          socket.on('end', () => resolve(response))
          socket.on('error', reject)
          socket.write(
            [
              'POST /api/agent/stop HTTP/1.1',
              `Host: 127.0.0.1:${port}`,
              `Authorization: Bearer ${capability}`,
              'Content-Type: application/json',
              `Content-Length: ${Buffer.byteLength(body)}`,
              'Connection: close',
              '',
              body,
            ].join('\r\n'),
          )
        }),
    )

    const raw = await Promise.all(responses)
    expect(raw.map((response) => response.split('\r\n')[0])).toEqual([
      'HTTP/1.1 200 OK',
      'HTTP/1.1 200 OK',
      'HTTP/1.1 200 OK',
      'HTTP/1.1 200 OK',
    ])
    const results = raw.map(
      (response) =>
        JSON.parse(response.split('\r\n\r\n')[1] ?? '{}') as {
          readonly alreadyStopped: boolean
        },
    )
    expect(results.filter((result) => !result.alreadyStopped)).toHaveLength(1)
    expect(results.filter((result) => result.alreadyStopped)).toHaveLength(3)
  })

  it('settles a waiting long poll when the session stops', async () => {
    // Long enough that a poll the stop never settles cannot pass by timing out.
    const server = await start({ agentPollMs: 60_000 })
    const capability = await capabilityOf(server)
    const polled = agentFetch(server, capability, '/api/agent/events?after=0')
    // The poll has to be registered before the stop reaches it. Authenticating
    // the capability and adding the poll are one synchronous step, so an
    // attached agent is that registration, observed in this process.
    await waitForAttachedAgent(server)
    await server.stop('main-cancelled')
    await expect((await polled).json()).resolves.toMatchObject({
      waiting: true,
    })
  })

  it('closes browser sockets with a closing frame', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await nextFrame(socket, 'ready')
    const closing = nextFrame(socket, 'closing')
    const ended = once(socket, 'close')
    await server.stop('main-cancelled')
    expect(await closing).toMatchObject({ reason: 'main-cancelled' })
    await ended
  })

  it('journals the browser connection the runtime admitted', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const ready = await nextFrame(socket, 'ready')
    // The record is journaled before the snapshot is handed over, so the
    // sequence the browser starts from already counts its own arrival.
    expect(ready.snapshot.lastSequence).toBe(1)
    expect(server.status().browser).toMatchObject({
      connected: true,
      connections: 1,
    })
    const opened = await journalOf(server)
    const connected = opened[0]
    if (
      connected?.format !== 'yarramate/visual-event/v1' ||
      connected.type !== 'browser.connected'
    ) {
      throw new Error('the session journaled no browser connection')
    }
    expect(connected).toMatchObject({
      sessionId: server.started.sessionId,
      sequence: 1,
    })
    // Every field the browser is not allowed to choose was minted here.
    expect(connected.eventId).toMatch(/^[0-9a-f]{32}$/)
    expect(connected.timestamp).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/,
    )

    socket.close(1000)
    await once(socket, 'close')
    await waitForSequence(server, 2)

    const journal = await journalOf(server)
    expect(journal).toHaveLength(2)
    // One connection, one identifier: the pair names the same socket, and the
    // close code the transport reported is the one the record carries.
    expect(journal[1]).toMatchObject({
      format: 'yarramate/visual-event/v1',
      type: 'browser.disconnected',
      sequence: 2,
      payload: { connectionId: connected.payload.connectionId, code: 1000 },
    })
    const idle = server.status()
    expect(idle.browser).toMatchObject({ connected: false, connections: 0 })
    expect(idle.browser.graceExpiresAt).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/,
    )
  })

  it('does not admit a browser whose connected event cannot be journaled', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    await chmod(join(server.started.sessionRoot, 'journal.jsonl'), 0o400)

    const socket = await openBrowserSocket(server, cookie)
    await once(socket, 'close')

    expect(server.status()).toMatchObject({
      browser: { connected: false, connections: 0 },
      queue: { lastSequence: 0 },
    })
    expect(await journalOf(server)).toEqual([])
  })

  it('never opens an agent turn for a browser lifecycle record', async () => {
    const server = await start({ agentPollMs: 60 })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await nextFrame(socket, 'ready')
    socket.close(1000)
    await once(socket, 'close')
    await waitForSequence(server, 2)

    await expect(
      (await agentFetch(server, capability, '/api/agent/events?after=0')).json(),
    ).resolves.toEqual({ waiting: true, lastSequence: 2, pendingEvents: 0 })
    expect(server.status()).toMatchObject({
      agent: { attached: true, inFlightEventId: null },
      queue: { pendingEvents: 0, lastSequence: 2, frozen: false },
    })
  })

  it('journals no disconnection for a socket the shutdown closed', async () => {
    const server = await start({ includeTranscript: true })
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await nextFrame(socket, 'ready')
    const ended = once(socket, 'close')

    const closed = await server.stop('user-ended')
    await ended

    // The transcript recovery read is the whole record: one arrival, then the
    // record that closed the session, and no shutdown noise behind it.
    expect(
      (closed.handoff?.transcript ?? []).map((record) => record.type),
    ).toEqual(['browser.connected', 'session.end'])
  })
})

describe('startVisualServer shutdown and admission races', () => {
  it('never journals a browser frame that raced the stop it lost', async () => {
    const server = await start({ includeTranscript: true })
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejections = collectRejections()

    // Enqueued, unacknowledged, and deliberately not awaited: every frame is
    // already on the admission chain when the stop begins.
    for (let sent = 0; sent < 8; sent += 1) {
      socket.send(
        JSON.stringify({
          type: 'chat.message',
          lastAcknowledgedSequence: 0,
          payload: { text: `race ${sent}` },
        }),
      )
    }
    const closed = await server.stop('main-cancelled')

    expect(closed).toMatchObject({
      reason: 'main-cancelled',
      alreadyStopped: false,
    })
    expect(closed.handoff).toBeDefined()
    // Recovery must observe a settled journal: every sequence it counted is a
    // record it could actually read.
    const events = (closed.handoff?.transcript ?? []).filter(
      (record) => record.format === 'yarramate/visual-event/v1',
    )
    expect(events).toHaveLength(closed.handoff?.lastSequence ?? -1)
    await expect(server.closed).resolves.toMatchObject({
      reason: 'main-cancelled',
    })
    await expect(server.stop('user-ended')).resolves.toMatchObject({
      alreadyStopped: true,
      reason: 'main-cancelled',
    })
    expect(server.status()).toMatchObject({
      lifecycle: 'stopped',
      alreadyStopped: true,
    })
    // Nothing may recreate the session directory after recovery deleted it.
    await expect(stat(server.started.sessionRoot)).rejects.toThrow()
    expect(await rejections.settled()).toEqual([])
  })

  it('tells the browser when admitting its frame fails', async () => {
    let narrow = 0
    const server = await start({
      // 16-byte draws mint the session id, the style nonce, the connection id,
      // the record the runtime writes for that connection, then browser event
      // identifiers; failing from the first of those makes admission throw
      // inside the socket's own fire-and-forget handler.
      randomBytes: (size: number) => {
        if (size !== 16) return randomBytes(size)
        narrow += 1
        if (narrow >= 5) throw new Error('random source unavailable')
        return randomBytes(16)
      },
    })
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejections = collectRejections()

    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'unminted' },
      }),
    )

    expect((await rejected).diagnostics[0]?.code).toBe('YMVS307')
    // Nothing but the connection the runtime journaled for itself.
    expect(await journalOf(server)).toMatchObject([
      { type: 'browser.connected' },
    ])
    // The session survives a failed admission and still answers.
    expect(server.status().lifecycle).toBe('running')
    expect(await rejections.settled()).toEqual([])
  })

  it('never journals a frame sent after the drain began', async () => {
    const server = await start({ includeTranscript: true })
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    await sendChat(socket, 'in time')
    const rejections = collectRejections()

    // The stop marks the session draining and starts the socket's closing
    // handshake synchronously, but the client is still OPEN for a moment: a
    // frame written now can reach a session that is already recovering.
    const stopping = server.stop('main-cancelled')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'too late' },
      }),
    )
    const closed = await stopping

    const texts = (closed.handoff?.transcript ?? [])
      .filter((record) => record.type === 'chat.message')
      .map((record) => JSON.stringify(record.payload))
    expect(texts).toEqual([JSON.stringify({ text: 'in time' })])
    await expect(stat(server.started.sessionRoot)).rejects.toThrow()
    expect(await rejections.settled()).toEqual([])
  })

  it('finishes admitted work before recovering the session', async () => {
    const compilerLog = join(baseDir, 'compiler.log')
    await writeFile(compilerLog, '')
    const server = await start({ includeTranscript: true })
    const capability = await capabilityOf(server)
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const accepted = await sendChat(socket, 'redraw it slowly')
    const rejections = collectRejections()

    // The barrier: the fake compiler records every execution before it does
    // anything else, and this candidate's validate stage never returns, so a
    // logged run means a compile is provably still in flight when stop begins.
    process.env.YARRAMATE_FAKE_LIKEC4_LOG = compilerLog
    const running = watch(compilerLog)
    const posted = postResponse(server, capability, {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(6),
      eventId: accepted.eventId,
      type: 'model.replace',
      timestamp: '2026-08-08T00:00:06.000Z',
      payload: { model: modelWith('hang') },
    })
    for await (const _change of running) {
      if ((await readFile(compilerLog, 'utf8')).includes('validate')) break
    }
    delete process.env.YARRAMATE_FAKE_LIKEC4_LOG

    const closed = await server.stop('main-cancelled')

    // Shutdown cancelled the compile rather than waiting out its budget, and
    // still waited for the diagnostic that cancellation produced to be
    // journaled, so recovery reports work the server had already accepted.
    const types = (closed.handoff?.transcript ?? []).map((record) => record.type)
    expect(types).toContain('model.replace')
    expect(types).toContain('diagnostic')
    await expect((await posted).json()).resolves.toMatchObject({
      accepted: true,
      diagnostics: [{ code: 'YMVS204' }],
    })
    await expect(stat(server.started.sessionRoot)).rejects.toThrow()
    expect(await rejections.settled()).toEqual([])
  }, 30_000)
})

describe('startVisualServer diagnostic conformance', () => {
  /**
   * Every diagnostic the runtime publishes is read back by the one-shot agent
   * clients inside a `visual-diagnostic-result/v1` document, so each refusal
   * surface has to emit diagnostics that document already accepts — including
   * the RFC 6901 pointers it requires.
   */
  const publishable = (diagnostics: unknown): readonly VisualDiagnostic[] => {
    const parsed = parseVisualDiagnosticResult({
      format: 'yarramate/visual-diagnostic-result/v1',
      diagnostics,
    })
    if (!parsed.ok) {
      throw new Error(
        `diagnostics are not publishable: ${JSON.stringify(diagnostics)} (${parsed.diagnostics[0]?.message})`,
      )
    }
    return parsed.value.diagnostics
  }

  const diagnosticsOf = (document: unknown): unknown => {
    if (
      typeof document === 'object' &&
      document !== null &&
      'diagnostics' in document
    ) {
      return document.diagnostics
    }
    throw new Error(`answer carries no diagnostics: ${JSON.stringify(document)}`)
  }

  it('publishes a schema refusal as a diagnostic result', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const empty: VisualResponse = {
      format: 'yarramate/visual-response/v1',
      sessionId: server.started.sessionId,
      responseId: identifier(1),
      eventId: identifier(9),
      type: 'chat.response',
      timestamp: '2026-08-08T00:00:02.000Z',
      // Empty text violates the schema's minLength, which no type can catch.
      payload: { text: '' },
    }
    const response = await postResponse(server, capability, empty)
    expect(response.status).toBe(400)
    expect(
      publishable(diagnosticsOf(await response.json())).length,
    ).toBeGreaterThan(0)
  })

  it('publishes a foreign-session refusal as a diagnostic result', async () => {
    const server = await start()
    const capability = await capabilityOf(server)
    const response = await postResponse(server, capability, {
      ...chatResponse(server, identifier(9), 1),
      sessionId: identifier(7),
    })
    expect(response.status).toBe(409)
    const diagnostics = publishable(diagnosticsOf(await response.json()))
    expect(diagnostics[0]).toMatchObject({
      code: 'YMVS126',
      pointer: '/sessionId',
    })
  })

  it('publishes a rejected browser frame as a diagnostic result', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    const rejected = nextFrame(socket, 'rejected')
    socket.send(JSON.stringify({
      type: 'chat.message',
      lastAcknowledgedSequence: 0,
      payload: {},
    }))
    expect(publishable((await rejected).diagnostics).length).toBeGreaterThan(0)
    socket.close()
  })

  it('publishes a frozen-queue refusal as a diagnostic result', async () => {
    const server = await start()
    const { cookie } = await bootstrap(server)
    const socket = await openBrowserSocket(server, cookie)
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`)
    }
    const rejected = nextFrame(socket, 'rejected')
    socket.send(
      JSON.stringify({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: 'one more' },
      }),
    )
    const diagnostics = publishable((await rejected).diagnostics)
    expect(diagnostics[0]).toMatchObject({
      code: 'YMVS305',
      pointer: '/sequence',
    })
    socket.close()
  })
})

describe('startVisualServer teardown retries', () => {
  /**
   * The teardown is failed through the filesystem rather than the clock: a
   * session root nothing may unlink from refuses the removal a stop ends with,
   * refuses it on every attempt, and stops refusing the moment the permission
   * comes back. A process the permission does not bind cannot see any of it.
   */
  const enforcesPermissions =
    process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!enforcesPermissions)(
    'retries a teardown the first stop failed to finish',
    async () => {
      const server = await start()
      const root = server.started.sessionRoot
      // Readable and traversable, so the recovery the stop reads still
      // succeeds; not writable, so the removal that follows it cannot.
      await chmod(root, 0o500)

      await expect(server.stop('user-ended')).rejects.toThrow()
      // Nothing was lost to the failure: the journal the retry recovers from
      // is still the one this session wrote.
      await expect(stat(join(root, 'journal.jsonl'))).resolves.toBeDefined()

      await chmod(root, 0o700)
      const closed = await server.stop('user-ended')

      expect(closed).toMatchObject({
        reason: 'user-ended',
        alreadyStopped: false,
      })
      expect(closed.handoff).toMatchObject({
        format: 'yarramate/visual-handoff/v1',
        sessionId: server.started.sessionId,
      })
      await expect(stat(root)).rejects.toThrow()
      await expect(server.closed).resolves.toMatchObject({
        reason: 'user-ended',
      })
      expect(server.status()).toMatchObject({
        lifecycle: 'stopped',
        server: { listening: false },
      })
    },
  )
})

it('keeps the fixture asset root free of anything the server must not serve', async () => {
  expect(dirname(assetRoot)).toBe(fixtures.replace(/\/$/, ''))
  const page = await readFile(join(assetRoot, 'index.html'), 'utf8')
  expect(page).not.toMatch(/https?:\/\//)
  expect(page).not.toMatch(/<script(?![^>]*\ssrc=)/)
})
