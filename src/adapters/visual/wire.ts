import type { CanvasGraph } from '../../graph-projection.js'
import type { PatternMembership, PatternVacancy } from '../../compiler.js'
import type {
  VISUAL_PROTOCOL_VERSION,
  VisualApplyResultPayload,
  VisualAuthority,
  VisualBrowserInput,
  VisualCapabilities,
  VisualChoicePresentPayload,
  VisualDiagnostic,
  VisualFilterResultPayload,
  VisualFreezeReason,
  VisualKindOption,
  VisualPatternOption,
  VisualLayoutPositions,
  VisualLayoutSaveResultPayload,
  VisualResponse,
  VisualTerminationReason,
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

/** One open question, as the question panel and a node's chip read it. */
export interface VisualQuestionEntry {
  readonly questionId: string
  /** Rendered phrasing — per-subject questions arrive already interpolated. */
  readonly question: string
  readonly authority: 'human' | 'agent' | 'either'
  readonly since?: string
}

/**
 * The interrogation report, folded for drawing (#292).
 *
 * Derived per successful recompile from the same compile the graph came
 * from, and never stored — the stateless-interview rule as the canvas sees
 * it. Optional on the model: a host that computes no overlay ships none,
 * and the app draws no chips rather than zeros.
 */
export interface VisualInterrogationOverlay {
  /** `id@version` of the catalogue that asked. */
  readonly catalogue: string
  /** Engine condition-semantics version (ADR 0106), carried so a consumer
   * can tell "the model moved" from "the engine moved". */
  readonly semantics: string
  /** Workspace-scoped open questions — they name no subject, so they are
   * shown when nothing is selected rather than pinned to a node. */
  readonly workspace: readonly VisualQuestionEntry[]
  /** Open questions per qualified subject id — `CanvasNode.id`'s space. */
  readonly subjects: Readonly<Record<string, readonly VisualQuestionEntry[]>>
}

/** The resolved graph a session renders, as the browser receives it. */
export interface VisualRenderedModel {
  readonly authority: VisualAuthority
  readonly initialView: string
  readonly graph: CanvasGraph
  /** Present only when the host evaluated the catalogue for this compile. */
  readonly interrogation?: VisualInterrogationOverlay
  /** Manifest-relative document paths — the add-concept target dropdown. */
  readonly documents: readonly string[]
  readonly vocabulary: {
    readonly conceptKinds: readonly VisualKindOption[]
    readonly relationshipKinds: readonly VisualKindOption[]
    /**
     * The patterns this workspace declares, with their slots resolved to what
     * each admits (#473 phase 4, ADR 0146).
     *
     * Optional, and ABSENT rather than empty where the workspace declares none:
     * an empty list is a workspace with no patterns, while absence is a host
     * that never looked, and a palette should be able to tell those apart.
     */
    readonly patterns?: readonly VisualPatternOption[]
  }
  /** Every saved layout sidecar, keyed by projection id (Plan-level decision 1). */
  readonly layouts: { readonly [projectionId: string]: VisualLayoutPositions }
  /**
   * What each view folds, keyed by projection id (#473). A SIBLING of
   * `layouts` rather than a field inside its entries: a layout entry is
   * positions, one shape a host may already be reading, and widening it would
   * make every reader of `layouts[id]` handle a case that did not exist.
   */
  readonly folds?: {
    readonly [projectionId: string]: {
      readonly folded: readonly string[]
      readonly unfolded: readonly string[]
    }
  }
  /**
   * Which subject fills which slot of which instance (ADR 0131), and which
   * slots nothing fills (#447), forwarded so the browser can draw containment
   * and answer "what is inside this box" without a second round trip.
   *
   * Optional: a host that never folds and never shows slots need not supply
   * them, and a frame from before #473 has neither.
   */
  readonly memberships?: readonly PatternMembership[]
  readonly vacancies?: readonly PatternVacancy[]
  /**
   * The sha256 of every workspace source this graph was compiled from, keyed by
   * manifest-relative path — the same map `visual-model/v1` already requires of
   * a canonical model (`YMVS112`), forwarded rather than dropped so the browser
   * can state what it rendered when it asks for a commit.
   */
  readonly sourceDigests: Readonly<Record<string, string>>
  /**
   * The sha256 of every projection this session knows about, keyed by
   * manifest-relative path.
   *
   * Kept apart from `sourceDigests` rather than folded into it: that map means
   * what the GRAPH was compiled from, which `YMVS112` requires a canonical
   * model to state, and a projection is not part of it. A staged view
   * operation pins against this one instead (ADR 0103), and a path absent from
   * it is a projection the commit will create.
   */
  readonly projectionDigests: Readonly<Record<string, string>>
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
      /**
       * The input this refusal is about, as the frame that carried it named
       * itself. A browser with a commit or a save in flight can only retire
       * the right control if the refusal says which one died, and a refusal
       * that never got as far as reading a type - a binary frame, a document
       * that is not JSON - names nothing rather than guessing.
       */
      readonly refused?: VisualBrowserInput['type']
      readonly diagnostics: readonly VisualDiagnostic[]
      readonly frozen?: VisualFreezeReason
    }
  | { readonly kind: 'response'; readonly response: VisualResponse }
  | {
      readonly kind: 'model'
      readonly model: VisualRenderedModel
      /**
       * The saved views again, because a recompile moves what their queries
       * match and the tree states those counts. Required rather than optional:
       * a recompile that shipped a graph without them would leave every count
       * beside it describing the model before the commit.
       */
      readonly views: readonly VisualViewSummary[]
    }
  | { readonly kind: 'filter-result'; readonly result: VisualFilterResultPayload }
  | { readonly kind: 'apply-result'; readonly result: VisualApplyResultPayload }
  | {
      readonly kind: 'layout-save-result'
      readonly result: VisualLayoutSaveResultPayload
    }
  | { readonly kind: 'closing'; readonly reason: VisualTerminationReason }
