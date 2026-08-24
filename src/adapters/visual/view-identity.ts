import type { ProjectionDefinition, ProjectionQuery } from "../../projection.js";

/**
 * How a saved view gets its id, its path, and its document.
 *
 * The browser composes a `write-view` operation now rather than asking the
 * server to compose one at commit time (ADR 0103): a staged row has to name
 * the document it will write before it is committed, because that is what the
 * reviewer reads in the tray and what the digest pins against.
 *
 * So this lives where both sides can reach it. No React, no cytoscape, and
 * nothing from `node:` — the browser bundle imports it for its value, and
 * `visual-app-browser-safety.test.ts` is what holds that honest. Validation
 * stays on the server, where the schema and its loader are: composing a
 * projection is arithmetic, deciding it is acceptable is not.
 */

/** Where projections live when nothing says otherwise. */
export const DEFAULT_PROJECTION_DIRECTORY = ".yarramate/projections";

/**
 * Turns a view title into a schema-valid projection id: lowercase,
 * hyphen-separated, letter-led. A title with no letters or digits degrades
 * to "view" rather than producing an id the schema would reject.
 */
export const slugify = (title: string): string => {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return "view";
  return /^[a-z]/.test(cleaned) ? cleaned : `view-${cleaned}`;
};

/** Appends a numeric suffix only when the base id collides with a known view. */
export const uniqueViewId = (
  base: string,
  taken: ReadonlySet<string>,
): string => {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

/** The id a title should take, given the ids already in use. */
export const viewIdFrom = (
  title: string,
  taken: ReadonlySet<string>,
): string => uniqueViewId(slugify(title), taken);

/**
 * Where a view's document goes: beside every other one.
 *
 * The directory no longer carries meaning. Folders are DECLARED in the
 * projection now (ADR 0104), so a view files itself with a label and the path
 * is only an address - which is what makes "New folder" a thing the editor can
 * do at all. Writing into a subdirectory was the one motion that could put a
 * projection where the manifest's patterns do not reach (`YMVS315`), and the
 * editor no longer has a reason to try.
 */
export const projectionPathFor = (id: string): string =>
  `${DEFAULT_PROJECTION_DIRECTORY}/${id}.yaml`;

/**
 * The projection document a saved view is, composed from what the form holds.
 *
 * `title` and `description` are presentation fields rather than top-level
 * ones, which is where `ProjectionDefinition` puts them, and every other
 * presentation field the active view declared is carried through — dropping
 * one here is how overwriting a view silently loses its nesting or direction.
 */
/** The folder a saved view declares, or `""` for none. */
export const declaredFolder = (view: {
  readonly presentation: ProjectionDefinition["presentation"];
}): string => view.presentation?.folder ?? "";

/**
 * Retitling a view, as a staged write.
 *
 * The path and the id do NOT move. A projection's id decides its filename and
 * also keys its layout sidecar (`.yarramate/visual-layout/<id>.yaml`), so a
 * rename that carried the id along would silently orphan the positions the
 * reviewer dragged. Renaming is a change to what the view is called; moving it
 * is a different motion, and not one #246 asked for.
 *
 * Every other presentation field the view declared is carried through by
 * `composeProjection`, so a rename cannot quietly drop a nesting vocabulary or
 * a direction the canvas never showed.
 */
export const renameView = (
  view: SavedView,
  title: string,
): { readonly path: string; readonly projection: ProjectionDefinition } => ({
  path: view.path,
  projection: composeProjection({
    id: view.id,
    title,
    description: view.description,
    query: view.query,
    presentation: view.presentation,
  }),
});

/**
 * Copying a view into a new document beside it.
 *
 * The copy keeps the original's folder, because a duplicate the reviewer then
 * has to move is a duplicate in the wrong place - and it comes along for free
 * now that a folder is a declared field `composeProjection` carries with every
 * other one. It does NOT inherit the layout sidecar: that is keyed by id, and
 * a copy is a different view that lays itself out.
 */
export const duplicateView = (
  view: SavedView,
  taken: ReadonlySet<string>,
): { readonly path: string; readonly projection: ProjectionDefinition } => {
  const title = `${view.title} copy`;
  const id = viewIdFrom(title, taken);
  return {
    path: projectionPathFor(id),
    projection: composeProjection({
      id,
      title,
      description: view.description,
      query: view.query,
      presentation: view.presentation,
    }),
  };
};

/** What these need of a saved view, and nothing about how it is drawn. */
export interface SavedView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly query: ProjectionQuery;
  readonly presentation: ProjectionDefinition["presentation"];
  readonly path: string;
}

export const composeProjection = (input: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly query: ProjectionQuery;
  readonly presentation: ProjectionDefinition["presentation"];
}): ProjectionDefinition => ({
  format: "yarramate/projection/v1",
  id: input.id,
  version: "1.0",
  query: input.query,
  presentation: {
    ...(input.presentation ?? {}),
    title: input.title,
    description: input.description,
  },
});

/**
 * Whether a view can be told which subjects it holds.
 *
 * Only a view that ENUMERATES `subjects:` can. A view that describes its
 * subjects with facets — a layer, a kind, a state — already includes anything
 * matching them and excludes anything that does not, so there is nothing for a
 * membership edit to say to it: the subject is in or out by what it is, and
 * saying otherwise means editing the query rather than a list (#255).
 */
export const enumeratesSubjects = (
  query: ProjectionQuery,
): query is ProjectionQuery & { readonly subjects: readonly string[] } =>
  query.subjects !== undefined;

/**
 * The same view, holding one more subject or one fewer.
 *
 * `null` when there is nothing to stage: the view describes its subjects
 * rather than listing them, or the list already says what was asked for.
 * Returning the absence rather than an unchanged document is what keeps a
 * no-op out of the changeset, where a row that writes a file back exactly as
 * it was is a row the reviewer has to read and discard for nothing.
 */
export const withMembership = (
  projection: ProjectionDefinition,
  subjectId: string,
  membership: "add" | "remove",
): ProjectionDefinition | null => {
  if (!enumeratesSubjects(projection.query)) return null;
  const subjects = projection.query.subjects;
  const holds = subjects.includes(subjectId);
  if (membership === "add" ? holds : !holds) return null;
  return {
    ...projection,
    query: {
      ...projection.query,
      subjects:
        membership === "add"
          ? // Appended rather than sorted in: the list is the author's, and
            // reordering it would rewrite lines nobody touched.
            [...subjects, subjectId]
          : subjects.filter((id) => id !== subjectId),
    },
  };
};

/**
 * What a membership edit did to a view, as the tray reads it: `+id` for a
 * subject this row adds, `-id` for one it drops, against the document the
 * workspace holds. Empty when the row changed something else — a title, a
 * query, a presentation flag — which the row says by other means.
 */
export const membershipDelta = (
  saved: ProjectionQuery,
  staged: ProjectionQuery,
): readonly string[] => {
  if (!enumeratesSubjects(saved) || !enumeratesSubjects(staged)) return [];
  return [
    ...staged.subjects
      .filter((id) => !saved.subjects.includes(id))
      .map((id) => `+${id}`),
    ...saved.subjects
      .filter((id) => !staged.subjects.includes(id))
      .map((id) => `-${id}`),
  ];
};

/**
 * Two projection documents, compared by what they SAY rather than by how they
 * are written.
 *
 * Key order is the author's: a document read back off YAML holds its fields in
 * the order someone wrote them, and one composed here holds them in the order
 * this file writes them. Comparing the two as text reports every view as
 * changed the moment anything touches it.
 */
export const sameDocument = (
  left: ProjectionDefinition,
  right: ProjectionDefinition,
): boolean => canonical(left) === canonical(right);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    // Order is meaningful inside a list - a subjects list is the author's own
    // ordering - so only object keys are sorted.
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};
