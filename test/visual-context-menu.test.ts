import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextMenu } from "../src/visual-app/context-menu.js";
import type { CanvasEdge, CanvasGraph, CanvasNode } from "../src/graph-projection.js";
import type { VisualKindOption } from "../src/adapters/visual/protocol-contract.js";
import {
  contextMenuFor,
  placeMenu,
  type ContextMenuContext,
  type ContextMenuGroup,
} from "../src/visual-app/context-menu-model.js";
import { relationshipKindOffer } from "../src/visual-app/relationship-kind-options.js";

const node = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "api",
  localId: "api",
  kind: "yarramate/core@0.1#applicationComponent",
  kindLabel: "applicationComponent",
  coreKindLabel: "applicationComponent",
  document: "main.yaml",
  layer: "application",
  aspect: null,
  name: "API",
  description: null,
  aka: [],
  status: null,
  owner: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
  ...overrides,
});

const edge = (overrides: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: "api-serving-ui",
  localId: "api-serving-ui",
  document: "main.yaml",
  kind: "yarramate/core@0.1#serving",
  kindLabel: "serving",
  coreKindLabel: "serving",
  from: "api",
  to: "ui",
  name: null,
  description: null,
  mode: null,
  content: null,
  status: null,
  references: [],
  presentIn: [],
  ...overrides,
});

/**
 * A different row of the table on purpose: `applicationComponent ->
 * businessActor` permits association, flow, serving and triggering, and
 * refuses composition. Two application components would have permitted
 * composition, and a narrowing that removes nothing proves nothing.
 */
const reviewer = node({
  id: "ui",
  localId: "ui",
  name: "Reviewer",
  kind: "yarramate/core@0.1#businessActor",
  kindLabel: "businessActor",
  coreKindLabel: "businessActor",
  layer: "business",
});

const graph: CanvasGraph = {
  nodes: [node(), reviewer],
  edges: [edge()],
};

/** A core kind stands for itself; an extension names what it descends from. */
const kind = (label: string, coreLabel: string = label): VisualKindOption => ({
  id: `yarramate/core@0.1#${label}`,
  label,
  coreLabel,
});

const VOCABULARY: readonly VisualKindOption[] = [
  kind("association"),
  kind("serving"),
  kind("triggering"),
  kind("composition"),
];

const context = (
  overrides: Partial<ContextMenuContext> = {},
): ContextMenuContext => ({
  graph,
  relationshipKinds: VOCABULARY,
  activeViewId: "",
  filtered: false,
  ...overrides,
});

const labels = (groups: readonly ContextMenuGroup[]): readonly string[] =>
  groups.flatMap((group) => group.items.map((item) => item.label));

describe("the view/model split every menu has to teach", () => {
  it("never puts a model group before a view group", () => {
    for (const target of [
      { kind: "subject", id: "api" },
      { kind: "relationship", id: "api-serving-ui" },
      { kind: "canvas" },
      { kind: "view-row", id: "current" },
      { kind: "model-row", id: "api" },
    ] as const) {
      const groups = contextMenuFor(target, context({ filtered: true }));
      const lastView = groups.findLastIndex((group) => group.scope === "view");
      const firstModel = groups.findIndex((group) => group.scope === "model");
      if (lastView === -1 || firstModel === -1) continue;
      expect(lastView, `${target.kind} orders view before model`).toBeLessThan(
        firstModel,
      );
    }
  });

  it("puts the destructive group last, alone, and only once", () => {
    for (const target of [
      { kind: "subject", id: "api" },
      { kind: "relationship", id: "api-serving-ui" },
      { kind: "model-row", id: "api" },
    ] as const) {
      const groups = contextMenuFor(target, context());
      const destructive = groups.filter((group) => group.destructive);
      expect(destructive).toHaveLength(1);
      expect(groups[groups.length - 1]?.destructive).toBe(true);
      // A rule the reviewer can slip past is no rule: one item behind it.
      expect(destructive[0]?.items).toHaveLength(1);
    }
  });

  it("gives a view row nothing that edits the model", () => {
    // Including its delete: removing a view rewrites one projection and leaves
    // every subject alone, which is exactly the distinction the rule teaches.
    const groups = contextMenuFor({ kind: "view-row", id: "current" }, context());
    expect(groups.every((group) => group.scope === "view")).toBe(true);
    expect(labels(groups)).toEqual([
      "Open view",
      "New view…",
      "Delete view…",
    ]);
  });
});

describe("what each menu offers", () => {
  it("offers the canvas a view group and a model group", () => {
    const groups = contextMenuFor({ kind: "canvas" }, context());
    expect(groups.map((group) => group.label)).toEqual(["View", "Model"]);
    expect(labels(groups)).toEqual(["New view…", "Add subject…"]);
  });

  it("offers to show all only while something is narrowing the canvas", () => {
    expect(labels(contextMenuFor({ kind: "canvas" }, context()))).not.toContain(
      "Show all subjects",
    );
    expect(
      labels(contextMenuFor({ kind: "canvas" }, context({ filtered: true }))),
    ).toContain("Show all subjects");
  });

  it("marks the view already open", () => {
    const groups = contextMenuFor(
      { kind: "view-row", id: "current" },
      context({ activeViewId: "current" }),
    );
    expect(groups[0]?.items[0]?.current).toBe(true);
  });

  it("gives the all-subjects row the clearing item, not an open", () => {
    const groups = contextMenuFor({ kind: "view-row", id: "" }, context());
    expect(labels(groups)).toEqual(["Show all subjects", "New view…"]);
  });

  it("draws nothing for a target the model no longer holds", () => {
    // A commit can replace the model between the right-click and the render.
    expect(contextMenuFor({ kind: "subject", id: "gone" }, context())).toEqual([]);
    expect(
      contextMenuFor({ kind: "relationship", id: "gone" }, context()),
    ).toEqual([]);
    expect(
      contextMenuFor({ kind: "canvas" }, context({ graph: null })),
    ).toEqual([]);
  });

  it("names the intent rather than carrying a callback", () => {
    const groups = contextMenuFor({ kind: "subject", id: "api" }, context());
    expect(groups.flatMap((group) => group.items.map((item) => item.intent)))
      .toEqual([
        { type: "subject.inspect", id: "api" },
        { type: "subject.connect", from: "api" },
        { type: "subject.delete", id: "api" },
      ]);
  });
});

describe("a menu cannot draw an edge the compiler would refuse", () => {
  it("offers only kinds the endpoint pairing permits", () => {
    const groups = contextMenuFor(
      { kind: "relationship", id: "api-serving-ui" },
      context(),
    );
    const kinds = groups.find((group) => group.key === "kind");
    expect(kinds).toBeDefined();
    // `composition` between two application components is refused by the
    // ArchiMate table, so the menu must not be able to produce it.
    expect(kinds!.items.map((item) => item.label)).not.toContain("composition");
    expect(kinds!.items.map((item) => item.label)).toContain("serving");
  });

  it("marks the kind the edge already has", () => {
    const groups = contextMenuFor(
      { kind: "relationship", id: "api-serving-ui" },
      context(),
    );
    const kinds = groups.find((group) => group.key === "kind");
    const current = kinds!.items.filter((item) => item.current === true);
    expect(current.map((item) => item.label)).toEqual(["serving"]);
  });

  it("drops the change-kind group when there is no other kind to pick", () => {
    const groups = contextMenuFor(
      { kind: "relationship", id: "api-serving-ui" },
      context({ relationshipKinds: [kind("serving")] }),
    );
    expect(groups.some((group) => group.key === "kind")).toBe(false);
  });
});

describe("relationshipKindOffer", () => {
  it("keeps the kind the edge already has, even when the table refuses it", () => {
    // A model authored outside this editor is not the editor's to rewrite,
    // and a select whose current value is missing renders blank.
    const offer = relationshipKindOffer(
      graph,
      { from: "api", to: "ui" },
      VOCABULARY,
      "composition",
    );
    expect(offer.narrowed).toBe(true);
    expect(offer.options.map((option) => option.label)).toContain("composition");
  });

  it("judges nothing when an endpoint sits outside the core vocabulary", () => {
    const extended: CanvasGraph = {
      nodes: [node({ coreKindLabel: "notAKind" }), reviewer],
      edges: [edge()],
    };
    const offer = relationshipKindOffer(
      extended,
      { from: "api", to: "ui" },
      VOCABULARY,
      "serving",
    );
    expect(offer.narrowed).toBe(false);
    expect(offer.options).toEqual(VOCABULARY);
  });

  it("judges an extension kind by what it descends from", () => {
    // `implements` extending `realization` is refused between an application
    // component and a business actor exactly as `realization` is. Before
    // `coreLabel` existed the browser could not see this, so every extension
    // kind was offered unchecked and the menu could produce a YM404 after all.
    const observes = kind("observes", "association");
    const implementsKind = kind("implements", "realization");
    const offer = relationshipKindOffer(
      graph,
      { from: "api", to: "ui" },
      [...VOCABULARY, observes, implementsKind],
      "serving",
    );
    expect(offer.narrowed).toBe(true);
    const offered = offer.options.map((option) => option.label);
    expect(offered).toContain("observes");
    expect(offered).not.toContain("implements");
  });

  it("offers a kind whose lineage never reaches the table at all", () => {
    // No row exists to judge it against, so refusing it would be a guess.
    const offer = relationshipKindOffer(
      graph,
      { from: "api", to: "ui" },
      [...VOCABULARY, kind("annotates", "annotates")],
      "serving",
    );
    expect(offer.options.map((option) => option.label)).toContain("annotates");
  });

  it("follows the endpoints it is given, not the ones the edge was authored with", () => {
    const both = relationshipKindOffer(
      graph,
      { from: "api", to: "api" },
      VOCABULARY,
      "serving",
    );
    // Same subject on both ends is a different row of the table; the point is
    // that the answer is computed from the endpoints passed in.
    expect(both.narrowed).toBe(true);
  });
});

describe("placeMenu", () => {
  const size = { width: 200, height: 300 };
  const viewport = { width: 1000, height: 800 };

  it("sits at the pointer when there is room", () => {
    expect(placeMenu({ x: 100, y: 100 }, size, viewport)).toEqual({
      left: 100,
      top: 100,
    });
  });

  it("flips to the other side of the pointer at the right edge", () => {
    expect(placeMenu({ x: 950, y: 100 }, size, viewport).left).toBe(750);
  });

  it("flips above the pointer at the bottom edge", () => {
    expect(placeMenu({ x: 100, y: 780 }, size, viewport).top).toBe(480);
  });

  it("clamps to the viewport rather than going negative", () => {
    // A menu taller than the window: the top is the last thing to give up.
    expect(placeMenu({ x: 10, y: 10 }, { width: 200, height: 900 }, viewport))
      .toEqual({ left: 10, top: 0 });
  });
});

/**
 * Asserted on the markup rather than on the groups, because the rule is only
 * a rule once it is drawn: a model returning `destructive: true` over a
 * component that renders every group identically would still pass every
 * assertion above while the menu put Delete next to Properties.
 */
describe("what the menu draws", () => {
  const render = (target: Parameters<typeof contextMenuFor>[0]) =>
    renderToStaticMarkup(
      createElement(ContextMenu, {
        groups: contextMenuFor(target, context({ filtered: true })),
        x: 0,
        y: 0,
        onChoose: () => {},
        onDismiss: () => {},
      }),
    );

  it("draws Delete behind the rule, and nothing else with it", () => {
    const markup = render({ kind: "subject", id: "api" });
    // Everything after the destructive class opens is that group and no other,
    // because it is the last group in the menu.
    const behindTheRule = markup.slice(
      markup.indexOf("context-menu-destructive"),
    );
    expect(behindTheRule).toContain("Delete from model…");
    expect(behindTheRule).not.toContain("Properties");
    expect(behindTheRule).not.toContain("Connect from here…");
    // And Delete is not also drawn anywhere in front of it.
    expect(
      markup.slice(0, markup.indexOf("context-menu-destructive")),
    ).not.toContain("Delete");
  });

  it("names each scope, so the split is read rather than inferred", () => {
    const markup = render({ kind: "canvas" });
    expect(markup).toContain("context-menu-view");
    expect(markup).toContain("context-menu-model");
    expect(markup).toContain(">View<");
    expect(markup).toContain(">Model<");
  });

  it("draws no destructive group where there is nothing to destroy", () => {
    // The empty canvas destroys nothing; "All subjects" is the absence of a
    // view rather than a document, so it has no delete either.
    expect(render({ kind: "canvas" })).not.toContain(
      "context-menu-destructive",
    );
    expect(render({ kind: "view-row", id: "" })).not.toContain(
      "context-menu-destructive",
    );
  });

  it("puts a view's own delete behind the same rule, in the same red", () => {
    const markup = render({ kind: "view-row", id: "current" });
    const behindTheRule = markup.slice(
      markup.indexOf("context-menu-destructive"),
    );

    expect(behindTheRule).toContain("Delete view…");
    expect(behindTheRule).not.toContain("Open view");
    // Still a view-scope group: what it destroys is a projection, not a
    // subject, and the reviewer learns one rule about where danger sits.
    expect(markup).toContain("context-menu-view context-menu-destructive");
  });

  it("draws nothing at all for a target that has gone", () => {
    expect(render({ kind: "subject", id: "gone" })).toBe("");
  });
});
