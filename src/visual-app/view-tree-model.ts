/**
 * What the left rail shows, as data.
 *
 * The rail is two trees over things the session already has — the saved views
 * and the subjects the model declares — so everything it decides is a pure
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
import type { VisualViewSummary } from "../adapters/visual/protocol-contract.js";

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

export interface ViewTreeRow {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly subjectCount: number;
  readonly active: boolean;
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

const normalize = (text: string): string => text.trim().toLowerCase();

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
  matches(label, normalize(filterText));

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
  readonly activeViewId: string;
  /**
   * How many subjects the active view is drawing right now, from the standing
   * filter's match set. The server's `subjectCount` was true when the frame
   * carrying it was sent; this one is true of the canvas beside it, which is
   * the number the reviewer can check by looking.
   */
  readonly activeSubjectCount: number | null;
  readonly filterText: string;
}

export const buildViewTree = ({
  views,
  activeViewId,
  activeSubjectCount,
  filterText,
}: ViewTreeInput): ViewTree => {
  const needle = normalize(filterText);
  const rowsByFolder = new Map<string, ViewTreeRow[]>();

  for (const view of views) {
    const active = view.id === activeViewId;
    const folder = folderOf(view);
    // A folder that matches shows everything it holds: the reviewer typing
    // `target` is asking for that folder, not for views whose titles happen
    // to say so.
    if (!matches(view.title, needle) && !matches(folder, needle)) continue;
    const row: ViewTreeRow = {
      id: view.id,
      title: view.title,
      path: view.path,
      subjectCount:
        active && activeSubjectCount !== null
          ? activeSubjectCount
          : view.subjectCount,
      active,
    };
    const existing = rowsByFolder.get(folder);
    if (existing === undefined) rowsByFolder.set(folder, [row]);
    else existing.push(row);
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
  const needle = normalize(filterText);
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
    // Kind is searchable because it is how an architect names a set of
    // subjects — "every applicationComponent" — and the row already shows it.
    if (
      !matches(node.name, needle) &&
      !matches(node.kindLabel, needle) &&
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
