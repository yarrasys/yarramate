import {
  VISUAL_LIMITS,
  type VisualAgentStatusPayload,
  type VisualAuthority,
  type VisualBrowserInput,
  type VisualChoicePresentPayload,
  type VisualDiagnostic,
  type VisualHandoffSummary,
  type VisualLayoutSavePayload,
  type VisualLayoutSaveResultPayload,
  type VisualViewSavePayload,
  type VisualViewSaveResultPayload,
  type VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";

import type { YarramateOperation } from "../operations.js";
import type { ProjectionQuery } from "../projection.js";
import type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
  VisualTranscriptRecord,
} from "../adapters/visual/wire.js";

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
export const RECONNECT_WINDOW_MS = VISUAL_LIMITS.reconnectMs;

/** Shown the moment End is requested, and kept in the record. */
export const VISUAL_END_NOTICE = "Returning control to the main agent";

export type VisualAppLifecycle =
  "connecting" | "active" | "ending" | "disconnected" | "closed";

/**
 * The session speaks too: it is the browser, not the agent, that tells the
 * reviewer control is going back.
 */
export type VisualAppSpeaker = VisualTranscriptRecord["speaker"] | "session";

export interface VisualAppRecord extends Omit<
  VisualTranscriptRecord,
  "speaker"
> {
  readonly speaker: VisualAppSpeaker;
}

/** The part of the server snapshot that decides what the browser renders. */
export interface VisualAppSnapshot {
  readonly authority: VisualAuthority;
  readonly title: string;
  readonly description: string;
  readonly chatEnabled: boolean;
  readonly model: VisualRenderedModel;
  readonly transcript: readonly VisualTranscriptRecord[];
  readonly agentTurnOpen: boolean;
  readonly choices: VisualChoicePresentPayload | null;
  readonly styleNonce: string;
  readonly lastSequence: number;
  readonly frozen: boolean;
  readonly views: readonly VisualViewSummary[];
}

export interface VisualAppState {
  readonly lifecycle: VisualAppLifecycle;
  readonly authority: VisualAuthority;
  readonly title: string;
  readonly description: string;
  readonly chatEnabled: boolean;
  /** Last model that compiled. A failed candidate never replaces it. */
  readonly model: VisualRenderedModel | null;
  readonly styleNonce: string;
  readonly activeView: string;
  readonly transcript: readonly VisualAppRecord[];
  readonly views: readonly VisualViewSummary[];
  readonly choices: VisualChoicePresentPayload | null;
  readonly agentStatus: VisualAgentStatusPayload | null;
  readonly diagnostics: readonly VisualDiagnostic[];
  readonly handoff: VisualHandoffSummary | null;
  readonly composerEnabled: boolean;
  readonly awaitingAgent: boolean;
  /** Records this browser has written itself, so a key is never reused. */
  readonly localRecords: number;
  readonly lastSequence: number;
  readonly frozen: boolean;
  /** The last query the reviewer applied, and what it matched. `null` = unfiltered. */
  readonly activeFilter: {
    readonly query: ProjectionQuery;
    readonly matchedIds: readonly string[];
    readonly source: "view" | "panel" | "chat";
  } | null;
  /** Client-side substring narrowing layered on top of `activeFilter`. */
  readonly quickFilterText: string;
  readonly closedReason: string | null;
  /** The save in flight, so the panel can disable itself and the result can
   * be matched back to what it named — the result carries only an id. */
  readonly pendingViewSave: VisualViewSavePayload | null;
  /** Shown once a save lands ok, until the reviewer dismisses it or a fresh
   * save starts. */
  readonly viewSaveNotice: boolean;
  /** Operations staged for commit; replaces on same-field re-edit. */
  readonly pendingChangeset: {
    readonly operations: readonly YarramateOperation[];
  };
  /** Idle when no commit in flight; committing while waiting for apply-result. */
  readonly commitStatus: "idle" | "committing";
  /** Diagnostics from the most recent failed commit; null when idle or on success. */
  readonly commitDiagnostics: readonly VisualDiagnostic[] | null;
  /** The document list the server reported for the last successful commit -
   * never an optimistic local guess. Cleared when a fresh edit is staged. */
  readonly commitNotice: readonly string[] | null;
  /** Transient notice from layout.save success/failure, cleared on next save. */
  readonly layoutNotice: string | null;
}

export type VisualAppAction =
  | { readonly type: "session.loaded"; readonly snapshot: VisualAppSnapshot }
  | { readonly type: "model.received"; readonly model: VisualRenderedModel }
  | {
      readonly type: "diagnostic.received";
      readonly diagnostics: readonly VisualDiagnostic[];
    }
  | { readonly type: "chat.sent"; readonly text: string }
  | {
      readonly type: "chat.received";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly type: "status.received";
      readonly status: VisualAgentStatusPayload;
    }
  | {
      readonly type: "choice.presented";
      readonly choice: VisualChoicePresentPayload;
    }
  | { readonly type: "choice.sent"; readonly optionId: string }
  | { readonly type: "view.navigated"; readonly viewId: string }
  | {
      readonly type: "filter.applied";
      readonly query: ProjectionQuery;
      readonly matchedIds: readonly string[];
      readonly source: "view" | "panel" | "chat";
    }
  | { readonly type: "filter.cleared" }
  | { readonly type: "quickFilter.changed"; readonly text: string }
  | { readonly type: "view.save.sent"; readonly payload: VisualViewSavePayload }
  | {
      readonly type: "view.saved";
      readonly result: VisualViewSaveResultPayload;
    }
  | { readonly type: "view.saveNotice.dismissed" }
  | {
      readonly type: "changeset.staged";
      readonly operation: YarramateOperation;
    }
  | { readonly type: "changeset.discarded"; readonly index: number }
  | { readonly type: "changeset.cleared" }
  | { readonly type: "changeset.commit.sent" }
  | {
      readonly type: "changeset.committed";
      readonly documents: readonly string[];
    }
  | {
      readonly type: "apply.failed";
      readonly diagnostics: readonly VisualDiagnostic[];
    }
  | {
      readonly type: "layout.saved";
      readonly result: VisualLayoutSaveResultPayload;
    }
  | {
      readonly type: "handoff.received";
      readonly id: string;
      readonly handoff: VisualHandoffSummary;
    }
  | { readonly type: "event.acknowledged"; readonly sequence: number }
  | {
      readonly type: "input.refused";
      readonly diagnostics: readonly VisualDiagnostic[];
      readonly frozen: boolean;
    }
  | { readonly type: "end.requested" }
  | { readonly type: "connection.lost" }
  | { readonly type: "session.closed"; readonly reason: string };

export const initialVisualAppState: VisualAppState = {
  lifecycle: "connecting",
  authority: "canonical",
  title: "",
  description: "",
  chatEnabled: false,
  model: null,
  styleNonce: "",
  activeView: "",
  transcript: [],
  views: [],
  choices: null,
  agentStatus: null,
  diagnostics: [],
  handoff: null,
  composerEnabled: false,
  awaitingAgent: false,
  localRecords: 0,
  lastSequence: 0,
  frozen: false,
  activeFilter: null,
  quickFilterText: "",
  closedReason: null,
  pendingViewSave: null,
  viewSaveNotice: false,
  pendingChangeset: { operations: [] },
  commitStatus: "idle",
  commitDiagnostics: null,
  commitNotice: null,
  layoutNotice: null,
};

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
  choices: snapshot.pendingChoice,
  styleNonce: snapshot.styleNonce,
  lastSequence: snapshot.lastSequence,
  frozen: snapshot.frozen,
  views: snapshot.views,
});

/**
 * A dropped socket is recoverable only while the server still holds the
 * session. Past the grace it has already recovered the handoff, so retrying
 * would only spend the reviewer's attention on a session that no longer exists.
 */
export const canReconnect = (lostAt: number, now: number): boolean =>
  now - lostAt < RECONNECT_WINDOW_MS;

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
});

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
    : [...state.transcript, record];

/** The view the reviewer keeps, or the one the new model opens on. */
const viewWithin = (model: VisualRenderedModel): string => model.initialView;

/**
 * The turn is over. The composer reopens, and the status the agent reported
 * while it worked is dropped: nobody may be told the agent is still thinking
 * about a question it has answered.
 */
const turnAnswered = { awaitingAgent: false, agentStatus: null } as const;

/** Derive a unique key for an operation target (address + changed field names).
 * Operations targeting the same subject and field should replace rather than queue.
 * Concepts and relationships are addressed by `id`; an overlay observation has
 * none and is addressed by the pair (target, key) that `apply` matches on.
 */
const changesetTargetKey = (op: YarramateOperation): string => {
  const changedFields = (payload: object, address: readonly string[]) =>
    Object.keys(payload)
      .filter((k) => !address.includes(k))
      .sort()
      .join(":");
  if ("concept" in op) {
    const concept = op.concept;
    return `${op.op}:${op.document}:concept:${concept.id}:${changedFields(concept, ["id"])}`;
  }
  if ("relationship" in op) {
    const relationship = op.relationship;
    return `${op.op}:${op.document}:relationship:${relationship.id}:${changedFields(relationship, ["id"])}`;
  }
  const observation = op.observation;
  const address = `${observation.subject ?? observation.claim}:${observation.key ?? ""}`;
  return `${op.op}:${op.document}:observation:${address}:${changedFields(
    observation,
    ["subject", "claim", "key"],
  )}`;
};

const transition = (
  state: VisualAppState,
  action: VisualAppAction,
): VisualAppState => {
  switch (action.type) {
    case "session.loaded":
      return {
        ...state,
        ...action.snapshot,
        // A reconnect re-sends the snapshot, and it reports what the session
        // holds — never that a session the reviewer already ended is open.
        lifecycle: state.lifecycle === "ending" ? "ending" : "active",
        activeView: viewWithin(action.snapshot.model),
        // The session owns what was said; this browser owns only what it told
        // the reviewer itself, so a reload restores the record and keeps its
        // own notices.
        transcript: [
          ...action.snapshot.transcript,
          ...state.transcript.filter((record) => record.speaker === "session"),
        ],
        // The session knows whether the turn is still open; a browser that was
        // away while the agent answered must not stay locked out, and one that
        // reconnects mid-turn must not be told the agent is idle.
        awaitingAgent: action.snapshot.agentTurnOpen,
        agentStatus: action.snapshot.agentTurnOpen ? state.agentStatus : null,
        lastSequence: Math.max(
          state.lastSequence,
          action.snapshot.lastSequence,
        ),
        // A reconnect must not resurrect an in-flight save from before the
        // socket dropped, nor replay a notice for one that already landed.
        pendingViewSave: null,
        viewSaveNotice: false,
      };
    case "model.received":
      // Mid-session model frames replace the compilation; preserve the
      // reviewer's current view, filter, and search state across edits.
      return {
        ...state,
        model: action.model,
        diagnostics: [],
      };
    case "diagnostic.received":
      // The candidate that failed is gone; what is on screen still compiled.
      // One failure has as many reasons as it has, and the reviewer reads all
      // of them: keeping only the last would hide the one they need.
      return {
        ...state,
        diagnostics: action.diagnostics,
        ...turnAnswered,
      };
    case "chat.sent":
      return {
        ...state,
        transcript: withRecord(
          state,
          localRecord(state, "reviewer", action.text),
        ),
        localRecords: state.localRecords + 1,
        choices: null,
        awaitingAgent: true,
      };
    case "chat.received":
      return {
        ...state,
        transcript: withRecord(state, {
          id: action.id,
          speaker: "agent",
          text: action.text,
        }),
        ...turnAnswered,
      };
    case "status.received":
      return { ...state, agentStatus: action.status };
    case "choice.presented":
      return { ...state, choices: action.choice, ...turnAnswered };
    case "choice.sent": {
      const chosen = state.choices?.options.find(
        (option) => option.id === action.optionId,
      );
      if (chosen === undefined) return state;
      return {
        ...state,
        transcript: withRecord(
          state,
          localRecord(state, "reviewer", chosen.label),
        ),
        localRecords: state.localRecords + 1,
        choices: null,
        awaitingAgent: true,
      };
    }
    case "view.navigated":
      // Drill-down is local: the reviewer never waits for the agent to redraw.
      return state.activeView === action.viewId
        ? state
        : { ...state, activeView: action.viewId };
    case "handoff.received":
      return {
        ...state,
        handoff: action.handoff,
        transcript: withRecord(state, {
          id: action.id,
          speaker: "agent",
          text: action.handoff.summary,
        }),
        ...turnAnswered,
      };
    case "event.acknowledged":
      return {
        ...state,
        lastSequence: Math.max(state.lastSequence, action.sequence),
      };
    case "input.refused":
      return {
        ...state,
        diagnostics: action.diagnostics,
        frozen: state.frozen || action.frozen,
        // A refused frame never produces a `view-save-result`, so the save
        // that was in flight has to be retired here or the control stays
        // disabled for the rest of the session.
        pendingViewSave: null,
        ...turnAnswered,
      };
    case "end.requested":
      return {
        ...state,
        lifecycle: "ending",
        choices: null,
        transcript: withRecord(
          state,
          localRecord(state, "session", VISUAL_END_NOTICE),
        ),
        localRecords: state.localRecords + 1,
      };
    case "connection.lost":
      return { ...state, lifecycle: "disconnected" };
    case "session.closed":
      return { ...state, lifecycle: "closed", closedReason: action.reason };
    case "filter.applied":
      return {
        ...state,
        activeFilter: {
          query: action.query,
          matchedIds: action.matchedIds,
          source: action.source,
        },
      };
    case "filter.cleared":
      // Clearing the filter also leaves whatever named view was active -
      // the reviewer is back on the unfiltered "All" view, not a stale one.
      return { ...state, activeFilter: null, activeView: "" };
    case "quickFilter.changed":
      return state.quickFilterText === action.text
        ? state
        : { ...state, quickFilterText: action.text };
    case "view.save.sent":
      return {
        ...state,
        pendingViewSave: action.payload,
        viewSaveNotice: false,
      };
    case "view.saved": {
      if (!action.result.ok) {
        // The failed candidate names nothing new; what was saved before, if
        // anything, is unchanged. Every reason it failed is shown, verbatim.
        return {
          ...state,
          diagnostics: action.result.diagnostics,
          pendingViewSave: null,
        };
      }
      const pending = state.pendingViewSave;
      // A result with nothing pending names a save this browser never sent —
      // stale or duplicated, either way nothing here to build a summary from.
      if (pending === null) return state;
      const saved: VisualViewSummary = {
        id: action.result.id,
        title: pending.title,
        description: pending.description,
        query: pending.query,
        presentation: pending.presentation,
      };
      const existingIndex = state.views.findIndex(
        (view) => view.id === saved.id,
      );
      return {
        ...state,
        views:
          existingIndex === -1
            ? [...state.views, saved]
            : state.views.map((view, index) =>
                index === existingIndex ? saved : view,
              ),
        viewSaveNotice: true,
        pendingViewSave: null,
      };
    }
    case "view.saveNotice.dismissed":
      return { ...state, viewSaveNotice: false };
    case "changeset.staged": {
      // Replacing: if an operation targets the same subject and field, remove the old one.
      const key = changesetTargetKey(action.operation);
      const filtered = state.pendingChangeset.operations.filter(
        (op) => changesetTargetKey(op) !== key,
      );
      return {
        ...state,
        pendingChangeset: {
          operations: [...filtered, action.operation],
        },
        commitDiagnostics: null,
        // A fresh edit makes the last commit's receipt stale, not wrong: drop it.
        commitNotice: null,
      };
    }
    case "changeset.discarded": {
      const { index } = action;
      if (index < 0 || index >= state.pendingChangeset.operations.length) {
        return state;
      }
      return {
        ...state,
        pendingChangeset: {
          operations: state.pendingChangeset.operations.filter(
            (_, i) => i !== index,
          ),
        },
      };
    }
    case "changeset.cleared":
      return {
        ...state,
        pendingChangeset: { operations: [] },
        commitDiagnostics: null,
      };
    case "changeset.commit.sent":
      // The button locks the moment the frame leaves, so one changeset cannot be
      // committed twice while the runtime is still validating the first attempt.
      return { ...state, commitStatus: "committing", commitDiagnostics: null };
    case "changeset.committed":
      return {
        ...state,
        pendingChangeset: { operations: [] },
        commitStatus: "idle",
        commitDiagnostics: null,
        commitNotice: action.documents,
      };
    case "apply.failed":
      return {
        ...state,
        commitStatus: "idle",
        commitDiagnostics: action.diagnostics,
      };
    case "layout.saved": {
      const notice = action.result.ok ? "Layout saved" : action.result.message;
      return {
        ...state,
        layoutNotice: notice,
      };
    }
  }
};

/**
 * Whether the reviewer may type. Derived rather than assigned, so no transition
 * can leave a live session with dead controls or a closed one with live ones.
 */
const composerOpen = (state: VisualAppState): boolean =>
  state.lifecycle === "active" &&
  state.chatEnabled &&
  !state.frozen &&
  !state.awaitingAgent;

export function visualAppReducer(
  state: VisualAppState,
  action: VisualAppAction,
): VisualAppState {
  // A closed session is the end of the record: the server has already recovered
  // the handoff, so nothing that arrives afterwards may change what it says.
  if (state.lifecycle === "closed") return state;
  const next = transition(state, action);
  if (next === state) return state;
  return { ...next, composerEnabled: composerOpen(next) };
}

/** Everything the reviewer can ask the session to do. */
export type VisualAppIntent =
  | { readonly kind: "chat"; readonly text: string }
  | {
      readonly kind: "choice";
      readonly choiceId: string;
      readonly optionId: string;
    }
  | { readonly kind: "navigate"; readonly viewId: string }
  | { readonly kind: "end" }
  | { readonly kind: "filter"; readonly query: ProjectionQuery }
  | { readonly kind: "save-view"; readonly payload: VisualViewSavePayload }
  | { readonly kind: "commit-changeset" }
  | { readonly kind: "save-layout"; readonly payload: VisualLayoutSavePayload };

/**
 * One intent as the frame the server admits. Every frame carries the sequence
 * this browser last saw acknowledged, so a session that reconnected mid-turn
 * cannot slip a frame in behind a journal it never read.
 */
export const visualBrowserInputFor = (
  intent: VisualAppIntent,
  state: VisualAppState,
): VisualBrowserInput => {
  const lastAcknowledgedSequence = state.lastSequence;
  switch (intent.kind) {
    case "chat":
      return {
        type: "chat.message",
        lastAcknowledgedSequence,
        payload: { text: intent.text },
      };
    case "choice":
      return {
        type: "choice.selected",
        lastAcknowledgedSequence,
        payload: { choiceId: intent.choiceId, optionId: intent.optionId },
      };
    case "navigate":
      return {
        type: "view.navigate",
        lastAcknowledgedSequence,
        // Drill-down is the reviewer reading, not a question: the agent is told
        // where they went without being asked to answer for it.
        payload: { viewId: intent.viewId, requiresAttention: false },
      };
    case "end":
      return {
        type: "session.end",
        lastAcknowledgedSequence,
        payload: { reason: "user-ended" },
      };
    case "filter":
      return {
        type: "filter.query",
        lastAcknowledgedSequence,
        payload: { query: intent.query },
      };
    case "save-view":
      return {
        type: "view.save",
        lastAcknowledgedSequence,
        payload: intent.payload,
      };
    case "commit-changeset":
      return {
        type: "changeset.commit",
        lastAcknowledgedSequence,
        payload: { operations: state.pendingChangeset.operations },
      };
    case "save-layout":
      return {
        type: "layout.save",
        lastAcknowledgedSequence,
        payload: intent.payload,
      };
  }
};

/**
 * One server frame as the actions it means. Translation is pure so the socket
 * owns nothing but the socket.
 */
export const visualAppActionsForFrame = (
  frame: VisualServerFrame,
): readonly VisualAppAction[] => {
  switch (frame.kind) {
    case "ready":
      return [
        {
          type: "session.loaded",
          snapshot: visualAppSnapshotFrom(frame.snapshot),
        },
      ];
    case "accepted":
      return [{ type: "event.acknowledged", sequence: frame.sequence }];
    case "rejected":
      // One refusal, however many reasons it carries.
      return [
        {
          type: "input.refused",
          diagnostics: frame.diagnostics,
          frozen: frame.frozen !== undefined,
        },
      ];
    case "model":
      return [{ type: "model.received", model: frame.model }];
    case "closing":
      return [{ type: "session.closed", reason: frame.reason }];
    case "filter-result":
      return [
        {
          type: "filter.applied",
          query: frame.result.query,
          matchedIds: frame.result.matchedIds,
          source: "panel",
        },
      ];
    case "view-save-result":
      return [{ type: "view.saved", result: frame.result }];
    case "response":
      switch (frame.response.type) {
        case "chat.response": {
          const actions: VisualAppAction[] = [
            {
              type: "chat.received",
              id: frame.response.responseId,
              text: frame.response.payload.text,
            },
          ];
          if (frame.response.payload.appliedQuery) {
            actions.push({
              type: "filter.applied",
              query: frame.response.payload.appliedQuery.query,
              matchedIds: frame.response.payload.appliedQuery.matchedIds,
              source: "chat",
            });
          }
          return actions;
        }
        case "agent.status":
          return [{ type: "status.received", status: frame.response.payload }];
        case "choice.present":
          return [{ type: "choice.presented", choice: frame.response.payload }];
        case "handoff.complete":
          return [
            {
              type: "handoff.received",
              id: frame.response.responseId,
              handoff: frame.response.payload,
            },
          ];
        case "diagnostic":
          return [
            {
              type: "diagnostic.received",
              diagnostics: frame.response.payload.diagnostics,
            },
          ];
      }
    case "apply-result": {
      const actions: VisualAppAction[] = [];
      if (frame.result.ok) {
        actions.push({
          type: "changeset.committed",
          documents: frame.result.result.documents,
        });
      } else {
        actions.push({
          type: "apply.failed",
          diagnostics: frame.result.diagnostics,
        });
      }
      return actions;
    }
    case "layout-save-result":
      return [{ type: "layout.saved", result: frame.result }];
  }
};
