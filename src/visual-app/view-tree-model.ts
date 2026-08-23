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
  /** The directory the views share, relative to where all of them live. */
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
  /**
   * Whether the canvas is drawing this subject. Read from the standing
   * filter's match set, never from the graph: the graph holds every subject
   * the workspace declares, and the whole point of the marker is to name the
   * ones it holds that the active view leaves out.
   */
  readonly inView: boolean;
}

export interface ModelLayerGroup {
  readonly key: string;
  readonly label: string;
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

const directoryOf = (path: string): readonly string[] => {
  const segments = path.split("/");
  return segments.slice(0, -1);
};

/**
 * The deepest directory every one of these paths sits under.
 *
 * This is what makes folders fall out of the workspace rather than out of the
 * projection format: a workspace whose projections all sit in one directory
 * shares that whole directory and so shows no folders at all, while one that
 * sorts them into `current/` and `target/` shares only the parent, and those
 * two directory names become the folders. Nothing in the format had to gain a
 * folder concept for either to work.
 */
export const commonDirectory = (
  paths: readonly string[],
): readonly string[] => {
  if (paths.length === 0) return [];
  const directories = paths.map(directoryOf);
  const first = directories[0] ?? [];
  let shared = first.length;
  for (const directory of directories.slice(1)) {
    let index = 0;
    while (
      index < shared &&
      index < directory.length &&
      directory[index] === first[index]
    ) {
      index += 1;
    }
    shared = index;
  }
  return first.slice(0, shared);
};

/**
 * The folder a view belongs to: whatever directory it sits in below the one
 * they all share. A view alone in that shared directory has no folder, and a
 * view nested two deep is labelled by the whole relative path rather than
 * splitting into a second level — the tree draws one level of folder, so a
 * deeper path is named in full rather than silently truncated.
 */
export const folderOf = (
  path: string,
  shared: readonly string[],
): string => directoryOf(path).slice(shared.length).join("/");

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
  const shared = commonDirectory(views.map((view) => view.path));
  const rowsByFolder = new Map<string, ViewTreeRow[]>();

  for (const view of views) {
    const active = view.id === activeViewId;
    const folder = folderOf(view.path, shared);
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
}: ModelTreeInput): readonly ModelLayerGroup[] => {
  const needle = normalize(filterText);
  const byLayer = new Map<string, ModelSubjectRow[]>();

  for (const node of nodes) {
    const layer = node.layer;
    const group = layer ?? UNLAYERED;
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
      inView: inViewIds === null || inViewIds.has(node.id),
    };
    const existing = byLayer.get(group);
    if (existing === undefined) byLayer.set(group, [row]);
    else existing.push(row);
  }

  // Profile order, not alphabetical: the layers stack motivation over strategy
  // over business the way the canvas bands them, and a rail that reordered
  // them would disagree with the diagram it sits beside.
  const order = [...layers, UNLAYERED];
  return order.flatMap((layer) => {
    const subjects = byLayer.get(layer);
    if (subjects === undefined || subjects.length === 0) return [];
    return [
      {
        key: layerKey(layer),
        label: layer,
        subjects: [...subjects].sort((a, b) => a.name.localeCompare(b.name)),
      },
    ];
  });
};
