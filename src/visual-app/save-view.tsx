import { useState } from "react";
import type { ProjectionQuery } from "../projection.js";
import type {
  VisualViewSavePayload,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import { ConfirmDialog } from "./confirm-dialog.js";

export interface SaveViewControlProps {
  readonly views: readonly VisualViewSummary[];
  readonly activeViewId: string;
  readonly query: ProjectionQuery | null;
  readonly layout: "layered";
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly pendingSave: boolean;
  readonly notice: boolean;
  /**
   * Openness is the caller's, not the panel's: the tree's new-view button
   * opens this form from the other side of the shell, and two components
   * cannot both own one boolean.
   */
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onSave: (payload: VisualViewSavePayload) => void;
  readonly onDismissNotice: () => void;
}

export interface BuildPayloadParams {
  readonly id: string | undefined;
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

/** Pure translation from the form's local state to the wire payload — no
 * active filter names an unfiltered view, since every field of a
 * `ProjectionQuery` is optional and `{}` is itself a valid, if
 * unconstrained, query. */
export const buildPayload = ({
  id,
  title,
  description,
  query,
  layout,
  showLifecycle,
  showEvidence,
  showOwnership,
  carriedDirection,
}: BuildPayloadParams): VisualViewSavePayload => ({
  ...(id === undefined ? {} : { id }),
  title,
  description,
  query: query ?? {},
  presentation: {
    layout,
    ...(carriedDirection === undefined ? {} : { direction: carriedDirection }),
    showLifecycle,
    showEvidence,
    showOwnership,
  },
});

interface SaveViewFormProps {
  readonly activeView: VisualViewSummary | null;
  readonly pendingSave: boolean;
  readonly notice: boolean;
  readonly onDismissNotice: () => void;
  readonly onSubmit: (
    id: string | undefined,
    title: string,
    description: string,
  ) => void;
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
function SaveViewForm({
  activeView,
  pendingSave,
  notice,
  onDismissNotice,
  onSubmit,
}: SaveViewFormProps) {
  const [title, setTitle] = useState(activeView?.title ?? "");
  const [description, setDescription] = useState(activeView?.description ?? "");

  // `title` and `description` are both required `nonEmptyText` in
  // `viewSavePayload`, so the form refuses exactly what the server would
  // reject rather than sending a save that can only come back as a fault.
  const incomplete = title.trim() === "" || description.trim() === "";

  return (
    <div className="save-view-panel">
      <div id="save-view-panel-body" className="save-view-panel-body">
        {notice ? (
          <p className="save-view-notice" role="status">
            View saved
            <button type="button" onClick={onDismissNotice}>
              Dismiss
            </button>
          </p>
        ) : null}
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
              disabled={pendingSave}
              required
            />
          </div>
          <div>
            <label htmlFor="save-view-description">Description</label>
            <textarea
              id="save-view-description"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              disabled={pendingSave}
              required
            />
          </div>
          <div className="save-view-actions">
            <button
              type="submit"
              disabled={pendingSave || activeView === null || incomplete}
            >
              Save
            </button>
            <button
              type="button"
              disabled={pendingSave || incomplete}
              onClick={() => {
                if (incomplete) return;
                onSubmit(undefined, title, description);
              }}
            >
              Save As New
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Saves the reviewer's current filter and presentation as a named
 * projection document. "Save" overwrites whatever view is active — behind a
 * confirm dialog, since that is destructive — and "Save As New" always
 * creates a fresh one, which the server can never collide with a
 * client-chosen id, so it needs no confirmation.
 */
export function SaveViewControl({
  views,
  activeViewId,
  query,
  layout,
  showLifecycle,
  showEvidence,
  showOwnership,
  pendingSave,
  notice,
  open,
  onToggle,
  onSave,
  onDismissNotice,
}: SaveViewControlProps) {
  // What an overwrite would send, held while the reviewer is asked to confirm
  // it — the payload rather than the id, because the fields it was built from
  // belong to the form and the dialog has to outlive them.
  const [confirming, setConfirming] = useState<VisualViewSavePayload | null>(
    null,
  );
  const activeView = views.find((view) => view.id === activeViewId) ?? null;

  const submit = (
    id: string | undefined,
    title: string,
    description: string,
  ) => {
    const payload = buildPayload({
      id,
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
    });
    if (id === undefined) {
      onSave(payload);
      return;
    }
    setConfirming(payload);
  };

  return (
    <div className="save-view-control">
      <button
        type="button"
        className="save-view-toggle"
        aria-expanded={open}
        aria-controls="save-view-panel-body"
        onClick={onToggle}
        disabled={pendingSave}
      >
        Save view
      </button>
      {open ? (
        <SaveViewForm
          // Remount when the reviewer switches view with the panel open, so
          // the fields describe the view the Save button would overwrite.
          key={activeViewId}
          activeView={activeView}
          pendingSave={pendingSave}
          notice={notice}
          onDismissNotice={onDismissNotice}
          onSubmit={submit}
        />
      ) : null}
      {confirming === null ? null : (
        <ConfirmDialog
          title="Overwrite this view?"
          message={`Saving will replace "${activeView?.title ?? confirming.id ?? ""}" with the current filter and layout.`}
          confirmLabel="Overwrite"
          cancelLabel="Cancel"
          onConfirm={() => {
            onSave(confirming);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
