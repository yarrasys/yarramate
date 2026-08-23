import { describe, expect, it } from "vitest";
import {
  VISUAL_LIMITS,
  type VisualBrowserInput,
} from "../src/adapters/visual/protocol.js";
import type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
} from "../src/adapters/visual/wire.js";
import {
  RECONNECT_WINDOW_MS,
  VISUAL_END_NOTICE,
  canReconnect,
  filterToReresolve,
  initialVisualAppState,
  visualAppActionsForFrame,
  visualAppReducer,
  visualAppSnapshotFrom,
  visualBrowserInputFor,
  type VisualAppAction,
  type VisualAppState,
} from "../src/visual-app/state.js";
import type { ProjectionQuery } from "../src/projection.js";

/** A rendered model with an empty canvas graph — only initialView matters here. */
const model = (
  initialView: string,
  sourceDigests: Readonly<Record<string, string>> = {},
): VisualRenderedModel => ({
  authority: "canonical",
  initialView,
  graph: { nodes: [], edges: [] },
  documents: [],
  vocabulary: {
    conceptKinds: [],
    relationshipKinds: [],
  },
  layouts: {},
  sourceDigests,
});

/** A plausible sha256, distinct per seed, for pins the reducer only compares. */
const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

const serverSnapshot: VisualSessionSnapshot = {
  protocolVersion: "yarramate/visual-protocol/v4",
  sessionId: "0".repeat(32),
  authority: "canonical",
  title: "Choose a delivery design",
  description: "Design options drawn from the checked workspace",
  chatEnabled: true,
  capabilities: {
    chat: true,
    choices: true,
    navigation: true,
    transcript: true,
  },
  webSocketUrl: "ws://127.0.0.1:4321/socket",
  model: model("choices"),
  transcript: [],
  views: [],
  agentTurnOpen: false,
  pendingChoice: null,
  styleNonce: "a".repeat(32),
  lastSequence: 0,
  frozen: false,
};

const loaded = (
  overrides: Partial<VisualSessionSnapshot> = {},
): VisualAppState =>
  visualAppReducer(initialVisualAppState, {
    type: "session.loaded",
    snapshot: visualAppSnapshotFrom({ ...serverSnapshot, ...overrides }),
  });

const activeState = loaded();

const compileDiagnostic = {
  severity: "error",
  code: "YMVS201",
  message: 'Unresolved reference "ghost"',
  path: "model.likec4",
  pointer: "/files/model.likec4",
  line: 2,
  column: 5,
} as const;

/** A second fault of the same failure, so dropping one of them is visible. */
const secondDiagnostic = {
  ...compileDiagnostic,
  code: "YMVS202",
  message: 'Unresolved reference "phantom"',
  line: 9,
} as const;

const responseEnvelope = {
  format: "yarramate/visual-response/v1",
  sessionId: "0".repeat(32),
  responseId: "a".repeat(32),
  eventId: "b".repeat(32),
  timestamp: "2026-08-08T00:00:01.000Z",
} as const;

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
  );

describe("visualAppReducer session lifecycle", () => {
  it("starts connecting with nothing to draw and no way to type", () => {
    expect(initialVisualAppState).toMatchObject({
      lifecycle: "connecting",
      model: null,
      composerEnabled: false,
      transcript: [],
      lastSequence: 0,
    });
  });

  it("activates the session from the server snapshot", () => {
    expect(activeState).toMatchObject({
      lifecycle: "active",
      authority: "canonical",
      title: "Choose a delivery design",
      description: "Design options drawn from the checked workspace",
      activeView: "choices",
      composerEnabled: true,
    });
    expect(activeState.model).toBe(serverSnapshot.model);
  });

  it("keeps input shut when the turn was still open at reconnect", () => {
    const asked = visualAppReducer(
      visualAppReducer(activeState, { type: "chat.sent", text: "Why B?" }),
      { type: "status.received", status: { state: "thinking" } },
    );
    const reconnected = visualAppReducer(asked, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [{ id: "e1", speaker: "reviewer", text: "Why B?" }],
        agentTurnOpen: true,
        lastSequence: 1,
      }),
    });
    expect(reconnected.composerEnabled).toBe(false);
    expect(reconnected.agentStatus).toEqual({ state: "thinking" });
  });

  it("restores the choice the agent is still waiting on at reconnect", () => {
    const question = {
      choiceId: "delivery",
      question: "Which delivery design should we keep?",
      options: [
        { id: "shared-queue", label: "Shared queue" },
        { id: "isolated-worker", label: "Isolated worker" },
      ],
    };
    // Nothing in the transcript says a question was asked, so a reviewer who
    // reloads can only answer it if the snapshot brings it back.
    expect(loaded({ pendingChoice: question }).choices).toEqual(question);
  });

  it("closes a choice the session no longer waits on", () => {
    const presented = visualAppReducer(activeState, {
      type: "choice.presented",
      choice: { choiceId: "delivery", question: "Which?", options: [] },
    });
    const reconnected = visualAppReducer(presented, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom(serverSnapshot),
    });
    expect(reconnected.choices).toBe(null);
  });

  it("reopens input when the agent answered while the browser was away", () => {
    const asked = visualAppReducer(
      visualAppReducer(activeState, { type: "chat.sent", text: "Why B?" }),
      { type: "status.received", status: { state: "thinking" } },
    );
    const lost = visualAppReducer(asked, { type: "connection.lost" });
    const reconnected = visualAppReducer(lost, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [
          { id: "e1", speaker: "reviewer", text: "Why B?" },
          { id: "r1", speaker: "agent", text: "It reuses the intake path." },
        ],
        agentTurnOpen: false,
        lastSequence: 1,
      }),
    });
    expect(reconnected.lifecycle).toBe("active");
    expect(reconnected.composerEnabled).toBe(true);
    expect(reconnected.agentStatus).toBe(null);
    expect(reconnected.transcript).toHaveLength(2);

    // The server may replay the response this browser missed; the record it
    // already holds is the same record, not a second one.
    const replayed = visualAppReducer(reconnected, {
      type: "chat.received",
      id: "r1",
      text: "It reuses the intake path.",
    });
    expect(replayed.transcript).toHaveLength(2);
    expect(replayed.composerEnabled).toBe(true);
  });

  it("never reuses a record key across a restored conversation", () => {
    const ending = visualAppReducer(activeState, { type: "end.requested" });
    const restored = visualAppReducer(ending, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [
          { id: "e1", speaker: "reviewer", text: "one" },
          { id: "r1", speaker: "agent", text: "two" },
        ],
      }),
    });
    const asked = visualAppReducer(restored, {
      type: "chat.sent",
      text: "next",
    });
    const keys = asked.transcript.map((record) => record.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the session style nonce to the renderer", () => {
    expect(activeState.styleNonce).toBe("a".repeat(32));
  });

  it("restores the conversation the session already holds", () => {
    const restored = loaded({
      transcript: [
        { id: "e1", speaker: "reviewer", text: "Why option B?" },
        { id: "r1", speaker: "agent", text: "It reuses the intake path." },
      ],
      lastSequence: 1,
    });
    expect(restored.transcript).toEqual([
      { id: "e1", speaker: "reviewer", text: "Why option B?" },
      { id: "r1", speaker: "agent", text: "It reuses the intake path." },
    ]);
    expect(restored.lastSequence).toBe(1);
  });

  it("keeps its own session notices when the server restores the record", () => {
    const ending = visualAppReducer(activeState, { type: "end.requested" });
    const restored = visualAppReducer(ending, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        transcript: [{ id: "e1", speaker: "reviewer", text: "Why option B?" }],
      }),
    });
    // The server owns what was said; the browser owns what it told the reviewer.
    expect(restored.transcript).toEqual([
      { id: "e1", speaker: "reviewer", text: "Why option B?" },
      { id: "local-0", speaker: "session", text: VISUAL_END_NOTICE },
    ]);
  });

  it("leaves the composer shut when the session arrives already frozen", () => {
    expect(loaded({ frozen: true }).composerEnabled).toBe(false);
  });

  it("leaves the composer shut when the session has no chat", () => {
    expect(loaded({ chatEnabled: false }).composerEnabled).toBe(false);
  });

  it("freezes input immediately when End is requested", () => {
    const next = visualAppReducer(activeState, { type: "end.requested" });
    expect(next.lifecycle).toBe("ending");
    expect(next.composerEnabled).toBe(false);
  });

  it("tells the reviewer control is going back to the main agent", () => {
    const next = visualAppReducer(activeState, { type: "end.requested" });
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: "session",
      text: "Returning control to the main agent",
    });
    expect(VISUAL_END_NOTICE).toBe("Returning control to the main agent");
  });

  it("keeps a session that already requested End ending when it reconnects", () => {
    const ending = visualAppReducer(activeState, { type: "end.requested" });
    const reconnected = visualAppReducer(ending, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom(serverSnapshot),
    });
    expect(reconnected.lifecycle).toBe("ending");
    expect(reconnected.composerEnabled).toBe(false);
  });

  it("marks the session disconnected and shuts input when the socket drops", () => {
    const next = visualAppReducer(activeState, { type: "connection.lost" });
    expect(next.lifecycle).toBe("disconnected");
    expect(next.composerEnabled).toBe(false);
    expect(next.model).toBe(activeState.model);
  });

  it("closes the session on the reason the server reports", () => {
    const next = visualAppReducer(
      visualAppReducer(activeState, { type: "end.requested" }),
      { type: "session.closed", reason: "user-ended" },
    );
    expect(next.lifecycle).toBe("closed");
    expect(next.closedReason).toBe("user-ended");
    expect(next.composerEnabled).toBe(false);
  });

  it("stays closed when a late frame arrives", () => {
    const closed = visualAppReducer(activeState, {
      type: "session.closed",
      reason: "main-cancelled",
    });
    expect(
      visualAppReducer(closed, {
        type: "session.loaded",
        snapshot: visualAppSnapshotFrom(serverSnapshot),
      }).lifecycle,
    ).toBe("closed");
    expect(
      visualAppReducer(closed, { type: "connection.lost" }).lifecycle,
    ).toBe("closed");
  });
});

describe("visualAppReducer model rendering", () => {
  it("renders a replacement model and clears the diagnostics it answers", () => {
    const failed = visualAppReducer(activeState, {
      type: "diagnostic.received",
      diagnostics: [compileDiagnostic],
    });
    const replacement = model("choices");
    const next = visualAppReducer(failed, {
      type: "model.received",
      model: replacement,
    });
    expect(next.model).toBe(replacement);
    expect(next.diagnostics).toEqual([]);
  });

  it("keeps the last rendered model when compilation fails", () => {
    const next = visualAppReducer(activeState, {
      type: "diagnostic.received",
      diagnostics: [compileDiagnostic],
    });
    expect(next.model).toBe(activeState.model);
    expect(next.diagnostics).toEqual([compileDiagnostic]);
  });

  it("shows every fault of one failed compilation, not only the last", () => {
    // A compilation fails for several reasons at once, and the reviewer has to
    // read all of them: a frame is one failure, not a queue of replacements.
    const next = applyFrame(activeState, {
      kind: "response",
      response: {
        ...responseEnvelope,
        type: "diagnostic",
        payload: { diagnostics: [compileDiagnostic, secondDiagnostic] },
      },
    });
    expect(next.diagnostics).toEqual([compileDiagnostic, secondDiagnostic]);
    expect(next.model).toBe(activeState.model);
  });

  it("keeps the current view when the replacement model happens to open on it", () => {
    const drilled = visualAppReducer(activeState, {
      type: "view.navigated",
      viewId: "option-b",
    });
    const next = visualAppReducer(drilled, {
      type: "model.received",
      model: model("option-b"),
    });
    expect(next.activeView).toBe("option-b");
  });

  it("does not fall back to the replacement model's own initial view when one was already chosen", () => {
    const drilled = visualAppReducer(activeState, {
      type: "view.navigated",
      viewId: "option-b",
    });
    const next = visualAppReducer(drilled, {
      type: "model.received",
      model: model("choices"),
    });
    // A mid-session recompile must not yank the reviewer back to a default view.
    expect(next.activeView).toBe("option-b");
  });

  it("preserves the active filter and quick-filter text across a model replacement", () => {
    const filtered = visualAppReducer(activeState, {
      type: "filter.applied",
      query: { subjects: ["Q1"] },
      matchedIds: ["node1"],
      source: "panel",
    });
    const searched = visualAppReducer(filtered, {
      type: "quickFilter.changed",
      text: "checkout",
    });
    const next = visualAppReducer(searched, {
      type: "model.received",
      model: model("choices"),
    });
    expect(next.activeFilter).toEqual({
      query: { subjects: ["Q1"] },
      matchedIds: ["node1"],
      source: "panel",
    });
    expect(next.quickFilterText).toBe("checkout");
  });

  it("moves the active view locally without touching the transcript", () => {
    const next = visualAppReducer(activeState, {
      type: "view.navigated",
      viewId: "option-b",
    });
    expect(next.activeView).toBe("option-b");
    expect(next.transcript).toBe(activeState.transcript);
    expect(next.composerEnabled).toBe(true);
  });
});

describe("visualAppReducer changeset management", () => {
  it("replaces a pending edit targeting the same subject and field", () => {
    const op1 = {
      op: "update-concept",
      document: "model.yaml",
      concept: { id: "Q1", name: "First name" },
    } as const;
    const op2 = {
      op: "update-concept",
      document: "model.yaml",
      concept: { id: "Q1", name: "Revised name" },
    } as const;
    const staged1 = visualAppReducer(activeState, {
      type: "changeset.staged",
      operation: op1,
    });
    expect(staged1.pendingChangeset.operations).toHaveLength(1);
    expect(staged1.pendingChangeset.operations[0]).toBe(op1);

    // Staging a second edit to the same field replaces the first.
    const staged2 = visualAppReducer(staged1, {
      type: "changeset.staged",
      operation: op2,
    });
    expect(staged2.pendingChangeset.operations).toHaveLength(1);
    expect(staged2.pendingChangeset.operations[0]).toBe(op2);
  });

  it("keeps the changeset intact when apply fails, and sets diagnostics", () => {
    const op = {
      op: "update-concept",
      document: "model.yaml",
      concept: { id: "Q1", name: "Updated" },
    } as const;
    const staged = visualAppReducer(activeState, {
      type: "changeset.staged",
      operation: op,
    });
    expect(staged.pendingChangeset.operations).toHaveLength(1);

    const diagnostic = {
      severity: "error" as const,
      code: "TEST001",
      message: "Invalid update",
      path: "model.yaml",
      pointer: "/concept/Q1",
      line: 1,
      column: 1,
    } as const;

    const failed = visualAppReducer(staged, {
      type: "apply.failed",
      diagnostics: [diagnostic],
    });
    // Changeset is preserved so the user can fix and retry.
    expect(failed.pendingChangeset.operations).toHaveLength(1);
    expect(failed.commitDiagnostics).toEqual([diagnostic]);
    expect(failed.commitStatus).toBe("idle");
  });

  it("clears the changeset and diagnostics when commit succeeds", () => {
    const op = {
      op: "update-concept",
      document: "model.yaml",
      concept: { id: "Q1", name: "Updated" },
    } as const;
    const staged = visualAppReducer(activeState, {
      type: "changeset.staged",
      operation: op,
    });

    const committed = visualAppReducer(staged, {
      type: "changeset.committed",
      documents: ["model.yaml"],
    });
    expect(committed.pendingChangeset.operations).toEqual([]);
    expect(committed.commitStatus).toBe("idle");
    expect(committed.commitDiagnostics).toBeNull();
    expect(committed.commitNotice).toEqual(["model.yaml"]);
  });
});

describe("visualAppReducer changeset undo and redo", () => {
  const rename = (id: string, name: string) =>
    ({
      op: "update-concept",
      document: "model.yaml",
      concept: { id, name },
    }) as const;

  /** Drives the reducer through a sequence, the way the browser would. */
  const replay = (
    state: VisualAppState,
    ...actions: readonly VisualAppAction[]
  ): VisualAppState => actions.reduce(visualAppReducer, state);


  it("restores the value a same-field replacement destroyed", () => {
    const first = rename("Q1", "First name");
    const second = rename("Q1", "Revised name");
    const replaced = replay(
      activeState,
      { type: "changeset.staged", operation: first },
      { type: "changeset.staged", operation: second },
    );
    expect(replaced.pendingChangeset.operations).toEqual([second]);

    // An inverse operation could not do this: the replacement dropped `first`
    // from the staged set, so only a snapshot still holds it.
    const undone = visualAppReducer(replaced, { type: "changeset.undone" });
    expect(undone.pendingChangeset.operations).toEqual([first]);

    const redone = visualAppReducer(undone, { type: "changeset.redone" });
    expect(redone.pendingChangeset.operations).toEqual([second]);
  });

  it("walks back and forward one edit at a time, newest first", () => {
    const a = rename("Q1", "A");
    const b = rename("Q2", "B");
    const c = rename("Q3", "C");
    const staged = replay(
      activeState,
      ...[a, b, c].map(
        (operation) => ({ type: "changeset.staged", operation }) as const,
      ),
    );
    expect(staged.pendingChangeset.operations).toEqual([a, b, c]);

    const back1 = visualAppReducer(staged, { type: "changeset.undone" });
    const back2 = visualAppReducer(back1, { type: "changeset.undone" });
    const back3 = visualAppReducer(back2, { type: "changeset.undone" });
    expect(back1.pendingChangeset.operations).toEqual([a, b]);
    expect(back2.pendingChangeset.operations).toEqual([a]);
    expect(back3.pendingChangeset.operations).toEqual([]);

    // Bottom of the stack: nothing further to restore, and no state churn.
    expect(visualAppReducer(back3, { type: "changeset.undone" })).toBe(back3);

    const forward = replay(
      back3,
      { type: "changeset.redone" },
      { type: "changeset.redone" },
      { type: "changeset.redone" },
    );
    expect(forward.pendingChangeset.operations).toEqual([a, b, c]);
    expect(visualAppReducer(forward, { type: "changeset.redone" })).toBe(
      forward,
    );
  });

  it("drops the redo branch once a fresh edit is staged", () => {
    const a = rename("Q1", "A");
    const b = rename("Q2", "B");
    const undone = replay(
      activeState,
      { type: "changeset.staged", operation: a },
      { type: "changeset.undone" },
    );
    expect(undone.redoStack).toHaveLength(1);

    const diverged = visualAppReducer(undone, {
      type: "changeset.staged",
      operation: b,
    });
    expect(diverged.redoStack).toEqual([]);
    expect(diverged.pendingChangeset.operations).toEqual([b]);
  });

  it("undoes a single discard and a discard-all alike", () => {
    const a = rename("Q1", "A");
    const b = rename("Q2", "B");
    const staged = replay(
      activeState,
      ...[a, b].map(
        (operation) => ({ type: "changeset.staged", operation }) as const,
      ),
    );

    const discarded = visualAppReducer(staged, {
      type: "changeset.discarded",
      index: 0,
    });
    expect(discarded.pendingChangeset.operations).toEqual([b]);
    expect(
      visualAppReducer(discarded, { type: "changeset.undone" })
        .pendingChangeset.operations,
    ).toEqual([a, b]);

    const cleared = visualAppReducer(staged, { type: "changeset.cleared" });
    expect(cleared.pendingChangeset.operations).toEqual([]);
    expect(
      visualAppReducer(cleared, { type: "changeset.undone" })
        .pendingChangeset.operations,
    ).toEqual([a, b]);
  });

  it("does not stack a dead undo step when clearing nothing", () => {
    const cleared = visualAppReducer(activeState, {
      type: "changeset.cleared",
    });
    expect(cleared.undoStack).toEqual([]);
    expect(cleared.redoStack).toEqual([]);
  });

  it("clears index-attributed diagnostics whenever the staged rows move", () => {
    const diagnostic = {
      severity: "error" as const,
      code: "YM913",
      message: "Invalid update",
      path: "model.yaml",
      pointer: "/operations/1/concept/name",
      line: 1,
      column: 1,
    } as const;
    const failed = replay(
      activeState,
      { type: "changeset.staged", operation: rename("Q1", "A") },
      { type: "changeset.staged", operation: rename("Q2", "B") },
      { type: "apply.failed", diagnostics: [diagnostic] },
    );
    expect(failed.commitDiagnostics).toEqual([diagnostic]);

    // Row 1's diagnostics would otherwise be redrawn against a different row.
    for (const action of [
      { type: "changeset.discarded" as const, index: 0 },
      { type: "changeset.undone" as const },
    ]) {
      expect(visualAppReducer(failed, action).commitDiagnostics).toBeNull();
    }
  });

  it("forgets both stacks once a batch lands", () => {
    const landed = replay(
      activeState,
      { type: "changeset.staged", operation: rename("Q1", "A") },
      { type: "changeset.undone" },
      { type: "changeset.staged", operation: rename("Q2", "B") },
      { type: "changeset.commit.sent" },
      { type: "changeset.committed", documents: ["model.yaml"] },
    );

    // What landed is reverted with `git revert`, not resurrected here.
    expect(landed.undoStack).toEqual([]);
    expect(landed.redoStack).toEqual([]);
    expect(visualAppReducer(landed, { type: "changeset.undone" })).toBe(landed);
  });
});

describe("visualAppReducer staged digests", () => {
  const held = digest("a");
  const replaced = digest("b");
  const other = digest("c");

  /** A session whose model names two documents with known contents. */
  const pinnedState = loaded({
    model: model("choices", {
      "model.yaml": held,
      "other.yaml": other,
    }),
  });

  const rename = (document: string, id: string, name: string) =>
    ({ op: "update-concept", document, concept: { id, name } }) as const;

  it("pins the document the row targets, and only that one", () => {
    const staged = visualAppReducer(pinnedState, {
      type: "changeset.staged",
      operation: rename("model.yaml", "Q1", "A"),
    });

    // `other.yaml` is in the model but untouched: vouching for it would refuse
    // a commit over a change that has nothing to do with this batch.
    expect(staged.pendingChangeset.sourceDigests).toEqual({
      "model.yaml": held,
    });
  });

  it("keeps the digest the first row saw when a newer model arrives", () => {
    // The whole point: another session landed a write, the fresh model says so,
    // and the pin must still say what was on screen when the row was written.
    // Refreshing it here would let the next edit overwrite that write silently.
    const staged = visualAppReducer(pinnedState, {
      type: "changeset.staged",
      operation: rename("model.yaml", "Q1", "A"),
    });
    const refreshed = visualAppReducer(staged, {
      type: "model.received",
      model: model("choices", { "model.yaml": replaced, "other.yaml": other }),
    });
    const again = visualAppReducer(refreshed, {
      type: "changeset.staged",
      operation: rename("model.yaml", "Q1", "B"),
    });

    expect(again.pendingChangeset.sourceDigests).toEqual({
      "model.yaml": held,
    });
  });

  it("stops vouching for a document once its last row is discarded", () => {
    const staged = [
      rename("model.yaml", "Q1", "A"),
      rename("other.yaml", "Q2", "B"),
    ].reduce(
      (state, operation) =>
        visualAppReducer(state, { type: "changeset.staged", operation }),
      pinnedState,
    );
    expect(Object.keys(staged.pendingChangeset.sourceDigests)).toEqual([
      "model.yaml",
      "other.yaml",
    ]);

    const discarded = visualAppReducer(staged, {
      type: "changeset.discarded",
      index: 1,
    });
    expect(discarded.pendingChangeset.sourceDigests).toEqual({
      "model.yaml": held,
    });
  });

  it("restores the pins a snapshot was staged against, not today's", () => {
    const staged = visualAppReducer(pinnedState, {
      type: "changeset.staged",
      operation: rename("model.yaml", "Q1", "A"),
    });
    const cleared = visualAppReducer(staged, { type: "changeset.cleared" });
    expect(cleared.pendingChangeset.sourceDigests).toEqual({});

    const undone = visualAppReducer(
      visualAppReducer(cleared, {
        type: "model.received",
        model: model("choices", { "model.yaml": replaced }),
      }),
      { type: "changeset.undone" },
    );
    expect(undone.pendingChangeset.sourceDigests).toEqual({
      "model.yaml": held,
    });
  });

  it("leaves a row unpinned when the model does not have the document", () => {
    const staged = visualAppReducer(pinnedState, {
      type: "changeset.staged",
      operation: rename("new.yaml", "Q1", "A"),
    });

    // Nothing to be stale against: `apply` creates it, and a pin nobody minted
    // would refuse a commit for a file that never existed.
    expect(staged.pendingChangeset.sourceDigests).toEqual({});
  });

  it("sends the rows and the digests they were staged against together", () => {
    const staged = visualAppReducer(pinnedState, {
      type: "changeset.staged",
      operation: rename("model.yaml", "Q1", "A"),
    });
    const input = visualBrowserInputFor({ kind: "commit-changeset" }, staged);

    expect(input).toMatchObject({
      type: "changeset.commit",
      payload: {
        operations: staged.pendingChangeset.operations,
        sourceDigests: { "model.yaml": held },
      },
    });
  });
});

describe("visualAppReducer conversation", () => {
  it("records the reviewer question verbatim and waits for the answer", () => {
    const next = visualAppReducer(activeState, {
      type: "chat.sent",
      text: "Why is <b>option B</b> cheaper?",
    });
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: "reviewer",
      text: "Why is <b>option B</b> cheaper?",
    });
    expect(next.composerEnabled).toBe(false);
  });

  it("reopens the composer when the agent answers", () => {
    const asked = visualAppReducer(activeState, {
      type: "chat.sent",
      text: "Why is option B cheaper?",
    });
    const next = visualAppReducer(asked, {
      type: "chat.received",
      id: "r1",
      text: "Option B reuses the existing queue.",
    });
    expect(next.transcript.at(-1)).toMatchObject({
      id: "r1",
      speaker: "agent",
      text: "Option B reuses the existing queue.",
    });
    expect(next.composerEnabled).toBe(true);
  });

  it("gives every transcript record its own key", () => {
    const first = visualAppReducer(activeState, {
      type: "chat.sent",
      text: "one",
    });
    const second = visualAppReducer(first, { type: "chat.sent", text: "one" });
    const keys = second.transcript.map((entry) => entry.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("presents choices and closes them the moment one is selected", () => {
    const presented = visualAppReducer(activeState, {
      type: "choice.presented",
      choice: {
        choiceId: "delivery",
        question: "Which delivery design should we keep?",
        options: [
          { id: "option-a", label: "Isolated worker" },
          { id: "option-b", label: "Shared queue" },
        ],
      },
    });
    expect(presented.choices?.options).toHaveLength(2);
    expect(presented.composerEnabled).toBe(true);

    const chosen = visualAppReducer(presented, {
      type: "choice.sent",
      optionId: "option-b",
    });
    expect(chosen.choices).toBe(null);
    expect(chosen.transcript.at(-1)).toMatchObject({
      speaker: "reviewer",
      text: "Shared queue",
    });
    expect(chosen.composerEnabled).toBe(false);
  });

  describe("after a choice, every later record keeps its own key", () => {
    const present = (state: VisualAppState, choiceId: string) =>
      visualAppReducer(state, {
        type: "choice.presented",
        choice: {
          choiceId,
          question: "Which delivery design should we keep?",
          options: [
            { id: "option-a", label: "Isolated worker" },
            { id: "option-b", label: "Shared queue" },
          ],
        },
      });

    const chosen = visualAppReducer(present(activeState, "first"), {
      type: "choice.sent",
      optionId: "option-b",
    });

    const unique = (state: VisualAppState) => {
      const keys = state.transcript.map((record) => record.id);
      expect(new Set(keys).size).toBe(keys.length);
    };

    it("records a second choice beside the first", () => {
      const next = visualAppReducer(present(chosen, "second"), {
        type: "choice.sent",
        optionId: "option-a",
      });
      expect(next.transcript.map((record) => record.text)).toEqual([
        "Shared queue",
        "Isolated worker",
      ]);
      unique(next);
    });

    it("records a question asked after a choice", () => {
      const next = visualAppReducer(chosen, {
        type: "chat.sent",
        text: "What does that cost?",
      });
      expect(next.transcript.map((record) => record.text)).toEqual([
        "Shared queue",
        "What does that cost?",
      ]);
      unique(next);
    });

    it("still shows the End notice after a choice", () => {
      const next = visualAppReducer(chosen, { type: "end.requested" });
      expect(next.transcript.map((record) => record.text)).toEqual([
        "Shared queue",
        VISUAL_END_NOTICE,
      ]);
      unique(next);
    });
  });

  it("reports agent status without disturbing the transcript", () => {
    const next = visualAppReducer(activeState, {
      type: "status.received",
      status: { state: "compiling", detail: "Rendering option B" },
    });
    expect(next.agentStatus).toEqual({
      state: "compiling",
      detail: "Rendering option B",
    });
    expect(next.transcript).toBe(activeState.transcript);
  });

  it("drops the agent status once the turn it described is answered", () => {
    const thinking = visualAppReducer(
      visualAppReducer(activeState, { type: "chat.sent", text: "why?" }),
      { type: "status.received", status: { state: "thinking" } },
    );
    expect(thinking.agentStatus).not.toBe(null);
    // The reviewer must never be told the agent is still thinking about a
    // question it has already answered.
    expect(
      visualAppReducer(thinking, {
        type: "chat.received",
        id: "r2",
        text: "Because it reuses the intake path.",
      }).agentStatus,
    ).toBe(null);
    expect(
      visualAppReducer(thinking, {
        type: "choice.presented",
        choice: { choiceId: "c", question: "Which?", options: [] },
      }).agentStatus,
    ).toBe(null);
    expect(
      visualAppReducer(thinking, {
        type: "diagnostic.received",
        diagnostics: [compileDiagnostic],
      }).agentStatus,
    ).toBe(null);
  });

  it("records the handoff summary the agent closed with", () => {
    const next = visualAppReducer(activeState, {
      type: "handoff.received",
      id: "r9",
      handoff: {
        summary: "Option B confirmed",
        confirmedDecisions: ["Reuse the shared queue"],
        requestedChanges: [],
        unresolvedQuestions: [],
        finalViews: ["option-b"],
      },
    });
    expect(next.handoff?.summary).toBe("Option B confirmed");
    expect(next.transcript.at(-1)).toMatchObject({
      speaker: "agent",
      text: "Option B confirmed",
    });
  });
});

describe("visualAppReducer acknowledgement and refusal", () => {
  it("tracks the highest sequence the server acknowledged", () => {
    const first = visualAppReducer(activeState, {
      type: "event.acknowledged",
      sequence: 2,
    });
    expect(first.lastSequence).toBe(2);
    // A late acknowledgement for an earlier event never rewinds the browser's
    // view of the journal, because that view is what every frame carries.
    expect(
      visualAppReducer(first, { type: "event.acknowledged", sequence: 1 })
        .lastSequence,
    ).toBe(2);
  });

  it("shuts the composer for good when the server freezes input", () => {
    const next = visualAppReducer(activeState, {
      type: "input.refused",
      diagnostics: [compileDiagnostic],
      frozen: true,
    });
    expect(next.frozen).toBe(true);
    expect(next.composerEnabled).toBe(false);
    expect(next.diagnostics).toEqual([compileDiagnostic]);
  });

  it("leaves the composer open when a single frame was refused", () => {
    const next = visualAppReducer(activeState, {
      type: "input.refused",
      diagnostics: [compileDiagnostic],
      frozen: false,
    });
    expect(next.frozen).toBe(false);
    expect(next.composerEnabled).toBe(true);
  });

  it("shows every reason one frame was refused, not only the last", () => {
    const next = applyFrame(activeState, {
      kind: "rejected",
      diagnostics: [compileDiagnostic, secondDiagnostic],
      frozen: "pending-events",
    });
    expect(next.diagnostics).toEqual([compileDiagnostic, secondDiagnostic]);
    expect(next.frozen).toBe(true);
    expect(next.composerEnabled).toBe(false);
  });

  it("retires a save that was refused, so the control is usable again", () => {
    const sent = visualAppReducer(activeState, {
      type: "view.save.sent",
      payload: {
        title: "Refused view",
        description: "",
        query: {},
        presentation: {
          layout: "layered",
          direction: "top-down",
        },
      },
    });
    expect(sent.pendingViewSave).not.toBeNull();
    // No `view-save-result` ever follows a refusal, so nothing else would
    // clear it and every later Save would stay disabled.
    const refused = visualAppReducer(sent, {
      type: "input.refused",
      diagnostics: [compileDiagnostic],
      frozen: false,
    });
    expect(refused.pendingViewSave).toBeNull();
  });

  it("retires a commit the server refused, on the rows it refused", () => {
    const staged = visualAppReducer(activeState, {
      type: "changeset.staged",
      operation: {
        op: "update-concept",
        document: "model.yaml",
        concept: { id: "Q1", name: " " },
      } as const,
    });
    const sent = visualAppReducer(staged, { type: "changeset.commit.sent" });
    expect(sent.commitStatus).toBe("committing");
    // The gate refuses a blank name at ingress, so no `apply-result` follows:
    // without the refusal answering the commit, the button never comes back.
    const refused = visualAppReducer(sent, {
      type: "input.refused",
      refused: "changeset.commit",
      diagnostics: [compileDiagnostic],
      frozen: false,
    });
    expect(refused.commitStatus).toBe("idle");
    expect(refused.commitDiagnostics).toEqual([compileDiagnostic]);
    expect(refused.pendingChangeset.operations).toHaveLength(1);
  });

  it("leaves controls the refusal did not name alone", () => {
    const sent = visualAppReducer(activeState, {
      type: "view.save.sent",
      payload: {
        title: "Still saving",
        description: "",
        query: {},
        presentation: {
          layout: "layered",
          direction: "top-down",
        },
      },
    });
    const refused = visualAppReducer(sent, {
      type: "input.refused",
      refused: "changeset.commit",
      diagnostics: [compileDiagnostic],
      frozen: false,
    });
    // A refused commit says nothing about a save the server never answered.
    expect(refused.pendingViewSave).not.toBeNull();
    expect(refused.commitStatus).toBe("idle");
  });
});

describe("visualBrowserInputFor", () => {
  it("carries the last acknowledged sequence on every browser frame", () => {
    const acknowledged = visualAppReducer(activeState, {
      type: "event.acknowledged",
      sequence: 7,
    });
    const frames: readonly VisualBrowserInput[] = [
      visualBrowserInputFor(
        { kind: "chat", text: "Why option B?" },
        acknowledged,
      ),
      visualBrowserInputFor(
        { kind: "choice", choiceId: "delivery", optionId: "option-b" },
        acknowledged,
      ),
      visualBrowserInputFor(
        { kind: "navigate", viewId: "option-b" },
        acknowledged,
      ),
      visualBrowserInputFor({ kind: "end" }, acknowledged),
    ];
    expect(frames.map((frame) => frame.lastAcknowledgedSequence)).toEqual([
      7, 7, 7, 7,
    ]);
    expect(frames.map((frame) => frame.type)).toEqual([
      "chat.message",
      "choice.selected",
      "view.navigate",
      "session.end",
    ]);
  });

  it("never asks the agent for attention on a local drill-down", () => {
    expect(
      visualBrowserInputFor(
        { kind: "navigate", viewId: "option-b" },
        activeState,
      ),
    ).toEqual({
      type: "view.navigate",
      lastAcknowledgedSequence: 0,
      payload: { viewId: "option-b", requiresAttention: false },
    });
  });

  it("ends only for the reason the reviewer chose", () => {
    expect(visualBrowserInputFor({ kind: "end" }, activeState)).toEqual({
      type: "session.end",
      lastAcknowledgedSequence: 0,
      payload: { reason: "user-ended" },
    });
  });
});

describe("visualAppActionsForFrame", () => {
  const actionsFor = (frame: VisualServerFrame) =>
    visualAppActionsForFrame(frame);

  it("loads the session from a ready frame", () => {
    expect(actionsFor({ kind: "ready", snapshot: serverSnapshot })).toEqual([
      {
        type: "session.loaded",
        snapshot: visualAppSnapshotFrom(serverSnapshot),
      },
    ]);
  });

  it("acknowledges an accepted event", () => {
    expect(
      actionsFor({ kind: "accepted", sequence: 3, eventId: "e3" }),
    ).toEqual([{ type: "event.acknowledged", sequence: 3 }]);
  });

  it("refuses input and reports whether the session froze", () => {
    expect(
      actionsFor({
        kind: "rejected",
        diagnostics: [compileDiagnostic],
        frozen: "pending-events",
      }),
    ).toEqual([
      {
        type: "input.refused",
        diagnostics: [compileDiagnostic],
        frozen: true,
      },
    ]);
  });

  it("carries every diagnostic of a refused frame in one refusal", () => {
    expect(
      actionsFor({
        kind: "rejected",
        diagnostics: [compileDiagnostic, secondDiagnostic],
      }),
    ).toEqual([
      {
        type: "input.refused",
        diagnostics: [compileDiagnostic, secondDiagnostic],
        frozen: false,
      },
    ]);
  });

  it("names the input a refusal ended when the frame says which", () => {
    expect(
      actionsFor({
        kind: "rejected",
        refused: "changeset.commit",
        diagnostics: [compileDiagnostic],
      }),
    ).toEqual([
      {
        type: "input.refused",
        refused: "changeset.commit",
        diagnostics: [compileDiagnostic],
        frozen: false,
      },
    ]);
  });

  it("replaces the rendered model from a model frame", () => {
    const rendered = model("choices");
    expect(actionsFor({ kind: "model", model: rendered })).toEqual([
      { type: "model.received", model: rendered },
    ]);
  });

  it("closes the session from a closing frame", () => {
    expect(actionsFor({ kind: "closing", reason: "user-ended" })).toEqual([
      { type: "session.closed", reason: "user-ended" },
    ]);
  });

  it("turns each agent response into the record it belongs to", () => {
    expect(
      actionsFor({
        kind: "response",
        response: {
          ...responseEnvelope,
          type: "chat.response",
          payload: { text: "Option B reuses the queue" },
        },
      }),
    ).toEqual([
      {
        type: "chat.received",
        id: responseEnvelope.responseId,
        text: "Option B reuses the queue",
      },
    ]);
    expect(
      actionsFor({
        kind: "response",
        response: {
          ...responseEnvelope,
          type: "agent.status",
          payload: { state: "thinking" },
        },
      }),
    ).toEqual([{ type: "status.received", status: { state: "thinking" } }]);
    expect(
      actionsFor({
        kind: "response",
        response: {
          ...responseEnvelope,
          type: "diagnostic",
          payload: { diagnostics: [compileDiagnostic] },
        },
      }),
    ).toEqual([
      { type: "diagnostic.received", diagnostics: [compileDiagnostic] },
    ]);
  });
});

describe("visualAppReducer filter state", () => {
  const query: ProjectionQuery = { subjects: ["Q1"] };
  const matchedIds = ["node1", "node2", "node3"];

  it("initializes with no active filter", () => {
    expect(initialVisualAppState.activeFilter).toBe(null);
    expect(initialVisualAppState.quickFilterText).toBe("");
  });

  it("applies a filter with panel source from filter-result frame", () => {
    const actions = visualAppActionsForFrame({
      kind: "filter-result",
      result: { query, matchedIds },
    });
    const filtered = actions.reduce(
      (state, action) => visualAppReducer(state, action),
      activeState,
    );
    expect(filtered.activeFilter).toEqual({
      query,
      matchedIds,
      source: "panel",
    });
  });
  it("applies a filter with chat source from chat response", () => {
    const actions = visualAppActionsForFrame({
      kind: "response",
      response: {
        ...responseEnvelope,
        type: "chat.response",
        payload: {
          text: "Here are results",
          appliedQuery: { query, matchedIds },
        },
      },
    });
    const filtered = actions.reduce(
      (state, action) => visualAppReducer(state, action),
      activeState,
    );
    expect(filtered.activeFilter).toEqual({
      query,
      matchedIds,
      source: "chat",
    });
  });

  it("labels a filter result with the origin the browser recorded", () => {
    const frame = {
      kind: "filter-result",
      result: { query, matchedIds },
    } as const;
    expect(visualAppActionsForFrame(frame, "view")).toEqual([
      { type: "filter.applied", query, matchedIds, source: "view" },
    ]);
    expect(visualAppActionsForFrame(frame)).toEqual([
      { type: "filter.applied", query, matchedIds, source: "panel" },
    ]);
  });

  it("keeps the named view standing when the view's own query lands", () => {
    const filtered = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "view",
    });
    expect(filtered.activeView).toBe(activeState.activeView);
  });

  it("stops claiming the named view when the panel filters", () => {
    const filtered = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "panel",
    });
    expect(activeState.activeView).not.toBe("");
    expect(filtered.activeView).toBe("");
  });

  it("stops claiming the named view when chat filters", () => {
    const filtered = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "chat",
    });
    expect(filtered.activeView).toBe("");
  });

  it("clears the active filter on filter.cleared action", () => {
    const filtered = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "panel",
    });
    expect(filtered.activeFilter).not.toBe(null);
    const cleared = visualAppReducer(filtered, {
      type: "filter.cleared",
    });
    expect(cleared.activeFilter).toBe(null);
  });

  it("does not clear quickFilterText when clearing the filter", () => {
    const withFilter = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "panel",
    });
    const cleared = visualAppReducer(withFilter, {
      type: "filter.cleared",
    });
    // quickFilterText should remain unchanged
    expect(cleared.quickFilterText).toBe(activeState.quickFilterText);
  });

  it("replacing a filter with a new one updates the activeFilter", () => {
    const filtered1 = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds: ["node1"],
      source: "panel",
    });
    const newQuery: ProjectionQuery = { subjects: ["Q2"] };
    const filtered2 = visualAppReducer(filtered1, {
      type: "filter.applied",
      query: newQuery,
      matchedIds: ["node4", "node5"],
      source: "chat",
    });
    expect(filtered2.activeFilter).toEqual({
      query: newQuery,
      matchedIds: ["node4", "node5"],
      source: "chat",
    });
  });

  it("sets quickFilterText on quickFilter.changed, independent of activeFilter", () => {
    const withFilter = visualAppReducer(activeState, {
      type: "filter.applied",
      query,
      matchedIds,
      source: "panel",
    });
    const typed = visualAppReducer(withFilter, {
      type: "quickFilter.changed",
      text: "checkout",
    });
    expect(typed.quickFilterText).toBe("checkout");
    expect(typed.activeFilter).toEqual(withFilter.activeFilter);
  });
});

describe("canReconnect", () => {
  it("reconnects inside the grace and stops at its edge", () => {
    const lostAt = 1_000_000;
    expect(canReconnect(lostAt, lostAt)).toBe(true);
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS - 1)).toBe(true);
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS)).toBe(false);
    expect(canReconnect(lostAt, lostAt + RECONNECT_WINDOW_MS + 60_000)).toBe(
      false,
    );
  });
});

describe("visualAppReducer view save", () => {
  it("stores pending save on view.save.sent", () => {
    const payload = {
      title: "My view",
      description: "A test view",
      query: { subjects: ["Q1"] },
      presentation: {
        layout: "layered",
        direction: "top-down",
      } as const,
    };
    const sent = visualAppReducer(initialVisualAppState, {
      type: "view.save.sent",
      payload,
    });
    expect(sent.pendingViewSave).toEqual(payload);
    expect(sent.viewSaveNotice).toBe(false);
  });

  it("saves view and shows notice on view.saved ok:true", () => {
    const payload = {
      title: "My view",
      description: "A test view",
      query: { subjects: ["Q1"] },
      presentation: {
        layout: "layered",
        direction: "top-down",
      } as const,
    };
    const sent = visualAppReducer(initialVisualAppState, {
      type: "view.save.sent",
      payload,
    });
    const saved = visualAppReducer(sent, {
      type: "view.saved",
      result: { ok: true, id: "view-1", path: "/views/view-1" },
    });
    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toEqual({
      id: "view-1",
      title: "My view",
      description: "A test view",
      query: { subjects: ["Q1"] },
      presentation: { layout: "layered", direction: "top-down" },
    });
    expect(saved.viewSaveNotice).toBe(true);
    expect(saved.pendingViewSave).toBe(null);
  });

  it("replaces existing view on overwrite", () => {
    const view1 = {
      id: "view-1",
      title: "Old title",
      description: "Old desc",
      query: {} as ProjectionQuery,
      presentation: {
        layout: "layered",
        direction: "top-down",
      } as const,
    };
    const state = { ...initialVisualAppState, views: [view1] };
    const payload = {
      id: "view-1",
      title: "New title",
      description: "New desc",
      query: {},
      presentation: {
        layout: "layered",
        direction: "left-right",
      } as const,
    };
    const sent = visualAppReducer(state, {
      type: "view.save.sent",
      payload,
    });
    const saved = visualAppReducer(sent, {
      type: "view.saved",
      result: { ok: true, id: "view-1", path: "/views/view-1" },
    });
    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]?.title).toBe("New title");
  });

  it("sets diagnostics and clears pending on view.saved ok:false", () => {
    const payload = {
      title: "Bad view",
      description: "Will fail",
      query: {},
      presentation: {
        layout: "layered",
        direction: "top-down",
      } as const,
    };
    const sent = visualAppReducer(initialVisualAppState, {
      type: "view.save.sent",
      payload,
    });
    const diag = {
      severity: "error" as const,
      code: "E001",
      message: "Invalid",
      path: "test.yaml",
      line: 1,
      column: 1,
      pointer: "/x",
    };
    const saved = visualAppReducer(sent, {
      type: "view.saved",
      result: { ok: false, diagnostics: [diag] },
    });
    expect(saved.diagnostics).toEqual([diag]);
    expect(saved.pendingViewSave).toBe(null);
  });

  it("clears notice on view.saveNotice.dismissed", () => {
    const state = { ...initialVisualAppState, viewSaveNotice: true };
    const dismissed = visualAppReducer(state, {
      type: "view.saveNotice.dismissed",
    });
    expect(dismissed.viewSaveNotice).toBe(false);
  });

  it("clears pending/notice on session.loaded reconnect", () => {
    const payload = {
      title: "Stale",
      description: "Should go away",
      query: {},
      presentation: {
        layout: "layered",
        direction: "top-down",
      } as const,
    };
    const state = {
      ...initialVisualAppState,
      pendingViewSave: payload,
      viewSaveNotice: true,
    };
    const reloaded = visualAppReducer(state, {
      type: "session.loaded",
      snapshot: visualAppSnapshotFrom({
        ...serverSnapshot,
        authority: "canonical",
        title: "Test",
        description: "Test session",
        views: [],
        lastSequence: 0,
        agentTurnOpen: false,
      }),
    });
    expect(reloaded.pendingViewSave).toBe(null);
    expect(reloaded.viewSaveNotice).toBe(false);
  });
});

describe("filterToReresolve", () => {
  /**
   * The defect this exists to close: a filter is resolved against the model
   * the server held when it was asked, and a landed commit replaces that
   * model. Nothing re-asked, so the matched set went on describing the graph
   * as it was, and the canvas hid the subject the reviewer had just created.
   * The commit reported success and the diagram did not change.
   */
  const standing = (
    source: "view" | "panel" | "chat",
    matchedIds: readonly string[] = ["checkout"],
  ): VisualAppState => ({
    ...initialVisualAppState,
    activeFilter: {
      query: { kinds: ["yarramate/core@0.1#applicationComponent"] },
      matchedIds,
      source,
    },
  });

  const modelFrame: VisualServerFrame = { kind: "model", model: model("all") };

  it("asks the standing view query again when a model replaces the old one", () => {
    expect(filterToReresolve(modelFrame, standing("view"))).toEqual({
      query: { kinds: ["yarramate/core@0.1#applicationComponent"] },
      source: "view",
    });
  });

  it.each(["panel", "chat"] as const)(
    "re-asks a %s filter under the source that asked for it",
    (source) => {
      // A reviewer holding their own filter must not have the active view's
      // query put back underneath them, and a chat-issued narrowing must not
      // start reporting itself as the reviewer's own.
      expect(filterToReresolve(modelFrame, standing(source))?.source).toBe(source);
    },
  );

  it("has nothing to re-ask when no filter is standing", () => {
    // Unfiltered draws everything, which a new subject joins by existing.
    expect(filterToReresolve(modelFrame, initialVisualAppState)).toBeNull();
  });

  it("never re-asks off a filter result, which is the answer to the question", () => {
    // The guard against asking forever: this frame is what a re-ask produces.
    expect(
      filterToReresolve(
        {
          kind: "filter-result",
          result: {
            query: { kinds: ["yarramate/core@0.1#applicationComponent"] },
            matchedIds: ["checkout", "payment-gateway"],
          },
        },
        standing("view"),
      ),
    ).toBeNull();
  });

  it("re-asks off nothing but a model", () => {
    for (const frame of [
      { kind: "accepted", sequence: 1 },
      { kind: "rejected", reason: "nope" },
      { kind: "closing", reason: "user-ended" },
    ] as unknown as VisualServerFrame[]) {
      expect(filterToReresolve(frame, standing("view"))).toBeNull();
    }
  });
});
