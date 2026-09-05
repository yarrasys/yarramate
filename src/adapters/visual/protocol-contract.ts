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
import type { NestingKind } from "../../nesting.js";
import type {
  YarramateApplyResult,
  YarramateOperation,
} from "../../operations.js";
import type {
  ProjectionDefinition,
  ProjectionExclusion,
  ProjectionQuery,
} from "../../projection.js";

/**
 * The wire this adapter speaks. v5 makes a view a staged change rather than an
 * immediate write (ADR 0103): a commit carries `viewOperations` beside its
 * model operations, a model frame carries the projection digests those
 * operations pin against, and the `view.save` event that wrote a projection
 * the moment it was composed is gone. A v4 peer and a v5 peer refuse each
 * other at the first document exchanged.
 *
 * v4 retyped every path-carrying field from a bare native string to a
 * canonical local `file:` URI (ADR 0096).
 */
export const VISUAL_PROTOCOL_VERSION = "yarramate/visual-protocol/v5" as const;

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
  /**
   * The subjects this diagnostic is about, most relevant first, when its
   * pointer names one (ADR 0102, extending the derivation Core added for
   * exactly this consumer).
   *
   * Absence is meaningful and is not "not yet populated": a diagnostic with no
   * subject belongs to no subject, such as a YAML parse failure, a
   * whole-document schema violation, a projection's own definition, or a
   * manifest. That is what lets a canvas route one to an element and the other
   * to a lane of its own, rather than showing a failure with nothing marked.
   */
  readonly subjects?: readonly string[];
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
  readonly format: "yarramate/visual-session-started/v2";
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly authority: VisualAuthority;
  readonly title: string;
  readonly chatEnabled: boolean;
  readonly browserUrl: string;
  readonly webSocketUrl: string;
  readonly origin: string;
  /** Canonical local `file:` URI. Copy it back verbatim as the argument to
   * `wait`/`respond`/`status`/`recover`/`stop`; it is never hand-typed as a
   * native path. Minted by `toWireFileUri`, read by `fromWireFileUri`. */
  readonly descriptorPath: string;
  /** Canonical local `file:` URI, as `descriptorPath`. */
  readonly sessionRoot: string;
  readonly capabilities: VisualCapabilities;
  readonly startedAt: string;
}

export interface VisualSessionDescriptor {
  readonly format: "yarramate/visual-session-descriptor/v2";
  readonly protocolVersion: typeof VISUAL_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly origin: string;
  readonly agentCapability: string;
  /** Canonical local `file:` URI. Proven against the session actually opened
   * before `agentCapability` is ever spent. */
  readonly sessionRoot: string;
  /** Canonical local `file:` URI, as `sessionRoot`. */
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
  /**
   * Manifest-relative path of the projection document this view was read from,
   * as `VisualRenderedModel.documents` names a document — not the `file:` URI
   * ADR 0096 mints for the descriptor and session root, which name things
   * outside the workspace.
   *
   * The tree derives its folders from these paths, so a workspace that keeps
   * `current/` and `target/` projections in directories gets a foldered view
   * list without the projection format gaining a folder concept of its own.
   */
  readonly path: string;
  /**
   * How many subjects this view's query matches, resolved by the runtime the
   * way `filter.query` is: a `ProjectionQuery` needs the semantic graph, which
   * the browser does not have. Recomputed and re-sent whenever the workspace
   * recompiles, since landing a changeset moves these counts.
   */
  readonly subjectCount: number;
}

/**
 * One pattern a browser may offer, with everything a form needs to ask for its
 * parts (#473 phase 4, ADR 0146).
 *
 * Built in `workspace-model.ts` so both hosts agree, for the reason the
 * containment tree is: two derivations of what a pattern holds would be two
 * answers to one question.
 */
export interface VisualPatternOption {
  /** The concept kind that IS this pattern. */
  readonly kind: string;
  readonly label: string;
  /** The core kind the pattern's own kind descends from. */
  readonly coreLabel: string;
  /** The pattern document that declared it, by path. */
  readonly document: string;
  /** The profile's display name for the kind, where it authored one. */
  readonly name?: string;
  readonly slots: readonly {
    readonly name: string;
    readonly required: boolean;
    readonly wiring: "owned" | "context" | "unwired";
    /**
     * The kind LABELS this slot accepts, descendants already resolved.
     *
     * Resolved here rather than in the browser because it needs the lineage
     * map: a slot declaring `kindMatching: descendants` admits a family, and a
     * picker that offered only the declared kind would refuse subjects the
     * compiler accepts.
     */
    readonly admits: readonly string[];
  }[];
  readonly wiring: readonly {
    readonly from: string;
    readonly kind: string;
    readonly to: string;
  }[];
  readonly ports: readonly {
    readonly kind: string;
    readonly out: string;
    readonly in: string;
  }[];
}

export interface VisualKindOption {
  readonly id: string;
  readonly label: string;
  /**
   * The pattern this kind IS, which for a pattern kind is its own id (#473
   * phase 4). Absent on a kind no pattern declares, which is most of them.
   */
  readonly pattern?: string;
  /**
   * The display name the profile authored, where it authored one. `label`
   * stays the local id, because that is what a drag payload and an operation
   * carry and the two must not drift.
   */
  readonly name?: string;
  /**
   * The nearest core-profile kind this one descends from, as a label — the
   * same resolution `CanvasNode.coreKindLabel` and `CanvasEdge.coreKindLabel`
   * carry, for a kind nothing has been authored with yet.
   *
   * Without it a browser can read a palette but cannot judge it: the ArchiMate
   * table is keyed on core kinds, so an editor offering an extension kind has
   * no way to ask whether the pairing permits what that kind descends from,
   * and can put a `YM404` one click away. Equal to `label` for a core kind.
   */
  readonly coreLabel: string;
}

export interface VisualFilterQueryPayload {
  readonly query: ProjectionQuery;
  /**
   * The nesting the canvas is drawing with, when the browser knows it (#473
   * phase 2).
   *
   * Only `query.instances` reads it, and it must: the closure of an instance IS
   * the containment tree, so evaluating it under a different nesting than the
   * canvas answers a different question. On the ApertureX reference that is 15
   * subjects against 2.
   *
   * Optional, so an older browser and every filter that names no instance keep
   * working unchanged; absent, the evaluator falls back to the default nesting
   * exactly as it did before.
   */
  readonly nesting?: readonly NestingKind[];
}

export interface VisualFilterResultPayload {
  readonly query: ProjectionQuery;
  readonly matchedIds: readonly string[];
  /**
   * Every concept this query DROPPED, each with the facet that dropped it, as
   * `explainProjection` reports it. The editor needs it to say why a subject
   * is not on the canvas: a query that quietly drops the one subject the
   * reviewer was looking for is otherwise indistinguishable from a model that
   * does not hold it.
   *
   * A frame field, not a document field. `yarramate/projection-result/v1` is
   * `additionalProperties: false` and this is a question about a query rather
   * than part of what a projection IS, so the exclusions ride on the answer to
   * the question that asked for them and nowhere else.
   *
   * Relationships are absent by construction: they enter a view through their
   * endpoints rather than by matching a facet, so "why" for a relationship is
   * a statement about the concepts it joins.
   */
  readonly excluded: readonly ProjectionExclusion[];
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

/**
 * A change to a projection document, staged rather than written (ADR 0103).
 *
 * These ride beside the model's operations rather than inside them: Core holds
 * that a projection is never an operation's own target, and a view is
 * presentation rather than semantics. Atomicity does not come from sharing a
 * list - it comes from the runtime planning both and issuing one
 * `SourceStore.writeAll`, so a view and the subjects it shows land together or
 * not at all.
 *
 * `path` is manifest-relative, the way `VisualViewSummary.path` names it. A
 * `write-view` at a path the manifest's patterns do not cover is refused
 * rather than written, because a projection nothing loads is worse than a
 * refusal (ADR 0043).
 */
export type VisualViewOperation =
  | {
      readonly op: "write-view";
      readonly path: string;
      readonly projection: ProjectionDefinition;
    }
  | { readonly op: "delete-view"; readonly path: string };

export interface VisualChangesetCommitPayload {
  readonly operations: readonly YarramateOperation[];
  /**
   * Projection writes and removals landing in the same batch as `operations`.
   * Required, not optional, for the same reason `sourceDigests` is: a browser
   * that may omit it is one whose commits mean two different things.
   */
  readonly viewOperations: readonly VisualViewOperation[];
  /**
   * What the browser believed each targeted document held when the rows were
   * staged — sha256 keyed by manifest-relative path, pinned at staging time and
   * never refreshed while rows remain staged. The runtime refuses the batch when
   * a pin no longer matches the file, so a same-field overwrite of a write the
   * reviewer never saw cannot land silently (ADR 0093).
   *
   * Required, not optional: a browser that omits it is exactly the browser that
   * cannot detect the conflict, which is why this field is what makes the
   * protocol `v3`.
   *
   * One map covers both lists. On the model frame the two are kept apart,
   * because there they mean different things — what the graph was compiled
   * from, and what the views are — but a pin means the same thing for either:
   * what the browser expected to find on disk.
   */
  readonly sourceDigests: Readonly<Record<string, string>>;
}

export interface VisualLayoutSavePayload {
  readonly projectionId: string;
  readonly positions: VisualLayoutPositions;
  /**
   * What this view folds, saved beside the positions in ONE document (#473).
   *
   * Full state every time, never a patch. A half-applied fold state draws a
   * box whose contents are somewhere else on the canvas, and the sidecar is
   * written by a browser that may have been reloaded between any two saves.
   *
   * `unfolded` exists because the view's own `presentation.fold` is a default,
   * not a rule: a reader who opened a box must not have it close again when the
   * default is read back.
   */
  readonly folded?: readonly string[];
  readonly unfolded?: readonly string[];
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
  | VisualEventEnvelope<"changeset.commit", VisualChangesetCommitPayload>
  | VisualEventEnvelope<"layout.save", VisualLayoutSavePayload>;

/**
 * The filter a chat turn resolved to. The agent states `query` and nothing
 * else: the runtime evaluates it against the same graph a `filter.query`
 * event is evaluated against and fills `matchedIds` in before the response
 * is journaled or streamed (ADR 0090). `matchedIds` is optional so a
 * resolved response survives a transcript round-trip - an agent that sends
 * one is refused.
 */
export interface VisualChatAppliedQuery {
  readonly query: ProjectionQuery;
  readonly matchedIds?: readonly string[];
}

export interface VisualChatResponsePayload {
  readonly text: string;
  readonly appliedQuery?: VisualChatAppliedQuery;
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
  | {
      readonly ok: true;
      readonly id: string;
      readonly path: string;
      /**
       * What the saved query matches, stated by the side that can count it.
       * The browser builds the new view's summary from what it sent plus this
       * result, and a `ProjectionQuery` needs the semantic graph to resolve —
       * without this the row would join the tree claiming zero subjects.
       */
      readonly subjectCount: number;
    }
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
  readonly format: "yarramate/visual-handoff/v2";
  readonly sessionId: string;
  readonly authority: VisualAuthority;
  readonly decision: VisualHandoffDecision;
  readonly terminationReason: VisualTerminationReason;
  readonly lastSequence: number;
  /** Canonical local `file:` URI. */
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
