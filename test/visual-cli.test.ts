import { EventEmitter, once } from 'node:events'
import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  VISUAL_CLIENT_LIMITS,
  stopVisualSessionClient,
} from '../src/adapters/visual/client.js'
import {
  VISUAL_LIMITS,
  VISUAL_PROTOCOL_VERSION,
  parseVisualDiagnosticResult,
  parseVisualEvent,
  parseVisualHandoff,
  parseVisualSessionStarted,
  parseVisualStatus,
  type VisualBrowserInput,
  type VisualEvent,
  type VisualHandoff,
  type VisualModel,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualSessionRequest,
  type VisualSessionStarted,
} from '../src/adapters/visual/protocol.js'
import {
  VISUAL_SERVER_LIMITS,
  startVisualServer,
  type VisualServerFrame,
  type VisualServerHandle,
  type VisualServerOptions,
} from '../src/adapters/visual/session-server.js'
import {
  VISUAL_SESSION_DIRECTORY,
  runVisualCli,
  runVisualClientCli,
  runVisualStart,
  visualUsage,
  type VisualStartIo,
} from '../src/adapters/visual-cli.js'
import { packageVersion, type CliResult } from '../src/cli-support.js'

const fixtures = fileURLToPath(new URL('./fixtures/visual/', import.meta.url))
const fakeCompiler = join(fixtures, 'fake-likec4.mjs')
const assetRoot = join(fixtures, 'browser-assets')

/** Nothing listens on port 1, so a client reaches it only to be refused. */
const CLOSED_PORT = 1

const modelWith = (marker?: string): VisualModel => ({
  format: 'yarramate/visual-model/v1',
  authority: 'ad-hoc',
  initialView: 'choices',
  sourceDigests: {},
  files: {
    'likec4.config.json': '{"name":"visual"}',
    'model.likec4': `model { system = system "System" }${
      marker === undefined ? '' : `\n// fake:${marker}`
    }`,
    'views/choices.likec4': 'views { view choices { include * } }',
  },
})

const requestWith = (marker?: string): VisualSessionRequest => ({
  format: 'yarramate/visual-session-request/v1',
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  compiler: { command: process.execPath, args: [fakeCompiler] },
  initialModel: modelWith(marker),
})

const chatEventInput = {
  type: 'chat.message',
  lastAcknowledgedSequence: 0,
  payload: { text: 'Compare the two delivery designs' },
} as const

const identifier = (index: number) => index.toString(16).padStart(32, '0')

const line = (value: unknown) => `${JSON.stringify(value)}\n`

let baseDir = ''
let workDir = ''
const running: VisualServerHandle[] = []
/** Browser sockets a test opened, closed once the session behind them is gone. */
const attached: WebSocket[] = []

const startServer = async (overrides: Partial<VisualServerOptions> = {}) => {
  const handle = await startVisualServer({
    request: requestWith(),
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

const writeJson = (path: string, value: unknown) =>
  writeFile(path, line(value), { mode: 0o600 })

/**
 * Every diagnostic code the refusal on stderr carries. Reading it back through
 * the protocol parser means a test that asserts a code also asserts the refusal
 * is a valid `yarramate/visual-diagnostic-result/v1` document.
 */
const refusalCodes = (result: CliResult): readonly string[] => {
  const parsed = parseVisualDiagnosticResult(JSON.parse(result.stderr))
  if (!parsed.ok) {
    throw new Error(
      `stderr is not a diagnostic result: ${result.stderr} (${parsed.diagnostics[0]?.message})`,
    )
  }
  return parsed.value.diagnostics.map((diagnostic) => diagnostic.code)
}

const readDescriptorFile = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as VisualSessionDescriptor

const entriesIn = async (directory: string) => {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

// ------------------------------------------------------- live browser traffic

const buffered = new WeakMap<WebSocket, VisualServerFrame[]>()

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

/**
 * Drives one real browser input into a session: bootstrap for the cookie,
 * upgrade, send, and wait for the runtime's acknowledgement, so the event is
 * journaled before the CLI is asked for it.
 *
 * The socket is left open and closed by the teardown. A session journals a
 * browser going away, so closing it here would leave every sequence the CLI
 * then reads racing an append nothing in the test is waiting on.
 */
const sendBrowserEvent = async (
  started: VisualSessionStarted,
  input: VisualBrowserInput,
) => {
  const bootstrapped = await fetch(started.browserUrl, { redirect: 'manual' })
  const header = bootstrapped.headers.get('set-cookie')
  if (header === null) throw new Error('bootstrap returned no cookie')
  const socket = new WebSocket(started.webSocketUrl, {
    headers: {
      Cookie: header.split(';')[0] as string,
      Origin: started.origin,
    },
  })
  const frames: VisualServerFrame[] = []
  buffered.set(socket, frames)
  socket.on('message', (data) => {
    frames.push(JSON.parse(String(data)) as VisualServerFrame)
  })
  await once(socket, 'open')
  attached.push(socket)
  const accepted = nextFrame(socket, 'accepted')
  socket.send(JSON.stringify(input))
  return accepted
}

const agentPost = (
  descriptor: VisualSessionDescriptor,
  path: string,
  body: unknown,
) =>
  fetch(`${descriptor.origin}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${descriptor.agentCapability}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

// ------------------------------------------------------------ planted session

let plantedIndex = 0

const plantedJournal = (
  id: string,
): readonly (VisualEvent | VisualResponse)[] => [
  {
    format: 'yarramate/visual-event/v1',
    sessionId: id,
    sequence: 1,
    eventId: identifier(1),
    type: 'chat.message',
    timestamp: '2026-08-08T00:00:01.000Z',
    payload: { text: 'Compare the two delivery designs' },
  },
  {
    format: 'yarramate/visual-response/v1',
    sessionId: id,
    responseId: identifier(2),
    eventId: identifier(1),
    type: 'handoff.complete',
    timestamp: '2026-08-08T00:00:02.000Z',
    payload: {
      summary: 'Design A isolates delivery.',
      confirmedDecisions: ['Isolate delivery'],
      requestedChanges: [],
      unresolvedQuestions: [],
      finalViews: ['choices'],
    },
  },
  {
    format: 'yarramate/visual-event/v1',
    sessionId: id,
    sequence: 2,
    eventId: identifier(3),
    type: 'session.end',
    timestamp: '2026-08-08T00:00:03.000Z',
    payload: { reason: 'user-ended' },
  },
]

/**
 * A correctly marked session directory whose server is gone. This is the shape
 * every server-down path has to cope with: local recovery, the status fallback,
 * and a stop that has nothing left to ask.
 */
const plantSession = async (
  options: {
    readonly port?: number
    readonly createdAt?: string
    readonly marker?: unknown
  } = {},
) => {
  plantedIndex += 1
  const id = identifier(0x100000 + plantedIndex)
  const root = join(baseDir, id)
  await mkdir(join(root, 'candidates'), { recursive: true, mode: 0o700 })
  const createdAt = options.createdAt ?? '2026-08-08T00:00:00.000Z'
  await writeJson(
    join(root, 'session.json'),
    options.marker ?? {
      format: 'yarramate/visual-session-marker/v1',
      id,
      createdAt,
      authority: 'ad-hoc',
    },
  )
  const records = plantedJournal(id)
  await writeFile(
    join(root, 'journal.jsonl'),
    records.map((record) => line(record)).join(''),
    { mode: 0o600 },
  )
  const descriptor: VisualSessionDescriptor = {
    format: 'yarramate/visual-session-descriptor/v1',
    protocolVersion: VISUAL_PROTOCOL_VERSION,
    sessionId: id,
    origin: `http://127.0.0.1:${options.port ?? CLOSED_PORT}`,
    agentCapability: 'a'.repeat(64),
    sessionRoot: root,
    journalPath: join(root, 'journal.jsonl'),
    createdAt,
  }
  const descriptorPath = join(root, 'descriptor.json')
  await writeJson(descriptorPath, descriptor)
  return { id, root, descriptor, descriptorPath, records }
}

// --------------------------------------------------------- foreground `start`

interface Foreground {
  readonly result: Promise<CliResult>
  readonly started: Promise<VisualSessionStarted>
  readonly stdout: string[]
  readonly stderr: string[]
  readonly signals: EventEmitter
}

/**
 * Runs the blocking command the way the executable does, with the signal source
 * injected: emitting on the process itself would also wake the test runner's
 * own handlers. One test covers the uninjected default.
 */
const startForeground = (requestPath: string, cwd: string): Foreground => {
  const stdout: string[] = []
  const stderr: string[] = []
  const signals = new EventEmitter()
  const first = Promise.withResolvers<VisualSessionStarted>()
  const result = runVisualStart(requestPath, cwd, {
    stdout: (chunk) => {
      stdout.push(chunk)
      const parsed = parseVisualSessionStarted(JSON.parse(chunk))
      if (parsed.ok) first.resolve(parsed.value)
      else first.reject(new Error(`start published no document: ${chunk}`))
    },
    stderr: (chunk) => stderr.push(chunk),
    signals,
  })
  // A start that refuses before listening never publishes; the waiter has to
  // fail with that refusal instead of hanging on it.
  result.then(
    () =>
      first.reject(
        new Error(`start returned before publishing: ${stderr.join('')}`),
      ),
    (cause: unknown) => first.reject(cause),
  )
  return { result, started: first.promise, stdout, stderr, signals }
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'yarramate-visual-cli-'))
  workDir = await mkdtemp(join(tmpdir(), 'yarramate-visual-work-'))
})

afterEach(async () => {
  for (const socket of attached.splice(0)) socket.close()
  for (const handle of running.splice(0)) {
    await handle.stop('main-cancelled')
  }
  await rm(baseDir, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
})

describe('runVisualClientCli usage', () => {
  it('prints the package version', async () => {
    await expect(
      runVisualClientCli(['--version'], workDir),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: `yarramate-visual ${packageVersion}\n`,
      stderr: '',
    })
  })

  it('prints usage without arguments', async () => {
    await expect(runVisualClientCli([], workDir)).resolves.toEqual({
      exitCode: 2,
      stdout: '',
      stderr: visualUsage,
    })
  })

  it('prints usage for an unknown command', async () => {
    await expect(
      runVisualClientCli(['inspect', 'descriptor.json'], workDir),
    ).resolves.toEqual({ exitCode: 2, stdout: '', stderr: visualUsage })
  })

  it('prints usage for a command without a descriptor', async () => {
    for (const command of ['wait', 'respond', 'status', 'recover', 'stop']) {
      await expect(
        runVisualClientCli([command], workDir),
      ).resolves.toMatchObject({ exitCode: 2, stderr: visualUsage })
    }
  })

  it('prints usage for an unknown flag', async () => {
    const { descriptorPath } = await plantSession()
    for (const rest of [['--since', '1'], ['--transcript']]) {
      await expect(
        runVisualClientCli(['wait', descriptorPath, ...rest], workDir),
      ).resolves.toMatchObject({ exitCode: 2, stderr: visualUsage })
    }
  })

  it('prints usage for an --after that is not a sequence', async () => {
    const { descriptorPath } = await plantSession()
    for (const value of ['-1', 'first', '1.5', '', '0x2', ' 1']) {
      await expect(
        runVisualClientCli(['wait', descriptorPath, '--after', value], workDir),
      ).resolves.toMatchObject({ exitCode: 2, stderr: visualUsage })
    }
    await expect(
      runVisualClientCli(['wait', descriptorPath, '--after'], workDir),
    ).resolves.toMatchObject({ exitCode: 2, stderr: visualUsage })
  })

  it('prints usage when respond has no response document', async () => {
    const { descriptorPath } = await plantSession()
    await expect(
      runVisualClientCli(['respond', descriptorPath], workDir),
    ).resolves.toMatchObject({ exitCode: 2, stderr: visualUsage })
  })

  it('prints usage for a trailing argument', async () => {
    const { descriptorPath } = await plantSession()
    const rejected: readonly (readonly string[])[] = [
      ['status', descriptorPath, '--transcript'],
      ['recover', descriptorPath, '--transcript', '--transcript'],
      ['stop', descriptorPath, 'now'],
      ['respond', descriptorPath, 'response.json', 'extra.json'],
      ['wait', descriptorPath, '--after', '1', '--transcript'],
    ]
    for (const args of rejected) {
      await expect(runVisualClientCli(args, workDir)).resolves.toMatchObject({
        exitCode: 2,
        stderr: visualUsage,
      })
    }
  })

  it('prints usage when start is invoked without a request', async () => {
    await expect(runVisualCli(['start'], workDir)).resolves.toEqual({
      exitCode: 2,
      stdout: '',
      stderr: visualUsage,
    })
  })
})

describe('descriptor confinement', () => {
  it('refuses a descriptor that is not there', async () => {
    const result = await runVisualClientCli(
      ['status', join(workDir, 'missing.json')],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS401'])
  })

  it('refuses a descriptor that is a symlink', async () => {
    const { descriptorPath } = await plantSession()
    const link = join(workDir, 'linked.json')
    await symlink(descriptorPath, link)
    const result = await runVisualClientCli(['status', link], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS401'])
  })

  it('refuses a descriptor that is not JSON', async () => {
    const path = join(workDir, 'descriptor.json')
    await writeFile(path, '{"format":')
    const result = await runVisualClientCli(['status', path], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS402'])
  })

  it('refuses a document that is not a session descriptor', async () => {
    const path = join(workDir, 'descriptor.json')
    await writeJson(path, { format: 'yarramate/visual-status/v1' })
    const result = await runVisualClientCli(['status', path], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toContain('YMVS103')
  })

  it('refuses a descriptor whose origin is not loopback', async () => {
    const { descriptor, root } = await plantSession()
    const path = join(root, 'descriptor.json')
    await writeJson(path, { ...descriptor, origin: 'http://model.example.com' })
    const result = await runVisualClientCli(['status', path], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toContain('YMVS103')
  })

  it('refuses a descriptor that names a session outside its own directory', async () => {
    const { descriptor } = await plantSession()
    const copied = join(workDir, 'descriptor.json')
    await writeJson(copied, descriptor)
    const result = await runVisualClientCli(['stop', copied], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS403'])
    // The session a redirected descriptor would have deleted is still there.
    expect(existsSync(descriptor.sessionRoot)).toBe(true)
  })

  it('refuses a descriptor whose journal is not the session journal', async () => {
    const { descriptor, root } = await plantSession()
    const path = join(root, 'descriptor.json')
    await writeJson(path, {
      ...descriptor,
      journalPath: join(root, 'candidates', 'journal.jsonl'),
    })
    const result = await runVisualClientCli(['recover', path], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS403'])
  })

  it('resolves a descriptor path against the working directory', async () => {
    const { descriptor, root } = await plantSession()
    const result = await runVisualClientCli(['recover', 'descriptor.json'], root)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      sessionId: descriptor.sessionId,
    })
  })
})

describe('wait', () => {
  it('waits for the event the browser sent', async () => {
    const handle = await startServer()
    const acknowledged = await sendBrowserEvent(handle.started, chatEventInput)

    const result = await runVisualClientCli(
      ['wait', handle.started.descriptorPath, '--after', '0'],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const event: unknown = JSON.parse(result.stdout)
    expect(event).toMatchObject({
      format: 'yarramate/visual-event/v1',
      sessionId: handle.started.sessionId,
      type: 'chat.message',
      // Sequence 1 is the arrival the runtime journaled for this browser.
      sequence: 2,
      eventId: acknowledged.eventId,
      payload: { text: chatEventInput.payload.text },
    })
    expect(parseVisualEvent(event).ok).toBe(true)
    // One document per poll, on one line.
    expect(result.stdout).toBe(line(event))
  })

  it('defaults to waiting from the start of the session', async () => {
    const handle = await startServer()
    await sendBrowserEvent(handle.started, chatEventInput)
    const result = await runVisualClientCli(
      ['wait', handle.started.descriptorPath],
      workDir,
    )
    expect(JSON.parse(result.stdout)).toMatchObject({ sequence: 2 })
  })

  it('reports nothing when the poll window closes idle', async () => {
    const handle = await startServer({ agentPollMs: 50 })
    await expect(
      runVisualClientCli(
        ['wait', handle.started.descriptorPath, '--after', '0'],
        workDir,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('skips an event the caller has already seen', async () => {
    const handle = await startServer({ agentPollMs: 50 })
    await sendBrowserEvent(handle.started, chatEventInput)
    await expect(
      runVisualClientCli(
        ['wait', handle.started.descriptorPath, '--after', '2'],
        workDir,
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('outlasts the whole poll window the server may hold it for', () => {
    expect(VISUAL_CLIENT_LIMITS.requestTimeoutMs).toBeGreaterThan(
      VISUAL_SERVER_LIMITS.agentPollMs,
    )
  })

  it('reports a server that refuses the descriptor capability', async () => {
    const handle = await startServer()
    const descriptor = await readDescriptorFile(handle.started.descriptorPath)
    await writeJson(handle.started.descriptorPath, {
      ...descriptor,
      agentCapability: 'b'.repeat(64),
    })
    const result = await runVisualClientCli(
      ['wait', handle.started.descriptorPath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS405'])
  })

  it('reports a session server that is not listening', async () => {
    const { descriptorPath } = await plantSession()
    const result = await runVisualClientCli(['wait', descriptorPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS404'])
  })
})

describe('respond', () => {
  const responseFor = (sessionId: string, eventId: string): VisualResponse => ({
    format: 'yarramate/visual-response/v1',
    sessionId,
    responseId: identifier(7),
    eventId,
    type: 'chat.response',
    timestamp: '2026-08-08T00:00:04.000Z',
    payload: { text: 'Design A isolates delivery; design B shares it.' },
  })

  it('journals the response the agent wrote for the browser event', async () => {
    const handle = await startServer()
    const acknowledged = await sendBrowserEvent(handle.started, chatEventInput)
    const responsePath = join(workDir, 'response.json')
    await writeJson(
      responsePath,
      responseFor(handle.started.sessionId, acknowledged.eventId),
    )

    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, responsePath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      accepted: true,
      duplicate: false,
      lastSequence: 2,
    })
    expect(
      await readFile(join(handle.started.sessionRoot, 'journal.jsonl'), 'utf8'),
    ).toContain('"type":"chat.response"')
  })

  it('reports the second delivery of one response as a duplicate', async () => {
    const handle = await startServer()
    const acknowledged = await sendBrowserEvent(handle.started, chatEventInput)
    const responsePath = join(workDir, 'response.json')
    await writeJson(
      responsePath,
      responseFor(handle.started.sessionId, acknowledged.eventId),
    )
    const args = ['respond', handle.started.descriptorPath, responsePath]
    expect((await runVisualClientCli(args, workDir)).exitCode).toBe(0)
    const repeated = await runVisualClientCli(args, workDir)
    expect(repeated.exitCode).toBe(0)
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      accepted: true,
      duplicate: true,
    })
  })

  it('refuses a response document that is not there', async () => {
    const handle = await startServer()
    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, join(workDir, 'missing.json')],
      workDir,
    )
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS407'])
  })

  it('refuses a response document that is not JSON', async () => {
    const handle = await startServer()
    const responsePath = join(workDir, 'response.json')
    await writeFile(responsePath, 'chat.response')
    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, responsePath],
      workDir,
    )
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS407'])
  })

  it('refuses an invalid response before the server is asked', async () => {
    const handle = await startServer()
    const acknowledged = await sendBrowserEvent(handle.started, chatEventInput)
    const responsePath = join(workDir, 'response.json')
    await writeJson(responsePath, {
      ...responseFor(handle.started.sessionId, acknowledged.eventId),
      payload: { text: '' },
    })
    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, responsePath],
      workDir,
    )
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toContain('YMVS105')
    expect(
      await readFile(join(handle.started.sessionRoot, 'journal.jsonl'), 'utf8'),
    ).not.toContain('"type":"chat.response"')
  })

  it('surfaces the server refusal of a response for another session', async () => {
    const handle = await startServer()
    const acknowledged = await sendBrowserEvent(handle.started, chatEventInput)
    const responsePath = join(workDir, 'response.json')
    await writeJson(
      responsePath,
      responseFor(identifier(0xbad), acknowledged.eventId),
    )
    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, responsePath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS126'])
  })

  it('surfaces the store refusal of a response for an event never taken', async () => {
    const handle = await startServer()
    await sendBrowserEvent(handle.started, chatEventInput)
    const responsePath = join(workDir, 'response.json')
    await writeJson(
      responsePath,
      responseFor(handle.started.sessionId, identifier(0xbad)),
    )
    const result = await runVisualClientCli(
      ['respond', handle.started.descriptorPath, responsePath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    // The store's own code, and not the transport refusal this is laundered
    // into when the carried diagnostic does not survive the client's strict
    // read of the diagnostic result the server answered with.
    expect(refusalCodes(result)).toEqual(['YMVS131'])
  })

  it('reports a session server that is not listening', async () => {
    const { descriptor, descriptorPath } = await plantSession()
    const responsePath = join(workDir, 'response.json')
    await writeJson(
      responsePath,
      responseFor(descriptor.sessionId, identifier(1)),
    )
    const result = await runVisualClientCli(
      ['respond', descriptorPath, responsePath],
      workDir,
    )
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS404'])
  })
})

describe('status', () => {
  it('reports the status the running server serves', async () => {
    const handle = await startServer()
    await sendBrowserEvent(handle.started, chatEventInput)
    const result = await runVisualClientCli(
      ['status', handle.started.descriptorPath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const status: unknown = JSON.parse(result.stdout)
    expect(parseVisualStatus(status).ok).toBe(true)
    expect(status).toMatchObject({
      format: 'yarramate/visual-status/v1',
      sessionId: handle.started.sessionId,
      lifecycle: 'running',
      alreadyStopped: false,
      server: { listening: true, origin: handle.started.origin },
      queue: { pendingEvents: 1, lastSequence: 2, frozen: false },
    })
  })

  it('falls back to a stopped status when the server is gone', async () => {
    const { descriptorPath, id } = await plantSession()
    const result = await runVisualClientCli(['status', descriptorPath], workDir)
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const status: unknown = JSON.parse(result.stdout)
    expect(parseVisualStatus(status).ok).toBe(true)
    expect(status).toMatchObject({
      sessionId: id,
      lifecycle: 'stopped',
      alreadyStopped: true,
      server: { listening: false, origin: `http://127.0.0.1:${CLOSED_PORT}` },
      browser: { connected: false, connections: 0 },
      agent: { attached: false, inFlightEventId: null },
      // Read back from the journal that outlived the runtime.
      queue: { pendingEvents: 0, lastSequence: 2, frozen: false },
      capabilities: { chat: false, modelReplacement: false },
    })
  })

  it('reports a stopped status for a session that is already gone', async () => {
    const { descriptor, descriptorPath, root } = await plantSession()
    await rm(root, { recursive: true, force: true })
    // Only the descriptor is restored, so confinement still holds while every
    // other session document has gone with the runtime that owned it.
    await mkdir(root, { recursive: true, mode: 0o700 })
    await writeJson(descriptorPath, descriptor)
    const result = await runVisualClientCli(['status', descriptorPath], workDir)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      lifecycle: 'stopped',
      queue: { lastSequence: 0 },
      transcriptBytes: 0,
    })
  })
})

describe('recover', () => {
  it('recovers the journaled handoff while the server is gone', async () => {
    const { descriptorPath, id, root } = await plantSession()
    const result = await runVisualClientCli(['recover', descriptorPath], workDir)
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const handoff = JSON.parse(result.stdout) as VisualHandoff
    expect(parseVisualHandoff(handoff).ok).toBe(true)
    expect(handoff).toMatchObject({
      format: 'yarramate/visual-handoff/v1',
      sessionId: id,
      authority: 'ad-hoc',
      decision: 'completed',
      terminationReason: 'user-ended',
      lastSequence: 2,
      summary: 'Design A isolates delivery.',
      confirmedDecisions: ['Isolate delivery'],
      finalViews: ['choices'],
      transcriptPath: join(root, 'journal.jsonl'),
    })
    expect('transcript' in handoff).toBe(false)
    // Recovery is a read: the session survives it.
    expect(existsSync(root)).toBe(true)
  })

  it('includes the raw transcript when asked', async () => {
    const { descriptorPath } = await plantSession()
    const result = await runVisualClientCli(
      ['recover', descriptorPath, '--transcript'],
      workDir,
    )
    expect(result.exitCode).toBe(0)
    const handoff = JSON.parse(result.stdout) as VisualHandoff
    // The submitted summary is the handoff itself, not conversation.
    expect(handoff.transcript).toMatchObject([
      { type: 'chat.message', sequence: 1 },
      { type: 'session.end', sequence: 2 },
    ])
  })

  it('refuses a journal that is not a valid transcript', async () => {
    const { descriptorPath, root } = await plantSession()
    await writeFile(join(root, 'journal.jsonl'), '{"format":"nonsense"}\n')
    const result = await runVisualClientCli(['recover', descriptorPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS123'])
  })

  it('refuses a directory whose marker names another session', async () => {
    const { descriptorPath, root } = await plantSession({
      marker: {
        format: 'yarramate/visual-session-marker/v1',
        id: identifier(0xfeed),
        createdAt: '2026-08-08T00:00:00.000Z',
        authority: 'ad-hoc',
      },
    })
    const result = await runVisualClientCli(['recover', descriptorPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS125'])
    expect(existsSync(root)).toBe(true)
  })
})

describe('stop', () => {
  it('stops the running server and hands back the recovered summary', async () => {
    const handle = await startServer()
    await sendBrowserEvent(handle.started, chatEventInput)
    const result = await runVisualClientCli(
      ['stop', handle.started.descriptorPath],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: 'yarramate/visual-handoff/v1',
      sessionId: handle.started.sessionId,
      // The runtime's own terminal event, past the arrival and the chat
      // message, and the cause this stop closed the session under.
      lastSequence: 3,
      terminationReason: 'main-cancelled',
    })
    // Recovered before cleanup: the summary above came out of a journal the
    // same command then deleted.
    expect(existsSync(handle.started.sessionRoot)).toBe(false)
    await expect(handle.closed).resolves.toMatchObject({
      reason: 'main-cancelled',
      alreadyStopped: false,
    })
    running.splice(running.indexOf(handle), 1)
    await expect(
      fetch(`${handle.started.origin}/api/session`),
    ).rejects.toThrow()
  })

  it('converges when the server is already absent', async () => {
    const { descriptorPath, root, id } = await plantSession()
    const result = await runVisualClientCli(['stop', descriptorPath], workDir)
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      sessionId: id,
      lastSequence: 2,
      decision: 'completed',
    })
    expect(existsSync(root)).toBe(false)
  })

  it('includes the raw transcript when asked', async () => {
    const { descriptorPath } = await plantSession()
    const result = await runVisualClientCli(
      ['stop', descriptorPath, '--transcript'],
      workDir,
    )
    expect(result.exitCode).toBe(0)
    expect(
      (JSON.parse(result.stdout) as VisualHandoff).transcript,
    ).toHaveLength(2)
  })

  it('answers a repeated stop with nothing left to hand off', async () => {
    const { descriptor, root } = await plantSession()
    await expect(stopVisualSessionClient(descriptor)).resolves.toMatchObject({
      ok: true,
      value: { sessionId: descriptor.sessionId },
    })
    expect(existsSync(root)).toBe(false)
    await expect(stopVisualSessionClient(descriptor)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('reports a vanished descriptor rather than a second stop', async () => {
    const { descriptorPath } = await plantSession()
    expect(
      (await runVisualClientCli(['stop', descriptorPath], workDir)).exitCode,
    ).toBe(0)
    const repeated = await runVisualClientCli(['stop', descriptorPath], workDir)
    expect(repeated.exitCode).toBe(1)
    expect(refusalCodes(repeated)).toEqual(['YMVS401'])
  })

  it('never deletes a directory whose marker names another session', async () => {
    const { descriptorPath, root } = await plantSession({
      marker: {
        format: 'yarramate/visual-session-marker/v1',
        id: identifier(0xfeed),
        createdAt: '2026-08-08T00:00:00.000Z',
        authority: 'ad-hoc',
      },
    })
    const result = await runVisualClientCli(['stop', descriptorPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS125'])
    expect(existsSync(root)).toBe(true)
  })

  it('never deletes a session the server refused to hand over', async () => {
    const handle = await startServer()
    const descriptor = await readDescriptorFile(handle.started.descriptorPath)
    await writeJson(handle.started.descriptorPath, {
      ...descriptor,
      agentCapability: 'b'.repeat(64),
    })
    const result = await runVisualClientCli(
      ['stop', handle.started.descriptorPath],
      workDir,
    )
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS405'])
    expect(existsSync(handle.started.sessionRoot)).toBe(true)
    expect(handle.status().lifecycle).toBe('running')
  })
})

describe('runVisualStart', () => {
  const writeRequest = async (marker?: string) => {
    const path = join(workDir, 'request.json')
    await writeJson(path, requestWith(marker))
    return path
  }

  it('publishes exactly one started document and then blocks', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started

    expect(foreground.stdout).toEqual([line(started)])
    expect(foreground.stderr).toEqual([])
    expect(started).toMatchObject({
      format: 'yarramate/visual-session-started/v1',
      protocolVersion: VISUAL_PROTOCOL_VERSION,
      authority: 'ad-hoc',
      title: 'Choose a delivery design',
      chatEnabled: true,
      capabilities: { chat: true, transcript: true },
    })
    expect(started.sessionRoot).toBe(
      join(workDir, VISUAL_SESSION_DIRECTORY, started.sessionId),
    )

    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  })

  it('keeps the agent capability out of the published document', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started
    const descriptor = await readDescriptorFile(started.descriptorPath)

    expect(descriptor.agentCapability).toMatch(/^[0-9a-f]{64}$/)
    expect(foreground.stdout.join('')).not.toContain(descriptor.agentCapability)
    expect(Object.keys(started)).not.toContain('agentCapability')
    expect(descriptor.origin).toBe(started.origin)

    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toMatchObject({ exitCode: 0 })
  })

  it('stops and cleans up on SIGTERM', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started

    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toMatchObject({ exitCode: 0 })
    expect(existsSync(started.sessionRoot)).toBe(false)
    await expect(fetch(`${started.origin}/api/session`)).rejects.toThrow()
  })

  it('stops and cleans up on SIGINT', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started

    foreground.signals.emit('SIGINT')
    await expect(foreground.result).resolves.toMatchObject({ exitCode: 0 })
    expect(existsSync(started.sessionRoot)).toBe(false)
  })

  it('removes its signal handlers once it returns', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    await foreground.started

    expect(foreground.signals.listenerCount('SIGINT')).toBe(1)
    expect(foreground.signals.listenerCount('SIGTERM')).toBe(1)
    foreground.signals.emit('SIGTERM')
    await foreground.result
    expect(foreground.signals.listenerCount('SIGINT')).toBe(0)
    expect(foreground.signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('absorbs a repeated signal', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started

    foreground.signals.emit('SIGTERM')
    foreground.signals.emit('SIGINT')
    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    expect(existsSync(started.sessionRoot)).toBe(false)
  })

  /**
   * A signal is not a caller: nothing awaits the stop it starts, so a teardown
   * that fails there reaches the runtime as an unhandled rejection unless the
   * handler observes it. The failure is injected through the filesystem rather
   * than the clock — a session root nothing may unlink from refuses the removal
   * every time, and stops refusing the moment the permission comes back.
   */
  const enforcesPermissions =
    process.platform !== 'win32' && process.getuid?.() !== 0

  /**
   * A ceiling on the turns of the loop one teardown takes, measured in turns
   * rather than milliseconds so a slow machine spends no longer here than a
   * fast one: nothing in this test waits for a duration.
   */
  const teardownTurns = 5000

  it.skipIf(!enforcesPermissions)(
    'observes a signal stop that failed instead of crashing the runtime',
    async () => {
      const foreground = startForeground(await writeRequest(), workDir)
      const started = await foreground.started
      const journal = join(started.sessionRoot, 'journal.jsonl')
      const rejections: unknown[] = []
      const observe = (reason: unknown) => rejections.push(reason)
      // One turn of the loop, which is also one turn of the teardown's own
      // filesystem work: waiting is spent on the runtime's progress rather
      // than on a duration guessed to be long enough.
      const turn = async () => {
        const next = Promise.withResolvers<undefined>()
        setImmediate(() => next.resolve(undefined))
        return Promise.race([foreground.result, next.promise])
      }
      process.on('unhandledRejection', observe)
      try {
        // Readable and traversable, so the recovery a stop reads still
        // succeeds; not writable, so the removal that follows it cannot.
        await chmod(started.sessionRoot, 0o500)
        foreground.signals.emit('SIGTERM')

        // The terminal event is the last thing journaled before the removal
        // this permission denies, and the refusal is a few hundred turns of
        // the loop past it. The ceiling is not a wait: a runtime that lost a
        // rejection reports it in the turn after it is raised, and leaves this
        // loop there.
        let journaled = await readFile(journal, 'utf8')
        while (!journaled.includes('"session.end"')) {
          journaled = await readFile(journal, 'utf8')
        }
        let blocked = await turn()
        for (
          let spin = 0;
          spin < teardownTurns &&
          blocked === undefined &&
          rejections.length === 0;
          spin += 1
        ) {
          blocked = await turn()
        }

        // The teardown failed: the command is still blocked, its session is
        // still on disk, and the runtime was told about none of it.
        expect(blocked).toBeUndefined()
        expect(existsSync(started.sessionRoot)).toBe(true)
        expect(rejections).toEqual([])

        // A stop that failed stopped nothing: a later signal runs the teardown
        // again. One that lands on an attempt still in flight is absorbed by
        // it, so the command is signalled every turn until it returns.
        await chmod(started.sessionRoot, 0o700)
        let closed = await turn()
        for (
          let spin = 0;
          closed === undefined && spin < teardownTurns;
          spin += 1
        ) {
          foreground.signals.emit('SIGTERM')
          closed = await turn()
        }

        expect(closed).toMatchObject({ exitCode: 0 })
        expect(existsSync(started.sessionRoot)).toBe(false)
        expect(rejections).toEqual([])
      } finally {
        process.off('unhandledRejection', observe)
        // Whatever failed, the temporary directory cannot be collected while
        // one of its sessions refuses to be unlinked from.
        if (existsSync(started.sessionRoot)) {
          await chmod(started.sessionRoot, 0o700)
        }
      }
    },
  )

  it('observes the process signals when no source is injected', async () => {
    const requestPath = await writeRequest()
    const before = {
      interrupt: process.listenerCount('SIGINT'),
      terminate: process.listenerCount('SIGTERM'),
    }
    const stdout: string[] = []
    const result = runVisualStart(requestPath, workDir, {
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    })
    while (stdout.length === 0) await new Promise(setImmediate)
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.terminate + 1)

    const started = JSON.parse(stdout[0] as string) as VisualSessionStarted
    await expect(
      runVisualClientCli(['stop', started.descriptorPath], workDir),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(result).resolves.toMatchObject({ exitCode: 0 })
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt)
    expect(process.listenerCount('SIGTERM')).toBe(before.terminate)
  })

  it('serves the browser and the agent until it is stopped', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started
    await sendBrowserEvent(started, chatEventInput)

    const waited = await runVisualClientCli(
      ['wait', started.descriptorPath, '--after', '0'],
      workDir,
    )
    expect(JSON.parse(waited.stdout)).toMatchObject({
      type: 'chat.message',
      sequence: 2,
    })

    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toMatchObject({ exitCode: 0 })
  })

  it('exits non-zero when the session ends in a failure state', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started
    const descriptor = await readDescriptorFile(started.descriptorPath)

    const stopped = await agentPost(descriptor, '/api/agent/stop', {
      reason: 'child-failed',
    })
    expect(stopped.status).toBe(200)
    // The runtime recovered the handoff before it deleted the session.
    expect(await stopped.json()).toMatchObject({
      reason: 'child-failed',
      handoff: { format: 'yarramate/visual-handoff/v1' },
    })

    const result = await foreground.result
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS409'])
    expect(existsSync(started.sessionRoot)).toBe(false)
    expect(foreground.signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('reports a reviewer End the child never answered as a failed session', async () => {
    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started
    await sendBrowserEvent(started, {
      type: 'session.end',
      lastAcknowledgedSequence: 0,
      payload: { reason: 'user-ended' },
    })

    // The child died before submitting its handoff, so the main agent closes
    // the session under its own cancellation.
    const stopped = await runVisualClientCli(
      ['stop', started.descriptorPath],
      workDir,
    )
    expect(stopped.exitCode).toBe(0)
    expect(JSON.parse(stopped.stdout)).toMatchObject({
      decision: 'failed',
      terminationReason: 'child-failed',
    })

    // The journal, not the reason someone asked to stop under, is what says
    // whether this session did what it was opened to do.
    const result = await foreground.result
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS409'])
  })

  it('refuses a request document that is not there', async () => {
    const result = await runVisualCli(
      ['start', join(workDir, 'missing.json')],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS407'])
    expect(existsSync(join(workDir, VISUAL_SESSION_DIRECTORY))).toBe(false)
  })

  it('refuses a request that is not JSON', async () => {
    const requestPath = join(workDir, 'request.json')
    await writeFile(requestPath, 'authority: ad-hoc')
    const result = await runVisualCli(['start', requestPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toEqual(['YMVS407'])
  })

  it('refuses an invalid request before any filesystem effect', async () => {
    const requestPath = join(workDir, 'request.json')
    await writeJson(requestPath, {
      ...requestWith(),
      compiler: { command: 'likec4', args: [] },
    })
    const result = await runVisualCli(['start', requestPath], workDir)
    expect(result.exitCode).toBe(1)
    expect(refusalCodes(result)).toContain('YMVS101')
    expect(existsSync(join(workDir, VISUAL_SESSION_DIRECTORY))).toBe(false)
  })

  it('leaves no session behind when the initial model does not compile', async () => {
    const result = await runVisualCli(
      ['start', await writeRequest('invalid')],
      workDir,
    )
    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(refusalCodes(result)).toEqual(['YMVS201'])
    await expect(
      entriesIn(join(workDir, VISUAL_SESSION_DIRECTORY)),
    ).resolves.toEqual([])
  })

  it('prunes a session a previous runtime abandoned', async () => {
    const stale = identifier(0x5747)
    const root = join(workDir, VISUAL_SESSION_DIRECTORY, stale)
    const abandonedAt = new Date(
      Date.now() - VISUAL_LIMITS.staleSessionMs - 60_000,
    )
    await mkdir(root, { recursive: true, mode: 0o700 })
    await writeJson(join(root, 'session.json'), {
      format: 'yarramate/visual-session-marker/v1',
      id: stale,
      createdAt: abandonedAt.toISOString(),
      authority: 'ad-hoc',
    })
    await writeFile(join(root, 'journal.jsonl'), '', { mode: 0o600 })
    // Collection follows what nothing has written to, so the abandonment has
    // to be on the filesystem and not only in the marker.
    for (const artefact of [
      join(root, 'journal.jsonl'),
      join(root, 'session.json'),
      root,
    ]) {
      await utimes(artefact, abandonedAt, abandonedAt)
    }

    const foreground = startForeground(await writeRequest(), workDir)
    const started = await foreground.started
    expect(existsSync(root)).toBe(false)
    expect(existsSync(started.sessionRoot)).toBe(true)

    foreground.signals.emit('SIGTERM')
    await expect(foreground.result).resolves.toMatchObject({ exitCode: 0 })
  })

  it('dispatches every command that is not start to the one-shot client', async () => {
    await expect(runVisualCli(['--version'], workDir)).resolves.toEqual({
      exitCode: 0,
      stdout: `yarramate-visual ${packageVersion}\n`,
      stderr: '',
    })
    const { descriptorPath, id } = await plantSession()
    const dispatched = await runVisualCli(['recover', descriptorPath], workDir)
    expect(dispatched).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(dispatched.stdout)).toMatchObject({ sessionId: id })
  })
})
