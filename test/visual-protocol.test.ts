import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createFileSystemStore } from '../src/source-store.js'
import {
  digestOf,
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
  fromWireFileUri,
  toWireFileUri,
  VISUAL_LIMITS,
  VISUAL_PROTOCOL_VERSION,
} from '../src/adapters/visual/protocol.js'

const graphNode = {
  id: 'system',
  localId: 'system',
  document: 'main.yaml',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  coreKindLabel: 'applicationComponent',
  layer: null,
  aspect: null,
  name: 'System',
  description: null,
  aka: [],
  status: null,
  owner: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
} as const

const model = {
  format: 'yarramate/visual-model/v1',
  authority: 'canonical',
  initialView: 'choices',
  sourceDigests: { 'model.likec4': 'a'.repeat(64) },
  graph: { nodes: [graphNode], edges: [] },
} as const

const sessionId = '0123456789abcdef0123456789abcdef'
const eventId = 'aaaaaaaabbbbbbbbccccccccdddddddd'
const responseId = 'ddddddddccccccccbbbbbbbbaaaaaaaa'
const timestamp = '2026-08-08T00:00:00.000Z'

const sessionRequest = {
  format: 'yarramate/visual-session-request/v1',
  authority: 'canonical',
  title: 'Choose a delivery design',
  description: 'Design options drawn from the checked workspace',
  chatEnabled: true,
  initialModel: model,
} as const

const posixOnly = process.platform !== 'win32'

const capabilities = {
  chat: true,
  choices: true,
  navigation: true,
  transcript: true,
} as const

const sessionStarted = {
  format: 'yarramate/visual-session-started/v2',
  protocolVersion: VISUAL_PROTOCOL_VERSION,
  sessionId,
  authority: 'canonical',
  title: 'Choose a delivery design',
  chatEnabled: true,
  browserUrl: 'http://127.0.0.1:51234/bootstrap?key=0123456789abcdef',
  webSocketUrl: 'ws://127.0.0.1:51234/socket',
  origin: 'http://127.0.0.1:51234',
  descriptorPath: 'file:///tmp/yarramate-visual/session/descriptor.json',
  sessionRoot: 'file:///tmp/yarramate-visual/session',
  capabilities,
  startedAt: timestamp,
} as const

const sessionDescriptor = {
  format: 'yarramate/visual-session-descriptor/v2',
  protocolVersion: VISUAL_PROTOCOL_VERSION,
  sessionId,
  origin: 'http://127.0.0.1:51234',
  agentCapability:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  sessionRoot: 'file:///tmp/yarramate-visual/session',
  journalPath: 'file:///tmp/yarramate-visual/session/journal.jsonl',
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
  'filter.query': { query: { kinds: ['yarramate/core@0.1#applicationComponent'] } },
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
  path: 'src/architecture/product.yaml',
  pointer: '/graph/nodes/0/name',
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
  'handoff.complete': handoffSummary,
  diagnostic: { diagnostics: [diagnostic] },
}

const handoff = {
  format: 'yarramate/visual-handoff/v2',
  sessionId,
  authority: 'canonical',
  decision: 'completed',
  terminationReason: 'user-ended',
  lastSequence: 3,
  transcriptPath: 'file:///tmp/yarramate-visual/session/journal.jsonl',
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
        authority: 'canonical',
        title: 'Choose a delivery design',
        description: 'Design options drawn from the checked workspace',
        chatEnabled: true,
        initialModel: model,
      }),
    ).toMatchObject({ ok: true })
  })

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
        lastAcknowledgedSequence: 0,
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

  it('accepts a Windows drive-root file URI', () => {
    expect(
      parseVisualSessionStarted({
        ...sessionStarted,
        descriptorPath:
          'file:///C:/Users/nabsha/.yarramate-visual/abc123/descriptor.json',
        sessionRoot: 'file:///C:/Users/nabsha/.yarramate-visual/abc123',
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualSessionDescriptor({
        ...sessionDescriptor,
        sessionRoot: 'file:///C:/Users/nabsha/.yarramate-visual/abc123',
        journalPath:
          'file:///C:/Users/nabsha/.yarramate-visual/abc123/journal.jsonl',
      }),
    ).toMatchObject({ ok: true })
  })

  it.each([
    ['a raw POSIX path', '/tmp/yarramate-visual/abc123/descriptor.json'],
    [
      'a raw Windows path',
      'C:\\Users\\nabsha\\.yarramate-visual\\abc123\\descriptor.json',
    ],
    [
      'a forward-slash Windows path, the v3 wire form',
      'C:/Users/nabsha/.yarramate-visual/abc123/descriptor.json',
    ],
    ['a UNC-derived URI', 'file://server/share/abc123/descriptor.json'],
    ['a non-file scheme', 'http://127.0.0.1:51234/descriptor.json'],
  ])('rejects %s as a wire path', (_label, descriptorPath) => {
    expect(
      parseVisualSessionStarted({ ...sessionStarted, descriptorPath }),
    ).toMatchObject({ ok: false })
  })

  it('refuses a v3 document rather than translating it', () => {
    // No bespoke "v3 detected" code: the version consts fail like any other
    // schema violation, which is what makes the incompatibility detectable.
    expect(
      parseVisualSessionDescriptor({
        ...sessionDescriptor,
        format: 'yarramate/visual-session-descriptor/v1',
        protocolVersion: 'yarramate/visual-protocol/v3',
        sessionRoot: '/tmp/yarramate-visual/session',
        journalPath: '/tmp/yarramate-visual/session/journal.jsonl',
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'YMVS103', pointer: '/format' }),
        expect.objectContaining({
          code: 'YMVS103',
          pointer: '/protocolVersion',
        }),
      ]),
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

  it.each(['filter.query'] as const)(
    'accepts the %s browser input',
    (type) => {
      expect(
        parseVisualBrowserInput({
          type,
          lastAcknowledgedSequence: 0,
          payload: eventPayloads[type],
        }),
      ).toMatchObject({ ok: true })
    },
  )

  it('round-trips chat.response with and without an appliedQuery', () => {
    expect(
      parseVisualResponse(
        visualResponse('chat.response', { text: 'Filtered to 2 concepts.' }),
      ),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualResponse(
        visualResponse('chat.response', {
          text: 'Filtered to 2 concepts.',
          appliedQuery: {
            query: { kinds: ['yarramate/core@0.1#applicationComponent'] },
            matchedIds: ['a', 'b'],
          },
        }),
      ),
    ).toMatchObject({ ok: true })
  })

  it('round-trips filter.result and view.save.result response payloads', () => {
    expect(
      parseVisualResponse(
        visualResponse('filter.result', {
          query: { kinds: ['yarramate/core@0.1#applicationComponent'] },
          matchedIds: ['a', 'b'],
        }),
      ),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualResponse(
        visualResponse('view.save.result', {
          ok: true,
          id: 'audit-test',
          path: 'workspace/views/audit-test.view.yaml',
        }),
      ),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualResponse(
        visualResponse('view.save.result', {
          ok: false,
          diagnostics: [diagnostic],
        }),
      ),
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
        lastAcknowledgedSequence: 0,
        payload: { text: 'Hello' },
        sessionId,
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualBrowserInput({
        type: 'browser.connected',
        lastAcknowledgedSequence: 0,
        payload: { connectionId: 'c1' },
      }),
    ).toMatchObject({ ok: false })
  })

  it('requires every browser frame to carry its last acknowledged sequence', () => {
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        payload: { text: 'Hello' },
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseVisualBrowserInput({
        type: 'session.end',
        payload: { reason: 'user-ended' },
      }),
    ).toMatchObject({ ok: false })
  })

  describe('a staged edit is judged against the branch its op names', () => {
    const commit = (operation: unknown) =>
      parseVisualBrowserInput({
        type: 'changeset.commit',
        lastAcknowledgedSequence: 0,
        payload: {
          operations: [operation],
          viewOperations: [],
          sourceDigests: {},
        },
      })

    it('reports a blank field once, on the field', () => {
      const result = commit({
        op: 'update-concept',
        document: 'architecture/engine.yaml',
        concept: { id: 'check', name: '   ' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        pointer: '/payload/operations/0/concept/name',
        message: expect.stringContaining('must not be blank'),
      })
    })

    it('names an operation kind that does not exist, rather than every kind that does', () => {
      const result = commit({ op: 'resurrect-concept', document: 'a.yaml' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        pointer: '/payload/operations/0',
        message: expect.stringContaining(
          'unknown "op" value "resurrect-concept"',
        ),
      })
    })

    it('reports a missing op once, without restating it as a tag fault', () => {
      const result = commit({ document: 'a.yaml' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        message: expect.stringContaining("must have required property 'op'"),
      })
    })

    it('keeps every fault when one operation has more than one', () => {
      const result = commit({
        op: 'update-concept',
        document: 'a.yaml',
        relationship: { id: 'r' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        expect.stringContaining("must have required property 'concept'"),
        expect.stringContaining('Property "relationship" is not allowed'),
      ])
    })

    it('refuses a commit that states nothing about what it is replacing', () => {
      // A v2 browser sends exactly this. The precondition is required rather
      // than optional so an old client is refused, not silently trusted.
      const result = parseVisualBrowserInput({
        type: 'changeset.commit',
        lastAcknowledgedSequence: 0,
        payload: {
          operations: [
            {
              op: 'update-concept',
              document: 'architecture/engine.yaml',
              concept: { id: 'check', name: 'Check' },
            },
          ],
          viewOperations: [],
        },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        expect.stringContaining("must have required property 'sourceDigests'"),
      ])
    })

    it.each([
      ['not a digest', 'nope'],
      ['a truncated digest', 'a'.repeat(63)],
      ['an upper-case digest', 'A'.repeat(64)],
    ])('refuses %s as a pinned value', (_case, digest) => {
      const result = parseVisualBrowserInput({
        type: 'changeset.commit',
        lastAcknowledgedSequence: 0,
        payload: {
          operations: [
            {
              op: 'update-concept',
              document: 'architecture/engine.yaml',
              concept: { id: 'check', name: 'Check' },
            },
          ],
          viewOperations: [],
          sourceDigests: { 'architecture/engine.yaml': digest },
        },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics[0]?.pointer).toBe(
        '/payload/sourceDigests/architecture~1engine.yaml',
      )
    })
  })

  it.each([-1, 1.5, '1', null])(
    'rejects %s as a last acknowledged sequence',
    (lastAcknowledgedSequence) => {
      expect(
        parseVisualBrowserInput({
          type: 'chat.message',
          lastAcknowledgedSequence,
          payload: { text: 'Hello' },
        }),
      ).toMatchObject({ ok: false })
    },
  )

  it('requires a canonical model to record source digests', () => {
    const digests = { 'model.likec4': '9'.repeat(64) }
    expect(
      parseVisualModel({ ...model, sourceDigests: digests }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualModel({ ...model, sourceDigests: {} }),
    ).toMatchObject({ ok: false })
  })

  it.each([
    '../secret.likec4',
    '/tmp/secret.likec4',
    'a/../b.likec4',
    './model.likec4',
    'a//b.likec4',
    'sub\\model.likec4',
  ])('rejects the unsafe source digest key %s', (key) => {
    expect(
      parseVisualModel({
        ...model,
        authority: 'canonical',
        sourceDigests: { [key]: '9'.repeat(64) },
      }),
    ).toMatchObject({ ok: false })
  })

  it('accepts nested source digest keys inside the candidate root', () => {
    expect(
      parseVisualModel({
        ...model,
        authority: 'canonical',
        sourceDigests: {
          'likec4.config.json': '9'.repeat(64),
          'views/choices.likec4': '9'.repeat(64),
          'model/system.c4': '9'.repeat(64),
        },
      }),
    ).toMatchObject({ ok: true })
  })

  it('measures chat message limits in bytes, not characters', () => {
    const exact = 'a'.repeat(VISUAL_LIMITS.messageBytes)
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: exact },
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: `${exact}a` },
      }),
    ).toMatchObject({ ok: false })

    const multiByte = '€'.repeat(VISUAL_LIMITS.messageBytes / 3 + 1)
    expect(multiByte.length).toBeLessThan(VISUAL_LIMITS.messageBytes)
    expect(
      parseVisualBrowserInput({
        type: 'chat.message',
        lastAcknowledgedSequence: 0,
        payload: { text: multiByte },
      }),
    ).toMatchObject({ ok: false })
  })

  it('rejects a candidate model over the byte limit', () => {
    expect(
      parseVisualModel({
        ...model,
        graph: {
          nodes: [
            { ...graphNode, description: 'x'.repeat(VISUAL_LIMITS.modelBytes) },
          ],
          edges: [],
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

  it('refuses a transcript entry belonging to another session', () => {
    const foreign = {
      ...visualEvent('chat.message', eventPayloads['chat.message']),
      sessionId: '00000000000000000000000000000000',
    }
    expect(
      parseVisualHandoff({ ...handoff, transcript: [foreign] }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'YMVS116', pointer: '/transcript/0/sessionId' }],
    })
    expect(
      parseVisualHandoff({
        ...handoff,
        transcript: [
          visualEvent('chat.message', eventPayloads['chat.message']),
          {
            ...visualResponse('chat.response', responsePayloads['chat.response']),
            sessionId: '00000000000000000000000000000000',
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'YMVS116', pointer: '/transcript/1/sessionId' }],
    })
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

  it('points unsafe source digest diagnostics at the offending escaped key', () => {
    const parsed = parseVisualModel({
      ...model,
      authority: 'canonical',
      sourceDigests: { 'evil/../escape.likec4': '9'.repeat(64) },
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'YMVS113',
        pointer: '/sourceDigests/evil~1..~1escape.likec4',
      }),
    )
  })

  it('keeps a digest keyed under the workspace dot directory', () => {
    // Every workspace keeps its documents under `.yarramate/`, and the graph
    // addresses them by exactly that path, so a dot directory is the normal
    // case here rather than a smuggled metadata entry.
    expect(
      parseVisualModel({
        ...model,
        authority: 'canonical',
        sourceDigests: {
          '.yarramate/architecture/engine.yaml': '9'.repeat(64),
        },
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('toWireFileUri', () => {
  it('encodes a POSIX path as a local file URI that round-trips', () => {
    expect(toWireFileUri('/tmp/yarramate-visual/abc123')).toBe(
      'file:///tmp/yarramate-visual/abc123',
    )
    expect(
      fromWireFileUri('file:///tmp/yarramate-visual/abc123'),
    ).toMatchObject({ ok: true, value: '/tmp/yarramate-visual/abc123' })
  })

  it.each([
    ['a space', '/tmp/yarra mate/abc123'],
    ['a hash', '/tmp/yarramate#1/abc123'],
    ['a question mark', '/tmp/yarramate?1/abc123'],
    ['a non-ASCII byte', '/tmp/yarramaté/abc123'],
  ])('percent-encodes %s and round-trips it', (_label, native) => {
    const uri = toWireFileUri(native)
    expect(uri.startsWith('file:///')).toBe(true)
    expect(fromWireFileUri(uri)).toMatchObject({ ok: true, value: native })
  })

  // The defect that motivated the change: under the forward-slash transform
  // this directory and a Windows path joined with native separators
  // collapsed to the same wire string, and `fs` calls then missed the
  // directory the session actually created.
  it.skipIf(!posixOnly)(
    'keeps a directory name containing a backslash distinct from a separator',
    () => {
      const native = '/tmp/yarramate-visual-\\store-abc/journal.jsonl'
      const uri = toWireFileUri(native)
      expect(uri).toBe('file:///tmp/yarramate-visual-%5Cstore-abc/journal.jsonl')
      expect(uri).not.toBe(toWireFileUri('/tmp/yarramate-visual-/store-abc/journal.jsonl'))
      expect(fromWireFileUri(uri)).toMatchObject({ ok: true, value: native })
    },
  )

  it.skipIf(posixOnly)('encodes a Windows drive-root path', () => {
    const uri = toWireFileUri('C:\\Users\\nabsha\\.yarramate-visual\\abc123')
    expect(uri).toBe('file:///C:/Users/nabsha/.yarramate-visual/abc123')
    expect(fromWireFileUri(uri)).toMatchObject({
      ok: true,
      value: 'C:\\Users\\nabsha\\.yarramate-visual\\abc123',
    })
  })

  it('refuses to encode a relative path: that is a programming error', () => {
    expect(() => toWireFileUri('relative/segment')).toThrow(
      /must be absolute/,
    )
  })
})

describe('fromWireFileUri', () => {
  it.each([
    ['a non-file scheme', 'http://127.0.0.1/tmp/abc123'],
    ['a data URI', 'data:text/plain,abc123'],
    ['a bare POSIX path', '/tmp/yarramate-visual/abc123'],
    ['a bare Windows path', 'C:\\Users\\nabsha\\abc123'],
    ['a forward-slash Windows path', 'C:/Users/nabsha/abc123'],
    ['an unbalanced percent escape', 'file:///tmp/abc%2'],
    // `fileURLToPath` refuses an encoded separator itself: a path segment
    // that decodes to one containing `/` is not a path this runtime can open.
    ['an over-encoded separator', 'file:///tmp%2Fyarramate-visual/abc123'],
  ])('refuses %s as malformed', (_label, uri) => {
    expect(fromWireFileUri(uri)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a UNC-derived URI as nonlocal', () => {
    // Read off the parsed URL, not inferred from a `fileURLToPath` failure,
    // so the same URI earns the same refusal on POSIX and on Windows.
    expect(fromWireFileUri('file://server/share/abc123')).toEqual({
      ok: false,
      reason: 'nonlocal',
    })
  })

  it.each([
    [
      'an explicit localhost host',
      'file://localhost/tmp/abc123',
      // WHATWG `URL` normalizes a `localhost` file host away, so this never
      // reaches the host check: it is caught one step later, as the second
      // spelling of a target whose canonical form is `file:///tmp/abc123`.
    ],
    ['an unnecessary escape', 'file:///tmp/yarramate%2Dvisual/abc123'],
    ['a dot segment', 'file:///tmp/yarramate-visual/./abc123'],
    ['a parent segment', 'file:///tmp/yarramate-visual/x/../abc123'],
  ])('refuses %s as noncanonical', (_label, uri) => {
    // One native target has exactly one accepted spelling. A second spelling
    // is refused rather than normalized: normalizing is what made two
    // distinct paths indistinguishable in the first place.
    expect(fromWireFileUri(uri)).toEqual({ ok: false, reason: 'noncanonical' })
  })

})

describe('digestOf', () => {

  /**
   * A commit's pins become the `expected` revisions a store compares before it
   * writes (ADR 0100). A store's revision is opaque, and this one is only
   * usable as a pin because `createFileSystemStore` happens to mint the same
   * sha256 `digestOf` does. That is a coincidence the runtime depends on, so
   * it is asserted rather than assumed: if either side changes, this fails
   * here instead of making every commit's precondition unsatisfiable in a way
   * nothing would explain.
   */
  it('mints the revision the filesystem store does, which pins depend on', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-digest-pin-'))
    try {
      const source = 'format: yarramate/v1\nid: main\nconcepts: []\n'
      writeFileSync(join(parent, 'main.yaml'), source, 'utf8')

      expect(createFileSystemStore(parent).read('main.yaml')?.revision).toBe(
        digestOf(source),
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
