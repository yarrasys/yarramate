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
  readonly layout: 'layered' | 'radial' | 'force'
  readonly direction: 'top-down' | 'left-right'
  readonly showLifecycle: boolean
  readonly showEvidence: boolean
  readonly showOwnership: boolean
  readonly notation: 'native' | 'archimate'
  readonly seed: string
  readonly pendingSave: boolean
  readonly notice: boolean
  readonly onSave: (payload: VisualViewSavePayload) => void
  readonly onDismissNotice: () => void
}

// (no module-level seed constant: the seed a save writes is the one the canvas
// laid the view out with, held in workspace state - see `workspace-state.ts`.)

export interface BuildPayloadParams {
  readonly id: string | undefined
  readonly title: string
  readonly description: string
  readonly query: ProjectionQuery | null
  readonly layout: 'layered' | 'radial' | 'force'
  readonly direction: 'top-down' | 'left-right'
  readonly showLifecycle: boolean
  readonly showEvidence: boolean
  readonly showOwnership: boolean
  readonly notation: 'native' | 'archimate'
  readonly seed: string
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
  direction,
  showLifecycle,
  showEvidence,
  showOwnership,
  notation,
  seed,
}: BuildPayloadParams): VisualViewSavePayload => ({
  ...(id === undefined ? {} : { id }),
  title,
  description,
  query: query ?? {},
  presentation: { layout, direction, seed, showLifecycle, showEvidence, showOwnership, notation },
})

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
  layout,
  direction,
  showLifecycle,
  showEvidence,
  showOwnership,
  notation,
  seed,
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

  const submitPayload = (id: string | undefined) =>
    buildPayload({
      id,
      title,
      description,
      query,
      layout,
      direction,
      showLifecycle,
      showEvidence,
      showOwnership,
      notation,
      seed,
    })

  const submit = (id: string | undefined) => {
    if (title.trim() === '') return
    if (id === undefined) {
      onSave(submitPayload(undefined))
      return
    }
    setConfirmId(id)
  }

  const confirmOverwrite = () => {
    if (confirmId === null) return
    onSave(submitPayload(confirmId))
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
