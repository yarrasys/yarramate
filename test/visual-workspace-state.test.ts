import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "../src/graph-projection.js";
import {
  RIGHT_SECTIONS,
  conversationWidthBounds,
  sectionHeightBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  presentationActionsFor,
  viewNeedingApplication,
  visualWorkspaceReducer,
  type RightSectionId,
  type SelectedDiagramSubject,
  type VisualWorkspaceState,
} from "../src/visual-app/workspace-state.js";
import { stackRows } from "../src/visual-app/section-stack.js";

const canvasNode = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "system.api",
  localId: "api",
  kind: "yarramate/core@0.1#applicationComponent",
  kindLabel: "applicationComponent",
  coreKindLabel: "applicationComponent",
  portKinds: [],
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
  it("starts with every section open, at the responsive default width", () => {
    const state = createVisualWorkspaceState(1568);
    expect(state.conversation).toEqual({
      width: expect.closeTo(439.04, 2),
      hidden: false,
      unread: 0,
      collapsed: [],
      changesHeight: 200,
      chatHeight: 300,
    });
  });

  it("caps the default width at 480px on wide viewports", () => {
    expect(createVisualWorkspaceState(1920).conversation).toMatchObject({
      width: 480,
    });
  });

  it("counts an arriving reply only while chat is shut", () => {
    // Chat is a section on screen now, not a panel behind a toggle (#249), so
    // a reply that lands in front of the reviewer needs no count standing in
    // for it. A shut section is the only case where something happened out of
    // sight, and opening it is reading it.
    const initial = createVisualWorkspaceState(1568);
    const seen = visualWorkspaceReducer(initial, {
      type: "attention.received",
    });
    expect(seen.conversation.unread).toBe(0);

    const shut = visualWorkspaceReducer(initial, {
      type: "section.toggled",
      section: "chat",
    });
    const waiting = visualWorkspaceReducer(shut, {
      type: "attention.received",
    });
    expect(waiting.conversation).toMatchObject({
      collapsed: ["chat"],
      unread: 1,
    });

    const reopened = visualWorkspaceReducer(waiting, {
      type: "section.toggled",
      section: "chat",
    });
    expect(reopened.conversation).toMatchObject({ collapsed: [], unread: 0 });
  });

  it("re-reads a held subject from the replacement model and drops it only when removed", () => {
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: "subject.selected",
      subject: elementSubject,
    });
    // Selecting opens the section that describes the selection.
    expect(selected.conversation.collapsed).not.toContain("properties");
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
    expect(renamed.conversation.collapsed).not.toContain("properties");

    // A commit that deleted it, and a session with no model at all: nothing
    // left to point at either way.
    for (const graph of [{ nodes: [], edges: [] }, null]) {
      const gone = visualWorkspaceReducer(selected, {
        type: "model.replaced",
        graph,
      });
      expect(gone.selectedSubject).toBeNull();
      expect(gone.conversation.collapsed).not.toContain("properties");
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

  // A view says which way it runs and the canvas takes notice (#274, ADR
  // 0121). The ArchiMate bands that pinned this top-down keep the DEFAULT, not
  // the only answer: a deployment chain or a fan-out reads better left to
  // right, and the format has carried the field all along for the LikeC4
  // export.
  it("adopts a direction a view declares", () => {
    const actions = presentationActionsFor({
      layout: "layered",
      direction: "left-right",
    });
    expect(actions).toEqual([
      { type: "layout.set", layout: "layered" },
      { type: "nesting.set", nesting: ["composition"] },
      { type: "direction.set", direction: "left-right" },
    ]);
    const next = actions.reduce(visualWorkspaceReducer, workspaceState);
    expect(next.direction).toBe("left-right");
  });

  // Restored to the default rather than left holding the previous view's run,
  // the rule `nesting` follows: a view that says nothing is top-down, and
  // arriving from a left-right view must not tilt it.
  it("restores the default direction for a view that declares none", () => {
    const leftRight = presentationActionsFor({ direction: "left-right" }).reduce(
      visualWorkspaceReducer,
      workspaceState,
    );
    expect(leftRight.direction).toBe("left-right");
    const back = presentationActionsFor({}).reduce(
      visualWorkspaceReducer,
      leftRight,
    );
    expect(back.direction).toBe("top-down");
  });

  // Every identity memo downstream of this state reads its reference, so
  // restating the same direction must not mint a new object - the rule
  // `nesting.set` states for the same reason.
  it("returns the same state when a view restates the direction in force", () => {
    const actions = presentationActionsFor({ direction: "top-down" });
    expect(actions.reduce(visualWorkspaceReducer, workspaceState)).toBe(
      workspaceState,
    );
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
      { type: "direction.set", direction: "top-down" },
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
      { type: "direction.set", direction: "top-down" },
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

/**
 * The right column's sections (#249). The column has no open/closed mode any
 * more: the sections collapse one by one, and three shut headers say what is
 * behind each of them where a shut column said nothing.
 */
describe("the right column's sections", () => {
  const state = createVisualWorkspaceState(1568, 900);

  const toggle = (
    from: VisualWorkspaceState,
    section: RightSectionId,
  ): VisualWorkspaceState =>
    visualWorkspaceReducer(from, { type: "section.toggled", section });

  it("stacks palette, properties, questions, changes and chat, in that order", () => {
    // The palette leads: it is the tool that makes subjects, and tools read
    // above inspection (#295). Chat is pinned at the foot because it owns the
    // session's own control - the reviewer ends the conversation beside the
    // conversation. Questions sit under properties: what is asked about a
    // subject reads beside what is declared about it (#292).
    expect(RIGHT_SECTIONS).toEqual([
      "palette",
      "properties",
      "questions",
      "changes",
      "chat",
    ]);
  });

  it("shuts and reopens one section without touching the others", () => {
    const shut = toggle(state, "changes");
    expect(shut.conversation.collapsed).toEqual(["changes"]);

    const both = toggle(shut, "properties");
    expect(both.conversation.collapsed).toEqual(["changes", "properties"]);

    expect(toggle(both, "changes").conversation.collapsed).toEqual([
      "properties",
    ]);
  });

  it("holds what is CLOSED, so a section added later arrives open", () => {
    // The same rule the rail's branches follow: a default nobody chose should
    // not hide something nobody has seen.
    expect(state.conversation.collapsed).toEqual([]);
  });

  it("drags the height of the section below the handle", () => {
    const dragged = visualWorkspaceReducer(state, {
      type: "section.resized",
      section: "chat",
      height: 320,
    });

    expect(dragged.conversation.chatHeight).toBe(320);
    expect(dragged.conversation.changesHeight).toBe(
      state.conversation.changesHeight,
    );
  });

  it("keeps a section from being dragged shorter than a header or past the window", () => {
    const bounds = sectionHeightBounds(900);
    expect(bounds).toEqual({ min: 96, max: 740 });

    expect(
      visualWorkspaceReducer(state, {
        type: "section.resized",
        section: "chat",
        height: 10,
      }).conversation.chatHeight,
    ).toBe(96);
    expect(
      visualWorkspaceReducer(state, {
        type: "section.resized",
        section: "chat",
        height: 5_000,
      }).conversation.chatHeight,
    ).toBe(740);
  });

  it("re-clamps the sections when the window gets shorter", () => {
    // Held against the viewport the state was clamped for, never read live:
    // a shorter window changes what a splitter may be dragged to, and a render
    // that read the global would only say so by accident.
    const short = visualWorkspaceReducer(state, {
      type: "viewport.resized",
      viewportWidth: 1568,
      viewportHeight: 400,
    });

    expect(short.conversation.chatHeight).toBe(240);
    expect(short.viewportHeight).toBe(400);
  });

  it("changes nothing when a drag lands on the height it already has", () => {
    expect(
      visualWorkspaceReducer(state, {
        type: "section.resized",
        section: "chat",
        height: state.conversation.chatHeight,
      }),
    ).toBe(state);
  });
});

/**
 * The whole column can leave (#294). Hiding is a mode beside the width, not a
 * zero width: the width stays what it was, so reopening restores the layout -
 * sections, splitters and dragged width intact - and the reopen strip carries
 * the attention the hidden column would have shown.
 */
describe("the right column can leave (#294)", () => {
  const state = createVisualWorkspaceState(1568, 900);
  const toggled = (from: VisualWorkspaceState): VisualWorkspaceState =>
    visualWorkspaceReducer(from, { type: "conversation.toggled" });

  it("starts on screen: hiding is a gesture, never a resting state", () => {
    expect(state.conversation.hidden).toBe(false);
  });

  it("hides on the toggle, leaving the width and sections untouched", () => {
    const shutChanges = visualWorkspaceReducer(state, {
      type: "section.toggled",
      section: "changes",
    });
    const hidden = toggled(shutChanges);

    expect(hidden.conversation.hidden).toBe(true);
    expect(hidden.conversation.width).toBe(state.conversation.width);
    expect(hidden.conversation.collapsed).toEqual(["changes"]);
  });

  it("reopens at the previous dragged width, splitters intact", () => {
    const dragged = visualWorkspaceReducer(
      visualWorkspaceReducer(state, {
        type: "conversation.resized",
        width: 560,
      }),
      { type: "section.resized", section: "chat", height: 360 },
    );
    const reopened = toggled(toggled(dragged));

    expect(reopened.conversation.hidden).toBe(false);
    expect(reopened.conversation.width).toBe(560);
    expect(reopened.conversation.chatHeight).toBe(360);
  });

  it("ignores a resize while hidden: no separator is on screen to drag", () => {
    // Honouring a stray resize would make reopening restore a width the
    // reviewer never dragged to.
    const hidden = toggled(state);
    expect(
      visualWorkspaceReducer(hidden, {
        type: "conversation.resized",
        width: 640,
      }),
    ).toBe(hidden);
  });

  it("survives a viewport resize, and the held width is still re-clamped", () => {
    // The mode is not the width: a window that narrows while the column is
    // away must still leave a width the reopen can legally restore.
    const wide = toggled(
      visualWorkspaceReducer(state, {
        type: "conversation.resized",
        width: 640,
      }),
    );
    const narrowed = visualWorkspaceReducer(wide, {
      type: "viewport.resized",
      viewportWidth: 900,
    });

    expect(narrowed.conversation.hidden).toBe(true);
    expect(narrowed.conversation.width).toBe(405);
  });

  it("counts what arrives while hidden, and reopening reads it", () => {
    // The whole column away is chat out of sight, whatever the section list
    // says - and reopening puts chat back in front of the reviewer, so the
    // count goes the way it goes when the section itself is opened.
    const waiting = visualWorkspaceReducer(toggled(state), {
      type: "attention.received",
    });
    expect(waiting.conversation.unread).toBe(1);

    expect(toggled(waiting).conversation.unread).toBe(0);
  });

  it("keeps the count for a chat the reviewer had shut before hiding", () => {
    // Reopening the column does not open the chat section, so the arrival is
    // still out of sight: the count moves to the chat header instead.
    const shutChat = visualWorkspaceReducer(state, {
      type: "section.toggled",
      section: "chat",
    });
    const waiting = visualWorkspaceReducer(toggled(shutChat), {
      type: "attention.received",
    });
    const reopened = toggled(waiting);

    expect(reopened.conversation.hidden).toBe(false);
    expect(reopened.conversation).toMatchObject({
      collapsed: ["chat"],
      unread: 1,
    });
  });
});

/**
 * Which rows the stack draws, given the sections a host asked for (#252).
 * A handle sits between two sections; the first present one never gets one.
 */
describe("stackRows", () => {
  const bodies = {
    palette: "palette-body",
    properties: "properties-body",
    questions: "questions-body",
    changes: "changes-body",
    chat: "chat-body",
  } as const;
  const splitters = {
    changes: "changes-splitter",
    chat: "chat-splitter",
  } as const;
  const rows = (sections: readonly RightSectionId[]) =>
    stackRows(sections, bodies, splitters).map(
      (row) => (row as { readonly key: string | null }).key,
    );

  it("draws every section and the handles between them by default", () => {
    expect(rows(RIGHT_SECTIONS)).toEqual([
      "palette",
      "properties",
      "questions",
      "splitter-changes",
      "changes",
      "splitter-chat",
      "chat",
    ]);
  });

  it("takes a section's handle away with the section", () => {
    expect(rows(["properties", "chat"])).toEqual([
      "properties",
      "splitter-chat",
      "chat",
    ]);
  });

  it("gives a lone section no handle at all", () => {
    // Nothing to resize it against, and a stray handle at the top of the
    // column is the kind of thing only the configuration nobody rendered has.
    expect(rows(["chat"])).toEqual(["chat"]);
    expect(rows(["properties"])).toEqual(["properties"]);
  });

  it("keeps the stack's own order, whatever order the host wrote", () => {
    // The sequence means something - properties above changes above chat, which
    // is pinned at the foot - so a host cannot reorder the shell by writing its
    // array differently.
    expect(
      rows(["chat", "questions", "palette", "properties", "changes"]),
    ).toEqual(rows(RIGHT_SECTIONS));
  });

  it("draws nothing for a host that asked for nothing", () => {
    expect(rows([])).toEqual([]);
  });
});
