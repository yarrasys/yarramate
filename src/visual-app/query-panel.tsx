import { emitYaml } from "../yaml-emission.js";
import { useRef, useState } from "react";
import type { CanvasNode } from "../graph-projection.js";
import type {
  ConceptFacet,
  ProjectionDefinition,
  ProjectionExclusion,
  ProjectionQuery,
} from "../projection.js";
import type {
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import { composeProjection } from "../adapters/visual/view-identity.js";
import type { ActiveFilter } from "./state.js";
import {
  PresentationToggles,
  QueryFacets,
  composeQuery,
  queryToFields,
  type PresentationFlag,
  type QueryFields,
} from "./query-fields.js";

/**
 * The collapsible tabbed panel along the foot of the canvas column, and its
 * first tab: the view's query (#248).
 *
 * It spans the CANVAS COLUMN rather than the window - the right column runs
 * full height and its own foot is chat - so it is mounted inside the diagram
 * workspace and not beside it.
 *
 * The tab is the query editor the facets never quite were. A filter panel could
 * compose a query and narrow the diagram, but it opened OVER the canvas it was
 * narrowing and it could only report what matched. Three things move the
 * editing here: a live match count, so a query that selects nothing is visible
 * before it is saved; the subjects the query drops with the facet that dropped
 * each one; and the projection document the query resolves to, serialised by
 * the same `yaml` the runtime writes it with, so what the reviewer reads is
 * what a commit would put on disk.
 *
 * An edit STAGES rather than saves. A query edit is a change to a view like any
 * other change, so it joins the changeset and lands with everything else.
 */

/** How long the reviewer must pause before an edit becomes a live query. */
export const APPLY_DEBOUNCE_MS = 300;

/** How many subjects one exclusion group shows before it counts the rest. */
export const EXCLUSION_PREVIEW = 12;

export const BOTTOM_PANEL_TABS = [
  { id: "view-query", label: "View query" },
] as const;

export type BottomPanelTabId = (typeof BOTTOM_PANEL_TABS)[number]["id"];

/**
 * Whether two queries say the same thing, key order aside.
 *
 * A query seeded from a YAML document and a query composed by the form hold
 * the same fields in whatever order each was written, so `JSON.stringify` on
 * its own would report every view's own query as an unapplied edit the moment
 * the panel opened.
 */
const canonical = (value: object | undefined): string =>
  JSON.stringify(
    Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : 1,
    ),
  );

export const sameQuery = (
  left: ProjectionQuery,
  right: ProjectionQuery,
): boolean => canonical(left) === canonical(right);

/**
 * Why a subject the canvas does not draw is not drawn.
 *
 * A facet is the answer `explainProjection` gives. `isolatedConcepts` is the
 * only other way a concept leaves the drawn set - `relationships`/
 * `isolatedConcepts` run AFTER the facets, and dropping an unconnected concept
 * is the one thing they do that no facet reports. `unreported` is a chat
 * filter, whose answer carries no reasons at all: saying nothing is the honest
 * reading, and claiming a facet would be an invention.
 */
export type ExclusionReason = ConceptFacet | "isolatedConcepts" | "unreported";

export const EXCLUSION_LABELS: {
  readonly [Reason in ExclusionReason]: string;
} = {
  // Ordered the way `explainProjection` reaches them, so a reader meets the
  // reasons in the order the query applies them - the explicit exception
  // first, because it outranks every rule (#267).
  exclude: "Taken out of this view",
  states: "States",
  subjects: "Subjects",
  documents: "Documents",
  kinds: "Kinds",
  layers: "Layers",
  statuses: "Statuses",
  excludeStatuses: "Excluded statuses",
  owners: "Owners",
  constraints: "Constraints",
  isolatedConcepts: "Isolated concepts",
  unreported: "Not reported",
};

const REASON_ORDER = Object.keys(EXCLUSION_LABELS) as readonly ExclusionReason[];

export interface ExclusionGroup {
  readonly reason: ExclusionReason;
  readonly label: string;
  readonly subjects: readonly { readonly id: string; readonly title: string }[];
}

/**
 * The subjects the query drops, grouped by the facet that dropped each one.
 *
 * The SET comes from `matchedIds` and the REASON from `excluded`, deliberately:
 * `matchedIds` is what the canvas draws, so a list built from it can never
 * disagree with the diagram beside it. The exclusions answer a different
 * question - which facet rejected a concept - and a concept a facet rejected
 * can still be drawn, because `relationships: connected` pulls in the other end
 * of a relationship whatever the facets said about it.
 */
export const exclusionGroups = (
  nodes: readonly CanvasNode[],
  matchedIds: readonly string[] | null,
  excluded: readonly ProjectionExclusion[] | null,
): readonly ExclusionGroup[] => {
  if (matchedIds === null) return [];
  const drawn = new Set(matchedIds);
  const facetOf =
    excluded === null
      ? null
      : new Map(excluded.map(({ id, facet }) => [id, facet] as const));
  const grouped = new Map<
    ExclusionReason,
    { readonly id: string; readonly title: string }[]
  >();
  for (const node of nodes) {
    if (drawn.has(node.id)) continue;
    const reason: ExclusionReason =
      facetOf === null
        ? "unreported"
        : (facetOf.get(node.id) ?? "isolatedConcepts");
    const subjects = grouped.get(reason) ?? [];
    subjects.push({ id: node.id, title: node.name });
    grouped.set(reason, subjects);
  }
  return REASON_ORDER.flatMap((reason) => {
    const subjects = grouped.get(reason);
    return subjects === undefined
      ? []
      : [{ reason, label: EXCLUSION_LABELS[reason], subjects }];
  });
};

/**
 * How many SUBJECTS the query matches, which is not the size of the match set:
 * `matchedIds` names concepts and relationships together, so counting it whole
 * reports five for a view over three components with two relationships between
 * them, and the reviewer counting boxes finds three.
 */
export const matchedSubjectCount = (
  nodes: readonly CanvasNode[],
  matchedIds: readonly string[] | null,
): number => {
  if (matchedIds === null) return nodes.length;
  const drawn = new Set(matchedIds);
  return nodes.filter((node) => drawn.has(node.id)).length;
};

/**
 * Subjects a facet rejected that the canvas draws anyway. Not a contradiction:
 * `relationships: connected` selects a relationship on one endpoint and takes
 * the other endpoint with it. Reported because a query whose facets say one
 * thing and whose canvas shows another is worth one line of explanation.
 */
export const pulledBackIn = (
  matchedIds: readonly string[] | null,
  excluded: readonly ProjectionExclusion[] | null,
): number => {
  if (matchedIds === null || excluded === null) return 0;
  const drawn = new Set(matchedIds);
  return excluded.filter(({ id }) => drawn.has(id)).length;
};

/** The three badge toggles, which are the only presentation a reviewer can
 * change from this tab. */
export interface BadgeChoices {
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
}

export interface ViewDocumentInput {
  readonly view: VisualViewSummary;
  readonly query: ProjectionQuery;
  /** What the canvas is showing now. */
  readonly badges: BadgeChoices;
  /**
   * What it was showing when this view was opened.
   *
   * Without it, a flag the view never declared gets written anyway: not one
   * projection in this repository declares `showOwnership`, so staging a query
   * edit would quietly add three presentation fields the author never wrote and
   * the reviewer never chose. A flag is written when the view already declares
   * it, or when the reviewer has actually moved it.
   */
  readonly opened: BadgeChoices;
}

const badgePresentation = (
  view: VisualViewSummary,
  badges: BadgeChoices,
  opened: BadgeChoices,
): ProjectionDefinition["presentation"] => {
  const declared = view.presentation ?? {};
  const write = <Key extends keyof BadgeChoices>(
    key: Key,
  ): Partial<BadgeChoices> =>
    declared[key] !== undefined || badges[key] !== opened[key]
      ? { [key]: badges[key] }
      : {};
  return {
    // Every field the view declared, carried rather than restated: the
    // direction it runs and the nesting vocabulary it draws are both dropped
    // by a document that composes only what this tab can edit.
    ...declared,
    ...write("showLifecycle"),
    ...write("showEvidence"),
    ...write("showOwnership"),
  };
};

/**
 * The projection document this query resolves to, for the view being edited.
 */
export const viewDocument = ({
  view,
  query,
  badges,
  opened,
}: ViewDocumentInput): ProjectionDefinition =>
  composeProjection({
    id: view.id,
    title: view.title,
    description: view.description,
    query,
    presentation: badgePresentation(view, badges, opened),
  });

/** The staged write this tab's Stage button issues. Nothing reaches disk until
 * the changeset is committed (ADR 0103). */
export const stagedViewEdit = (
  input: ViewDocumentInput,
): VisualViewOperation => ({
  op: "write-view",
  path: input.view.path,
  projection: viewDocument(input),
});

/**
 * Whether staging would change the view's document at all.
 *
 * Compared field by field rather than as serialised text: a query read back off
 * a YAML document holds its fields in whatever order the author wrote them, and
 * the form composes its own order, so comparing the two documents as strings
 * reports every view as edited the moment it is opened.
 */
export const documentChanged = (input: ViewDocumentInput): boolean => {
  const edited = viewDocument(input);
  const saved = composeProjection({
    id: input.view.id,
    title: input.view.title,
    description: input.view.description,
    query: input.view.query,
    presentation: input.view.presentation,
  });
  return (
    canonical(edited.query) !== canonical(saved.query) ||
    canonical(edited.presentation) !== canonical(saved.presentation)
  );
};

export interface QueryPanelProps {
  /** Every concept the workspace declares, not the ones on screen: the
   * excluded list is the difference between the two. */
  readonly nodes: readonly CanvasNode[];
  readonly activeFilter: ActiveFilter | null;
  /** The view a staged edit would write, or null when no view is active. */
  readonly view: VisualViewSummary | null;
  readonly open: boolean;
  readonly tab: BottomPanelTabId;
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly showNudges: boolean;
  readonly onTogglePresentation: (
    flag: PresentationFlag,
    value: boolean,
  ) => void;
  readonly onToggleOpen: () => void;
  readonly onSelectTab: (tab: BottomPanelTabId) => void;
  /** Applies the edited query to the canvas. Live, debounced, and never a
   * write: what is on screen is what the reviewer is composing. */
  readonly onApply: (query: ProjectionQuery) => void;
  readonly onStage: (operation: VisualViewOperation) => void;
  /**
   * A viewer, not an author (#298): the fields still narrow the canvas - a
   * live filter writes nothing - but the affordance that stages the edit as a
   * view change is absent. The document still shows, because it is a fact.
   */
  readonly readOnly?: boolean;
}

export function QueryPanel({
  nodes,
  activeFilter,
  view,
  open,
  tab,
  showLifecycle,
  showEvidence,
  showOwnership,
  showNudges,
  onTogglePresentation,
  onToggleOpen,
  onSelectTab,
  onApply,
  onStage,
  readOnly = false,
}: QueryPanelProps) {
  const debounceHandle = useRef<number | null>(null);
  // The VIEW's own query first, and the standing filter only when no view is
  // active. A session opens its first view before that view's filter has been
  // answered, so seeding from the filter alone starts the tab empty and leaves
  // it empty: the fields say nothing, the document says `query: {}`, and
  // staging that would overwrite the view's query with nothing.
  const [fields, setFields] = useState<QueryFields>(() =>
    queryToFields(view?.query ?? activeFilter?.query ?? null),
  );
  const [staged, setStaged] = useState(false);
  // Captured once, when this view was opened: the panel is keyed on the active
  // view, so navigating remounts it and takes a fresh reading.
  const [opened] = useState<BadgeChoices>(() => ({
    showLifecycle,
    showEvidence,
    showOwnership,
  }));

  const scheduleApply = (next: QueryFields) => {
    if (debounceHandle.current !== null)
      window.clearTimeout(debounceHandle.current);
    debounceHandle.current = window.setTimeout(() => {
      debounceHandle.current = null;
      onApply(composeQuery(next));
    }, APPLY_DEBOUNCE_MS);
  };

  const update = <K extends keyof QueryFields>(
    key: K,
    value: QueryFields[K],
  ) => {
    setStaged(false);
    setFields((previous) => {
      const next = { ...previous, [key]: value };
      scheduleApply(next);
      return next;
    });
  };

  const composed = composeQuery(fields);
  const matchedIds = activeFilter?.matchedIds ?? null;
  const count = matchedSubjectCount(nodes, matchedIds);
  const groups = exclusionGroups(nodes, matchedIds, activeFilter?.excluded ?? null);
  const pulled = pulledBackIn(matchedIds, activeFilter?.excluded ?? null);
  // The outcome describes the query the canvas is showing. Until a pause has
  // passed and the answer has come back, that is not the query in the fields,
  // and a count labelled as if it were would be the one number in the tab that
  // could be wrong.
  const resolved =
    activeFilter === null
      ? Object.keys(composed).length === 0
      : sameQuery(composed, activeFilter.query);
  const documentInput: ViewDocumentInput | null =
    view === null
      ? null
      : {
          view,
          query: composed,
          badges: { showLifecycle, showEvidence, showOwnership },
          opened,
        };

  return (
    <section className="bottom-panel" aria-label="Canvas panels">
      <div className="bottom-panel-tabs" role="tablist" aria-label="Canvas panels">
        {BOTTOM_PANEL_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`bottom-tab-${entry.id}`}
            className="bottom-panel-tab"
            aria-selected={open && tab === entry.id}
            aria-controls={`bottom-panel-${entry.id}`}
            onClick={() => {
              if (open && tab === entry.id) {
                onToggleOpen();
                return;
              }
              onSelectTab(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
        {/* A collapsed panel still answers the question it was opened for. */}
        <span className="bottom-panel-summary" role="status">
          {count} {count === 1 ? "subject" : "subjects"}
          {groups.length === 0
            ? ""
            : ` · ${groups.reduce(
                (total, group) => total + group.subjects.length,
                0,
              )} excluded`}
        </span>
        <button
          type="button"
          className="bottom-panel-collapse"
          aria-expanded={open}
          aria-controls={`bottom-panel-${tab}`}
          aria-label={open ? "Collapse panel" : "Expand panel"}
          onClick={onToggleOpen}
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      {!open ? null : (
        <div
          className="bottom-panel-body"
          id={`bottom-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`bottom-tab-${tab}`}
        >
          <div className="query-tab">
            <div className="query-tab-fields">
              <QueryFacets fields={fields} onChange={update} />
              <PresentationToggles
                showLifecycle={showLifecycle}
                showEvidence={showEvidence}
                showOwnership={showOwnership}
                showNudges={showNudges}
                onTogglePresentation={onTogglePresentation}
              />
            </div>
            <div className="query-tab-outcome">
              <h3>Matches</h3>
              <p className="query-match-count">
                <strong>{count}</strong>{" "}
                {count === 1 ? "subject" : "subjects"} of {nodes.length}
              </p>
              {resolved ? null : (
                <p className="query-outcome-stale">
                  Describing the query on the canvas, not the edit in progress.
                </p>
              )}
              {count === 0 && matchedIds !== null ? (
                <p className="query-outcome-empty">
                  This query selects nothing.
                </p>
              ) : null}
              {pulled === 0 ? null : (
                <p className="query-outcome-note">
                  {pulled} a facet dropped {pulled === 1 ? "is" : "are"} drawn
                  anyway: <code>relationships: connected</code> takes the other
                  end of a relationship with it.
                </p>
              )}
              <h3>Excluded, and why</h3>
              {groups.length === 0 ? (
                <p className="query-outcome-note">
                  Nothing is left out of this view.
                </p>
              ) : (
                <ul className="query-exclusions">
                  {groups.map((group) => (
                    <li key={group.reason}>
                      <span className="query-exclusion-facet">
                        {group.label}
                      </span>{" "}
                      <span className="query-exclusion-count">
                        {group.subjects.length}
                      </span>
                      <ul>
                        {group.subjects
                          .slice(0, EXCLUSION_PREVIEW)
                          .map((subject) => (
                            <li key={subject.id} title={subject.id}>
                              {subject.title}
                            </li>
                          ))}
                        {group.subjects.length > EXCLUSION_PREVIEW ? (
                          <li className="query-exclusion-more">
                            and {group.subjects.length - EXCLUSION_PREVIEW} more
                          </li>
                        ) : null}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="query-tab-document">
              <h3>Document</h3>
              {documentInput === null ? (
                <p className="query-outcome-note">
                  {readOnly
                    ? "No view is active, so this query has no document. Pick one in the tree."
                    : "No view is active, so this query has no document yet. Pick one in the tree, or save this query as a new view."}
                </p>
              ) : (
                <>
                  <pre className="query-document">
                    {emitYaml(viewDocument(documentInput))}
                  </pre>
                  {readOnly ? null : (
                    <div className="query-tab-actions">
                      <button
                        type="button"
                        disabled={!documentChanged(documentInput)}
                        onClick={() => {
                          onStage(stagedViewEdit(documentInput));
                          setStaged(true);
                        }}
                      >
                        Stage view change
                      </button>
                      <span role="status" className="query-stage-status">
                        {staged
                          ? "Staged. It lands when the changeset is committed."
                          : ""}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
