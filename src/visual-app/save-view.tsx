import { useState } from "react";
import type { ProjectionQuery } from "../projection.js";
import type {
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import {
  composeProjection,
  projectionPathFor,
  viewIdFrom,
} from "../adapters/visual/view-identity.js";

export interface SaveViewDialogProps {
  readonly views: readonly VisualViewSummary[];
  readonly activeViewId: string;
  readonly query: ProjectionQuery | null;
  readonly layout: "layered";
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  /**
   * Openness is the caller's, not the form's: every way in is somewhere else -
   * the rail's new-view button, three context-menu items - and two components
   * cannot both own one boolean. The strip's own `Save view` button is gone
   * with the rest of the strip's controls (#249).
   */
  readonly open: boolean;
  /**
   * The folder a NEW view declares. Comes from "New view in this folder…",
   * which names one by pointing at a view already in it, or from "New
   * folder…", which names one that does not exist yet. Undefined is no folder.
   */
  readonly folder: string | undefined;
  readonly onClose: () => void;
  /** Stages the write. Nothing is on disk until the changeset is committed. */
  readonly onStage: (operation: VisualViewOperation) => void;
}

export interface BuildPayloadParams {
  /** The view being overwritten, or undefined to mint a new one. */
  readonly id: string | undefined;
  /**
   * Every view id already in use, so a new one takes a free slug. The server
   * used to mint this; a staged row has to name the document it will write
   * before it is committed, so the browser mints it now (ADR 0103).
   */
  readonly taken: ReadonlySet<string>;
  /** Where the overwritten view's document already lives, if there is one. */
  readonly path: string | undefined;
  /**
   * The folder this document declares. Carried rather than composed, for the
   * same reason `carriedDirection` is: this builds the presentation block from
   * scratch, so a field it is not given is a field the save DROPS - and a
   * reviewer who overwrote a view would find it had left its folder.
   */
  readonly folder: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly query: ProjectionQuery | null;
  readonly layout: "layered";
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  /**
   * Whatever the view being overwritten already declared, carried through
   * rather than restated. The canvas has no direction control - it draws
   * ArchiMate, which is top-down by construction - but the LikeC4 export reads
   * `presentation.direction`, so a save that simply omitted it would quietly
   * drop a value the reviewer never saw and cannot have meant to discard.
   */
  readonly carriedDirection: "top-down" | "left-right" | undefined;
}

/**
 * Pure translation from the form's local state to the staged operation — no
 * active filter names an unfiltered view, since every field of a
 * `ProjectionQuery` is optional and `{}` is itself a valid, if unconstrained,
 * query.
 *
 * A saved view is a row in the changeset rather than a write (ADR 0103), so
 * this composes the whole projection document and the path it will occupy.
 * Overwriting keeps the path the view already has; a new view takes a fresh
 * slug beside every other one, and says which folder it belongs to rather than
 * being put in a directory named after it (ADR 0104).
 */
export const buildPayload = ({
  id,
  taken,
  path,
  folder,
  title,
  description,
  query,
  layout,
  showLifecycle,
  showEvidence,
  showOwnership,
  carriedDirection,
}: BuildPayloadParams): VisualViewOperation => {
  const viewId = id ?? viewIdFrom(title, taken);
  return {
    op: "write-view",
    path: path ?? projectionPathFor(viewId),
    projection: composeProjection({
      id: viewId,
      title,
      description,
      query: query ?? {},
      presentation: {
        layout,
        ...(carriedDirection === undefined
          ? {}
          : { direction: carriedDirection }),
        // A folder is written only where there is one to write: an empty
        // string is not "no folder", it is a folder with no name, and the
        // schema refuses it.
        ...(folder === undefined || folder === "" ? {} : { folder }),
        showLifecycle,
        showEvidence,
        showOwnership,
      },
    }),
  };
};

interface SaveViewFormProps {
  readonly activeView: VisualViewSummary | null;
  readonly onSubmit: (
    id: string | undefined,
    title: string,
    description: string,
  ) => void;
  readonly onCancel: () => void;
}

/**
 * The fields, mounted only while the panel is open.
 *
 * Seeding lives in `useState` initialisers rather than in an effect keyed on
 * openness, because the seed is caused by the panel opening and not by a
 * render. Mounting it fresh each time is what makes "open it and press Save"
 * an overwrite of the active view with nothing retyped, and closing it
 * discard a half-typed name that was never workspace state.
 */
function SaveViewForm({ activeView, onSubmit, onCancel }: SaveViewFormProps) {
  const [title, setTitle] = useState(activeView?.title ?? "");
  const [description, setDescription] = useState(activeView?.description ?? "");

  // `title` and `description` are both required `nonEmptyText` in
  // `viewSavePayload`, so the form refuses exactly what the server would
  // reject rather than sending a save that can only come back as a fault.
  const incomplete = title.trim() === "" || description.trim() === "";

  return (
    <div className="save-view-panel">
      <div id="save-view-panel-body" className="save-view-panel-body">
        <form
          className="save-view-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (incomplete) return;
            onSubmit(activeView?.id, title, description);
          }}
        >
          <div>
            <label htmlFor="save-view-title">Title</label>
            <input
              id="save-view-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="save-view-description">Description</label>
            <textarea
              id="save-view-description"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              required
            />
          </div>
          <div className="save-view-actions">
            <button
              type="submit"
              disabled={activeView === null || incomplete}
            >
              Save
            </button>
            <button
              type="button"
              disabled={incomplete}
              onClick={() => {
                if (incomplete) return;
                onSubmit(undefined, title, description);
              }}
            >
              Save As New
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/**
 * Stages the reviewer's current filter and presentation as a named projection
 * document. "Save" overwrites whatever view is active and "Save As New" mints
 * a fresh id.
 *
 * Neither writes anything: both stage a row in the changeset (ADR 0103), which
 * is why the overwrite no longer asks first. The confirmation existed because
 * an overwrite was immediate and unundoable; a staged overwrite is a row the
 * reviewer can read, discard and undo before it lands, which is a better
 * answer than a dialog.
 */
export function SaveViewDialog({
  views,
  activeViewId,
  query,
  layout,
  showLifecycle,
  showEvidence,
  showOwnership,
  open,
  folder,
  onClose,
  onStage,
}: SaveViewDialogProps) {
  const activeView = views.find((view) => view.id === activeViewId) ?? null;

  const submit = (
    id: string | undefined,
    title: string,
    description: string,
  ) => {
    onStage(
      buildPayload({
        id,
        taken: new Set(views.map((view) => view.id)),
        // Overwriting writes the document the view already occupies, which is
        // not always the one its id would derive: a view saved into a folder
        // keeps its folder rather than being moved by a later save.
        path:
          id === undefined
            ? undefined
            : activeView?.path,
        // A new view takes the folder the caller named; an overwrite carries
        // the one the view already declares, which is not the same thing as
        // the one this control happens to be holding.
        folder: id === undefined ? folder : (activeView?.presentation?.folder),
        title,
        description,
        query,
        layout,
        showLifecycle,
        showEvidence,
        showOwnership,
        // Overwriting carries the view's own direction; a brand new view has
        // none to carry, and the export's own default applies.
        carriedDirection:
          id === undefined ? undefined : activeView?.presentation?.direction,
      }),
    );
  };

  if (!open) return null;
  return (
    <div className="save-view-control">
      <SaveViewForm
        // Remount when the reviewer switches view with the form open, so the
        // fields describe the view the Save button would overwrite.
        key={activeViewId}
        activeView={activeView}
        onSubmit={(id, title, description) => {
          submit(id, title, description);
          onClose();
        }}
        onCancel={onClose}
      />
    </div>
  );
}
