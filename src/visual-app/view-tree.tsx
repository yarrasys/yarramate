import { LAYER_COLORS } from "../notation/archimate.js";
import type {
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import type { CanvasNode } from "../graph-projection.js";
import {
  MODEL_ROOT_KEY,
  VIEWS_ROOT_KEY,
  buildModelTree,
  buildViewTree,
  matchesFilter,
  type ModelTreeGroup,
  type ViewTreeRow,
} from "./view-tree-model.js";
import { countMatchingSubjects } from "./subject-filter.js";

/**
 * The rail: the saved views and the whole model, as one tree.
 *
 * It replaces a `<select>` in the command strip that held every view at one
 * level and could do nothing to a view but open it. Two roots, the way Archi
 * has them — what is drawn, and everything there is to draw — so a subject the
 * active view leaves out is still visible, marked rather than absent.
 *
 * Rows are buttons in nested lists rather than an ARIA `tree`: a real tree
 * widget owes the reviewer roving focus and arrow-key traversal, and this repo
 * renders React through `renderToStaticMarkup` with no DOM test environment to
 * hold that behaviour honest. Buttons are what the rest of this application
 * uses and what its tests can read.
 */

const ALL_SUBJECTS_LABEL = "All subjects";

const CHEVRON_OPEN = "M2 3.5 5 6.5 8 3.5";
const CHEVRON_CLOSED = "M3.5 2 6.5 5 3.5 8";

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d={open ? CHEVRON_OPEN : CHEVRON_CLOSED}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ViewGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="9" height="7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5h9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function LayerSwatch({ layer }: { readonly layer: string | null }) {
  const colors =
    layer === null
      ? null
      : (LAYER_COLORS as Record<string, { fill: string; border: string }>)[
          layer
        ];
  return (
    <span
      className="tree-swatch"
      style={
        colors === undefined || colors === null
          ? undefined
          : { background: colors.fill, borderColor: colors.border }
      }
      aria-hidden
    />
  );
}

/**
 * A right-click on a row, in viewport coordinates. The rail reports which row
 * was hit and nothing about what the menu should say — `contextMenuFor` owns
 * that, and a rail that also decided it would be a second place to change.
 */
export type TreeRowMenu = (
  row: { readonly kind: "view" | "subject"; readonly id: string },
  position: { readonly x: number; readonly y: number },
) => void;

const menuHandler =
  (row: { readonly kind: "view" | "subject"; readonly id: string }, onMenu: TreeRowMenu) =>
  (event: { preventDefault: () => void; clientX: number; clientY: number }) => {
    event.preventDefault();
    onMenu(row, { x: event.clientX, y: event.clientY });
  };

interface ViewRowProps {
  readonly row: ViewTreeRow;
  readonly depth: 1 | 2;
  readonly onSelect: (id: string) => void;
  readonly onMenu: TreeRowMenu;
}

function ViewRow({ row, depth, onSelect, onMenu }: ViewRowProps) {
  // A staged NEW view is not navigable: opening a view resolves its id in the
  // landed list, where a staged one does not exist yet. The row is the
  // reviewer's intent made visible (ADR 0114); acting on it — discard, undo,
  // commit — belongs to the tray, so the row takes no click and no menu.
  const navigable = row.staged !== "new";
  return (
    <li>
      <button
        type="button"
        className={`tree-row tree-view tree-depth-${depth}${
          row.active ? " tree-row-active" : ""
        }${row.staged === null ? "" : " tree-row-staged"}${
          row.staged === "delete" ? " tree-row-staged-delete" : ""
        }`}
        // The title is width-capped and elided, exactly as the picker it
        // replaces was, so hover still recovers the authored title.
        title={row.title}
        aria-current={row.active ? "true" : undefined}
        onClick={navigable ? () => onSelect(row.id) : undefined}
        onContextMenu={
          navigable
            ? menuHandler({ kind: "view", id: row.id }, onMenu)
            : undefined
        }
      >
        <ViewGlyph />
        <span className="tree-label">{row.title}</span>
        {row.staged === null ? null : (
          <span className="tree-staged">
            {row.staged === "delete" ? "staged delete" : "staged"}
          </span>
        )}
        {/* No count for a row nothing has measured: a staged new view's query
            needs the semantic graph, and a made-up zero would read as an
            empty view. */}
        {row.subjectCount === null ? null : (
          <span className="tree-count">{row.subjectCount}</span>
        )}
      </button>
    </li>
  );
}

interface BranchProps {
  readonly label: string;
  readonly open: boolean;
  readonly count?: number;
  readonly depth: 0 | 1;
  readonly onToggle: () => void;
}

function Branch({ label, open, count, depth, onToggle }: BranchProps) {
  return (
    <button
      type="button"
      className={`tree-row tree-branch tree-depth-${depth}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Chevron open={open} />
      <span className="tree-label">{label}</span>
      {count === undefined ? null : <span className="tree-count">{count}</span>}
    </button>
  );
}

export interface ViewTreeProps {
  readonly views: readonly VisualViewSummary[];
  /**
   * The pending changeset's view operations, merged over `views` by
   * `buildViewTree` so staged intent is visible beside landed truth
   * (ADR 0114). Derived from the changeset at the call site, never stored:
   * discarding the operation is the revert.
   */
  readonly stagedViewOperations: readonly VisualViewOperation[];
  readonly activeViewId: string;
  /** Every subject the workspace declares, filtered or not. */
  readonly nodes: readonly CanvasNode[];
  /** What the canvas is drawing, or `null` when it is drawing everything. */
  readonly inViewIds: ReadonlySet<string> | null;
  /** What the active view draws folded, and what each box holds (#473). */
  readonly folded?: ReadonlySet<string>;
  readonly insideCounts?: ReadonlyMap<string, number>;
  readonly filterText: string;
  readonly collapsed: ReadonlySet<string>;
  readonly onFilterChange: (text: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onSelectView: (id: string) => void;
  readonly onClearView: () => void;
  readonly onNewView: () => void;
  readonly onSelectSubject: (id: string) => void;
  readonly onRowMenu: TreeRowMenu;
  /** A viewer, not an author (#298): the new-view affordance is absent. */
  readonly readOnly?: boolean;
  /**
   * Put the whole rail away (#294's shape, other side). Optional: a host that
   * gives no way back should not be able to draw the control that takes it.
   */
  readonly onHide?: () => void;
}

export function ViewTree({
  views,
  stagedViewOperations,
  activeViewId,
  nodes,
  inViewIds,
  folded,
  insideCounts,
  filterText,
  collapsed,
  onFilterChange,
  onToggle,
  onSelectView,
  onClearView,
  onNewView,
  onSelectSubject,
  onRowMenu,
  readOnly = false,
  onHide,
}: ViewTreeProps) {
  const tree = buildViewTree({
    views,
    stagedOperations: stagedViewOperations,
    activeViewId,
    // Nodes drawn, not entries in the match set: a match set holds the
    // relationships a view matched as well as its concepts, and the number
    // beside a view has to be the one the reviewer can count on the canvas.
    // The subjects themselves rather than their count, so the tree can say
    // how many survive the typed filter (#317).
    activeSubjects:
      inViewIds === null
        ? null
        : nodes.filter((node) => inViewIds.has(node.id)),
    filterText,
  });
  const model: readonly ModelTreeGroup[] = buildModelTree({
    nodes,
    inViewIds,
    filterText,
    folded,
    insideCounts,
  });
  const viewsOpen = !collapsed.has(VIEWS_ROOT_KEY);
  const modelOpen = !collapsed.has(MODEL_ROOT_KEY);
  const searching = filterText.trim() !== "";
  // Unfiltered means no view AND nothing else narrowing the canvas: a chat
  // filter clears the active view but still leaves subjects undrawn, and a row
  // claiming "all subjects" beside a canvas showing six would be wrong.
  const showingAll = activeViewId === "" && inViewIds === null;
  const allSubjectsShown = matchesFilter(ALL_SUBJECTS_LABEL, filterText);

  return (
    <aside className="view-tree" aria-label="Views and model">
      <div className="view-tree-head">
        <input
          type="search"
          name="view-tree-filter"
          className="view-tree-filter"
          placeholder="Filter tree"
          aria-label="Filter views and subjects"
          value={filterText}
          onChange={(event) => onFilterChange(event.currentTarget.value)}
        />
        {onHide === undefined ? null : (
          // Last in the head row so the filter keeps the width: the control
          // that puts the rail away is reached rarely and should not push the
          // thing used constantly.
          <button
            type="button"
            className="rail-hide"
            title="Hide the view tree"
            aria-label="Hide the view tree"
            onClick={onHide}
          >
            «
          </button>
        )}
        {readOnly ? null : (
          <button
            type="button"
            className="view-tree-new"
            title="New view"
            aria-label="New view"
            onClick={onNewView}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M7 3v8M3 7h8"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="view-tree-body">
        <Branch
          label="Views"
          open={viewsOpen}
          depth={0}
          onToggle={() => onToggle(VIEWS_ROOT_KEY)}
        />
        {!viewsOpen ? null : (
          <ul className="tree-list">
            {/* The picker carried an "All (unfiltered)" option and the tree
                has to carry it too: without it a reviewer who opens a view has
                no way back to the whole model, since the canvas only offers
                "Show all" for filters a view did not set. */}
            {!allSubjectsShown ? null : (
              <li>
                <button
                  type="button"
                  className={`tree-row tree-view tree-depth-1${
                    showingAll ? " tree-row-active" : ""
                  }`}
                  aria-current={showingAll ? "true" : undefined}
                  onClick={onClearView}
                  onContextMenu={menuHandler({ kind: "view", id: "" }, onRowMenu)}
                >
                  <ViewGlyph />
                  <span className="tree-label">{ALL_SUBJECTS_LABEL}</span>
                  {/* Survivors of the typed filter, which with no text is
                      every subject the model declares (#317). */}
                  <span className="tree-count">
                    {countMatchingSubjects(nodes, filterText)}
                  </span>
                </button>
              </li>
            )}
            {tree.loose.map((row) => (
              <ViewRow
                key={row.id}
                row={row}
                depth={1}
                onSelect={onSelectView}
                onMenu={onRowMenu}
              />
            ))}
            {tree.folders.map((folder) => {
              // A search opens every folder it matched into: a hit the
              // reviewer cannot see is the same as no hit.
              const open = searching || !collapsed.has(folder.key);
              return (
                <li key={folder.key}>
                  <Branch
                    label={folder.name}
                    open={open}
                    count={open ? undefined : folder.views.length}
                    depth={1}
                    onToggle={() => onToggle(folder.key)}
                  />
                  {!open ? null : (
                    <ul className="tree-list">
                      {folder.views.map((row) => (
                        <ViewRow
                          key={row.id}
                          row={row}
                          depth={2}
                          onSelect={onSelectView}
                          onMenu={onRowMenu}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {/* Only when the root is genuinely empty: a line saying nothing
                matched, printed under a row that did, is worse than silence. */}
            {!searching || tree.matched !== 0 || allSubjectsShown ? null : (
              <li className="tree-empty">No view matches that.</li>
            )}
          </ul>
        )}

        <Branch
          label="Model"
          open={modelOpen}
          depth={0}
          onToggle={() => onToggle(MODEL_ROOT_KEY)}
        />
        {!modelOpen ? null : (
          <ul className="tree-list">
            {model.map((group) => {
              const open = searching || !collapsed.has(group.key);
              return (
                <li key={group.key}>
                  <Branch
                    label={group.label}
                    open={open}
                    count={open ? undefined : group.subjects.length}
                    depth={1}
                    onToggle={() => onToggle(group.key)}
                  />
                  {!open ? null : (
                    <ul className="tree-list">
                      {group.subjects.map((subject) => (
                        <li key={subject.id}>
                          <button
                            type="button"
                            className={`tree-row tree-subject tree-depth-2${
                              subject.inView ? "" : " tree-row-quiet"
                            }`}
                            title={
                              subject.foldedCount === null
                                ? `${subject.name} — ${subject.kindLabel}`
                                : `${subject.name} — ${subject.kindLabel}, folded over ${subject.foldedCount} ${subject.foldedCount === 1 ? "subject" : "subjects"}`
                            }
                            onClick={() => onSelectSubject(subject.id)}
                            onContextMenu={menuHandler(
                              { kind: "subject", id: subject.id },
                              onRowMenu,
                            )}
                          >
                            <LayerSwatch layer={subject.layer} />
                            {/* The rail is where a reader looks when the
                                canvas has hidden something, so a folded box
                                says here what it swallowed (#473). */}
                            {subject.foldedCount === null ? null : (
                              <span className="tree-fold" aria-hidden="true">
                                ▸
                              </span>
                            )}
                            <span className="tree-label">{subject.name}</span>
                            {subject.foldedCount === null ||
                            subject.foldedCount === 0 ? null : (
                              <span className="tree-count">
                                {subject.foldedCount}
                              </span>
                            )}
                            {subject.inView ? null : (
                              <span className="tree-count">not in view</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {model.length !== 0 || !searching ? null : (
              <li className="tree-empty">No subject matches that.</li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}
