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
 * Where a view's document goes. `directory` is manifest-relative and comes
 * from the folder the reviewer saved into — folders are read back off these
 * paths rather than declared in the format (#245), so the path is the only
 * place a folder is ever stated.
 */
export const projectionPathFor = (
  id: string,
  directory: string = DEFAULT_PROJECTION_DIRECTORY,
): string => `${directory.replace(/\/+$/, "")}/${id}.yaml`;

/**
 * The projection document a saved view is, composed from what the form holds.
 *
 * `title` and `description` are presentation fields rather than top-level
 * ones, which is where `ProjectionDefinition` puts them, and every other
 * presentation field the active view declared is carried through — dropping
 * one here is how overwriting a view silently loses its nesting or direction.
 */
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
