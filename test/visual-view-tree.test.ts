import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../src/graph-projection.js";
import type { VisualViewSummary } from "../src/adapters/visual/protocol-contract.js";
import {
  buildModelTree,
  buildViewTree,
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
  folder: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
  ...overrides,
});

describe("view folders, which the author declares", () => {
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

  it("folders the views that declare one, and leaves the rest loose", () => {
    const views = [
      view({ id: "now", title: "Now", presentation: { folder: "Current" } }),
      view({ id: "then", title: "Then", presentation: { folder: "Target" } }),
      view({ id: "loose", title: "Loose" }),
    ];
    const tree = buildViewTree({
      views,
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });
    expect(tree.folders.map((folder) => folder.name)).toEqual([
      "Current",
      "Target",
    ]);
    expect(tree.folders[0]?.views.map((row) => row.id)).toEqual(["now"]);
    expect(tree.loose.map((row) => row.id)).toEqual(["loose"]);
  });

  it("takes the label verbatim, one level, however it nests", () => {
    // The tree draws a folder, not a folder tree: `Current/Engine` is one
    // folder with that name. The separator is reserved so nesting can be drawn
    // later without the label meaning something different in the meantime.
    expect(folderOf(view({ presentation: { folder: "Current/Engine" } }))).toBe(
      "Current/Engine",
    );
  });

  it("ignores the directory the projection sits in", () => {
    // The whole reframe (ADR 0104): a folder is an organising concept the
    // author declares, not a consequence of where a file happens to sit.
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
      view({ id: "now", title: "Now", presentation: { folder: "Target" } }),
      view({ id: "then", title: "Then", presentation: { folder: "Target" } }),
      view({ id: "other", title: "Other" }),
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

/**
 * Model folders (ADR 0104). Layer is the DEFAULT grouping and stays derived and
 * always correct; a declared folder OVERRIDES it for the subjects that declare
 * one, and nothing else moves.
 */
describe("the model root, once subjects declare folders", () => {
  const nodes = [
    node({ id: "app.checkout", name: "Checkout", layer: "application", folder: "Payments" }),
    node({ id: "app.ledger", name: "Ledger", layer: "application", folder: "Payments" }),
    node({ id: "app.search", name: "Search", layer: "application" }),
    node({
      id: "biz.pay",
      name: "Pay a supplier",
      layer: "business",
      kindLabel: "businessProcess",
    }),
  ];

  it("puts a foldered subject in its folder and nowhere else", () => {
    // Override, not coexistence: a subject in two groups is one the reviewer
    // finds twice and edits once.
    const groups = buildModelTree({ nodes, inViewIds: null, filterText: "" });
    const payments = groups.find((group) => group.label === "Payments");
    const application = groups.find((group) => group.label === "application");

    expect(payments?.subjects.map((subject) => subject.name)).toEqual([
      "Checkout",
      "Ledger",
    ]);
    expect(application?.subjects.map((subject) => subject.name)).toEqual([
      "Search",
    ]);
  });

  it("puts declared folders above derived layers, and keeps profile order below", () => {
    // What the author chose sits above what the profile derived; the layers
    // keep the order the canvas bands them in.
    expect(
      buildModelTree({ nodes, inViewIds: null, filterText: "" }).map(
        (group) => group.label,
      ),
    ).toEqual(["Payments", "business", "application"]);
  });

  it("says which grouping a row sits under, because they are not the same kind of thing", () => {
    const groups = buildModelTree({ nodes, inViewIds: null, filterText: "" });

    expect(groups.map(({ label, grouping }) => [label, grouping])).toEqual([
      ["Payments", "folder"],
      ["business", "layer"],
      ["application", "layer"],
    ]);
  });

  it("keeps a folder and a layer of the same name apart", () => {
    // An author may call a folder `business`. It is not that layer, and one
    // collapse set holds both keys.
    const groups = buildModelTree({
      nodes: [
        node({ id: "a", name: "A", layer: "application", folder: "business" }),
        node({ id: "b", name: "B", layer: "business" }),
      ],
      inViewIds: null,
      filterText: "",
    });

    expect(groups.map((group) => group.key)).toEqual([
      "model-folder:business",
      "model-layer:business",
    ]);
  });

  it("shows a whole folder the reviewer named, the way it shows a whole layer", () => {
    const groups = buildModelTree({
      nodes,
      inViewIds: null,
      filterText: "payments",
    });

    expect(groups.map((group) => group.label)).toEqual(["Payments"]);
    expect(groups[0]?.subjects).toHaveLength(2);
  });

  it("groups a model nobody has foldered exactly as it did before", () => {
    const plain = nodes.map((subject) => ({ ...subject, folder: null }));

    expect(
      buildModelTree({ nodes: plain, inViewIds: null, filterText: "" }).map(
        ({ label, grouping }) => [label, grouping],
      ),
    ).toEqual([
      ["business", "layer"],
      ["application", "layer"],
    ]);
  });
});
