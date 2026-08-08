import {
  VISUAL_LIMITS,
  type VisualAgentStatusPayload,
  type VisualAuthority,
  type VisualBrowserInput,
  type VisualChoicePresentPayload,
  type VisualDiagnostic,
  type VisualHandoffSummary,
} from '../adapters/visual/protocol-contract.js'
import type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
  VisualTranscriptRecord,
} from '../adapters/visual/wire.js'

/**
 * Everything the browser knows about a visual session, and the only place it
 * is decided.
 *
 * The reducer is pure and total: every frame the server can send, and every
 * intent the reviewer can express, becomes one action, and nothing else in the
 * application may change what is on screen. Transcript records are plain text
 * and are rendered through React text nodes, never as markup.
 */

/** How long after losing the socket the server still holds this session. */
export const RECONNECT_WINDOW_MS = VISUAL_LIMITS.reconnectMs

/** Shown the moment End is requested, and kept in the record. */
export const VISUAL_END_NOTICE = 'Returning control to the main agent'

export type VisualAppLifecycle =
  | 'connecting'
  | 'active'
  | 'ending'
  | 'disconnected'
  | 'closed'

/**
 * The session speaks too: it is the browser, not the agent, that tells the
 * reviewer control is going back.
 */
export type VisualAppSpeaker = VisualTranscriptRecord['speaker'] | 'session'

export interface VisualAppRecord extends Omit<VisualTranscriptRecord, 'speaker'> {
  readonly speaker: VisualAppSpeaker
}

/** The part of the server snapshot that decides what the browser renders. */
export interface VisualAppSnapshot {
  readonly authority: VisualAuthority
  readonly title: string
  readonly description: string
  readonly chatEnabled: boolean
  readonly model: VisualRenderedModel
  readonly transcript: readonly VisualTranscriptRecord[]
  readonly agentTurnOpen: boolean
  readonly styleNonce: string
  readonly lastSequence: number
  readonly frozen: boolean
}

export interface VisualAppState {
  readonly lifecycle: VisualAppLifecycle
  readonly authority: VisualAuthority
  readonly title: string
  readonly description: string
  readonly chatEnabled: boolean
  /** Last model that compiled. A failed candidate never replaces it. */
  readonly model: VisualRenderedModel | null
  readonly styleNonce: string
  readonly activeView: string
  readonly transcript: readonly VisualAppRecord[]
  readonly choices: VisualChoicePresentPayload | null
  readonly agentStatus: VisualAgentStatusPayload | null
  readonly diagnostics: readonly VisualDiagnostic[]
  readonly handoff: VisualHandoffSummary | null
  readonly composerEnabled: boolean
  readonly awaitingAgent: boolean
  /** Records this browser has written itself, so a key is never reused. */
  readonly localRecords: number
  readonly lastSequence: number
  readonly frozen: boolean
  readonly closedReason: string | null
}

export type VisualAppAction =
  | { readonly type: 'session.loaded'; readonly snapshot: VisualAppSnapshot }
  | { readonly type: 'model.received'; readonly model: VisualRenderedModel }
  | {
      readonly type: 'diagnostic.received'
      readonly diagnostic: VisualDiagnostic
    }
  | { readonly type: 'chat.sent'; readonly text: string }
  | {
      readonly type: 'chat.received'
      readonly id: string
      readonly text: string
    }
  | {
      readonly type: 'status.received'
      readonly status: VisualAgentStatusPayload
    }
  | {
      readonly type: 'choice.presented'
      readonly choice: VisualChoicePresentPayload
    }
  | { readonly type: 'choice.sent'; readonly optionId: string }
  | { readonly type: 'view.navigated'; readonly viewId: string }
  | {
      readonly type: 'handoff.received'
      readonly id: string
      readonly handoff: VisualHandoffSummary
    }
  | { readonly type: 'event.acknowledged'; readonly sequence: number }
  | {
      readonly type: 'input.refused'
      readonly diagnostic: VisualDiagnostic
      readonly frozen: boolean
    }
  | { readonly type: 'end.requested' }
  | { readonly type: 'connection.lost' }
  | { readonly type: 'session.closed'; readonly reason: string }

export const initialVisualAppState: VisualAppState = {
  lifecycle: 'connecting',
  authority: 'ad-hoc',
  title: '',
  description: '',
  chatEnabled: false,
  model: null,
  styleNonce: '',
  activeView: '',
  transcript: [],
  choices: null,
  agentStatus: null,
  diagnostics: [],
  handoff: null,
  composerEnabled: false,
  awaitingAgent: false,
  localRecords: 0,
  lastSequence: 0,
  frozen: false,
  closedReason: null,
}

export const visualAppSnapshotFrom = (
  snapshot: VisualSessionSnapshot,
): VisualAppSnapshot => ({
  authority: snapshot.authority,
  title: snapshot.title,
  description: snapshot.description,
  chatEnabled: snapshot.chatEnabled,
  model: snapshot.model,
  transcript: snapshot.transcript,
  agentTurnOpen: snapshot.agentTurnOpen,
  styleNonce: snapshot.styleNonce,
  lastSequence: snapshot.lastSequence,
  frozen: snapshot.frozen,
})

/** The exact words for what the reviewer is looking at. */
export const visualAuthorityLabel = (authority: VisualAuthority): string =>
  authority === 'canonical' ? 'Checked YarraMate model' : 'Ad hoc · non-canonical'

/**
 * A dropped socket is recoverable only while the server still holds the
 * session. Past the grace it has already recovered the handoff, so retrying
 * would only spend the reviewer's attention on a session that no longer exists.
 */
export const canReconnect = (lostAt: number, now: number): boolean =>
  now - lostAt < RECONNECT_WINDOW_MS

/**
 * A record this browser wrote itself, keyed by a counter rather than by
 * position: a restored conversation changes the position of everything, and a
 * key that moves is a key that can collide.
 */
const localRecord = (
  state: VisualAppState,
  speaker: VisualAppSpeaker,
  text: string,
): VisualAppRecord => ({
  id: `local-${state.localRecords}`,
  speaker,
  text,
})

/**
 * The record appended, unless the conversation already holds it. A reconnect
 * can restore a record and then replay the frame that produced it; both name it
 * by the same identifier, and it was said once.
 */
const withRecord = (
  state: VisualAppState,
  record: VisualAppRecord,
): readonly VisualAppRecord[] =>
  state.transcript.some((existing) => existing.id === record.id)
    ? state.transcript
    : [...state.transcript, record]

/** The view the reviewer keeps, or the one the new model opens on. */
const viewWithin = (model: VisualRenderedModel, activeView: string): string =>
  model.views.includes(activeView) ? activeView : model.initialView

/**
 * The turn is over. The composer reopens, and the status the agent reported
 * while it worked is dropped: nobody may be told the agent is still thinking
 * about a question it has answered.
 */
const turnAnswered = { awaitingAgent: false, agentStatus: null } as const

const transition = (
  state: VisualAppState,
  action: VisualAppAction,
): VisualAppState => {
  switch (action.type) {
    case 'session.loaded':
      return {
        ...state,
        ...action.snapshot,
        // A reconnect re-sends the snapshot, and it reports what the session
        // holds — never that a session the reviewer already ended is open.
        lifecycle: state.lifecycle === 'ending' ? 'ending' : 'active',
        activeView: viewWithin(action.snapshot.model, state.activeView),
        // The session owns what was said; this browser owns only what it told
        // the reviewer itself, so a reload restores the record and keeps its
        // own notices.
        transcript: [
          ...action.snapshot.transcript,
          ...state.transcript.filter((record) => record.speaker === 'session'),
        ],
        // The session knows whether the turn is still open; a browser that was
        // away while the agent answered must not stay locked out, and one that
        // reconnects mid-turn must not be told the agent is idle.
        awaitingAgent: action.snapshot.agentTurnOpen,
        agentStatus: action.snapshot.agentTurnOpen ? state.agentStatus : null,
        lastSequence: Math.max(state.lastSequence, action.snapshot.lastSequence),
      }
    case 'model.received':
      return {
        ...state,
        model: action.model,
        activeView: viewWithin(action.model, state.activeView),
        diagnostics: [],
      }
    case 'diagnostic.received':
      // The candidate that failed is gone; what is on screen still compiled.
      return {
        ...state,
        diagnostics: [action.diagnostic],
        ...turnAnswered,
      }
    case 'chat.sent':
      return {
        ...state,
        transcript: withRecord(
          state,
          localRecord(state, 'reviewer', action.text),
        ),
        localRecords: state.localRecords + 1,
        choices: null,
        awaitingAgent: true,
      }
    case 'chat.received':
      return {
        ...state,
        transcript: withRecord(state, {
          id: action.id,
          speaker: 'agent',
          text: action.text,
        }),
        ...turnAnswered,
      }
    case 'status.received':
      return { ...state, agentStatus: action.status }
    case 'choice.presented':
      return { ...state, choices: action.choice, ...turnAnswered }
    case 'choice.sent': {
      const chosen = state.choices?.options.find(
        (option) => option.id === action.optionId,
      )
      if (chosen === undefined) return state
      return {
        ...state,
        transcript: withRecord(
          state,
          localRecord(state, 'reviewer', chosen.label),
        ),
        localRecords: state.localRecords + 1,
        choices: null,
        awaitingAgent: true,
      }
    }
    case 'view.navigated':
      // Drill-down is local: the reviewer never waits for the agent to redraw.
      return state.activeView === action.viewId
        ? state
        : { ...state, activeView: action.viewId }
    case 'handoff.received':
      return {
        ...state,
        handoff: action.handoff,
        transcript: withRecord(state, {
          id: action.id,
          speaker: 'agent',
          text: action.handoff.summary,
        }),
        ...turnAnswered,
      }
    case 'event.acknowledged':
      return {
        ...state,
        lastSequence: Math.max(state.lastSequence, action.sequence),
      }
    case 'input.refused':
      return {
        ...state,
        diagnostics: [action.diagnostic],
        frozen: state.frozen || action.frozen,
        ...turnAnswered,
      }
    case 'end.requested':
      return {
        ...state,
        lifecycle: 'ending',
        choices: null,
        transcript: withRecord(
          state,
          localRecord(state, 'session', VISUAL_END_NOTICE),
        ),
        localRecords: state.localRecords + 1,
      }
    case 'connection.lost':
      return { ...state, lifecycle: 'disconnected' }
    case 'session.closed':
      return { ...state, lifecycle: 'closed', closedReason: action.reason }
  }
}

/**
 * Whether the reviewer may type. Derived rather than assigned, so no transition
 * can leave a live session with dead controls or a closed one with live ones.
 */
const composerOpen = (state: VisualAppState): boolean =>
  state.lifecycle === 'active' &&
  state.chatEnabled &&
  !state.frozen &&
  !state.awaitingAgent

export function visualAppReducer(
  state: VisualAppState,
  action: VisualAppAction,
): VisualAppState {
  // A closed session is the end of the record: the server has already recovered
  // the handoff, so nothing that arrives afterwards may change what it says.
  if (state.lifecycle === 'closed') return state
  const next = transition(state, action)
  if (next === state) return state
  return { ...next, composerEnabled: composerOpen(next) }
}

/** Everything the reviewer can ask the session to do. */
export type VisualAppIntent =
  | { readonly kind: 'chat'; readonly text: string }
  | {
      readonly kind: 'choice'
      readonly choiceId: string
      readonly optionId: string
    }
  | { readonly kind: 'navigate'; readonly viewId: string }
  | { readonly kind: 'end' }

/**
 * One intent as the frame the server admits. Every frame carries the sequence
 * this browser last saw acknowledged, so a session that reconnected mid-turn
 * cannot slip a frame in behind a journal it never read.
 */
export const visualBrowserInputFor = (
  intent: VisualAppIntent,
  state: VisualAppState,
): VisualBrowserInput => {
  const lastAcknowledgedSequence = state.lastSequence
  switch (intent.kind) {
    case 'chat':
      return {
        type: 'chat.message',
        lastAcknowledgedSequence,
        payload: { text: intent.text },
      }
    case 'choice':
      return {
        type: 'choice.selected',
        lastAcknowledgedSequence,
        payload: { choiceId: intent.choiceId, optionId: intent.optionId },
      }
    case 'navigate':
      return {
        type: 'view.navigate',
        lastAcknowledgedSequence,
        // Drill-down is the reviewer reading, not a question: the agent is told
        // where they went without being asked to answer for it.
        payload: { viewId: intent.viewId, requiresAttention: false },
      }
    case 'end':
      return {
        type: 'session.end',
        lastAcknowledgedSequence,
        payload: { reason: 'user-ended' },
      }
  }
}

/**
 * One server frame as the actions it means. Translation is pure so the socket
 * owns nothing but the socket.
 */
export const visualAppActionsForFrame = (
  frame: VisualServerFrame,
): readonly VisualAppAction[] => {
  switch (frame.kind) {
    case 'ready':
      return [
        { type: 'session.loaded', snapshot: visualAppSnapshotFrom(frame.snapshot) },
      ]
    case 'accepted':
      return [{ type: 'event.acknowledged', sequence: frame.sequence }]
    case 'rejected':
      return frame.diagnostics.map((diagnostic) => ({
        type: 'input.refused',
        diagnostic,
        frozen: frame.frozen !== undefined,
      }))
    case 'model':
      return [{ type: 'model.received', model: frame.model }]
    case 'closing':
      return [{ type: 'session.closed', reason: frame.reason }]
    case 'response':
      switch (frame.response.type) {
        case 'chat.response':
          return [
            {
              type: 'chat.received',
              id: frame.response.responseId,
              text: frame.response.payload.text,
            },
          ]
        case 'agent.status':
          return [{ type: 'status.received', status: frame.response.payload }]
        case 'choice.present':
          return [{ type: 'choice.presented', choice: frame.response.payload }]
        case 'handoff.complete':
          return [
            {
              type: 'handoff.received',
              id: frame.response.responseId,
              handoff: frame.response.payload,
            },
          ]
        case 'diagnostic':
          return frame.response.payload.diagnostics.map((diagnostic) => ({
            type: 'diagnostic.received',
            diagnostic,
          }))
        case 'model.replace':
          // The promoted candidate arrives as its own frame, compiled. The
          // response is the journal's copy of the request, not a rendering.
          return []
      }
  }
}
