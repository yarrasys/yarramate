import { stringify } from "yaml";
import { loadProjection } from "../../projection.js";
import { withDiagnosticSubjects } from "../../compiler.js";
import type { Diagnostic } from "../../compiler.js";
import { posixDirectoryOf } from "../../apply-command.js";
import type { PendingWrite, SourceStore } from "../../source-store.js";
import type { ResolvedWorkspace } from "../../workspace.js";
import { projectGraphForCanvas } from "../../graph-projection.js";
import { DEFAULT_PROJECTION_DIRECTORY } from "./view-identity.js";
import type {
  VisualDiagnostic,
  VisualViewOperation,
} from "./protocol-contract.js";
import { evaluateProjection, explainProjection } from "../../projection.js";
import type {
  ProjectionDefinition,
  ProjectionExclusion,
  ProjectionQuery,
} from "../../projection.js";
import type {
  ResolvedProfileContext,
  SemanticGraph,
} from "../../compiler.js";
import { kindLabelOf } from "../../kind-label.js";
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from "../../interrogate-command.js";
import type { VisualKindOption, VisualViewSummary } from "./protocol-contract.js";
import type {
  VisualInterrogationOverlay,
  VisualQuestionEntry,
  VisualRenderedModel,
} from "./wire.js";

/**
 * What a workspace looks like to the editor, however the editor is being run
 * (#252).
 *
 * These were the session server's, and the session server is one host now: an
 * embedder mounting the editor over its own store computes the same model, the
 * same vocabulary and the same view counts, and two definitions of any of them
 * would be two answers to the same question. So the arithmetic lives here and
 * the orchestration - which bytes to read, which digests to pin, what a layout
 * sidecar says - stays with whoever owns those.
 *
 * Browser-safe: no `node:`, no filesystem, no session. Everything is a pure
 * function of a compile result.
 */

/**
 * The kinds a browser may offer, each with the core kind it descends from.
 *
 * `[0]` is the nearest declared ancestor, the same reading
 * `projectGraphForCanvas` gives an authored subject its `coreKindLabel`. A kind
 * with no lineage IS a core kind and stands for itself. Without the core label
 * an editor can read a palette but cannot judge it: the ArchiMate table is
 * keyed on core kinds, so offering an extension kind unchecked puts a `YM404`
 * one click away.
 */
export const kindOptionsOf = (
  lineages: ReadonlyMap<string, readonly string[]>,
): readonly VisualKindOption[] =>
  [...lineages.keys()].map((id) => ({
    id,
    label: kindLabelOf(id),
    coreLabel: kindLabelOf(lineages.get(id)?.[0] ?? id),
  }));

/**
 * How many SUBJECTS a query matches, which is not the size of its match set.
 *
 * A `SemanticGraph`'s subjects are concepts and relationships together, so the
 * match set returns both — right for narrowing a canvas that draws edges as
 * well as nodes, and wrong for a number sitting beside a view called its
 * subject count. A view over three components with two relationships between
 * them would read as five, and the reviewer counting boxes would find three.
 */
export const conceptCountOf = (
  graph: SemanticGraph,
  query: ProjectionQuery,
  profileContext: ResolvedProfileContext,
): number =>
  evaluateProjection(graph, adHoc(query), profileContext).subjects.filter(
    ({ type }) => type === "concept",
  ).length;

/**
 * Folds one interrogation report into what the canvas draws (#292).
 *
 * Undefined — never a throw — when the catalogue does not load: the overlay
 * is a garnish on the model, and a model frame must not be blocked by it.
 * Subject ids come from the same compiled graph as `CanvasNode.id`, so the
 * join in the browser is a plain lookup.
 */
export interface DismissedQuestion {
  readonly questionId: string;
  /** Absent dismisses the question wherever it appears. */
  readonly subject?: string;
}

export const interrogationOverlayOf = (
  compiled: {
    readonly graph: SemanticGraph;
    readonly profileContext: ResolvedProfileContext;
  },
  catalogue: { readonly path: string; readonly source: string },
  /**
   * What the host has already dealt with (#328). Evaluation is unchanged and
   * the model is untouched: this decides only what the pane draws, because a
   * question set aside in the host's own product should not be asked again by
   * a pane embedded in it.
   */
  dismissed: readonly DismissedQuestion[] = [],
): VisualInterrogationOverlay | undefined => {
  const loaded = loadQuestionCatalogue(catalogue);
  if (!loaded.ok) return undefined;
  const report = evaluateCatalogue(
    loaded.catalogue,
    compiled.graph,
    compiled.profileContext,
  );
  const dismissedEverywhere = new Set(
    dismissed
      .filter(({ subject }) => subject === undefined)
      .map(({ questionId }) => questionId),
  );
  const dismissedForSubject = new Set(
    dismissed
      .filter(({ subject }) => subject !== undefined)
      .map(({ questionId, subject }) => `${questionId}\u0000${subject}`),
  );
  const workspace: VisualQuestionEntry[] = [];
  const subjects: Record<string, VisualQuestionEntry[]> = {};
  for (const wave of report.waves) {
    for (const question of wave.questions) {
      if (!question.open) continue;
      if (dismissedEverywhere.has(question.id)) continue;
      const base = {
        questionId: question.id,
        authority: question.authority,
        ...(question.since === undefined ? {} : { since: question.since }),
      };
      if (question.subjects === undefined) {
        workspace.push({ ...base, question: question.question });
        continue;
      }
      for (const subject of question.subjects) {
        if (dismissedForSubject.has(`${question.id}\u0000${subject.id}`)) {
          continue;
        }
        (subjects[subject.id] ??= []).push({
          ...base,
          question: subject.question,
        });
      }
    }
  }
  return {
    catalogue: report.catalogue,
    semantics: report.semantics,
    workspace,
    subjects,
  };
};

/**
 * Rebuilds the shared editor workspace from one successful compile.
 *
 * The caller owns metadata which cannot be inferred from a graph (authority,
 * source revisions, layouts, and initial view); this helper owns all derived
 * canvas, vocabulary, view-count, and interrogation arithmetic. `catalogue`
 * is the question catalogue's bytes — this module cannot read files, so
 * whoever can hands them over; omitting it ships a model with no overlay.
 */
export const renderedWorkspaceOf = (
  compiled: {
    readonly graph: SemanticGraph;
    readonly profileContext: ResolvedProfileContext;
  },
  views: readonly VisualViewSummary[],
  metadata: Omit<VisualRenderedModel, "graph" | "vocabulary" | "interrogation">,
  catalogue?: { readonly path: string; readonly source: string },
  dismissed?: readonly DismissedQuestion[],
): {
  readonly model: VisualRenderedModel;
  readonly views: readonly VisualViewSummary[];
} => {
  const refreshedViews = views.map((view) => ({
    ...view,
    subjectCount: conceptCountOf(
      compiled.graph,
      view.query,
      compiled.profileContext,
    ),
  }));
  const interrogation =
    catalogue === undefined
      ? undefined
      : interrogationOverlayOf(compiled, catalogue, dismissed);
  return {
    model: {
      ...metadata,
      graph: projectGraphForCanvas(compiled.graph, compiled.profileContext),
      vocabulary: {
        conceptKinds: kindOptionsOf(compiled.profileContext.conceptKindLineages),
        relationshipKinds: kindOptionsOf(
          compiled.profileContext.relationshipKindLineages,
        ),
      },
      ...(interrogation === undefined ? {} : { interrogation }),
    },
    views: refreshedViews,
  };
};

/** Every subject a query draws, concepts and relationships alike. */
export const matchedIdsOf = (
  graph: SemanticGraph,
  query: ProjectionQuery,
  profileContext: ResolvedProfileContext,
): readonly string[] =>
  evaluateProjection(graph, adHoc(query), profileContext).subjects.map(
    ({ id }) => id,
  );

/** Every concept a query dropped, and the facet that dropped it (#248). */
export const exclusionsOf = (
  graph: SemanticGraph,
  query: ProjectionQuery,
  profileContext: ResolvedProfileContext,
): readonly ProjectionExclusion[] =>
  explainProjection(graph, adHoc(query), profileContext);

/**
 * A query on its own is not a projection, and every evaluator here wants one.
 * The id is a placeholder that never reaches a document.
 */
const adHoc = (query: ProjectionQuery): ProjectionDefinition => ({
  format: "yarramate/projection/v1",
  id: "ad-hoc",
  version: "0",
  query,
});

/**
 * One saved view, as the rail reads it. `subjectCount` is the caller's,
 * because counting needs a compiled graph and a session builds its first list
 * before it has one.
 */
export const viewSummaryOf = (
  projection: ProjectionDefinition,
  path: string,
  subjectCount = 0,
): VisualViewSummary => ({
  id: projection.id,
  title: projection.presentation?.title ?? projection.id,
  description: projection.presentation?.description ?? "",
  query: projection.query,
  presentation: projection.presentation,
  path,
  subjectCount,
});

/**
 * Applies a landed view batch to a host-owned list.
 *
 * Writes are read back through the callback, so a malformed or otherwise
 * unreadable landed document cannot become a fabricated summary.
 */
export const adoptLandedViews = (
  views: readonly VisualViewSummary[],
  operations: readonly VisualViewOperation[],
  readSummary: (path: string) => VisualViewSummary | undefined,
): readonly VisualViewSummary[] => {
  const next = [...views];
  for (const operation of operations) {
    const at = next.findIndex((view) => view.path === operation.path);
    if (operation.op === "delete-view") {
      if (at !== -1) next.splice(at, 1);
      continue;
    }
    const summary = readSummary(operation.path);
    if (summary === undefined) continue;
    if (at === -1) next.push(summary);
    else next[at] = summary;
  }
  return next;
};

/**
 * The document a diagnostic the runtime minted itself points at. Not a file:
 * these are about the session rather than about anything the workspace holds.
 */
export const VISUAL_SERVER_DOCUMENT = "visual-session-server";

export const published = (
  diagnostics: readonly Diagnostic[],
  sources: readonly { readonly path: string; readonly source: string }[],
): readonly VisualDiagnostic[] =>
  withDiagnosticSubjects(diagnostics, sources) as readonly VisualDiagnostic[];

export const serverDiagnostic = (
  code: string,
  message: string,
  pointer = "/",
): VisualDiagnostic => ({
  severity: "error",
  code,
  message,
  path: VISUAL_SERVER_DOCUMENT,
  pointer,
  line: 1,
  column: 1,
});
/**
 * Whether the workspace would load a projection written at this path.
 *
 * This is a DIRECTORY check, not a pattern match, and deliberately so: ADR
 * 0100 recorded that the manifest's pattern dialect has never been named - it
 * is whatever `globSync` happens to support, undocumented and untested past
 * one wildcard - so a matcher written here would be inventing the dialect
 * rather than honouring it. A directory that already holds a projection the
 * manifest resolved is a directory the manifest demonstrably reaches.
 *
 * A workspace with no projections at all has nothing to demonstrate, so the
 * default directory is allowed: refusing there would make the first view in a
 * fresh workspace impossible to create.
 */
export const projectionDirectoryIsCovered = (
  path: string,
  workspace: ResolvedWorkspace,
): boolean => {
  if (workspace.projections.length === 0) {
    return posixDirectoryOf(path) === DEFAULT_PROJECTION_DIRECTORY;
  }
  const covered = new Set(workspace.projections.map(posixDirectoryOf));
  return covered.has(posixDirectoryOf(path));
};

/**
 * Turns staged view operations into pending writes, refusing before anything
 * is written (ADR 0103).
 *
 * A `write-view` is validated through the same `loadProjection` the CLI's own
 * projection writes go through, so a document the schema would reject never
 * reaches the store. A `delete-view` names a revision, which is what makes a
 * removal refusable rather than a silent success on a file someone else
 * already changed.
 */
export const planViewWrites = (
  operations: readonly VisualViewOperation[],
  workspace: ResolvedWorkspace,
  store: SourceStore,
):
  | { readonly ok: true; readonly writes: readonly PendingWrite[] }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] } => {
  const writes: PendingWrite[] = [];
  const diagnostics: VisualDiagnostic[] = [];
  for (const operation of operations) {
    const held = store.read(operation.path);
    if (operation.op === "delete-view") {
      if (held === undefined) {
        diagnostics.push(
          serverDiagnostic(
            "YMVS314",
            `View "${operation.path}" is already gone`,
          ),
        );
        continue;
      }
      writes.push({
        path: operation.path,
        source: null,
        expected: held.revision,
      });
      continue;
    }
    if (
      held === undefined &&
      !projectionDirectoryIsCovered(operation.path, workspace)
    ) {
      // A projection no pattern reaches is a file the workspace never loads,
      // which is worse than a refusal because nothing later says so (ADR 0043).
      diagnostics.push(
        serverDiagnostic(
          "YMVS315",
          `The workspace manifest covers no projection in "${posixDirectoryOf(
            operation.path,
          )}", so a view saved there would never load`,
        ),
      );
      continue;
    }
    const source = stringify(operation.projection);
    const loaded = loadProjection({ path: operation.path, source });
    if (!loaded.ok) {
      // The composed document is the only source these are about, so they are
      // published against it rather than against the workspace.
      diagnostics.push(
        ...published(loaded.diagnostics, [{ path: operation.path, source }]),
      );
      continue;
    }
    writes.push({
      path: operation.path,
      source,
      expected: held?.revision ?? null,
    });
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, writes };
};
