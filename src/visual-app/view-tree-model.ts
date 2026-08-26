/**
 * What the left rail shows, as data.
 *
 * The rail is two trees over things the session already has — the saved views
 * with the reviewer's staged view operations merged over them (ADR 0114), and
 * the subjects the model declares — so everything it decides is a pure
 * function of those plus what the reviewer typed. It lives outside the
 * component for the reason `filterToReresolve` does: this repo renders React
 * with `renderToStaticMarkup` and has no DOM test environment, so logic that
 * hides inside a component is logic no test can reach.
 *
 * No import of React, cytoscape, or anything from `node:` — the same
 * zero-dependency discipline as `badges.ts` and `kind-icons.ts`.
 */
import type { CanvasNode } from "../graph-projection.js";
import type { Layer } from "../profile.js";
import { layers } from "../profile.js";
import type {
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import {
  countMatchingSubjects,
  normalizeFilterText,
  subjectMatchesQuickFilter,
  type FilterableSubject,
} from "./subject-filter.js";

export const VIEWS_ROOT_KEY = "views";
export const MODEL_ROOT_KEY = "model";

/** Collapse keys are strings so one set holds every branch of both trees. */
export const folderKey = (folder: string): string => `view-folder:${folder}`;
export const layerKey = (layer: string): string => `model-layer:${layer}`;
/** A declared folder in the MODEL tree, kept apart from a layer of the same
 * name: an author may call a folder `business`, and it is not that layer. */
export const modelFolderKey = (folder: string): string =>
  `model-folder:${folder}`;

/** Where a subject with no resolved layer is grouped, last. */
export const UNLAYERED = "unlayered";

/**
 * How a row relates to the pending changeset (ADR 0114). `"new"` is a staged
 * `write-view` at a path nothing has landed; `"overwrite"` is one at a path a
 * landed view occupies; `"delete"` is a staged `delete-view`. A landed row
 * nothing pending touches carries `null`.
 */
export type ViewRowStaging = "new" | "overwrite" | "delete";

export interface ViewTreeRow {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  /**
   * `null` when nothing has measured it: a staged NEW view has no landed
   * document, and resolving its query needs the semantic graph the browser
   * does not hold — and, while the tree filter narrows, every landed view
   * but the active one, whose subjects live only in that same graph (#317).
   * A number is either the server's measure of what LANDED (a staged
   * overwrite keeps the landed count, the same staleness story
   * `VisualViewSummary.subjectCount` already tells) or, on the active row,
   * a count of the drawn subjects that survive the typed filter.
   */
  readonly subjectCount: number | null;
  readonly active: boolean;
  readonly staged: ViewRowStaging | null;
}

export interface ViewTreeFolder {
  readonly key: string;
  /** The label its views declare, verbatim. */
  readonly name: string;
  readonly views: readonly ViewTreeRow[];
}

export interface ViewTree {
  readonly folders: readonly ViewTreeFolder[];
  /** Views in no folder, shown under the root above the folders. */
  readonly loose: readonly ViewTreeRow[];
  /** Rows that survived the filter, across folders and all. */
  readonly matched: number;
}

export interface ModelSubjectRow {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly layer: Layer | null;
  /** The folder the author filed it under, or null. */
  readonly folder: string | null;
  /**
   * Whether the canvas is drawing this subject. Read from the standing
   * filter's match set, never from the graph: the graph holds every subject
   * the workspace declares, and the whole point of the marker is to name the
   * ones it holds that the active view leaves out.
   */
  readonly inView: boolean;
}

export interface ModelTreeGroup {
  readonly key: string;
  readonly label: string;
  /**
   * What put these subjects together. A `layer` group is DERIVED and always
   * correct - every subject has one, or is unlayered - and a `folder` group is
   * DECLARED, which is neither. The rail says which so a reader knows whether
   * moving a subject means editing a document or changing its kind.
   */
  readonly grouping: "folder" | "layer";
  readonly subjects: readonly ModelSubjectRow[];
}

/**
 * Whether a LABEL — a view title, a folder name, a group heading — survives
 * the typed text. Subjects go through `subjectMatchesQuickFilter` instead,
 * the very predicate the canvas quick filter applies (#317), so the two
 * boxes cannot disagree about a subject; labels are a rail-only concept the
 * canvas has no counterpart for, matched here with the same normalization.
 */
const matches = (haystack: string, needle: string): boolean =>
  needle === "" || haystack.toLowerCase().includes(needle);

/**
 * Whether a label survives what the reviewer typed into the rail.
 *
 * Exported for the one row that is not a saved view — the unfiltered "all
 * subjects" entry — which has no summary to pass through `buildViewTree` but
 * must narrow with everything else, or a search that matches nothing still
 * leaves a view row standing above the line saying nothing matched.
 */
export const matchesFilter = (label: string, filterText: string): boolean =>
  matches(label, normalizeFilterText(filterText));

/**
 * The folder a view files itself under, or `""` for none.
 *
 * DECLARED, never derived (ADR 0104). Folders used to fall out of the
 * directories the projections happened to sit in, which made a folder a
 * consequence of the filesystem: a workspace could not name one without moving
 * files, a manifest whose patterns reach no subdirectory could not have one at
 * all, and "New folder" meant "write somewhere the manifest may not load".
 * A label answers all three, and it is the same word `yarramate/likec4-project/v1`
 * already uses for the same thing (ADR 0067).
 *
 * One level: the tree draws a folder, not a folder tree, so `current/target`
 * is one folder called `current/target` rather than two nested ones. The
 * separator is reserved so nesting can be drawn later without the label
 * meaning something different.
 */
export const folderOf = (view: VisualViewSummary): string =>
  view.presentation?.folder ?? "";

export interface ViewTreeInput {
  readonly views: readonly VisualViewSummary[];
  /**
   * The pending changeset's view operations, merged over `views` so the rail
   * shows the reviewer's own staged intent beside landed truth (ADR 0114).
   * A staged `write-view` at a new path becomes a row; one at a landed path
   * marks that row and shows what WILL land; a staged `delete-view` marks the
   * row rather than hiding it. Discarding an operation removes it from this
   * list, which is the whole revert — the tree derives, it never remembers.
   */
  readonly stagedOperations: readonly VisualViewOperation[];
  readonly activeViewId: string;
  /**
   * The subjects the active view is drawing right now, from the standing
   * filter's match set, or `null` when nothing is filtering the canvas. The
   * subjects themselves rather than their count (#317): the active row's
   * number is how many of them survive the typed filter, which a
   * pre-computed count could not answer. Unfiltered it is their plain
   * length — the number the reviewer can check by looking, where the
   * server's `subjectCount` was only true when the frame carrying it was
   * sent.
   */
  readonly activeSubjects: readonly FilterableSubject[] | null;
  readonly filterText: string;
}

export const buildViewTree = ({
  views,
  stagedOperations,
  activeViewId,
  activeSubjects,
  filterText,
}: ViewTreeInput): ViewTree => {
  const needle = normalizeFilterText(filterText);
  // While the filter narrows, a shown count has to count SURVIVORS (#317):
  // the active view's drawn subjects are here to count, and every other
  // landed view's subjects live only in the server's semantic graph, so its
  // row shows no number rather than a full count the narrowing has made
  // wrong — the same honesty as the staged new row's null. With no filter
  // text every drawn subject survives, and every count is what it was.
  const filtering = needle !== "";
  const activeCount =
    activeSubjects === null
      ? null
      : countMatchingSubjects(activeSubjects, filterText);
  const rowsByFolder = new Map<string, ViewTreeRow[]>();

  const place = (folder: string, row: ViewTreeRow): void => {
    const existing = rowsByFolder.get(folder);
    if (existing === undefined) rowsByFolder.set(folder, [row]);
    else existing.push(row);
  };

  // The reducer keeps one operation per path; read last-wins anyway, so a
  // changeset that somehow says a document twice still renders what the
  // reviewer last meant rather than a duplicate row.
  const stagedByPath = new Map<string, VisualViewOperation>();
  for (const operation of stagedOperations) {
    stagedByPath.set(operation.path, operation);
  }

  for (const view of views) {
    const operation = stagedByPath.get(view.path);
    stagedByPath.delete(view.path);
    // A staged write over a landed path MARKS the landed row rather than
    // duplicating it, and the row says what will land — the staged title, the
    // staged folder — because a rail showing the state a discard would return
    // to, unmarked, is a rail claiming the save did not happen (#299). The id
    // stays the landed one: it is what navigation resolves.
    const projection =
      operation?.op === "write-view" ? operation.projection : null;
    const staged: ViewRowStaging | null =
      operation === undefined
        ? null
        : projection === null
          ? "delete"
          : "overwrite";
    const title =
      projection === null
        ? view.title
        : (projection.presentation?.title ?? projection.id);
    const folder =
      projection === null ? folderOf(view) : (projection.presentation?.folder ?? "");
    const active = view.id === activeViewId;
    // A folder that matches shows everything it holds: the reviewer typing
    // `target` is asking for that folder, not for views whose titles happen
    // to say so.
    if (!matches(title, needle) && !matches(folder, needle)) continue;
    place(folder, {
      id: view.id,
      title,
      path: view.path,
      subjectCount:
        active && activeCount !== null
          ? activeCount
          : filtering
            ? null
            : view.subjectCount,
      active,
      staged,
    });
  }

  // What remains is staged against paths nothing landed: each `write-view` is
  // a NEW view, drawn from its own projection document — which is what makes
  // "New folder…" visible the moment its first view is staged. It cannot be
  // the active view (navigation resolves landed ids only), and a `delete-view`
  // of a path that never landed has nothing to show.
  for (const operation of stagedByPath.values()) {
    if (operation.op !== "write-view") continue;
    const { projection } = operation;
    const title = projection.presentation?.title ?? projection.id;
    const folder = projection.presentation?.folder ?? "";
    if (!matches(title, needle) && !matches(folder, needle)) continue;
    place(folder, {
      id: projection.id,
      title,
      path: operation.path,
      subjectCount: null,
      active: false,
      staged: "new",
    });
  }

  const byTitle = (a: ViewTreeRow, b: ViewTreeRow): number =>
    a.title.localeCompare(b.title);
  const loose = [...(rowsByFolder.get("") ?? [])].sort(byTitle);
  const folders = [...rowsByFolder.entries()]
    .filter(([folder]) => folder !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, rows]) => ({
      key: folderKey(folder),
      name: folder,
      views: [...rows].sort(byTitle),
    }));

  return {
    folders,
    loose,
    matched:
      loose.length +
      folders.reduce((total, folder) => total + folder.views.length, 0),
  };
};

export interface ModelTreeInput {
  readonly nodes: readonly CanvasNode[];
  /**
   * The subjects the canvas is drawing, or `null` when nothing is filtering it
   * and every subject is therefore in view.
   */
  readonly inViewIds: ReadonlySet<string> | null;
  readonly filterText: string;
}

export const buildModelTree = ({
  nodes,
  inViewIds,
  filterText,
}: ModelTreeInput): readonly ModelTreeGroup[] => {
  const needle = normalizeFilterText(filterText);
  const byFolder = new Map<string, ModelSubjectRow[]>();
  const byLayer = new Map<string, ModelSubjectRow[]>();

  for (const node of nodes) {
    const layer = node.layer;
    // A declared folder OVERRIDES the layer rather than sitting beside it: a
    // subject in two groups is a subject the reviewer finds twice and edits
    // once. Layer stays the default, so a model nobody has foldered - which is
    // every model today - is grouped exactly as it was.
    const folder = node.folder;
    const group = folder ?? layer ?? UNLAYERED;
    // A subject survives by the canvas quick filter's own predicate — id,
    // name, kind label — imported, never restated, so the two boxes cannot
    // drift (#317; the rail used to omit `id`, and id-shaped input emptied
    // the tree while the canvas kept drawing, #307). Kind is in the
    // predicate because it is how an architect names a set of subjects —
    // "every applicationComponent" — and the row already shows it. The
    // group label is the rail's own extra: a folder or layer that matches
    // shows everything it holds.
    if (
      !subjectMatchesQuickFilter(needle, node.id, node.name, node.kindLabel) &&
      !matches(group, needle)
    ) {
      continue;
    }
    const row: ModelSubjectRow = {
      id: node.id,
      name: node.name,
      kindLabel: node.kindLabel,
      layer,
      folder,
      inView: inViewIds === null || inViewIds.has(node.id),
    };
    const into = folder === null ? byLayer : byFolder;
    const existing = into.get(group);
    if (existing === undefined) into.set(group, [row]);
    else existing.push(row);
  }

  const byName = (a: ModelSubjectRow, b: ModelSubjectRow): number =>
    a.name.localeCompare(b.name);

  // Declared folders first, alphabetically: what the author chose sits above
  // what the profile derived. Layers keep PROFILE ORDER, not alphabetical -
  // they stack motivation over strategy over business the way the canvas bands
  // them, and a rail that reordered them would disagree with the diagram it
  // sits beside.
  const folders = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, subjects]) => ({
      key: modelFolderKey(folder),
      label: folder,
      grouping: "folder" as const,
      subjects: [...subjects].sort(byName),
    }));

  const order = [...layers, UNLAYERED];
  return [
    ...folders,
    ...order.flatMap((layer) => {
      const subjects = byLayer.get(layer);
      if (subjects === undefined || subjects.length === 0) return [];
      return [
        {
          key: layerKey(layer),
          label: layer,
          grouping: "layer" as const,
          subjects: [...subjects].sort(byName),
        },
      ];
    }),
  ];
};
