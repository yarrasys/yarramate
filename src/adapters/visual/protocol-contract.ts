/**
 * Every visual protocol declaration, and the limits they are measured against,
 * with no runtime dependency of any kind.
 *
 * The validators that police these documents live in `./protocol.js`, which
 * re-exports this module so a Node consumer still has one import for the whole
 * protocol. The split exists because the browser application ships the same
 * contract: it can import these declarations and limits without pulling Ajv,
 * `node:path`, or the schema documents into its bundle.
 */
import type { CanvasGraph } from "../../graph-projection.js";
import type {
  YarramateApplyResult,
  YarramateOperation,
} from "../../operations.js";
import type {
  ProjectionDefinition,
  ProjectionQuery,
} from "../../projection.js";

export const VISUAL_PROTOCOL_VERSION = "yarramate/visual-protocol/v2" as const;

export const VISUAL_LIMITS = {
  messageBytes: 64 * 1024,
  modelBytes: 5 * 1024 * 1024,
  transcriptBytes: 5 * 1024 * 1024,
  pendingEvents: 32,
  reconnectMs: 5 * 60 * 1000,
  staleSessionMs: 24 * 60 * 60 * 1000,
} as const;

export type VisualAuthority = "canonical";

export interface VisualDiagnostic {
  readonly severity: "error";
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly pointer: string;
  readonly line: number;
  readonly column: number;
}

export interface VisualDiagnosticResult {
  readonly format: "yarramate/visual-diagnostic-result/v1";
  readonly diagnostics: readonly VisualDiagnostic[];
}

export interface VisualCapabilities {
  readonly chat: boolean;
  readonly choices: boolean;
  readonly navigation: boolean;
  readonly transcript: boolean;
}

export interface VisualModel {
  readonly format: "yarramate/visual-model/v1";
  readonly authority: VisualAuthority;
  readonly initialView: string;
  readonly sourceDigests: Readonly<Record<string, string>>;
  readonly graph: CanvasGraph;
}

export interface VisualSessionRequest {
  readonly format: "yarramate/visual-session-request/v1";
  readonly authority: VisualModel["authority"];
  readonly title: string;
  readonly description: string;
  readonly chatEnabled: boolean;
  readonly initialModel: VisualModel;
}

export interface VisualSessionStarted {
  readonly format: "yarramate/visual-session-started/v1";
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly authority: VisualAuthority;
  readonly title: string;
  readonly chatEnabled: boolean;
  readonly browserUrl: string;
  readonly webSocketUrl: string;
  readonly origin: string;
  readonly descriptorPath: string;
  readonly sessionRoot: string;
  readonly capabilities: VisualCapabilities;
  readonly startedAt: string;
}

export interface VisualSessionDescriptor {
  readonly format: "yarramate/visual-session-descriptor/v1";
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly origin: string;
  readonly agentCapability: string;
  readonly sessionRoot: string;
  readonly journalPath: string;
  readonly createdAt: string;
}

export interface VisualChatMessagePayload {
  readonly text: string;
}

export interface VisualChoiceSelectedPayload {
  readonly choiceId: string;
  readonly optionId: string;
}

export interface VisualViewNavigatePayload {
  readonly viewId: string;
  readonly requiresAttention: boolean;
}

export interface VisualViewSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly query: ProjectionQuery;
  readonly presentation: ProjectionDefinition["presentation"];
}

export interface VisualKindOption {
  readonly id: string;
  readonly label: string;
}

export interface VisualFilterQueryPayload {
  readonly query: ProjectionQuery;
}

export interface VisualFilterResultPayload {
  readonly query: ProjectionQuery;
  readonly matchedIds: readonly string[];
}

export interface VisualViewSavePayload {
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly query: ProjectionQuery;
  readonly presentation: ProjectionDefinition["presentation"];
}

export interface VisualLayoutPositions {
  readonly [subjectId: string]: { readonly x: number; readonly y: number };
}

export interface VisualChangesetCommitPayload {
  readonly operations: readonly YarramateOperation[];
}

export interface VisualLayoutSavePayload {
  readonly projectionId: string;
  readonly positions: VisualLayoutPositions;
}

/**
 * Terminal event payload. Every reason is the runtime's to choose: only it
 * knows whether a session ended by request, by a failing child, by a browser
 * that never came back, or by its own cancellation.
 */
export interface VisualSessionEndPayload {
  readonly reason: VisualTerminationReason;
}

/** End as an untrusted browser may ask for it, and nothing more. */
export interface VisualBrowserSessionEndPayload {
  readonly reason: "user-ended";
}

export interface VisualBrowserConnectedPayload {
  readonly connectionId: string;
}

export interface VisualBrowserDisconnectedPayload {
  readonly connectionId: string;
  readonly code: number;
}

/**
 * Untrusted browser message. The runtime owns session identifiers, sequence
 * numbers, event identifiers, and timestamps, so the browser may send only a
 * discriminant, the last sequence it saw acknowledged, and its payload.
 *
 * `lastAcknowledgedSequence` is the browser's own view of the journal, carried
 * on every frame so a session that reconnected mid-turn can be told it is
 * ahead of the journal it claims to have read. It is 0 before the first
 * acknowledgement, and never authorises anything: admission still assigns the
 * sequence and event identifier.
 */
export type VisualBrowserInput =
  | {
      readonly type: "chat.message";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualChatMessagePayload;
    }
  | {
      readonly type: "choice.selected";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualChoiceSelectedPayload;
    }
  | {
      readonly type: "view.navigate";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualViewNavigatePayload;
    }
  | {
      readonly type: "filter.query";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualFilterQueryPayload;
    }
  | {
      readonly type: "view.save";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualViewSavePayload;
    }
  | {
      readonly type: "changeset.commit";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualChangesetCommitPayload;
    }
  | {
      readonly type: "layout.save";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualLayoutSavePayload;
    }
  | {
      readonly type: "session.end";
      readonly lastAcknowledgedSequence: number;
      readonly payload: VisualBrowserSessionEndPayload;
    };

interface VisualEventEnvelope<Type extends string, Payload> {
  readonly format: "yarramate/visual-event/v1";
  readonly sessionId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly type: Type;
  readonly timestamp: string;
  readonly payload: Payload;
}

export type VisualEvent =
  | VisualEventEnvelope<"chat.message", VisualChatMessagePayload>
  | VisualEventEnvelope<"choice.selected", VisualChoiceSelectedPayload>
  | VisualEventEnvelope<"view.navigate", VisualViewNavigatePayload>
  | VisualEventEnvelope<"session.end", VisualSessionEndPayload>
  | VisualEventEnvelope<"browser.connected", VisualBrowserConnectedPayload>
  | VisualEventEnvelope<
      "browser.disconnected",
      VisualBrowserDisconnectedPayload
    >
  | VisualEventEnvelope<"filter.query", VisualFilterQueryPayload>
  | VisualEventEnvelope<"view.save", VisualViewSavePayload>
  | VisualEventEnvelope<"changeset.commit", VisualChangesetCommitPayload>
  | VisualEventEnvelope<"layout.save", VisualLayoutSavePayload>;

export interface VisualChatResponsePayload {
  readonly text: string;
  readonly appliedQuery?: VisualFilterResultPayload;
}

export interface VisualAgentStatusPayload {
  readonly state: "thinking" | "compiling" | "waiting" | "idle";
  readonly detail?: string;
}

export interface VisualChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface VisualChoicePresentPayload {
  readonly choiceId: string;
  readonly question: string;
  readonly options: readonly VisualChoiceOption[];
}

export interface VisualHandoffSummary {
  readonly summary: string;
  readonly confirmedDecisions: readonly string[];
  readonly requestedChanges: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly finalViews: readonly string[];
}

export interface VisualDiagnosticPayload {
  readonly diagnostics: readonly VisualDiagnostic[];
}

export type VisualViewSaveResultPayload =
  | { readonly ok: true; readonly id: string; readonly path: string }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] };

export type VisualApplyResultPayload =
  | { readonly ok: true; readonly result: YarramateApplyResult }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] };

export type VisualLayoutSaveResultPayload =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

interface VisualResponseEnvelope<Type extends string, Payload> {
  readonly format: "yarramate/visual-response/v1";
  readonly sessionId: string;
  readonly responseId: string;
  readonly eventId: string;
  readonly type: Type;
  readonly timestamp: string;
  readonly payload: Payload;
}

export type VisualResponse =
  | VisualResponseEnvelope<"chat.response", VisualChatResponsePayload>
  | VisualResponseEnvelope<"agent.status", VisualAgentStatusPayload>
  | VisualResponseEnvelope<"choice.present", VisualChoicePresentPayload>
  | VisualResponseEnvelope<"handoff.complete", VisualHandoffSummary>
  | VisualResponseEnvelope<"diagnostic", VisualDiagnosticPayload>;

export type VisualHandoffDecision = "completed" | "cancelled" | "failed";

export type VisualTerminationReason =
  | "user-ended"
  | "child-failed"
  | "browser-timeout"
  | "main-cancelled"
  | "server-failed"
  | "compiler-failed";

export interface VisualHandoff extends VisualHandoffSummary {
  readonly format: "yarramate/visual-handoff/v1";
  readonly sessionId: string;
  readonly authority: VisualAuthority;
  readonly decision: VisualHandoffDecision;
  readonly terminationReason: VisualTerminationReason;
  readonly lastSequence: number;
  readonly transcriptPath: string;
  readonly transcript?: readonly (VisualEvent | VisualResponse)[];
  readonly completedAt: string;
}

export type VisualLifecycle = "starting" | "running" | "draining" | "stopped";

export type VisualFreezeReason =
  | "message-bytes"
  | "model-bytes"
  | "transcript-bytes"
  | "pending-events"
  | "browser-disconnected"
  | "terminal-event"
  | "recompile-failed";

export interface VisualStatus {
  readonly format: "yarramate/visual-status/v1";
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly lifecycle: VisualLifecycle;
  readonly alreadyStopped: boolean;
  readonly server: {
    readonly listening: boolean;
    readonly origin: string;
  };
  readonly browser: {
    readonly connected: boolean;
    readonly connections: number;
    readonly lastSeenAt?: string;
    readonly graceExpiresAt?: string;
  };
  readonly agent: {
    readonly attached: boolean;
    readonly inFlightEventId: string | null;
  };
  readonly queue: {
    readonly pendingEvents: number;
    readonly lastSequence: number;
    readonly frozen: boolean;
    readonly frozenReason?: VisualFreezeReason;
  };
  readonly capabilities: VisualCapabilities;
  readonly transcriptBytes: number;
  readonly updatedAt: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] };
