import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../src/graph-projection.js";
import type {
  VisualViewOperation,
  VisualViewSummary,
} from "../src/adapters/visual/protocol-contract.js";
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
      stagedOperations: [],
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
      stagedOperations: [],
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
      stagedOperations: [],
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
      stagedOperations: [],
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
      stagedOperations: [],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "the",
    });
    expect(byTitle.matched).toBe(2);

    const byFolder = buildViewTree({
      views,
      stagedOperations: [],
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

/**
 * Staged intent beside landed truth (ADR 0114, #299). The tree merges the
 * pending changeset's view operations over the landed views, so a staged
 * view — and the folder it declares — is visible before commit, marked.
 */
describe("staged view operations, merged over the landed views", () => {
  const writeOp = (
    id: string,
    overrides: {
      readonly title?: string;
      readonly folder?: string;
      readonly path?: string;
    } = {},
  ): VisualViewOperation => ({
    op: "write-view",
    path: overrides.path ?? `.yarramate/projections/${id}.yaml`,
    projection: {
      format: "yarramate/projection/v1",
      id,
      version: "1.0",
      query: {},
      presentation: {
        title: overrides.title ?? id,
        description: "staged",
        ...(overrides.folder === undefined ? {} : { folder: overrides.folder }),
      },
    },
  });

  it("renders a staged NEW view as a row, in the folder it declares", () => {
    // The #299 repro: "New folder…" stages the first view of a folder no
    // landed document declares, and the rail used to show nothing at all.
    const tree = buildViewTree({
      views: [view()],
      stagedOperations: [
        writeOp("roadmap-first", { title: "Roadmap first", folder: "Roadmap" }),
      ],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    expect(tree.folders.map((folder) => folder.name)).toEqual(["Roadmap"]);
    expect(tree.folders[0]?.views).toEqual([
      {
        id: "roadmap-first",
        title: "Roadmap first",
        path: ".yarramate/projections/roadmap-first.yaml",
        // Nothing has measured a staged view: its query needs the semantic
        // graph, which the browser does not hold.
        subjectCount: null,
        // Navigation resolves landed ids, so a staged new view can never be
        // the active one.
        active: false,
        staged: "new",
      },
    ]);
  });

  it("marks the landed row a staged write overwrites, showing what WILL land", () => {
    const tree = buildViewTree({
      views: [view({ id: "current-engine", title: "Current engine" })],
      stagedOperations: [
        writeOp("current-engine", {
          title: "Engine, renamed",
          folder: "Current",
          path: ".yarramate/projections/current-engine.yaml",
        }),
      ],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    // Marked, not duplicated: one document, one row.
    expect(tree.matched).toBe(1);
    expect(tree.loose).toEqual([]);
    expect(tree.folders[0]?.name).toBe("Current");
    expect(tree.folders[0]?.views[0]).toMatchObject({
      id: "current-engine",
      title: "Engine, renamed",
      staged: "overwrite",
      // The landed measure stays: the staged query has not landed, and the
      // summary's own staleness story already covers it.
      subjectCount: 7,
    });
  });

  it("marks a staged delete rather than hiding the row", () => {
    const tree = buildViewTree({
      views: [view()],
      stagedOperations: [
        { op: "delete-view", path: ".yarramate/projections/current-engine.yaml" },
      ],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    expect(tree.loose[0]).toMatchObject({
      id: "current-engine",
      title: "Current engine",
      staged: "delete",
    });
    expect(tree.matched).toBe(1);
  });

  it("reverts to the plain tree when the operations are discarded", () => {
    // Discarding a staged row leaves the changeset without it, and the tree
    // derives rather than remembers — so absence of operations IS the revert.
    const views = [view()];
    const staged = buildViewTree({
      views,
      stagedOperations: [writeOp("brand-new", { folder: "Roadmap" })],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });
    const discarded = buildViewTree({
      views,
      stagedOperations: [],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    expect(staged.matched).toBe(2);
    expect(discarded.matched).toBe(1);
    expect(discarded.folders).toEqual([]);
    expect(discarded.loose[0]).toMatchObject({
      id: "current-engine",
      staged: null,
    });
  });

  it("counts staged rows in matched, and filters them by their staged words", () => {
    const input = {
      views: [view({ id: "loose-view", title: "Loose view", path: "a.yaml" })],
      stagedOperations: [
        writeOp("target-next", { title: "Target next", folder: "Target" }),
      ],
      activeViewId: "",
      activeSubjectCount: null,
    };

    // The staged folder is searchable the way a landed one is: typing it is
    // asking for the folder, wherever its rows come from.
    expect(buildViewTree({ ...input, filterText: "target" }).matched).toBe(1);
    expect(buildViewTree({ ...input, filterText: "" }).matched).toBe(2);
    expect(
      buildViewTree({ ...input, filterText: "nothing-says-this" }).matched,
    ).toBe(0);
  });

  it("filters an overwritten row by what will land, not by what did", () => {
    const input = {
      views: [view({ id: "current-engine", title: "Current engine" })],
      stagedOperations: [
        writeOp("current-engine", {
          title: "Renamed entirely",
          path: ".yarramate/projections/current-engine.yaml",
        }),
      ],
      activeViewId: "",
      activeSubjectCount: null,
    };

    // The row SHOWS the staged title, so the filter has to match it — a row
    // found by a word it no longer displays would look like a false hit.
    expect(buildViewTree({ ...input, filterText: "renamed" }).matched).toBe(1);
    expect(
      buildViewTree({ ...input, filterText: "current engine" }).matched,
    ).toBe(0);
  });

  it("keeps the drawn count on an overwritten row that is active", () => {
    const tree = buildViewTree({
      views: [view({ id: "current-engine" })],
      stagedOperations: [
        writeOp("current-engine", {
          path: ".yarramate/projections/current-engine.yaml",
        }),
      ],
      activeViewId: "current-engine",
      activeSubjectCount: 3,
      filterText: "",
    });

    expect(tree.loose[0]).toMatchObject({
      active: true,
      staged: "overwrite",
      subjectCount: 3,
    });
  });

  it("shows nothing for a staged delete of a path nothing landed", () => {
    const tree = buildViewTree({
      views: [],
      stagedOperations: [{ op: "delete-view", path: "never-landed.yaml" }],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    expect(tree.matched).toBe(0);
  });

  it("renders the last operation staged for a path, never two rows for one document", () => {
    // The reducer already keeps one row per document; the tree reads
    // last-wins anyway, so a malformed changeset degrades to what the
    // reviewer last meant rather than to a duplicate.
    const tree = buildViewTree({
      views: [],
      stagedOperations: [
        writeOp("draft", { title: "First words", path: "draft.yaml" }),
        writeOp("draft", { title: "Second thoughts", path: "draft.yaml" }),
      ],
      activeViewId: "",
      activeSubjectCount: null,
      filterText: "",
    });

    expect(tree.matched).toBe(1);
    expect(tree.loose[0]?.title).toBe("Second thoughts");
  });
});
