import { describe, expect, it } from 'vitest'
import {
  parseVisualBrowserInput,
  parseVisualDiagnosticResult,
  parseVisualEvent,
  parseVisualHandoff,
  parseVisualModel,
  parseVisualResponse,
  parseVisualSessionDescriptor,
  parseVisualSessionRequest,
  parseVisualSessionStarted,
  parseVisualStatus,
  VISUAL_LIMITS,
  VISUAL_PROTOCOL_VERSION,
} from '../src/adapters/visual/protocol.js'

const model = {
  format: 'yarramate/visual-model/v1',
  authority: 'ad-hoc',
  initialView: 'choices',
  sourceDigests: {},
  files: {
    'likec4.config.json': '{"name":"visual"}',
    'model.likec4': 'model { system = system "System" }',
    'views.likec4': 'views { view choices { include * } }',
  },
} as const

const sessionId = '0123456789abcdef0123456789abcdef'
const eventId = 'aaaaaaaabbbbbbbbccccccccdddddddd'
const responseId = 'ddddddddccccccccbbbbbbbbaaaaaaaa'
const timestamp = '2026-08-08T00:00:00.000Z'

const sessionRequest = {
  format: 'yarramate/visual-session-request/v1',
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  compiler: { command: '/usr/bin/node', args: ['fake-likec4.mjs'] },
  initialModel: model,
} as const

const capabilities = {
  chat: true,
  choices: true,
  navigation: true,
  modelReplacement: true,
  transcript: true,
} as const

const sessionStarted = {
  format: 'yarramate/visual-session-started/v1',
  protocolVersion: VISUAL_PROTOCOL_VERSION,
  sessionId,
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  chatEnabled: true,
  browserUrl: 'http://127.0.0.1:51234/bootstrap?key=0123456789abcdef',
  webSocketUrl: 'ws://127.0.0.1:51234/socket',
  origin: 'http://127.0.0.1:51234',
  descriptorPath: '/tmp/yarramate-visual/session/descriptor.json',
  sessionRoot: '/tmp/yarramate-visual/session',
  capabilities,
  startedAt: timestamp,
} as const

const sessionDescriptor = {
  format: 'yarramate/visual-session-descriptor/v1',
  protocolVersion: VISUAL_PROTOCOL_VERSION,
  sessionId,
  origin: 'http://127.0.0.1:51234',
  agentCapability:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  sessionRoot: '/tmp/yarramate-visual/session',
  journalPath: '/tmp/yarramate-visual/session/journal.jsonl',
  createdAt: timestamp,
} as const

const visualEvent = (type: string, payload: unknown) => ({
  format: 'yarramate/visual-event/v1',
  sessionId,
  sequence: 1,
  eventId,
  type,
  timestamp,
  payload,
})

const visualResponse = (type: string, payload: unknown) => ({
  format: 'yarramate/visual-response/v1',
  sessionId,
  responseId,
  eventId,
  type,
  timestamp,
  payload,
})

const eventPayloads: Readonly<Record<string, unknown>> = {
  'chat.message': { text: 'Why is option B cheaper?' },
  'choice.selected': { choiceId: 'delivery', optionId: 'option-b' },
  'view.navigate': { viewId: 'option-b', requiresAttention: false },
  'session.end': { reason: 'user-ended' },
  'browser.connected': { connectionId: 'c1' },
  'browser.disconnected': { connectionId: 'c1', code: 1001 },
}

const handoffSummary = {
  summary: 'Selected option B.',
  confirmedDecisions: ['option-b'],
  requestedChanges: [],
  unresolvedQuestions: [],
  finalViews: ['choices', 'option-b'],
} as const

const diagnostic = {
  severity: 'error',
  code: 'YMVS201',
  message: 'Unknown element',
  path: 'model.likec4',
  pointer: '/files/model.likec4',
  line: 1,
  column: 1,
} as const

const responsePayloads: Readonly<Record<string, unknown>> = {
  'chat.response': { text: 'Option B isolates rendering.' },
  'agent.status': { state: 'thinking' },
  'choice.present': {
    choiceId: 'delivery',
    question: 'Which delivery design?',
    options: [
      { id: 'option-a', label: 'Bundled' },
      { id: 'option-b', label: 'Isolated', description: 'Separate process' },
    ],
  },
  'model.replace': { model },
  'handoff.complete': handoffSummary,
  diagnostic: { diagnostics: [diagnostic] },
}

const handoff = {
  format: 'yarramate/visual-handoff/v1',
  sessionId,
  authority: 'ad-hoc',
  decision: 'completed',
  terminationReason: 'user-ended',
  lastSequence: 3,
  transcriptPath: '/tmp/yarramate-visual/session/journal.jsonl',
  completedAt: timestamp,
  ...handoffSummary,
} as const

const status = {
  format: 'yarramate/visual-status/v1',
  protocolVersion: VISUAL_PROTOCOL_VERSION,
  sessionId,
  lifecycle: 'running',
  alreadyStopped: false,
  server: { listening: true, origin: 'http://127.0.0.1:51234' },
  browser: { connected: true, connections: 1, lastSeenAt: timestamp },
  agent: { attached: true, inFlightEventId: null },
  queue: { pendingEvents: 0, lastSequence: 3, frozen: false },
  capabilities,
  transcriptBytes: 1024,
  updatedAt: timestamp,
} as const

const diagnosticResult = {
  format: 'yarramate/visual-diagnostic-result/v1',
  diagnostics: [diagnostic],
} as const

describe('visual protocol', () => {
  it('accepts a complete safe session request', () => {
    expect(
      parseVisualSessionRequest({
        format: 'yarramate/visual-session-request/v1',
        authority: 'ad-hoc',
        title: 'Choose a delivery design',
        description: 'Temporary non-canonical comparison',
        chatEnabled: true,
        compiler: { command: '/usr/bin/node', args: ['fake-likec4.mjs'] },
        initialModel: model,
      }),
    ).toMatchObject({ ok: true })
  })

  it.each(['../secret.likec4', '/tmp/secret.likec4', 'asset.js'])(
    'rejects unsafe model file %s',
    (path) => {
      expect(
        parseVisualModel({ ...model, files: { [path]: 'x' } }),
      ).toMatchObject({
        ok: false,
      })
    },
  )

  it('rejects messages over the exact limit', () => {
    expect(VISUAL_LIMITS.messageBytes).toBe(64 * 1024)
  })

  it('pins every protocol limit', () => {
    expect(VISUAL_LIMITS).toEqual({
      messageBytes: 65536,
      modelBytes: 5242880,
      transcriptBytes: 5242880,
      pendingEvents: 32,
      reconnectMs: 300000,
      staleSessionMs: 86400000,
    })
  })

  it('accepts one valid document of every format', () => {
    expect(parseVisualModel(model)).toMatchObject({ ok: true })
    expect(parseVisualSessionRequest(sessionRequest)).toMatchObject({ ok: true })
    expect(parseVisualSessionStarted(sessionStarted)).toMatchObject({ ok: true })
    expect(parseVisualSessionDescriptor(sessionDescriptor)).toMatchObject({
      ok: true,
    })
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: 'Hello' },
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualEvent(
        visualEvent('chat.message', eventPayloads['chat.message']),
      ),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualResponse(
        visualResponse('chat.response', responsePayloads['chat.response']),
      ),
    ).toMatchObject({ ok: true })
    expect(parseVisualHandoff(handoff)).toMatchObject({ ok: true })
    expect(parseVisualStatus(status)).toMatchObject({ ok: true })
    expect(parseVisualDiagnosticResult(diagnosticResult)).toMatchObject({
      ok: true,
    })
  })

  it.each(Object.keys(eventPayloads))('accepts the %s event', (type) => {
    expect(
      parseVisualEvent(visualEvent(type, eventPayloads[type])),
    ).toMatchObject({ ok: true })
  })

  it.each(Object.keys(responsePayloads))('accepts the %s response', (type) => {
    expect(
      parseVisualResponse(visualResponse(type, responsePayloads[type])),
    ).toMatchObject({ ok: true })
  })

  it('rejects an unknown event discriminant and mismatched payloads', () => {
    expect(
      parseVisualEvent(visualEvent('chat.shout', { text: 'x' })),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualEvent(visualEvent('chat.message', { viewId: 'choices' })),
    ).toMatchObject({ ok: false })
  })

  it('rejects an unknown response discriminant and mismatched payloads', () => {
    expect(
      parseVisualResponse(visualResponse('model.patch', { model })),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualResponse(visualResponse('model.replace', { text: 'x' })),
    ).toMatchObject({ ok: false })
  })

  it('rejects unknown properties on every document', () => {
    expect(parseVisualModel({ ...model, extra: 1 })).toMatchObject({ ok: false })
    expect(
      parseVisualSessionRequest({ ...sessionRequest, extra: 1 }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualSessionStarted({ ...sessionStarted, extra: 1 }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualSessionDescriptor({ ...sessionDescriptor, extra: 1 }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualEvent({
        ...visualEvent('session.end', { reason: 'user-ended' }),
        extra: 1,
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualResponse({
        ...visualResponse('agent.status', { state: 'idle' }),
        extra: 1,
      }),
    ).toMatchObject({ ok: false })
    expect(parseVisualHandoff({ ...handoff, extra: 1 })).toMatchObject({
      ok: false,
    })
    expect(parseVisualStatus({ ...status, extra: 1 })).toMatchObject({
      ok: false,
    })
    expect(
      parseVisualDiagnosticResult({ ...diagnosticResult, extra: 1 }),
    ).toMatchObject({ ok: false })
  })

  it('never lets the browser supply runtime-owned identifiers', () => {
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: 'Hello' },
        sessionId,
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualBrowserInput({
        type: 'browser.connected',
        payload: { connectionId: 'c1' },
      }),
    ).toMatchObject({ ok: false })
  })

  it('requires the request authority to match the initial model authority', () => {
    expect(
      parseVisualSessionRequest({ ...sessionRequest, authority: 'canonical' }),
    ).toMatchObject({ ok: false })
  })

  it('ties model authority to source digests', () => {
    const digests = { 'model.likec4': '9'.repeat(64) }
    expect(
      parseVisualModel({
        ...model,
        authority: 'canonical',
        sourceDigests: digests,
      }),
    ).toMatchObject({ ok: true })
    expect(parseVisualModel({ ...model, authority: 'canonical' })).toMatchObject(
      { ok: false },
    )
    expect(parseVisualModel({ ...model, sourceDigests: digests })).toMatchObject(
      { ok: false },
    )
  })

  it('requires at least one LikeC4 source file', () => {
    expect(
      parseVisualModel({
        ...model,
        files: { 'likec4.config.json': '{"name":"visual"}' },
      }),
    ).toMatchObject({ ok: false })
  })

  it.each([
    'nested/likec4.config.json',
    '.hidden.likec4',
    'a/../b.likec4',
    './model.likec4',
    'a//b.likec4',
    'sub\\model.likec4',
  ])('rejects the additional unsafe model file %s', (path) => {
    expect(parseVisualModel({ ...model, files: { [path]: 'x' } })).toMatchObject(
      { ok: false },
    )
  })

  it('accepts nested LikeC4 sources inside the candidate root', () => {
    expect(
      parseVisualModel({
        ...model,
        files: {
          'likec4.config.json': '{"name":"visual"}',
          'views/choices.likec4': 'views { view choices { include * } }',
          'model/system.c4': 'model { system = system "System" }',
        },
      }),
    ).toMatchObject({ ok: true })
  })

  it('measures chat message limits in bytes, not characters', () => {
    const exact = 'a'.repeat(VISUAL_LIMITS.messageBytes)
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: exact },
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: `${exact}a` },
      }),
    ).toMatchObject({ ok: false })

    const multiByte = '€'.repeat(VISUAL_LIMITS.messageBytes / 3 + 1)
    expect(multiByte.length).toBeLessThan(VISUAL_LIMITS.messageBytes)
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: multiByte },
      }),
    ).toMatchObject({ ok: false })
  })

  it('rejects a candidate model over the byte limit', () => {
    expect(
      parseVisualModel({
        ...model,
        files: {
          ...model.files,
          'huge.likec4': 'x'.repeat(VISUAL_LIMITS.modelBytes),
        },
      }),
    ).toMatchObject({ ok: false })
  })

  it('caps the pending event queue at the exact limit', () => {
    expect(
      parseVisualStatus({
        ...status,
        queue: {
          pendingEvents: VISUAL_LIMITS.pendingEvents,
          lastSequence: 3,
          frozen: true,
          frozenReason: 'pending-events',
        },
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualStatus({
        ...status,
        queue: {
          pendingEvents: VISUAL_LIMITS.pendingEvents + 1,
          lastSequence: 3,
          frozen: true,
        },
      }),
    ).toMatchObject({ ok: false })
  })

  it('rejects a transcript over the byte limit', () => {
    const bulky = visualEvent('chat.message', { text: 'x'.repeat(60000) })
    expect(
      parseVisualHandoff({
        ...handoff,
        transcript: Array.from({ length: 100 }, (_unused, index) => ({
          ...bulky,
          sequence: index + 1,
        })),
      }),
    ).toMatchObject({ ok: false })
  })

  it('exposes the transcript only when it is supplied', () => {
    const parsed = parseVisualHandoff(handoff)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.transcript).toBeUndefined()

    expect(
      parseVisualHandoff({
        ...handoff,
        transcript: [
          visualEvent('chat.message', eventPayloads['chat.message']),
          visualResponse('chat.response', responsePayloads['chat.response']),
        ],
      }),
    ).toMatchObject({ ok: true })
  })

  it('ties the handoff decision to the termination reason', () => {
    expect(parseVisualHandoff({ ...handoff, decision: 'failed' })).toMatchObject(
      { ok: false },
    )
    expect(
      parseVisualHandoff({
        ...handoff,
        decision: 'failed',
        terminationReason: 'child-failed',
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualHandoff({ ...handoff, terminationReason: 'child-failed' }),
    ).toMatchObject({ ok: false })
  })

  it('keeps the agent capability out of the public started result', () => {
    expect(
      parseVisualSessionStarted({
        ...sessionStarted,
        agentCapability: 'f'.repeat(64),
      }),
    ).toMatchObject({ ok: false })
  })

  it('forces diagram-only capabilities when chat is disabled', () => {
    expect(
      parseVisualSessionStarted({ ...sessionStarted, chatEnabled: false }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualSessionStarted({
        ...sessionStarted,
        chatEnabled: false,
        capabilities: { ...capabilities, chat: false },
      }),
    ).toMatchObject({ ok: true })
  })

  it('requires an absolute compiler executable and rejects hostile arguments', () => {
    expect(
      parseVisualSessionRequest({
        ...sessionRequest,
        compiler: { command: 'node', args: [] },
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualSessionRequest({
        ...sessionRequest,
        compiler: { command: '/usr/bin/node', args: ['a\u0000b'] },
      }),
    ).toMatchObject({ ok: false })
  })

  it('reports source-located diagnostics for invalid documents', () => {
    const parsed = parseVisualSessionRequest({ ...sessionRequest, title: '' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'YMVS101',
      path: 'visual-session-request/v1',
      pointer: '/title',
      line: 1,
      column: 1,
    })
    expect(parsed.diagnostics[0]?.message).toMatch(/\S/)
    expect(
      parseVisualDiagnosticResult({
        format: 'yarramate/visual-diagnostic-result/v1',
        diagnostics: parsed.diagnostics,
      }),
    ).toMatchObject({ ok: true })
  })

  it('points unsafe file diagnostics at the offending escaped key', () => {
    const parsed = parseVisualModel({
      ...model,
      files: { ...model.files, 'evil/../escape.likec4': 'x' },
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'YMVS113',
        pointer: '/files/evil~1..~1escape.likec4',
      }),
    )
  })
})
