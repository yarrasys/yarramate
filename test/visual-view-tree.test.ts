import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../src/graph-projection.js";
import type { VisualViewSummary } from "../src/adapters/visual/protocol-contract.js";
import {
  buildModelTree,
  buildViewTree,
  commonDirectory,
  folderOf,
  matchesFilter,
} from "../src/visual-app/view-tree-model.js";

const view = (overrides: Partial<VisualViewSummary> = {}): VisualViewSummary => ({
  id: "current-engine",
  title: "Current engine",
  description: "",
  query: {},
  presentation: undefined,
  path: ".yarramate/projections/current-engine.yaml",
  subjectCount: 7,
  ...overrides,
});

const node = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "system.api",
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

describe("view folders from projection paths", () => {
  it("gives a flat workspace no folders at all", () => {
    const views = [
      view({ id: "a", path: ".yarramate/projections/a.yaml" }),
      view({ id: "b", path: ".yarramate/projections/b.yaml" }),
    ];
    const tree = buildViewTree({
      views,
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });
    expect(tree.folders).toEqual([]);
    expect(tree.loose.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("folders a workspace that sorts its projections into directories", () => {
    const views = [
      view({
        id: "now",
        title: "Now",
        path: ".yarramate/projections/current/now.yaml",
      }),
      view({
        id: "then",
        title: "Then",
        path: ".yarramate/projections/target/then.yaml",
      }),
      view({ id: "loose", title: "Loose", path: ".yarramate/projections/loose.yaml" }),
    ];
    const tree = buildViewTree({
      views,
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });
    expect(tree.folders.map((folder) => folder.name)).toEqual([
      "current",
      "target",
    ]);
    expect(tree.folders[0]?.views.map((row) => row.id)).toEqual(["now"]);
    expect(tree.loose.map((row) => row.id)).toEqual(["loose"]);
  });

  it("names a view nested deeper by its whole relative path rather than truncating it", () => {
    const shared = commonDirectory([
      ".yarramate/projections/a.yaml",
      ".yarramate/projections/current/before/b.yaml",
    ]);
    expect(folderOf(".yarramate/projections/current/before/b.yaml", shared)).toBe(
      "current/before",
    );
  });

  it("gives a single view no folder, since its own directory is the shared one", () => {
    const tree = buildViewTree({
      views: [view({ path: "deeply/nested/only.yaml" })],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });
    expect(tree.folders).toEqual([]);
    expect(tree.loose).toHaveLength(1);
  });
});

describe("view rows", () => {
  it("marks the active view and states what the canvas is drawing for it", () => {
    const tree = buildViewTree({
      views: [
        view({ id: "a", title: "A", subjectCount: 7 }),
        view({ id: "b", title: "B", subjectCount: 9, path: ".yarramate/projections/b.yaml" }),
      ],
      activeViewId: "a",
      // A commit landed and this view now draws six, whatever the frame that
      // carried its summary said.
      activeSubjectCount: 6,
      filterText: "",
    });
    expect(tree.loose[0]).toMatchObject({ id: "a", active: true, subjectCount: 6 });
    expect(tree.loose[1]).toMatchObject({ id: "b", active: false, subjectCount: 9 });
  });

  it("narrows to titles that match, and keeps a whole folder the reviewer named", () => {
    const views = [
      view({ id: "now", title: "Now", path: ".yarramate/projections/target/now.yaml" }),
      view({ id: "then", title: "Then", path: ".yarramate/projections/target/then.yaml" }),
      view({ id: "other", title: "Other", path: ".yarramate/projections/other.yaml" }),
    ];
    const byTitle = buildViewTree({
      views,
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "the",
    });
    expect(byTitle.matched).toBe(2);

    const byFolder = buildViewTree({
      views,
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "target",
    });
    expect(byFolder.matched).toBe(2);
    expect(byFolder.folders[0]?.views.map((row) => row.id)).toEqual([
      "now",
      "then",
    ]);
  });
});

describe("the unfiltered row, which is not a saved view", () => {
  it("narrows with everything else rather than standing above an empty root", () => {
    expect(matchesFilter("All subjects", "")).toBe(true);
    expect(matchesFilter("All subjects", "  SUBJ ")).toBe(true);
    expect(matchesFilter("All subjects", "ledger")).toBe(false);
  });
});

describe("the model root", () => {
  const nodes = [
    node({ id: "app.checkout", name: "Checkout", layer: "application" }),
    node({ id: "app.ledger", name: "Ledger", layer: "application" }),
    node({
      id: "biz.pay",
      name: "Pay a supplier",
      layer: "business",
      kindLabel: "businessProcess",
    }),
  ];

  it("groups subjects by layer in profile order, not alphabetically", () => {
    const groups = buildModelTree({ nodes, inViewIds: null, filterText: "" });
    expect(groups.map((group) => group.label)).toEqual([
      "business",
      "application",
    ]);
  });

  it("marks a subject the active view leaves out rather than dropping it", () => {
    const groups = buildModelTree({
      nodes,
      inViewIds: new Set(["app.checkout"]),
      filterText: "",
    });
    const application = groups.find((group) => group.label === "application");
    expect(application?.subjects.map((subject) => [subject.name, subject.inView])).toEqual([
      ["Checkout", true],
      ["Ledger", false],
    ]);
  });

  it("treats everything as in view when nothing is filtering the canvas", () => {
    const groups = buildModelTree({ nodes, inViewIds: null, filterText: "" });
    expect(
      groups.every((group) => group.subjects.every((subject) => subject.inView)),
    ).toBe(true);
  });

  it("finds subjects by kind as well as by name", () => {
    const groups = buildModelTree({
      nodes,
      inViewIds: null,
      filterText: "businessProcess",
    });
    expect(groups.flatMap((group) => group.subjects.map((s) => s.id))).toEqual([
      "biz.pay",
    ]);
  });

  it("groups a subject whose layer never resolved rather than losing it", () => {
    const groups = buildModelTree({
      nodes: [node({ id: "x", name: "Unresolved", layer: null })],
      inViewIds: null,
      filterText: "",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("unlayered");
    expect(groups[0]?.subjects[0]?.id).toBe("x");
  });
});
