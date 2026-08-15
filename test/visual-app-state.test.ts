import { describe, expect, it } from 'vitest'
import {
  VISUAL_LIMITS,
  type VisualBrowserInput,
} from '../src/adapters/visual/protocol.js'
import type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
} from '../src/adapters/visual/wire.js'
import {
  RECONNECT_WINDOW_MS,
  VISUAL_END_NOTICE,
  canReconnect,
  initialVisualAppState,
  visualAppActionsForFrame,
  visualAppReducer,
  visualAppSnapshotFrom,
  visualAuthorityLabel,
  visualBrowserInputFor,
  type VisualAppState,
} from '../src/visual-app/state.js'

/** A rendered model with an empty canvas graph — only initialView matters here. */
const model = (initialView: string): VisualRenderedModel => ({
  authority: 'ad-hoc',
  initialView,
  graph: { nodes: [], edges: [] },
})

const serverSnapshot: VisualSessionSnapshot = {
  protocolVersion: 'yarramate/visual-protocol/v1',
  sessionId: '0'.repeat(32),
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  capabilities: {
    chat: true,
    choices: true,
    navigation: true,
    modelReplacement: true,
    transcript: true,
  },
  webSocketUrl: 'ws://127.0.0.1:4321/socket',
  model: model('choices'),
  transcript: [],
  views: [],
  agentTurnOpen: false,
  pendingChoice: null,
  styleNonce: 'a'.repeat(32),
  lastSequence: 0,
  frozen: false,
}

const loaded = (
  overrides: Partial<VisualSessionSnapshot> = {},
): VisualAppState =>
  visualAppReducer(initialVisualAppState, {
    type: 'session.loaded',
    snapshot: visualAppSnapshotFrom({ ...serverSnapshot, ...overrides }),
  })

const activeState = loaded()

const compileDiagnostic = {
  severity: 'error',
  code: 'YMVS201',
  message: 'Unresolved reference "ghost"',
  path: 'model.likec4',
  pointer: '/files/model.likec4',
  line: 2,
  column: 5,
} as const

/** A second fault of the same failure, so dropping one of them is visible. */
const secondDiagnostic = {
  ...compileDiagnostic,
  code: 'YMVS202',
  message: 'Unresolved reference "phantom"',
  line: 9,
} as const

const responseEnvelope = {
  format: 'yarramate/visual-response/v1',
  sessionId: '0'.repeat(32),
  responseId: 'a'.repeat(32),
  eventId: 'b'.repeat(32),
  timestamp: '2026-08-08T00:00:01.000Z',
} as const

/**
 * One frame as the reviewer ends up seeing it: every action it means, in order.
 */
const applyFrame = (
  state: VisualAppState,
  frame: VisualServerFrame,
): VisualAppState =>
  visualAppActionsForFrame(frame).reduce(
    (carried, action) => visualAppReducer(carried, action),
    state,
  )

describe('visualAppReducer session lifecycle', () => {
  it('starts connecting with nothing to draw and no way to type', () => {
    expect(initialVisualAppState).toMatchObject({
      lifecycle: 'connecting',
      model: null,
      composerEnabled: false,
      transcript: [],
      lastSequence: 0,
    })
  })

  it('activates the session from the server snapshot', () => {
    expect(activeState).toMatchObject({
      lifecycle: 'active',
      authority: 'ad-hoc',
      title: 'Choose a delivery design',
      description: 'Temporary non-canonical comparison',
      activeView: 'choices',
      composerEnabled: true,
    })
    expect(activeState.model).toBe(serverSnapshot.model)
  })

  it('keeps input shut when the turn was still open at reconnect', () => {
    const asked = visualAppReducer(
      visualAppReducer(activeState, { type: 'chat.sent', text: 'Why B?' }),
      { type: 'status.received', status: { state: 'thinking' } },
    )
    const reconnected = visualAppReducer(asked, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [{ id: 'e1', speaker: 'reviewer', text: 'Why B?' }],
        agentTurnOpen: true,
        lastSequence: 1,
      }),
    })
    expect(reconnected.composerEnabled).toBe(false)
    expect(reconnected.agentStatus).toEqual({ state: 'thinking' })
  })

  it('restores the choice the agent is still waiting on at reconnect', () => {
    const question = {
      choiceId: 'delivery',
      question: 'Which delivery design should we keep?',
      options: [
        { id: 'shared-queue', label: 'Shared queue' },
        { id: 'isolated-worker', label: 'Isolated worker' },
      ],
    }
    // Nothing in the transcript says a question was asked, so a reviewer who
    // reloads can only answer it if the snapshot brings it back.
    expect(loaded({ pendingChoice: question }).choices).toEqual(question)
  })

  it('closes a choice the session no longer waits on', () => {
    const presented = visualAppReducer(activeState, {
      type: 'choice.presented',
      choice: { choiceId: 'delivery', question: 'Which?', options: [] },
    })
    const reconnected = visualAppReducer(presented, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom(serverSnapshot),
    })
    expect(reconnected.choices).toBe(null)
  })

  it('reopens input when the agent answered while the browser was away', () => {
    const asked = visualAppReducer(
      visualAppReducer(activeState, { type: 'chat.sent', text: 'Why B?' }),
      { type: 'status.received', status: { state: 'thinking' } },
    )
    const lost = visualAppReducer(asked, { type: 'connection.lost' })
    const reconnected = visualAppReducer(lost, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [
          { id: 'e1', speaker: 'reviewer', text: 'Why B?' },
          { id: 'r1', speaker: 'agent', text: 'It reuses the intake path.' },
        ],
        agentTurnOpen: false,
        lastSequence: 1,
      }),
    })
    expect(reconnected.lifecycle).toBe('active')
    expect(reconnected.composerEnabled).toBe(true)
    expect(reconnected.agentStatus).toBe(null)
    expect(reconnected.transcript).toHaveLength(2)

    // The server may replay the response this browser missed; the record it
    // already holds is the same record, not a second one.
    const replayed = visualAppReducer(reconnected, {
      type: 'chat.received',
      id: 'r1',
      text: 'It reuses the intake path.',
    })
    expect(replayed.transcript).toHaveLength(2)
    expect(replayed.composerEnabled).toBe(true)
  })

  it('never reuses a record key across a restored conversation', () => {
    const ending = visualAppReducer(activeState, { type: 'end.requested' })
    const restored = visualAppReducer(ending, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [
          { id: 'e1', speaker: 'reviewer', text: 'one' },
          { id: 'r1', speaker: 'agent', text: 'two' },
        ],
      }),
    })
    const asked = visualAppReducer(restored, { type: 'chat.sent', text: 'next' })
    const keys = asked.transcript.map((record) => record.id)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries the session style nonce to the renderer', () => {
    expect(activeState.styleNonce).toBe('a'.repeat(32))
  })

  it('restores the conversation the session already holds', () => {
    const restored = loaded({
      transcript: [
        { id: 'e1', speaker: 'reviewer', text: 'Why option B?' },
        { id: 'r1', speaker: 'agent', text: 'It reuses the intake path.' },
      ],
      lastSequence: 1,
    })
    expect(restored.transcript).toEqual([
      { id: 'e1', speaker: 'reviewer', text: 'Why option B?' },
      { id: 'r1', speaker: 'agent', text: 'It reuses the intake path.' },
    ])
    expect(restored.lastSequence).toBe(1)
  })

  it('keeps its own session notices when the server restores the record', () => {
    const ending = visualAppReducer(activeState, { type: 'end.requested' })
    const restored = visualAppReducer(ending, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [{ id: 'e1', speaker: 'reviewer', text: 'Why option B?' }],
      }),
    })
    // The server owns what was said; the browser owns what it told the reviewer.
    expect(restored.transcript).toEqual([
      { id: 'e1', speaker: 'reviewer', text: 'Why option B?' },
      { id: 'local-0', speaker: 'session', text: VISUAL_END_NOTICE },
    ])
  })

  it('leaves the composer shut when the session arrives already frozen', () => {
    expect(loaded({ frozen: true }).composerEnabled).toBe(false)
  })

  it('leaves the composer shut when the session has no chat', () => {
    expect(loaded({ chatEnabled: false }).composerEnabled).toBe(false)
  })

  it('freezes input immediately when End is requested', () => {
    const next = visualAppReducer(activeState, { type: 'end.requested' })
    expect(next.lifecycle).toBe('ending')
    expect(next.composerEnabled).toBe(false)
  })

  it('tells the reviewer control is going back to the main agent', () => {
    const next = visualAppReducer(activeState, { type: 'end.requested' })
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: 'session',
      text: 'Returning control to the main agent',
    })
    expect(VISUAL_END_NOTICE).toBe('Returning control to the main agent')
  })

  it('keeps a session that already requested End ending when it reconnects', () => {
    const ending = visualAppReducer(activeState, { type: 'end.requested' })
    const reconnected = visualAppReducer(ending, {
      type: 'session.loaded',
      snapshot: visualAppSnapshotFrom(serverSnapshot),
    })
    expect(reconnected.lifecycle).toBe('ending')
    expect(reconnected.composerEnabled).toBe(false)
  })

  it('marks the session disconnected and shuts input when the socket drops', () => {
    const next = visualAppReducer(activeState, { type: 'connection.lost' })
    expect(next.lifecycle).toBe('disconnected')
    expect(next.composerEnabled).toBe(false)
    expect(next.model).toBe(activeState.model)
  })

  it('closes the session on the reason the server reports', () => {
    const next = visualAppReducer(
      visualAppReducer(activeState, { type: 'end.requested' }),
      { type: 'session.closed', reason: 'user-ended' },
    )
    expect(next.lifecycle).toBe('closed')
    expect(next.closedReason).toBe('user-ended')
    expect(next.composerEnabled).toBe(false)
  })

  it('stays closed when a late frame arrives', () => {
    const closed = visualAppReducer(activeState, {
      type: 'session.closed',
      reason: 'main-cancelled',
    })
    expect(
      visualAppReducer(closed, {
        type: 'session.loaded',
        snapshot: visualAppSnapshotFrom(serverSnapshot),
      }).lifecycle,
    ).toBe('closed')
    expect(visualAppReducer(closed, { type: 'connection.lost' }).lifecycle).toBe(
      'closed',
    )
  })
})

describe('visualAppReducer model rendering', () => {
  it('renders a replacement model and clears the diagnostics it answers', () => {
    const failed = visualAppReducer(activeState, {
      type: 'diagnostic.received',
      diagnostics: [compileDiagnostic],
    })
    const replacement = model('choices')
    const next = visualAppReducer(failed, {
      type: 'model.received',
      model: replacement,
    })
    expect(next.model).toBe(replacement)
    expect(next.diagnostics).toEqual([])
  })

  it('keeps the last rendered model when compilation fails', () => {
    const next = visualAppReducer(activeState, {
      type: 'diagnostic.received',
      diagnostics: [compileDiagnostic],
    })
    expect(next.model).toBe(activeState.model)
    expect(next.diagnostics).toEqual([compileDiagnostic])
  })

  it('shows every fault of one failed compilation, not only the last', () => {
    // A compilation fails for several reasons at once, and the reviewer has to
    // read all of them: a frame is one failure, not a queue of replacements.
    const next = applyFrame(activeState, {
      kind: 'response',
      response: {
        ...responseEnvelope,
        type: 'diagnostic',
        payload: { diagnostics: [compileDiagnostic, secondDiagnostic] },
      },
    })
    expect(next.diagnostics).toEqual([compileDiagnostic, secondDiagnostic])
    expect(next.model).toBe(activeState.model)
  })

  it('keeps the current view when the replacement model happens to open on it', () => {
    const drilled = visualAppReducer(activeState, {
      type: 'view.navigated',
      viewId: 'option-b',
    })
    const next = visualAppReducer(drilled, {
      type: 'model.received',
      model: model('option-b'),
    })
    expect(next.activeView).toBe('option-b')
  })

  it("resets to the replacement model's own initial view, even after a drill-down", () => {
    const drilled = visualAppReducer(activeState, {
      type: 'view.navigated',
      viewId: 'option-b',
    })
    const next = visualAppReducer(drilled, {
      type: 'model.received',
      model: model('choices'),
    })
    expect(next.activeView).toBe('choices')
  })

  it('moves the active view locally without touching the transcript', () => {
    const next = visualAppReducer(activeState, {
      type: 'view.navigated',
      viewId: 'option-b',
    })
    expect(next.activeView).toBe('option-b')
    expect(next.transcript).toBe(activeState.transcript)
    expect(next.composerEnabled).toBe(true)
  })
})

describe('visualAppReducer conversation', () => {
  it('records the reviewer question verbatim and waits for the answer', () => {
    const next = visualAppReducer(activeState, {
      type: 'chat.sent',
      text: 'Why is <b>option B</b> cheaper?',
    })
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: 'reviewer',
      text: 'Why is <b>option B</b> cheaper?',
    })
    expect(next.composerEnabled).toBe(false)
  })

  it('reopens the composer when the agent answers', () => {
    const asked = visualAppReducer(activeState, {
      type: 'chat.sent',
      text: 'Why is option B cheaper?',
    })
    const next = visualAppReducer(asked, {
      type: 'chat.received',
      id: 'r1',
      text: 'Option B reuses the existing queue.',
    })
    expect(next.transcript.at(-1)).toMatchObject({
      id: 'r1',
      speaker: 'agent',
      text: 'Option B reuses the existing queue.',
    })
    expect(next.composerEnabled).toBe(true)
  })

  it('gives every transcript record its own key', () => {
    const first = visualAppReducer(activeState, {
      type: 'chat.sent',
      text: 'one',
    })
    const second = visualAppReducer(first, { type: 'chat.sent', text: 'one' })
    const keys = second.transcript.map((entry) => entry.id)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('presents choices and closes them the moment one is selected', () => {
    const presented = visualAppReducer(activeState, {
      type: 'choice.presented',
      choice: {
        choiceId: 'delivery',
        question: 'Which delivery design should we keep?',
        options: [
          { id: 'option-a', label: 'Isolated worker' },
          { id: 'option-b', label: 'Shared queue' },
        ],
      },
    })
    expect(presented.choices?.options).toHaveLength(2)
    expect(presented.composerEnabled).toBe(true)

    const chosen = visualAppReducer(presented, {
      type: 'choice.sent',
      optionId: 'option-b',
    })
    expect(chosen.choices).toBe(null)
    expect(chosen.transcript.at(-1)).toMatchObject({
      speaker: 'reviewer',
      text: 'Shared queue',
    })
    expect(chosen.composerEnabled).toBe(false)
  })

  describe('after a choice, every later record keeps its own key', () => {
    const present = (state: VisualAppState, choiceId: string) =>
      visualAppReducer(state, {
        type: 'choice.presented',
        choice: {
          choiceId,
          question: 'Which delivery design should we keep?',
          options: [
            { id: 'option-a', label: 'Isolated worker' },
            { id: 'option-b', label: 'Shared queue' },
          ],
        },
      })

    const chosen = visualAppReducer(present(activeState, 'first'), {
      type: 'choice.sent',
      optionId: 'option-b',
    })

    const unique = (state: VisualAppState) => {
      const keys = state.transcript.map((record) => record.id)
      expect(new Set(keys).size).toBe(keys.length)
    }

    it('records a second choice beside the first', () => {
      const next = visualAppReducer(present(chosen, 'second'), {
        type: 'choice.sent',
        optionId: 'option-a',
      })
      expect(next.transcript.map((record) => record.text)).toEqual([
        'Shared queue',
        'Isolated worker',
      ])
      unique(next)
    })

    it('records a question asked after a choice', () => {
      const next = visualAppReducer(chosen, {
        type: 'chat.sent',
        text: 'What does that cost?',
      })
      expect(next.transcript.map((record) => record.text)).toEqual([
        'Shared queue',
        'What does that cost?',
      ])
      unique(next)
    })

    it('still shows the End notice after a choice', () => {
      const next = visualAppReducer(chosen, { type: 'end.requested' })
      expect(next.transcript.map((record) => record.text)).toEqual([
        'Shared queue',
        VISUAL_END_NOTICE,
      ])
      unique(next)
    })
  })

  it('reports agent status without disturbing the transcript', () => {
    const next = visualAppReducer(activeState, {
      type: 'status.received',
      status: { state: 'compiling', detail: 'Rendering option B' },
    })
    expect(next.agentStatus).toEqual({
      state: 'compiling',
      detail: 'Rendering option B',
    })
    expect(next.transcript).toBe(activeState.transcript)
  })

  it('drops the agent status once the turn it described is answered', () => {
    const thinking = visualAppReducer(
      visualAppReducer(activeState, { type: 'chat.sent', text: 'why?' }),
      { type: 'status.received', status: { state: 'thinking' } },
    )
    expect(thinking.agentStatus).not.toBe(null)
    // The reviewer must never be told the agent is still thinking about a
    // question it has already answered.
    expect(
      visualAppReducer(thinking, {
        type: 'chat.received',
        id: 'r2',
        text: 'Because it reuses the intake path.',
      }).agentStatus,
    ).toBe(null)
    expect(
      visualAppReducer(thinking, {
        type: 'choice.presented',
        choice: { choiceId: 'c', question: 'Which?', options: [] },
      }).agentStatus,
    ).toBe(null)
    expect(
      visualAppReducer(thinking, {
        type: 'diagnostic.received',
        diagnostics: [compileDiagnostic],
      }).agentStatus,
    ).toBe(null)
  })

  it('records the handoff summary the agent closed with', () => {
    const next = visualAppReducer(activeState, {
      type: 'handoff.received',
      id: 'r9',
      handoff: {
        summary: 'Option B confirmed',
        confirmedDecisions: ['Reuse the shared queue'],
        requestedChanges: [],
        unresolvedQuestions: [],
        finalViews: ['option-b'],
      },
    })
    expect(next.handoff?.summary).toBe('Option B confirmed')
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: 'agent',
      text: 'Option B confirmed',
    })
  })
})

describe('visualAppReducer acknowledgement and refusal', () => {
  it('tracks the highest sequence the server acknowledged', () => {
    const first = visualAppReducer(activeState, {
      type: 'event.acknowledged',
      sequence: 2,
    })
    expect(first.lastSequence).toBe(2)
    // A late acknowledgement for an earlier event never rewinds the browser's
    // view of the journal, because that view is what every frame carries.
    expect(
      visualAppReducer(first, { type: 'event.acknowledged', sequence: 1 })
        .lastSequence,
    ).toBe(2)
  })

  it('shuts the composer for good when the server freezes input', () => {
    const next = visualAppReducer(activeState, {
      type: 'input.refused',
      diagnostics: [compileDiagnostic],
      frozen: true,
    })
    expect(next.frozen).toBe(true)
    expect(next.composerEnabled).toBe(false)
    expect(next.diagnostics).toEqual([compileDiagnostic])
  })

  it('leaves the composer open when a single frame was refused', () => {
    const next = visualAppReducer(activeState, {
      type: 'input.refused',
      diagnostics: [compileDiagnostic],
      frozen: false,
    })
    expect(next.frozen).toBe(false)
    expect(next.composerEnabled).toBe(true)
  })

  it('shows every reason one frame was refused, not only the last', () => {
    const next = applyFrame(activeState, {
      kind: 'rejected',
      diagnostics: [compileDiagnostic, secondDiagnostic],
      frozen: 'pending-events',
    })
    expect(next.diagnostics).toEqual([compileDiagnostic, secondDiagnostic])
    expect(next.frozen).toBe(true)
    expect(next.composerEnabled).toBe(false)
  })
})

describe('visualBrowserInputFor', () => {
  it('carries the last acknowledged sequence on every browser frame', () => {
    const acknowledged = visualAppReducer(activeState, {
      type: 'event.acknowledged',
      sequence: 7,
    })
    const frames: readonly VisualBrowserInput[] = [
      visualBrowserInputFor(
        { kind: 'chat', text: 'Why option B?' },
        acknowledged,
      ),
      visualBrowserInputFor(
        { kind: 'choice', choiceId: 'delivery', optionId: 'option-b' },
        acknowledged,
      ),
      visualBrowserInputFor(
        { kind: 'navigate', viewId: 'option-b' },
        acknowledged,
      ),
      visualBrowserInputFor({ kind: 'end' }, acknowledged),
    ]
    expect(frames.map((frame) => frame.lastAcknowledgedSequence)).toEqual([
      7, 7, 7, 7,
    ])
    expect(frames.map((frame) => frame.type)).toEqual([
      'chat.message',
      'choice.selected',
      'view.navigate',
      'session.end',
    ])
  })

  it('never asks the agent for attention on a local drill-down', () => {
    expect(
      visualBrowserInputFor({ kind: 'navigate', viewId: 'option-b' }, activeState),
    ).toEqual({
      type: 'view.navigate',
      lastAcknowledgedSequence: 0,
      payload: { viewId: 'option-b', requiresAttention: false },
    })
  })

  it('ends only for the reason the reviewer chose', () => {
    expect(visualBrowserInputFor({ kind: 'end' }, activeState)).toEqual({
      type: 'session.end',
      lastAcknowledgedSequence: 0,
      payload: { reason: 'user-ended' },
    })
  })
})

describe('visualAppActionsForFrame', () => {
  const actionsFor = (frame: VisualServerFrame) =>
    visualAppActionsForFrame(frame)

  it('loads the session from a ready frame', () => {
    expect(actionsFor({ kind: 'ready', snapshot: serverSnapshot })).toEqual([
      {
        type: 'session.loaded',
        snapshot: visualAppSnapshotFrom(serverSnapshot),
      },
    ])
  })

  it('acknowledges an accepted event', () => {
    expect(actionsFor({ kind: 'accepted', sequence: 3, eventId: 'e3' })).toEqual(
      [{ type: 'event.acknowledged', sequence: 3 }],
    )
  })

  it('refuses input and reports whether the session froze', () => {
    expect(
      actionsFor({
        kind: 'rejected',
        diagnostics: [compileDiagnostic],
        frozen: 'pending-events',
      }),
    ).toEqual([
      {
        type: 'input.refused',
        diagnostics: [compileDiagnostic],
        frozen: true,
      },
    ])
  })

  it('carries every diagnostic of a refused frame in one refusal', () => {
    expect(
      actionsFor({
        kind: 'rejected',
        diagnostics: [compileDiagnostic, secondDiagnostic],
      }),
    ).toEqual([
      {
        type: 'input.refused',
        diagnostics: [compileDiagnostic, secondDiagnostic],
        frozen: false,
      },
    ])
  })

  it('replaces the rendered model from a model frame', () => {
    const rendered = model('choices')
    expect(actionsFor({ kind: 'model', model: rendered })).toEqual([
      { type: 'model.received', model: rendered },
    ])
  })

  it('closes the session from a closing frame', () => {
    expect(actionsFor({ kind: 'closing', reason: 'user-ended' })).toEqual([
      { type: 'session.closed', reason: 'user-ended' },
    ])
  })

  it('turns each agent response into the record it belongs to', () => {
    expect(
      actionsFor({
        kind: 'response',
        response: {
          ...responseEnvelope,
          type: 'chat.response',
          payload: { text: 'Option B reuses the queue' },
        },
      }),
    ).toEqual([
      {
        type: 'chat.received',
        id: responseEnvelope.responseId,
        text: 'Option B reuses the queue',
      },
    ])
    expect(
      actionsFor({
        kind: 'response',
        response: {
          ...responseEnvelope,
          type: 'agent.status',
          payload: { state: 'thinking' },
        },
      }),
    ).toEqual([{ type: 'status.received', status: { state: 'thinking' } }])
    expect(
      actionsFor({
        kind: 'response',
        response: {
          ...responseEnvelope,
          type: 'diagnostic',
          payload: { diagnostics: [compileDiagnostic] },
        },
      }),
    ).toEqual([
      { type: 'diagnostic.received', diagnostics: [compileDiagnostic] },
    ])
  })
})

describe('visualAppReducer filter state', () => {
  const query = { include: { subjects: ['Q1'] }, exclude: {} }
  const matchedIds = ['node1', 'node2', 'node3']

  it('initializes with no active filter', () => {
    expect(initialVisualAppState.activeFilter).toBe(null)
    expect(initialVisualAppState.quickFilterText).toBe('')
  })

  it('applies a filter with panel source from filter-result frame', () => {
    const actions = visualAppActionsForFrame({
      kind: 'filter-result',
      result: { query, matchedIds },
    })
    const filtered = actions.reduce(
      (state, action) => visualAppReducer(state, action),
      activeState,
    )
    expect(filtered.activeFilter).toEqual({
      query,
      matchedIds,
      source: 'panel',
    })
  })

  it('applies a filter with chat source from chat response', () => {
    const actions = visualAppActionsForFrame({
      kind: 'response',
      response: {
        responseId: 'r1',
        type: 'chat.response',
        payload: {
          text: 'Here are results',
          appliedQuery: { query, matchedIds },
        },
      },
    })
    const filtered = actions.reduce(
      (state, action) => visualAppReducer(state, action),
      activeState,
    )
    expect(filtered.activeFilter).toEqual({
      query,
      matchedIds,
      source: 'chat',
    })
  })

  it('clears the active filter on filter.cleared action', () => {
    const filtered = visualAppReducer(activeState, {
      type: 'filter.applied',
      query,
      matchedIds,
      source: 'panel',
    })
    expect(filtered.activeFilter).not.toBe(null)
    const cleared = visualAppReducer(filtered, {
      type: 'filter.cleared',
    })
    expect(cleared.activeFilter).toBe(null)
  })

  it('does not clear quickFilterText when clearing the filter', () => {
    const withFilter = visualAppReducer(activeState, {
      type: 'filter.applied',
      query,
      matchedIds,
      source: 'panel',
    })
    const cleared = visualAppReducer(withFilter, {
      type: 'filter.cleared',
    })
    // quickFilterText should remain unchanged
    expect(cleared.quickFilterText).toBe(activeState.quickFilterText)
  })

  it('replacing a filter with a new one updates the activeFilter', () => {
    const filtered1 = visualAppReducer(activeState, {
      type: 'filter.applied',
      query,
      matchedIds: ['node1'],
      source: 'panel',
    })
    const newQuery = { include: { subjects: ['Q2'] }, exclude: {} }
    const filtered2 = visualAppReducer(filtered1, {
      type: 'filter.applied',
      query: newQuery,
      matchedIds: ['node4', 'node5'],
      source: 'chat',
    })
    expect(filtered2.activeFilter).toEqual({
      query: newQuery,
      matchedIds: ['node4', 'node5'],
      source: 'chat',
    })
  })
})

describe('canReconnect', () => {
  it('pins the browser grace to the protocol reconnect window', () => {
    expect(RECONNECT_WINDOW_MS).toBe(VISUAL_LIMITS.reconnectMs)
  })

  it('reconnects inside the grace and stops at its edge', () => {
    const lostAt = 1_000_000
    expect(canReconnect(lostAt, lostAt)).toBe(true)
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS - 1)).toBe(true)
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS)).toBe(false)
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS + 60_000)).toBe(
      false,
    )
  })
})

describe('visualAuthorityLabel', () => {
  it('names a checked model and an ad hoc one in the reviewer’s words', () => {
    expect(visualAuthorityLabel('canonical')).toBe('Checked YarraMate model')
    expect(visualAuthorityLabel('ad-hoc')).toBe('Ad hoc · non-canonical')
  })
})
