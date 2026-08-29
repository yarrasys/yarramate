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
  portKinds: [],
  document: "main.yaml",
  layer: "application",
  aspect: null,
  name: "API",
  description: null,
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
  portKinds: [],
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
  membership: null,
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
      "Rename…",
      "Duplicate",
      "New view in this folder…",
      "New view…",
      "New folder…",
      "Copy projection path",
      "Delete view…",
    ]);
  });
});

describe("what each menu offers", () => {
  it("offers the canvas a view group and a model group", () => {
    const groups = contextMenuFor({ kind: "canvas" }, context());
    expect(groups.map((group) => group.label)).toEqual(["View", "Model"]);
    expect(labels(groups)).toEqual([
      "New view…",
      "New folder…",
      "Export PNG",
      "Add subject…",
    ]);
  });

  it("gives the all-subjects row no rename, duplicate or path to copy", () => {
    // It is the absence of a view, not a document: there is nothing to
    // retitle, nothing to copy, and no folder of its own to add a sibling to.
    // Making a view, and making a folder to put one in, still make sense here.
    expect(labels(contextMenuFor({ kind: "view-row", id: "" }, context()))).toEqual(
      ["Show all subjects", "New view…", "New folder…"],
    );
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
    expect(labels(groups)).toEqual([
      "Show all subjects",
      "New view…",
      "New folder…",
    ]);
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
        // Focus leads the view group even with no view active: narrowing to a
        // subject needs no view to narrow within (#407).
        { type: "subject.focus", id: "api" },
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

/**
 * Membership is a VIEW operation on a MODEL subject, which is exactly the pair
 * the split exists to keep apart: removing a subject from a view rewrites one
 * projection, and the item one group below it takes the subject out of the
 * model entirely (#255).
 */
describe("putting a subject into a view, and taking it out", () => {
  const held = context({
    membership: { kind: "enumerated", subjects: ["api", "ui"] },
  });
  const notHeld = context({
    membership: { kind: "enumerated", subjects: ["ui"] },
  });

  it("offers Remove from view for a subject the view lists", () => {
    expect(labels(contextMenuFor({ kind: "subject", id: "api" }, held))).toEqual(
      [
        "Focus on this",
        "Remove from view",
        "Properties",
        "Connect from here…",
        "Delete from model…",
      ],
    );
  });

  it("offers Add to this view for one it does not", () => {
    // A subject can be DRAWN without being listed - `relationships: connected`
    // takes the other end of a relationship with it - so what is on the canvas
    // does not settle what the list says.
    expect(
      labels(contextMenuFor({ kind: "subject", id: "api" }, notHeld)),
    ).toContain("Add to this view");
  });

  it("offers neither where no view is active", () => {
    // Nothing to tell: the item would have no document to write to at all.
    const groups = contextMenuFor({ kind: "subject", id: "api" }, context());
    expect(labels(groups)).not.toContain("Remove from view");
    expect(labels(groups)).not.toContain("Add to this view");
    // The view group survives because Focus lives in it and needs no view
    // (#407); what must be absent is any item that would write to one.
    expect(
      groups
        .filter((group) => group.scope === "view")
        .flatMap((group) => group.items.map((item) => item.label)),
    ).toEqual(["Focus on this"]);
  });

  // A facet view states a rule, and the exception it cannot state is exactly
  // where a reviewer most wants to say "not that one" (#267, ADR 0122). The
  // group used to vanish here on the reasoning that an item which could only
  // ever do nothing is worse than no item - true of ADDING a subject to a
  // rule, and never true of taking one out of it.
  describe("a view that describes its subjects with facets", () => {
    const faceted = context({ membership: { kind: "faceted", excluded: [] } });
    const withException = context({
      membership: { kind: "faceted", excluded: ["api"] },
    });

    it("offers Remove from view, which stages the exception", () => {
      expect(
        labels(contextMenuFor({ kind: "subject", id: "api" }, faceted)),
      ).toContain("Remove from view");
    });

    it("offers Add to this view only to lift an exception it already holds", () => {
      expect(
        labels(contextMenuFor({ kind: "subject", id: "api" }, withException)),
      ).toContain("Add to this view");
      // The other subject is not excepted, so its own offer is the removal.
      expect(
        labels(contextMenuFor({ kind: "subject", id: "ui" }, withException)),
      ).toContain("Remove from view");
    });
  });

  it("gives the rail's model rows the same offer, which is what a drag would do", () => {
    expect(
      labels(contextMenuFor({ kind: "model-row", id: "api" }, notHeld)),
    ).toEqual(["Add to this view", "Properties", "Delete from model…"]);
  });

  it("keeps the membership item in the view half, above the model's", () => {
    const groups = contextMenuFor({ kind: "subject", id: "api" }, held);
    expect(groups[0]?.scope).toBe("view");
    expect(groups[0]?.label).toBe("View");
    expect(groups[groups.length - 1]?.destructive).toBe(true);
  });
});

/**
 * A read-only menu (#298, ADR 0117): the items that read or navigate survive,
 * every item whose intent stages a change is absent - not disabled - and a
 * group the filter empties is dropped whole, destructive groups first among
 * them.
 */
describe("a read-only menu offers no way to stage", () => {
  const readOnly = context({
    readOnly: true,
    membership: { kind: "enumerated", subjects: ["api"] },
  });

  // Focus survives readOnly, and that is the point of it being here: it reads
  // and narrows, stages nothing, and is the one thing a viewer most wants
  // (#407). Its presence beside Properties is what the filter is FOR - the
  // membership and delete items are gone from both menus.
  it("leaves a subject its Properties and Focus, and nothing that stages", () => {
    expect(
      labels(contextMenuFor({ kind: "subject", id: "api" }, readOnly)),
    ).toEqual(["Focus on this", "Properties"]);
  });

  it("leaves a relationship Focus and Properties: no retype, no delete", () => {
    expect(
      labels(
        contextMenuFor({ kind: "relationship", id: "api-serving-ui" }, readOnly),
      ),
    ).toEqual(["Focus on this", "Properties"]);
  });

  it("leaves the canvas its reads: export, and the way back to everything", () => {
    expect(
      labels(
        contextMenuFor(
          { kind: "canvas" },
          context({ readOnly: true, filtered: true }),
        ),
      ),
    ).toEqual(["Show all subjects", "Export PNG"]);
  });

  it("leaves a view row navigation and its path, nothing that writes one", () => {
    expect(
      labels(contextMenuFor({ kind: "view-row", id: "current" }, readOnly)),
    ).toEqual(["Open view", "Copy projection path"]);
  });

  it("leaves a model row its Properties, with no membership edit", () => {
    expect(
      labels(contextMenuFor({ kind: "model-row", id: "api" }, readOnly)),
    ).toEqual(["Properties"]);
  });

  it("drops every destructive group rather than emptying it in place", () => {
    for (const target of [
      { kind: "subject", id: "api" },
      { kind: "relationship", id: "api-serving-ui" },
      { kind: "view-row", id: "current" },
      { kind: "model-row", id: "api" },
    ] as const) {
      const groups = contextMenuFor(target, readOnly);
      expect(groups.some((group) => group.destructive)).toBe(false);
      expect(groups.every((group) => group.items.length > 0)).toBe(true);
    }
  });
});
