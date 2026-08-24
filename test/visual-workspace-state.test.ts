import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "../src/graph-projection.js";
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  presentationActionsFor,
  viewNeedingApplication,
  visualWorkspaceReducer,
  type SelectedDiagramSubject,
} from "../src/visual-app/workspace-state.js";

const canvasNode = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "system.api",
  localId: "api",
  kind: "yarramate/core@0.1#applicationComponent",
  kindLabel: "applicationComponent",
  coreKindLabel: "applicationComponent",
  document: "main.yaml",
  layer: "application",
  aspect: null,
  name: "API",
  description: "Handles requests.",
  aka: [],
  status: null,
  owner: null,
  folder: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
  ...overrides,
});

const canvasEdge = (overrides: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: "edge-1",
  localId: "edge-1",
  kind: "yarramate/core@0.1#dependency",
  kindLabel: "dependency",
  coreKindLabel: "dependency",
  document: "main.yaml",
  from: "web",
  to: "api",
  name: "calls",
  description: null,
  mode: null,
  content: null,
  status: null,
  references: [],
  presentIn: [],
  ...overrides,
});

const elementSubject: SelectedDiagramSubject = {
  type: "element",
  id: "system.api",
  title: "API",
  kind: "service",
  description: "Handles requests.",
};

describe("visual workspace state", () => {
  it("starts collapsed at the responsive default width", () => {
    const state = createVisualWorkspaceState(1568);
    expect(state.conversation).toEqual({
      mode: "auto",
      width: expect.closeTo(439.04, 2),
      unread: 0,
    });
  });

  it("caps the default width at 480px on wide viewports", () => {
    const state = createVisualWorkspaceState(1920);
    expect(state.conversation).toEqual({
      mode: "auto",
      width: 480,
      unread: 0,
    });
  });

  it("opens automatically for first activity but respects a manual close", () => {
    const initial = createVisualWorkspaceState(1568);
    const opened = visualWorkspaceReducer(initial, {
      type: "attention.received",
    });
    expect(opened.conversation.mode).toBe("open");

    const closed = visualWorkspaceReducer(opened, {
      type: "conversation.toggled",
    });
    const waiting = visualWorkspaceReducer(closed, {
      type: "attention.received",
    });
    expect(waiting.conversation).toMatchObject({ mode: "closed", unread: 1 });

    const reopened = visualWorkspaceReducer(waiting, {
      type: "conversation.toggled",
    });
    expect(reopened.conversation).toMatchObject({ mode: "open", unread: 0 });
  });

  it("re-reads a held subject from the replacement model and drops it only when removed", () => {
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: "subject.selected",
      subject: elementSubject,
    });
    expect(selected.conversation.mode).toBe("open");
    expect(selected.selectedSubject).toEqual(elementSubject);

    // A commit that renamed the held subject: the inspector follows the edit
    // instead of closing under the reviewer who just made it.
    const renamed = visualWorkspaceReducer(selected, {
      type: "model.replaced",
      graph: { nodes: [canvasNode({ name: "Gateway API" })], edges: [] },
    });
    expect(renamed.selectedSubject).toMatchObject({
      type: "element",
      id: "system.api",
      title: "Gateway API",
    });
    expect(renamed.conversation.mode).toBe("open");

    // A commit that deleted it, and a session with no model at all: nothing
    // left to point at either way.
    for (const graph of [{ nodes: [], edges: [] }, null]) {
      const gone = visualWorkspaceReducer(selected, {
        type: "model.replaced",
        graph,
      });
      expect(gone.selectedSubject).toBeNull();
      expect(gone.conversation.mode).toBe("open");
    }
  });

  it("re-resolves a held relationship endpoint title after replacement", () => {
    const web = canvasNode({ id: "web", name: "Web" });
    const api = canvasNode({ id: "api", name: "API" });
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: "subject.selected",
      subject: normalizeSelectedRelationship(
        canvasEdge(),
        new Map([
          ["web", "Web"],
          ["api", "API"],
        ]),
      ),
    });

    const replaced = visualWorkspaceReducer(selected, {
      type: "model.replaced",
      graph: {
        nodes: [web, canvasNode({ id: "api", name: "Gateway API" })],
        edges: [canvasEdge({ name: "invokes" })],
      },
    });
    expect(replaced.selectedSubject).toMatchObject({
      type: "relationship",
      id: "edge-1",
      sourceTitle: "Web",
      targetTitle: "Gateway API",
      label: "invokes",
    });

    // The edge outlives one of its endpoints only in a broken model; a
    // relationship the commit removed closes the inspector.
    const dropped = visualWorkspaceReducer(selected, {
      type: "model.replaced",
      graph: { nodes: [web, api], edges: [] },
    });
    expect(dropped.selectedSubject).toBeNull();
  });

  it("clamps width to the design maximum of min(45vw, 640px)", () => {
    expect(conversationWidthBounds(1568)).toEqual({ min: 320, max: 640 });
    expect(conversationWidthBounds(900)).toEqual({ min: 320, max: 405 });
    expect(conversationWidthBounds(600)).toEqual({ min: 320, max: 320 });

    const widened = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: "conversation.resized",
      width: 900,
    });
    expect(widened.conversation.width).toBe(640);

    const narrowedViewport = visualWorkspaceReducer(widened, {
      type: "viewport.resized",
      viewportWidth: 900,
    });
    expect(narrowedViewport.conversation.width).toBe(405);
  });

  // The separator reads its aria bounds from this state, so a viewport change
  // that leaves the panel width alone must still be observable.
  it("tracks the viewport width even when the clamped panel width is unchanged", () => {
    const initial = createVisualWorkspaceState(1568);
    expect(initial.viewportWidth).toBe(1568);

    const wider = visualWorkspaceReducer(initial, {
      type: "viewport.resized",
      viewportWidth: 1600,
    });
    expect(wider.conversation.width).toBe(initial.conversation.width);
    expect(wider.viewportWidth).toBe(1600);

    // A drag clamps against the viewport the state already knows.
    const dragged = visualWorkspaceReducer(
      visualWorkspaceReducer(wider, {
        type: "viewport.resized",
        viewportWidth: 900,
      }),
      { type: "conversation.resized", width: 900 },
    );
    expect(dragged.conversation.width).toBe(405);
  });
});

describe("selected diagram subjects", () => {
  it("normalizes a node into a selected element, trimming its description", () => {
    const selected = normalizeSelectedElement(
      canvasNode({
        id: "rendered-node",
        name: "API",
        kindLabel: "service",
        description: "  Handles requests.  ",
      }),
    );
    expect(selected).toEqual({
      type: "element",
      id: "rendered-node",
      title: "API",
      kind: "service",
      description: "Handles requests.",
    });
  });

  it("treats absent or blank descriptions as missing", () => {
    expect(
      normalizeSelectedElement(canvasNode({ description: null })).description,
    ).toBeNull();
    expect(
      normalizeSelectedElement(canvasNode({ description: "   " })).description,
    ).toBeNull();
  });

  it("preserves edge endpoints and falls back to the id for unknown titles", () => {
    const selected = normalizeSelectedRelationship(
      canvasEdge({
        id: "edge-1",
        from: "missing-source",
        to: "api",
        name: "routes to",
        description: "  Requests cross this boundary.  ",
        kindLabel: "sync",
      }),
      new Map([["api", "API"]]),
    );
    expect(selected).toEqual({
      type: "relationship",
      id: "edge-1",
      sourceId: "missing-source",
      sourceTitle: "missing-source",
      targetId: "api",
      targetTitle: "API",
      label: "routes to",
      description: "Requests cross this boundary.",
      kind: "sync",
    });
  });

  it("formats the exact visible text sent through the existing chat seam", () => {
    expect(formatContextualQuestion("What owns this?", elementSubject)).toBe(
      "About element “API” (system.api): What owns this?",
    );

    const relationship = normalizeSelectedRelationship(
      canvasEdge({ id: "edge-1", from: "web", to: "api", name: "calls" }),
      new Map([
        ["web", "Web"],
        ["api", "API"],
      ]),
    );
    expect(formatContextualQuestion("Why synchronous?", relationship)).toBe(
      "About relationship “Web → API — calls”: Why synchronous?",
    );
    expect(formatContextualQuestion("  General question  ", null)).toBe(
      "General question",
    );
  });
});

describe("visualWorkspaceReducer layout", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("starts on the layered backend", () => {
    expect(workspaceState.layout).toBe("layered");
  });

  it("carries the layout through layout.set", () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: "layout.set",
      layout: "layered",
    });
    expect(next.layout).toBe("layered");
  });

  it("adopts a selected view declared layout", () => {
    const actions = presentationActionsFor({ layout: "layered" });
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next.layout).toBe("layered");
  });

  // A view may still declare `direction` - the LikeC4 export reads it - and
  // the canvas must take no notice: it draws ArchiMate, which is top-down by
  // construction, and there is no control for a declared direction to move.
  it("ignores a direction a view declares", () => {
    const actions = presentationActionsFor({
      layout: "layered",
      direction: "left-right",
    } as Parameters<typeof presentationActionsFor>[0]);
    expect(actions).toEqual([
      { type: "layout.set", layout: "layered" },
      { type: "nesting.set", nesting: ["composition"] },
    ]);
  });

  it("leaves layout untouched when a view declares none", () => {
    const actions = presentationActionsFor({});
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next).toBe(workspaceState);
  });

  // `nesting` is the one field a view always states, declared or not. The
  // others are things a reviewer can toggle on screen, so leaving one unset
  // rightly keeps their choice across a view switch. Nesting has no control:
  // it is a property of the view, and carrying one view's containment meaning
  // into a view that never asked for it is exactly the ambiguity ADR 0101
  // exists to prevent, so an undeclaring view is restored to the default.
  it("adopts only the field a view actually declares", () => {
    const actions = presentationActionsFor({ layout: "layered" });
    expect(actions).toEqual([
      { type: "layout.set", layout: "layered" },
      { type: "nesting.set", nesting: ["composition"] },
    ]);
  });
});

describe("visualWorkspaceReducer presentation", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("starts with lifecycle and evidence badges on and ownership off", () => {
    expect(workspaceState.showLifecycle).toBe(true);
    expect(workspaceState.showEvidence).toBe(true);
    expect(workspaceState.showOwnership).toBe(false);
  });

  it.each([
    ["showLifecycle", false] as const,
    ["showEvidence", false] as const,
    ["showOwnership", true] as const,
  ])("sets %s to %s on presentation.toggled", (flag, value) => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: "presentation.toggled",
      flag,
      value,
    });
    expect(next[flag]).toBe(value);
  });

  it("leaves the other two flags untouched when one is toggled", () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: "presentation.toggled",
      flag: "showOwnership",
      value: true,
    });
    expect(next.showLifecycle).toBe(workspaceState.showLifecycle);
    expect(next.showEvidence).toBe(workspaceState.showEvidence);
  });

  it("adopts a selected view declared presentation flags", () => {
    const actions = presentationActionsFor({
      showLifecycle: false,
      showEvidence: false,
      showOwnership: true,
    });
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next.showLifecycle).toBe(false);
    expect(next.showEvidence).toBe(false);
    expect(next.showOwnership).toBe(true);
  });

  it("leaves presentation flags untouched when a view declares none of them", () => {
    const actions = presentationActionsFor({});
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next).toBe(workspaceState);
  });

  it("adopts only the presentation flag a view actually declares", () => {
    const actions = presentationActionsFor({ showOwnership: true });
    expect(actions).toEqual([
      { type: "nesting.set", nesting: ["composition"] },
      { type: "presentation.toggled", flag: "showOwnership", value: true },
    ]);
  });
});

describe("visualWorkspaceReducer connection", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  const start = (from: string) =>
    visualWorkspaceReducer(workspaceState, {
      type: "connection.started",
      from,
    });

  it("is not in use until it is started", () => {
    expect(workspaceState.connection).toBeNull();
  });

  it("holds the source, and no target yet", () => {
    expect(start("orders").connection).toEqual({ from: "orders", to: null });
  });

  it("takes a target", () => {
    const next = visualWorkspaceReducer(start("orders"), {
      type: "connection.targeted",
      to: "billing",
    });
    expect(next.connection).toEqual({ from: "orders", to: "billing" });
  });

  it("treats naming the source again as backing out", () => {
    // A subject related to itself is a mis-click far more often than an
    // intention, and `association` would be offered for it regardless.
    const next = visualWorkspaceReducer(start("orders"), {
      type: "connection.targeted",
      to: "orders",
    });
    expect(next.connection).toBeNull();
  });

  it("ignores a target when nothing is being drawn", () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: "connection.targeted",
      to: "billing",
    });
    expect(next).toBe(workspaceState);
  });

  it("starting again replaces the draft rather than stacking one", () => {
    const next = visualWorkspaceReducer(start("orders"), {
      type: "connection.started",
      from: "billing",
    });
    expect(next.connection).toEqual({ from: "billing", to: null });
  });

  it("cancels, and cancelling nothing changes nothing", () => {
    expect(
      visualWorkspaceReducer(start("orders"), { type: "connection.cancelled" })
        .connection,
    ).toBeNull();
    expect(
      visualWorkspaceReducer(workspaceState, { type: "connection.cancelled" }),
    ).toBe(workspaceState);
  });

  it("does not hold the kinds on offer, which are a function of the endpoints", () => {
    // Storing them would let a stale palette outlive the model frame it came
    // from; `connectableKinds` derives them at render.
    const next = visualWorkspaceReducer(start("orders"), {
      type: "connection.targeted",
      to: "billing",
    });
    expect(Object.keys(next.connection ?? {}).sort()).toEqual(["from", "to"]);
  });
});

describe("visualWorkspaceReducer subject draft", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("is closed until it is opened", () => {
    expect(workspaceState.draftingSubject).toBe(false);
    expect(
      visualWorkspaceReducer(workspaceState, { type: "subject.draft.opened" })
        .draftingSubject,
    ).toBe(true);
  });

  it("closing a form that is not open changes nothing", () => {
    expect(
      visualWorkspaceReducer(workspaceState, { type: "subject.draft.closed" }),
    ).toBe(workspaceState);
  });

  it("the two tools are alternatives, not layers", () => {
    // Opening one puts the other away, rather than leaving two half-finished
    // drafts on screen with no way to tell which a click belongs to.
    const connecting = visualWorkspaceReducer(workspaceState, {
      type: "connection.started",
      from: "orders",
    });
    const drafting = visualWorkspaceReducer(connecting, {
      type: "subject.draft.opened",
    });
    expect(drafting.connection).toBeNull();
    expect(drafting.draftingSubject).toBe(true);

    const backToConnecting = visualWorkspaceReducer(drafting, {
      type: "connection.started",
      from: "orders",
    });
    expect(backToConnecting.draftingSubject).toBe(false);
    expect(backToConnecting.connection).toEqual({ from: "orders", to: null });
  });
});

describe("visualWorkspaceReducer deletion", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("holds what was asked for until it is answered", () => {
    const asked = visualWorkspaceReducer(workspaceState, {
      type: "deletion.asked",
      id: "orders",
    });
    expect(asked.pendingDeletion).toBe("orders");
    expect(
      visualWorkspaceReducer(asked, { type: "deletion.dismissed" })
        .pendingDeletion,
    ).toBeNull();
  });

  it("dismissing when nothing was asked changes nothing", () => {
    expect(
      visualWorkspaceReducer(workspaceState, { type: "deletion.dismissed" }),
    ).toBe(workspaceState);
  });

  it("puts the other tools away, so only the confirmation takes the next click", () => {
    const connecting = visualWorkspaceReducer(workspaceState, {
      type: "connection.started",
      from: "orders",
    });
    const drafting = visualWorkspaceReducer(connecting, {
      type: "subject.draft.opened",
    });
    const asked = visualWorkspaceReducer(drafting, {
      type: "deletion.asked",
      id: "orders",
    });

    expect(asked.connection).toBeNull();
    expect(asked.draftingSubject).toBe(false);
    expect(asked.pendingDeletion).toBe("orders");
  });
});

describe("visualWorkspaceReducer nesting", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("starts at composition alone, the behaviour that shipped", () => {
    expect(workspaceState.nesting).toEqual(["composition"]);
  });

  it("adopts the vocabulary a view declares", () => {
    const actions = presentationActionsFor({
      nesting: ["composition", "assignment"],
    });
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next.nesting).toEqual(["composition", "assignment"]);
  });

  it("restores the default when the next view declares none", () => {
    // The point of ADR 0101: a view that never asked for assignment nesting
    // must not inherit it from the view before, or its nested boxes mean
    // something nothing on screen explains.
    const nested = presentationActionsFor({
      nesting: ["composition", "assignment"],
    }).reduce(visualWorkspaceReducer, workspaceState);
    expect(nested.nesting).toEqual(["composition", "assignment"]);

    const plain = presentationActionsFor({}).reduce(
      visualWorkspaceReducer,
      nested,
    );
    expect(plain.nesting).toEqual(["composition"]);
  });

  it("honours a view that turns nesting off entirely", () => {
    const actions = presentationActionsFor({ nesting: [] });
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next.nesting).toEqual([]);
  });

  it("treats restating the same vocabulary as no change at all", () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: "nesting.set",
      nesting: ["composition"],
    });
    expect(next).toBe(workspaceState);
  });
});

describe("viewNeedingApplication", () => {
  const views = [
    { id: "engine-components" },
    { id: "product-context" },
  ] as const;

  it("claims the view the session opened on, which no tree click applied", () => {
    const view = viewNeedingApplication("engine-components", views, null, true);
    expect(view).toBe(views[0]);
  });

  it("applies a view exactly once", () => {
    const view = viewNeedingApplication(
      "engine-components",
      views,
      "engine-components",
      true,
    );
    expect(view).toBeNull();
  });

  it('re-arms the view a reviewer returns to after clearing to "All"', () => {
    // Clearing empties `activeView`, which resets the applied record; picking
    // the same view again has to reapply its query and presentation.
    expect(
      viewNeedingApplication("", views, "engine-components", true),
    ).toBeNull();
    expect(viewNeedingApplication("engine-components", views, null, true)).toBe(
      views[0],
    );
  });

  it("waits for the summary rather than applying a view it cannot read", () => {
    expect(
      viewNeedingApplication("engine-components", [], null, true),
    ).toBeNull();
  });

  it("waits for the socket, since a query sent before it opens is dropped", () => {
    // The opening snapshot arrives over HTTP first; applying the view then
    // would burn the one application on a wire that cannot carry the query.
    expect(
      viewNeedingApplication("engine-components", views, null, false),
    ).toBeNull();
    expect(viewNeedingApplication("engine-components", views, null, true)).toBe(
      views[0],
    );
  });
});

describe("the left rail's own state", () => {
  const base = createVisualWorkspaceState(1440);

  it("starts with every branch open and nothing typed", () => {
    expect(base.tree).toEqual({ filterText: "", collapsed: [] });
  });

  it("records only the branches the reviewer shut", () => {
    const shut = visualWorkspaceReducer(base, {
      type: "tree.toggled",
      key: "model-layer:application",
    });
    expect(shut.tree.collapsed).toEqual(["model-layer:application"]);

    const reopened = visualWorkspaceReducer(shut, {
      type: "tree.toggled",
      key: "model-layer:application",
    });
    // Back to empty rather than to a list of explicit opens: a folder that
    // appears later must arrive open, not hidden behind a default nobody set.
    expect(reopened.tree.collapsed).toEqual([]);
  });

  it("holds the rail's filter apart from the one that narrows the canvas", () => {
    const typed = visualWorkspaceReducer(base, {
      type: "tree.filtered",
      filterText: "ledger",
    });
    expect(typed.tree.filterText).toBe("ledger");
    // Restating the same text is not a change, so nothing downstream re-renders.
    expect(
      visualWorkspaceReducer(typed, {
        type: "tree.filtered",
        filterText: "ledger",
      }),
    ).toBe(typed);
  });
});

describe("visualWorkspaceReducer context menu", () => {
  const workspaceState = createVisualWorkspaceState(1280);
  const opened = visualWorkspaceReducer(workspaceState, {
    type: "menu.opened",
    target: { kind: "subject", id: "system.api" },
    x: 120,
    y: 240,
  });

  it("holds what was right-clicked and where, and nothing about the items", () => {
    // The contents are derived on every render, so a commit landing under an
    // open menu cannot leave it pointing at a subject that has gone.
    expect(opened.contextMenu).toEqual({
      target: { kind: "subject", id: "system.api" },
      x: 120,
      y: 240,
    });
  });

  it("is dismissed by everything a menu item can lead to", () => {
    for (const action of [
      { type: "menu.dismissed" },
      { type: "connection.started", from: "system.api" },
      { type: "subject.draft.opened" },
      { type: "deletion.asked", id: "system.api" },
      {
        type: "subject.selected",
        subject: normalizeSelectedElement(canvasNode()),
      },
    ] as const) {
      expect(
        visualWorkspaceReducer(opened, action).contextMenu,
        `${action.type} closes the menu`,
      ).toBeNull();
    }
  });

  it("is dismissed by the commit that can take its target away", () => {
    expect(
      visualWorkspaceReducer(opened, { type: "model.replaced", graph: null })
        .contextMenu,
    ).toBeNull();
  });

  it("survives an agent's reply, which is not something the reviewer did", () => {
    expect(
      visualWorkspaceReducer(opened, { type: "attention.received" }).contextMenu,
    ).toEqual(opened.contextMenu);
  });

  it("dismissing when nothing is open changes nothing", () => {
    expect(
      visualWorkspaceReducer(workspaceState, { type: "menu.dismissed" }),
    ).toBe(workspaceState);
  });
});

describe("the canvas column's bottom panel", () => {
  const workspaceState = createVisualWorkspaceState(1280);

  it("is collapsed at rest, on the tab it will open on", () => {
    // The canvas keeps the room until the reviewer asks for the panel.
    expect(workspaceState.bottomPanel).toEqual({
      open: false,
      tab: "view-query",
    });
  });

  it("opens and shuts on the toggle", () => {
    const opened = visualWorkspaceReducer(workspaceState, {
      type: "bottomPanel.toggled",
    });

    expect(opened.bottomPanel.open).toBe(true);
    expect(
      visualWorkspaceReducer(opened, { type: "bottomPanel.toggled" })
        .bottomPanel.open,
    ).toBe(false);
  });

  it("opens the panel when a tab is named, because naming one asks to read it", () => {
    const selected = visualWorkspaceReducer(workspaceState, {
      type: "bottomPanel.tabSelected",
      tab: "view-query",
    });

    expect(selected.bottomPanel).toEqual({ open: true, tab: "view-query" });
  });

  it("remembers the tab while the panel is shut", () => {
    const shut = visualWorkspaceReducer(
      visualWorkspaceReducer(workspaceState, {
        type: "bottomPanel.tabSelected",
        tab: "view-query",
      }),
      { type: "bottomPanel.toggled" },
    );

    expect(shut.bottomPanel).toEqual({ open: false, tab: "view-query" });
  });

  it("changes nothing when the tab it is already showing is named again", () => {
    const opened = visualWorkspaceReducer(workspaceState, {
      type: "bottomPanel.toggled",
    });

    expect(
      visualWorkspaceReducer(opened, {
        type: "bottomPanel.tabSelected",
        tab: "view-query",
      }),
    ).toBe(opened);
  });
});
