import type { CanvasGraph } from '../../graph-projection.js'
import type {
  VISUAL_PROTOCOL_VERSION,
  VisualAuthority,
  VisualCapabilities,
  VisualChoicePresentPayload,
  VisualDiagnostic,
  VisualFilterResultPayload,
  VisualFreezeReason,
  VisualResponse,
  VisualTerminationReason,
  VisualViewSaveResultPayload,
  VisualViewSummary,
} from './protocol-contract.js'

/**
 * Transport shapes the session server and the browser application both speak.
 *
 * These are not protocol documents: they carry validated documents plus the
 * transport's own acknowledgements, so they are discriminated by `kind` rather
 * than by a versioned `format`. They live apart from the server because the
 * browser bundle must import the contract without importing the Node runtime
 * that serves it — this module holds types only, and every dependency it has on
 * the protocol is type-only too.
 */

/** The resolved graph a session renders, as the browser receives it. */
export interface VisualRenderedModel {
  readonly authority: VisualAuthority
  readonly initialView: string
  readonly graph: CanvasGraph
}

/**
 * One line of the conversation, as plain text.
 *
 * The server keeps this beside the journal so a browser that reloads or
 * reconnects sees the conversation it left. It carries no model source, no
 * credential, and none of the journal's own bookkeeping — only what was said
 * and who said it.
 */
export interface VisualTranscriptRecord {
  readonly id: string
  readonly speaker: 'reviewer' | 'agent'
  readonly text: string
}

/** Everything the browser needs to render, and nothing that authenticates it. */
export interface VisualSessionSnapshot {
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION
  readonly sessionId: string
  readonly authority: VisualAuthority
  readonly title: string
  readonly description: string
  readonly chatEnabled: boolean
  readonly capabilities: VisualCapabilities
  readonly webSocketUrl: string
  readonly model: VisualRenderedModel
  readonly transcript: readonly VisualTranscriptRecord[]
  /** The saved views the reviewer can switch this session's diagram to. */
  readonly views: readonly VisualViewSummary[]
  /**
   * Whether the agent still owes an answer to something the reviewer sent. A
   * browser that reconnects mid-turn reads this rather than inferring the turn
   * from the transcript, so a reply it never saw does not leave it waiting.
   */
  readonly agentTurnOpen: boolean
  /**
   * The structured choice the agent is still waiting on, or `null`. The
   * question lives in the agent's response and never in the transcript, so a
   * browser that reloads or reconnects reads it here; without it the reviewer
   * comes back to a session waiting on a selection they can no longer make.
   */
  readonly pendingChoice: VisualChoicePresentPayload | null
  /**
   * Nonce this session's policy admits for the inline styles the diagram
   * renderer injects. It authorises styling and nothing else, and it is not a
   * credential: the session cookie is what authenticates this snapshot.
   */
  readonly styleNonce: string
  readonly lastSequence: number
  readonly frozen: boolean
}

/** Server-to-browser transport frame. */
export type VisualServerFrame =
  | { readonly kind: 'ready'; readonly snapshot: VisualSessionSnapshot }
  | {
      readonly kind: 'accepted'
      readonly sequence: number
      readonly eventId: string
    }
  | {
      readonly kind: 'rejected'
      readonly diagnostics: readonly VisualDiagnostic[]
      readonly frozen?: VisualFreezeReason
    }
  | { readonly kind: 'response'; readonly response: VisualResponse }
  | { readonly kind: 'model'; readonly model: VisualRenderedModel }
  | { readonly kind: 'filter-result'; readonly result: VisualFilterResultPayload }
  | { readonly kind: 'view-save-result'; readonly result: VisualViewSaveResultPayload }
  | { readonly kind: 'closing'; readonly reason: VisualTerminationReason }
