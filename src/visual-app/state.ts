import {
  VISUAL_LIMITS,
  type VisualAgentStatusPayload,
  type VisualAuthority,
  type VisualBrowserInput,
  type VisualChangesetCommitPayload,
  type VisualViewOperation,
  type VisualChoicePresentPayload,
  type VisualDiagnostic,
  type VisualHandoffSummary,
  type VisualLayoutSavePayload,
  type VisualLayoutSaveResultPayload,
  type VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";

import {
  composeProjection,
  enumeratesSubjects,
  sameDocument,
  withMembership,
} from "../adapters/visual/view-identity.js";
import type { YarramateOperation } from "../operations.js";
import type {
  ProjectionExclusion,
  ProjectionQuery,
} from "../projection.js";
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

/**
 * Who asked for the filter that is standing.
 *
 * `view` is a named view being applied; `editor` is that view's own query
 * being edited in the canvas panel, which is still THAT view and so leaves its
 * name standing; `panel` is an ad-hoc query belonging to no view; `chat` is the
 * agent's.
 */
export type FilterSource = "view" | "editor" | "panel" | "chat";

/** The standing filter: the query, what it matched, and who asked. */
export interface ActiveFilter {
  readonly query: ProjectionQuery;
  readonly matchedIds: readonly string[];
  /**
   * What the query dropped and why, or `null` when nobody reported it.
   *
   * A `filter-result` always carries the exclusions; a chat turn's
   * `appliedQuery` cannot - it is a schema-bound document requiring exactly
   * `query` and `matchedIds` (ADR 0090), and widening it would be a protocol
   * change to answer a question chat never asked. So `null` means unknown,
   * and the editor says nothing rather than reporting that a query dropped
   * nothing.
   */
  readonly excluded: readonly ProjectionExclusion[] | null;
  readonly source: FilterSource;
}

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
  readonly activeFilter: ActiveFilter | null;
  /** Client-side substring narrowing layered on top of `activeFilter`. */
  readonly quickFilterText: string;
  readonly closedReason: string | null;
  /**
   * Operations staged for commit; replaces on same-field re-edit. Typed as the
   * commit payload itself, so the tray holds exactly what the wire takes and
   * `sourceDigests` cannot drift from the rows it vouches for: each row pins the
   * digest of the document it targets as it is staged, and the pin is never
   * refreshed while the row is staged - a pin that followed the newest model
   * frame would agree with disk and let the overwrite through (ADR 0093).
   */
  readonly pendingChangeset: VisualChangesetCommitPayload;
  /** Prior `pendingChangeset` values, oldest first, for ordered undo. Whole
   * snapshots rather than inverse operations: staging replaces on the same
   * `(target, field)` key, so a re-edit destroys the value an inverse
   * operation would need to restore. The pins travel inside the snapshot, so an
   * undone row is restored still vouching for what it was staged against. Local
   * only - never on the wire, never persisted, and cleared once a batch lands,
   * because a landed batch is reverted with `git revert`, not from the browser. */
  readonly undoStack: readonly VisualChangesetCommitPayload[];
  /** Values taken off `undoStack`, most recently undone last. Any fresh
   * staging, discard or clear drops it: the reviewer took a new branch. */
  readonly redoStack: readonly VisualChangesetCommitPayload[];
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
  | {
      readonly type: "model.received";
      readonly model: VisualRenderedModel;
      /** Recounted against the graph that came with them. */
      readonly views: readonly VisualViewSummary[];
    }
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
      /** `null` where the answer did not carry them, never `[]`. */
      readonly excluded: readonly ProjectionExclusion[] | null;
      readonly source: FilterSource;
    }
  | { readonly type: "filter.cleared" }
  | { readonly type: "quickFilter.changed"; readonly text: string }
  | {
      readonly type: "changeset.staged";
      readonly operation: YarramateOperation;
    }
  | {
      readonly type: "changeset.viewStaged";
      readonly operation: VisualViewOperation;
    }
  /**
   * One subject into or out of one view's own membership list.
   *
   * Not a `write-view` composed by the caller, because a second membership
   * edit has to be composed on top of the first: rows replace by path, so a
   * caller that composed from the SAVED document would silently drop the
   * subject it staged a moment ago. The reducer holds both the saved views and
   * the pending rows, so composing here is the only place it cannot be
   * forgotten.
   */
  | {
      readonly type: "changeset.viewMembership";
      readonly viewId: string;
      readonly subjectId: string;
      readonly membership: "add" | "remove";
    }
  | { readonly type: "changeset.discarded"; readonly index: number }
  | { readonly type: "changeset.cleared" }
  | { readonly type: "changeset.undone" }
  | { readonly type: "changeset.redone" }
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
      /** Which input the server refused, when the frame was named enough to
       * say. Absent only for a frame that parsed as no known input at all. */
      readonly refused?: VisualBrowserInput["type"];
      readonly diagnostics: readonly VisualDiagnostic[];
      readonly frozen: boolean;
    }
  | { readonly type: "end.requested" }
  | { readonly type: "connection.lost" }
  | { readonly type: "session.closed"; readonly reason: string };

/**
 * A changeset with nothing in it. Named rather than repeated, because the day
 * the payload grows a third list is the day three literals silently disagree.
 */
export const EMPTY_CHANGESET: VisualChangesetCommitPayload = {
  operations: [],
  viewOperations: [],
  sourceDigests: {},
};

/**
 * Whether a changeset would land anything. Both lists count: a changeset
 * holding only a staged view is not an empty one, and every control that reads
 * "is there anything to commit" has to agree about that.
 */
export const changesetIsEmpty = (
  changeset: VisualChangesetCommitPayload,
): boolean =>
  changeset.operations.length === 0 && changeset.viewOperations.length === 0;

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
  pendingChangeset: EMPTY_CHANGESET,
  undoStack: [],
  redoStack: [],
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

/**
 * The digests a staged set vouches for: one per document its rows target, taken
 * from the model the row was staged against.
 *
 * An existing pin is kept rather than re-read, which is the whole point. A pin
 * refreshed from a newer model frame would match the file on disk and let a
 * same-field overwrite of a write the reviewer never saw land silently — the pin
 * has to keep saying what was on screen when the row was written (ADR 0093).
 * Documents no longer targeted drop out, so discarding the last row that named a
 * document stops vouching for it and cannot refuse a later commit on its behalf.
 */
const pinnedDigests = (
  operations: readonly YarramateOperation[],
  viewOperations: readonly VisualViewOperation[],
  previous: Readonly<Record<string, string>>,
  model: VisualRenderedModel | null,
): Readonly<Record<string, string>> => {
  const pins: Record<string, string> = {};
  const pin = (path: string, held: string | undefined): void => {
    if (pins[path] !== undefined) return;
    const pinned = previous[path] ?? held;
    // A document the model does not name is one the commit will create: there is
    // no prior value to be stale against, so it is left unpinned rather than
    // pinned to a digest nobody minted.
    if (pinned !== undefined) pins[path] = pinned;
  };
  for (const operation of operations) {
    pin(operation.document, model?.sourceDigests[operation.document]);
  }
  // A view pins against the projection digests, which are published as their
  // own map: `sourceDigests` means what the graph was compiled from, and a
  // projection is not part of that (ADR 0103).
  for (const operation of viewOperations) {
    pin(operation.path, model?.projectionDigests[operation.path]);
  }
  return pins;
};

/**
 * A changeset with one of its lists replaced and its pins recomputed.
 *
 * Every path that stages, discards or clears goes through here, so `sourceDigests`
 * cannot drift from the rows it vouches for - which is the invariant the whole
 * pin mechanism rests on, and one that three separate object literals would
 * lose the first time a fourth was added.
 */
const restage = (
  changeset: VisualChangesetCommitPayload,
  model: VisualRenderedModel | null,
  next: {
    readonly operations?: readonly YarramateOperation[];
    readonly viewOperations?: readonly VisualViewOperation[];
  },
): VisualChangesetCommitPayload => {
  const operations = next.operations ?? changeset.operations;
  const viewOperations = next.viewOperations ?? changeset.viewOperations;
  return {
    operations,
    viewOperations,
    sourceDigests: pinnedDigests(
      operations,
      viewOperations,
      changeset.sourceDigests,
      model,
    ),
  };
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
      };
    case "model.received":
      // Mid-session model frames replace the compilation; preserve the
      // reviewer's current view, filter, and search state across edits. The
      // view list is replaced rather than preserved: it is the same list,
      // recounted against the graph arriving with it.
      return {
        ...state,
        model: action.model,
        views: action.views,
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
    case "input.refused": {
      // A refused frame produces no result of its own, so whatever control was
      // disabled while it was in flight has to be retired here or it stays
      // dead for the rest of the session. The frame names which input died;
      // a frame that parsed as no known input names nothing, and every control
      // is retired rather than guessing which one to leave hanging.
      const died = (type: VisualBrowserInput["type"]) =>
        action.refused === undefined || action.refused === type;
      return {
        ...state,
        diagnostics: action.diagnostics,
        frozen: state.frozen || action.frozen,
        // The refusal is the commit's answer, and it points at the rows it
        // refused, so the tray shows it where the reviewer is already looking.
        ...(died("changeset.commit")
          ? {
              commitStatus: "idle" as const,
              commitDiagnostics: action.diagnostics,
            }
          : {}),
        ...(died("chat.message") || died("choice.selected")
          ? turnAnswered
          : {}),
      };
    }
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
          excluded: action.excluded,
          source: action.source,
        },
        // Only a view's own query leaves its name standing. A filter from the
        // panel or from chat draws something the named view does not describe,
        // so the tree stops claiming it rather than naming what is not shown.
        //
        // An `editor` filter is that view's query being edited, which is still
        // the same view: forgetting its name mid-edit would take away the very
        // document the edit is going to be staged against.
        activeView:
          action.source === "view" || action.source === "editor"
            ? state.activeView
            : "",
      };
    case "filter.cleared":
      // Clearing the filter also leaves whatever named view was active -
      // the reviewer is back on the unfiltered "All" view, not a stale one.
      return { ...state, activeFilter: null, activeView: "" };
    case "quickFilter.changed":
      return state.quickFilterText === action.text
        ? state
        : { ...state, quickFilterText: action.text };
    case "changeset.staged": {
      // Replacing: if an operation targets the same subject and field, remove the old one.
      const key = changesetTargetKey(action.operation);
      const filtered = state.pendingChangeset.operations.filter(
        (op) => changesetTargetKey(op) !== key,
      );
      const operations = [...filtered, action.operation];
      return {
        ...state,
        pendingChangeset: restage(state.pendingChangeset, state.model, {
          operations,
        }),
        undoStack: [...state.undoStack, state.pendingChangeset],
        redoStack: [],
        commitDiagnostics: null,
        // A fresh edit makes the last commit's receipt stale, not wrong: drop it.
        commitNotice: null,
      };
    }
    case "changeset.viewStaged": {
      // One row per document, the same rule the model's rows follow: saving
      // over a view already staged replaces that row rather than queueing a
      // second write of the same file. A delete replaces a pending write too -
      // the last thing said about a document is what the reviewer meant.
      const filtered = state.pendingChangeset.viewOperations.filter(
        (operation) => operation.path !== action.operation.path,
      );
      return {
        ...state,
        pendingChangeset: restage(state.pendingChangeset, state.model, {
          viewOperations: [...filtered, action.operation],
        }),
        undoStack: [...state.undoStack, state.pendingChangeset],
        redoStack: [],
        commitDiagnostics: null,
        commitNotice: null,
      };
    }
    case "changeset.viewMembership": {
      const view = state.views.find(({ id }) => id === action.viewId);
      if (view === undefined) return state;
      // On top of what is already staged for this document, or on the saved
      // document when nothing is.
      const pending = state.pendingChangeset.viewOperations.find(
        (operation) => operation.path === view.path,
      );
      const saved = composeProjection({
        id: view.id,
        title: view.title,
        description: view.description,
        query: view.query,
        presentation: view.presentation,
      });
      const base = pending?.op === "write-view" ? pending.projection : saved;
      const amended = withMembership(base, action.subjectId, action.membership);
      // A view that describes its subjects has nothing to be told, and a list
      // that already says this has nothing to change.
      if (amended === null) return state;
      const others = state.pendingChangeset.viewOperations.filter(
        (operation) => operation.path !== view.path,
      );
      // Back to what the workspace already holds: the row goes rather than
      // staging a write that changes nothing. The WHOLE document is compared,
      // not just the list, so a membership edit undone by hand leaves a rename
      // staged beneath it standing.
      const undone = sameDocument(amended, saved);
      return {
        ...state,
        pendingChangeset: restage(state.pendingChangeset, state.model, {
          viewOperations: undone
            ? others
            : [
                ...others,
                { op: "write-view", path: view.path, projection: amended },
              ],
        }),
        undoStack: [...state.undoStack, state.pendingChangeset],
        redoStack: [],
        commitDiagnostics: null,
        commitNotice: null,
      };
    }
    case "changeset.discarded": {
      // The tray shows one list, so the reviewer discards by one index. Which
      // of the two underlying lists that row came from is arithmetic, done
      // where the ordering is defined rather than guessed at by the caller.
      const { index } = action;
      const rows = state.pendingChangeset.operations.length;
      const total = rows + state.pendingChangeset.viewOperations.length;
      if (index < 0 || index >= total) return state;
      const next =
        index < rows
          ? {
              operations: state.pendingChangeset.operations.filter(
                (_, i) => i !== index,
              ),
            }
          : {
              viewOperations: state.pendingChangeset.viewOperations.filter(
                (_, i) => i !== index - rows,
              ),
            };
      return {
        ...state,
        pendingChangeset: restage(state.pendingChangeset, state.model, next),
        undoStack: [...state.undoStack, state.pendingChangeset],
        redoStack: [],
        // Diagnostics point at rows by index, so a shorter list mis-attributes them.
        commitDiagnostics: null,
      };
    }
    case "changeset.cleared": {
      // Clearing an already-empty changeset must not stack an undo step that
      // would restore the same empty list - and "empty" means both lists, or
      // clearing a changeset holding only a staged view would be unundoable.
      const empty = changesetIsEmpty(state.pendingChangeset);
      return {
        ...state,
        pendingChangeset: EMPTY_CHANGESET,
        undoStack: empty
          ? state.undoStack
          : [...state.undoStack, state.pendingChangeset],
        redoStack: empty ? state.redoStack : [],
        commitDiagnostics: null,
      };
    }
    case "changeset.undone": {
      const restored = state.undoStack.at(-1);
      if (restored === undefined) {
        return state;
      }
      return {
        ...state,
        pendingChangeset: restored,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.pendingChangeset],
        commitDiagnostics: null,
      };
    }
    case "changeset.redone": {
      const restored = state.redoStack.at(-1);
      if (restored === undefined) {
        return state;
      }
      return {
        ...state,
        pendingChangeset: restored,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, state.pendingChangeset],
        commitDiagnostics: null,
      };
    }
    case "changeset.commit.sent":
      // The button locks the moment the frame leaves, so one changeset cannot be
      // committed twice while the runtime is still validating the first attempt.
      return { ...state, commitStatus: "committing", commitDiagnostics: null };
    case "changeset.committed":
      // A landed batch is reverted with `git revert`, never resurrected here.
      return {
        ...state,
        pendingChangeset: EMPTY_CHANGESET,
        undoStack: [],
        redoStack: [],
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
    case "commit-changeset":
      return {
        type: "changeset.commit",
        lastAcknowledgedSequence,
        // The staged set is the payload: the rows and the digests they were
        // staged against travel together or the check they exist for is a lie.
        payload: state.pendingChangeset,
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
 * The filter to ask again once a frame has been applied, or `null`.
 *
 * A filter is resolved against the model the server held when it was asked,
 * and a landed commit replaces that model. Nothing re-asks on its own, so
 * `matchedIds` goes on describing the graph as it was: a subject the reviewer
 * just created is not in it, and the canvas hides every element the matched
 * set does not name. The commit reports success and the diagram does not
 * change. That needs no unusual view and no stale projection - only a filter
 * that was resolved once, which is every view a session opens on.
 *
 * This is a consequence of a frame arriving rather than of a render, which is
 * why it lives here beside `visualAppActionsForFrame` and not in an effect:
 * the same `model` frame that invalidates the matched set is the thing that
 * has to ask for a new one.
 *
 * Only a `model` frame qualifies. A `filter-result` is the answer to this
 * question and must never re-ask it, or a session would ask forever.
 *
 * The query re-asked is whichever one is standing, under the source that asked
 * for it: a reviewer holding a panel filter must not have the active view's
 * query put back underneath them, and a chat-issued filter must not start
 * reporting itself as the reviewer's own.
 */
/**
 * The active view's membership list, as the menus must read it.
 *
 * `null` where there is no list to edit: no view is active, or the view
 * describes its subjects with facets rather than naming them.
 *
 * Read through the PENDING row when one is staged, not off the saved document.
 * A reviewer who has just added a subject and right-clicks it again must be
 * offered "Remove from view"; a menu built from the saved list would offer
 * "Add to this view" a second time and stage nothing.
 */
export const activeViewMembership = (
  state: VisualAppState,
): readonly string[] | null => {
  const view = state.views.find(({ id }) => id === state.activeView);
  if (view === undefined) return null;
  const pending = state.pendingChangeset.viewOperations.find(
    (operation) => operation.path === view.path,
  );
  const query =
    pending?.op === "write-view" ? pending.projection.query : view.query;
  return enumeratesSubjects(query) ? query.subjects : null;
};

export const filterToReresolve = (
  frame: VisualServerFrame,
  state: VisualAppState,
): {
  readonly query: ProjectionQuery;
  readonly source: FilterSource;
} | null => {
  if (frame.kind !== "model") return null;
  // No filter standing is "everything is drawn", which a new subject joins by
  // existing. There is nothing to re-ask.
  if (state.activeFilter === null) return null;
  // A commit can land a change to the VIEW'S OWN QUERY - putting the subject
  // the reviewer just created into the list (#255) - and the browser is still
  // holding that query as it was before the commit. Re-asking the held one
  // draws the view as it was: the commit reports success, the projection on
  // disk names the new subject, and the canvas does not change. So the view's
  // query is re-read off the frame that replaced the model.
  //
  // Only for a filter that view issued - which includes the query tab editing
  // it (`editor`), because a committed query edit is exactly the case: the
  // reviewer changed the view's query, the commit landed it, and the query the
  // browser holds is the one from before. A reviewer holding their own panel
  // filter must not have the view's query put back underneath them, which is
  // the same rule `source` exists for.
  const fromTheView =
    state.activeFilter.source === "view" ||
    state.activeFilter.source === "editor";
  const landed = frame.views.find(({ id }) => id === state.activeView);
  return {
    query:
      fromTheView && landed !== undefined
        ? landed.query
        : state.activeFilter.query,
    source: state.activeFilter.source,
  };
};

/**
 * One server frame as the actions it means. Translation is pure so the socket
 * owns nothing but the socket.
 *
 * A `filter-result` says what matched, never why it was asked. Only the
 * browser knows whether it sent that query because the reviewer picked a
 * named view or edited the filter panel, so the caller reports the origin
 * it recorded when it asked.
 */
export const visualAppActionsForFrame = (
  frame: VisualServerFrame,
  filterOrigin: FilterSource = "panel",
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
      // One refusal, however many reasons it carries, naming the input it
      // ended so the control that input disabled comes back.
      return [
        {
          type: "input.refused",
          ...(frame.refused === undefined ? {} : { refused: frame.refused }),
          diagnostics: frame.diagnostics,
          frozen: frame.frozen !== undefined,
        },
      ];
    case "model":
      return [{ type: "model.received", model: frame.model, views: frame.views }];
    case "closing":
      return [{ type: "session.closed", reason: frame.reason }];
    case "filter-result":
      return [
        {
          type: "filter.applied",
          query: frame.result.query,
          matchedIds: frame.result.matchedIds,
          excluded: frame.result.excluded,
          source: filterOrigin,
        },
      ];
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
          const applied = frame.response.payload.appliedQuery;
          if (applied) {
            actions.push({
              type: "filter.applied",
              query: applied.query,
              // The runtime fills `matchedIds` in before this frame is sent
              // (ADR 0090); a query it resolved to nothing still highlights
              // nothing rather than leaving the previous filter standing.
              matchedIds: applied.matchedIds ?? [],
              // Unknown, not empty: `appliedQuery` carries no exclusions.
              excluded: null,
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
