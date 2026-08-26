/**
 * The one substring judgement every surface that filters subjects by typed
 * text shares.
 *
 * #307 extracted the predicate inside `graph-canvas.tsx` so the canvas pass
 * and the shell's empty-state honesty could not drift; #317 lifts it here so
 * the rail's tree filter can share it too. It cannot simply be imported from
 * `graph-canvas.tsx`: the rail's tree model (`view-tree-model.ts`) keeps a
 * zero-dependency discipline — no React, no cytoscape — and merely loading
 * the canvas module registers cytoscape-elk. So the predicate lives in this
 * small pure module and both surfaces import it from here.
 */
import type { CanvasNode } from "../graph-projection.js";

/**
 * The slice of a subject the predicate reads — the render data both the
 * canvas and the rail already hold.
 */
export type FilterableSubject = Pick<CanvasNode, "id" | "name" | "kindLabel">;

/**
 * Typed filter text made comparable: trimmed and lowercased, once, so every
 * surface trims the same way before matching.
 */
export const normalizeFilterText = (text: string): string =>
  text.trim().toLowerCase();

/**
 * Whether a subject survives the typed text: case-insensitive, against its
 * id, name, and kind label. `name` and `kindLabel` are `unknown` because the
 * canvas reads them out of cytoscape data, which types nothing.
 */
export function subjectMatchesQuickFilter(
  trimmedLowerFilter: string,
  id: string,
  name: unknown,
  kindLabel: unknown,
): boolean {
  if (trimmedLowerFilter === "") return true;
  if (id.toLowerCase().includes(trimmedLowerFilter)) return true;
  if (
    typeof name === "string" &&
    name.toLowerCase().includes(trimmedLowerFilter)
  ) {
    return true;
  }
  return (
    typeof kindLabel === "string" &&
    kindLabel.toLowerCase().includes(trimmedLowerFilter)
  );
}

/**
 * How many of these subjects survive the typed text — the number a tree row
 * shows while the filter narrows (#317). With no text every subject
 * survives, so this is also the plain length.
 */
export const countMatchingSubjects = (
  subjects: readonly FilterableSubject[],
  filterText: string,
): number => {
  const needle = normalizeFilterText(filterText);
  return subjects.filter((subject) =>
    subjectMatchesQuickFilter(
      needle,
      subject.id,
      subject.name,
      subject.kindLabel,
    ),
  ).length;
};
