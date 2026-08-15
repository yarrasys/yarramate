import { useState } from 'react'
import type { ProjectionQuery } from '../projection.js'
import type {
  VisualViewSavePayload,
  VisualViewSummary,
} from '../adapters/visual/protocol-contract.js'
import { ConfirmDialog } from './confirm-dialog.js'

export interface SaveViewControlProps {
  readonly views: readonly VisualViewSummary[]
  readonly activeViewId: string
  readonly query: ProjectionQuery | null
  readonly direction: 'top-down' | 'left-right'
  readonly pendingSave: boolean
  readonly notice: boolean
  readonly onSave: (payload: VisualViewSavePayload) => void
  readonly onDismissNotice: () => void
}

/** The layered/elk algorithm is deterministic given its input, so there is no
 * real seed to capture yet — a placeholder until a later plan wires a
 * non-deterministic layout that needs one (Task 17 brief). */
const SAVE_SEED = 'default'

/**
 * Saves the reviewer's current filter and layout direction as a named
 * projection document. "Save" overwrites whatever view is active — behind a
 * confirm dialog, since that is destructive — and "Save As New" always
 * creates a fresh one, which the server can never collide with a
 * client-chosen id, so it needs no confirmation.
 */
export function SaveViewControl({
  views,
  activeViewId,
  query,
  direction,
  pendingSave,
  notice,
  onSave,
  onDismissNotice,
}: SaveViewControlProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const activeView = views.find((view) => view.id === activeViewId) ?? null

  const toggle = () => {
    setOpen((wasOpen) => {
      const nowOpen = !wasOpen
      // Opening starts from whatever the reviewer is already looking at, so
      // a plain overwrite Save needs no retyping.
      if (nowOpen) {
        setTitle(activeView?.title ?? '')
        setDescription(activeView?.description ?? '')
      }
      return nowOpen
    })
  }

  const buildPayload = (id: string | undefined): VisualViewSavePayload => ({
    ...(id === undefined ? {} : { id }),
    title,
    description,
    // No active filter names an unfiltered view — every field of a
    // `ProjectionQuery` is optional, so `{}` is itself a valid, if
    // unconstrained, query.
    query: query ?? {},
    presentation: { layout: 'layered', direction, seed: SAVE_SEED },
  })

  const submit = (id: string | undefined) => {
    if (title.trim() === '') return
    if (id === undefined) {
      onSave(buildPayload(undefined))
      return
    }
    setConfirmId(id)
  }

  const confirmOverwrite = () => {
    if (confirmId === null) return
    onSave(buildPayload(confirmId))
    setConfirmId(null)
  }

  return (
    <div className="save-view-control">
      <button
        type="button"
        className="save-view-toggle"
        aria-expanded={open}
        aria-controls="save-view-panel-body"
        onClick={toggle}
        disabled={pendingSave}
      >
        Save view
      </button>
      {open ? (
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
                event.preventDefault()
                submit(activeView === null ? undefined : activeView.id)
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
                  onChange={(event) =>
                    setDescription(event.currentTarget.value)
                  }
                  disabled={pendingSave}
                />
              </div>
              <div className="save-view-actions">
                <button
                  type="submit"
                  disabled={
                    pendingSave || activeView === null || title.trim() === ''
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={pendingSave || title.trim() === ''}
                  onClick={() => submit(undefined)}
                >
                  Save As New
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {confirmId === null ? null : (
        <ConfirmDialog
          title="Overwrite this view?"
          message={`Saving will replace "${activeView?.title ?? confirmId}" with the current filter and layout.`}
          confirmLabel="Overwrite"
          cancelLabel="Cancel"
          onConfirm={confirmOverwrite}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  )
}
