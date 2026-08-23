import type { VisualDiagnostic } from '../adapters/visual/protocol-contract.js'
import { summarise } from './faults.js'
import type { CanvasGraph } from '../graph-projection.js'
import type { YarramateOperation } from '../operations.js'
import type { VisualRenderedModel } from '../adapters/visual/wire.js'
import type { VisualAppState } from './state.js'

/**
 * The pending changeset, made legible one operation at a time, and the single
 * door through which it leaves the browser. Nothing here builds an operation
 * or guesses at what landed - it only names what is already staged and what
 * the server said about it.
 */

/**
 * The reviewer clicked a name on the diagram, not an id - so the tray names
 * the subject the same way, from the graph on screen right now. An operation
 * addresses its subject the way its document authored it, so the lookup is by
 * `(document, authored id)`: the same local id can be authored in two
 * documents and mean two different subjects. A subject an `add-*` operation is
 * about to create, or one an edit no longer applies to because a prior row
 * deleted it, has no entry to find: the id is the only honest fallback.
 */
export const resolveSubjectName = (
  document: string,
  id: string,
  graph: CanvasGraph | null,
): string => {
  const addresses = (candidate: { readonly document: string; readonly localId: string }) =>
    candidate.document === document && candidate.localId === id
  const node = graph?.nodes.find(addresses)
  if (node !== undefined) return node.name
  const edge = graph?.edges.find(addresses)
  if (edge?.name !== undefined && edge.name !== null) return edge.name
  return id
}

/** One staged operation, reduced to what a row needs to say. */
export interface ChangesetRowDescription {
  readonly verb: YarramateOperation['op']
  readonly subjectName: string
  readonly fields: readonly string[]
  readonly removedFields: readonly string[]
}

export const describeChangesetRow = (
  operation: YarramateOperation,
  graph: CanvasGraph | null,
): ChangesetRowDescription => {
  // Only `update-*` members carry `remove` at all.
  const removedFields =
    operation.op === 'update-concept' ||
    operation.op === 'update-relationship' ||
    operation.op === 'update-observation'
      ? (operation.remove ?? [])
      : []
  if ('observation' in operation) {
    // An overlay entry has no `id`: the pair (target, key) is its address,
    // and the target may be a claim this canvas never draws - the name
    // lookup falls back to the identity, which is what the row should say.
    const { subject, claim, key, ...fields } = operation.observation
    const name = resolveSubjectName(operation.document, (subject ?? claim)!, graph)
    return {
      verb: operation.op,
      subjectName: key === undefined ? name : `${name} (${key})`,
      fields: Object.keys(fields),
      removedFields,
    }
  }
  // Every other union member's payload carries `id`; scalars/lists it sets
  // or appends are whatever other keys ride alongside it.
  const payload = 'concept' in operation ? operation.concept : operation.relationship
  return {
    verb: operation.op,
    subjectName: resolveSubjectName(operation.document, payload.id, graph),
    fields: Object.keys(payload).filter((key) => key !== 'id'),
    removedFields,
  }
}

/** `update-concept · Checkout Service · name` - a retracted field reads
 * `remove: owner` so it is never mistaken for a write. */
export const changesetRowLabel = (row: ChangesetRowDescription): string => {
  const parts = [
    ...row.fields,
    ...row.removedFields.map((field) => `remove: ${field}`),
  ]
  return parts.length === 0
    ? `${row.verb} · ${row.subjectName}`
    : `${row.verb} · ${row.subjectName} · ${parts.join(', ')}`
}

/** Diagnostics whose pointer names a staged operation, keyed by that
 * operation's index; everything else - a compile error against a model
 * document, not the batch - stays batch-level. */
export interface PartitionedDiagnostics {
  readonly byRow: ReadonlyMap<number, readonly VisualDiagnostic[]>
  readonly batch: readonly VisualDiagnostic[]
}

const OPERATION_POINTER = /^\/operations\/(\d+)(\/|$)/

export const partitionDiagnostics = (
  diagnostics: readonly VisualDiagnostic[],
): PartitionedDiagnostics => {
  const byRow = new Map<number, VisualDiagnostic[]>()
  const batch: VisualDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    const match = OPERATION_POINTER.exec(diagnostic.pointer)
    if (match === null) {
      batch.push(diagnostic)
      continue
    }
    // The regex requires at least one digit, so this always parses.
    const index = Number(match[1])
    const existing = byRow.get(index)
    if (existing === undefined) byRow.set(index, [diagnostic])
    else existing.push(diagnostic)
  }
  return { byRow, batch }
}

/**
 * A staged row whose document has been rewritten since the row was staged.
 *
 * Derived at render rather than stored: the only thing that can change the
 * answer is a fresh `model` frame, and the server broadcasts one after any
 * session lands a batch, so the mark appears while the reviewer is still
 * sitting there rather than at commit time (ADR 0093).
 *
 * An unpinned row - one naming a document the model did not hold, which `apply`
 * will create - has no prior value to be stale against.
 */
export const stagedRowConflict = (
  operation: YarramateOperation,
  pins: Readonly<Record<string, string>>,
  model: VisualRenderedModel | null,
): string | null => {
  const pinned = pins[operation.document]
  if (pinned === undefined) return null
  const current = model?.sourceDigests[operation.document]
  return current === undefined || current === pinned ? null : operation.document
}

const DiagnosticLine = ({
  diagnostic,
}: {
  readonly diagnostic: VisualDiagnostic
}) => (
  <li>
    <span className="code">{diagnostic.code}</span> {diagnostic.message}
    {diagnostic.path === '' ? null : (
      <span className="where">
        {diagnostic.path}:{diagnostic.line}:{diagnostic.column}
      </span>
    )}
  </li>
)

const ChangesetRow = ({
  index,
  row,
  diagnostics,
  conflict,
  onDiscard,
}: {
  readonly index: number
  readonly row: ChangesetRowDescription
  readonly diagnostics: readonly VisualDiagnostic[]
  readonly conflict: string | null
  readonly onDiscard: () => void
}) => (
  <li className={conflict === null ? 'changeset-row' : 'changeset-row conflicted'}>
    <div className="changeset-row-line">
      <span className="changeset-row-label">{changesetRowLabel(row)}</span>
      <button type="button" className="changeset-row-discard" onClick={onDiscard}>
        Discard
      </button>
    </div>
    {conflict === null ? null : (
      <p className="changeset-row-conflict" role="status">
        {conflict} changed after this edit was staged
      </p>
    )}
    {diagnostics.length === 0 ? null : (
      <ul className="changeset-row-diagnostics">
        {diagnostics.map((diagnostic) => (
          <DiagnosticLine key={`${diagnostic.code}-${diagnostic.pointer}`} diagnostic={diagnostic} />
        ))}
      </ul>
    )}
  </li>
)

/**
 * The pending changeset, the commit control, and whatever the last attempt
 * said. A batch that failed stays exactly as staged - the reviewer corrects
 * and retries the same rows, never a redrawn guess of them.
 *
 * Undo and redo walk whole staged-set snapshots, so they cover staging, a
 * same-field replacement, a single discard and a discard-all alike. They stop
 * at the last commit: what landed is Git's to revert.
 */
export const ChangesetTray = ({
  state,
  onDiscardChange,
  onClearChangeset,
  onUndoChangeset,
  onRedoChangeset,
  onCommitChangeset,
}: {
  readonly state: VisualAppState
  readonly onDiscardChange: (index: number) => void
  readonly onClearChangeset: () => void
  readonly onUndoChangeset: () => void
  readonly onRedoChangeset: () => void
  readonly onCommitChangeset: () => void
}) => {
  const operations = state.pendingChangeset.operations
  // History keeps the tray mounted even with nothing staged: undoing the last
  // row back to an empty set must leave Redo reachable, and discarding all of
  // them must leave Undo reachable.
  if (
    operations.length === 0 &&
    state.commitNotice === null &&
    state.commitDiagnostics === null &&
    state.undoStack.length === 0 &&
    state.redoStack.length === 0
  ) {
    return null
  }

  const graph = state.model?.graph ?? null
  const { byRow, batch } = partitionDiagnostics(state.commitDiagnostics ?? [])
  const committing = state.commitStatus === 'committing'

  return (
    <section className="changeset-tray" aria-labelledby="changeset-heading">
      <div className="changeset-heading-row">
        <h2 id="changeset-heading">Pending changes</h2>
        <div className="changeset-history-controls">
          <button
            type="button"
            className="changeset-undo"
            disabled={state.undoStack.length === 0}
            onClick={onUndoChangeset}
          >
            Undo
          </button>
          <button
            type="button"
            className="changeset-redo"
            disabled={state.redoStack.length === 0}
            onClick={onRedoChangeset}
          >
            Redo
          </button>
          {operations.length === 0 ? null : (
            <button
              type="button"
              className="changeset-discard-all"
              onClick={onClearChangeset}
            >
              Discard all
            </button>
          )}
        </div>
      </div>

      {state.commitDiagnostics === null ||
      state.commitDiagnostics.length === 0 ||
      graph === null ? null : (
        // Whether a refusal can be SEEN, which is a different question from
        // which staged row is to blame. A reviewer who is shown two marked
        // elements and told nothing else will believe those are the problems,
        // so the count on screen is always the whole count (ADR 0102).
        <p className="changeset-fault-summary" role="status">
          {(() => {
            const summary = summarise(state.commitDiagnostics, graph)
            return `${summary.total} problem${
              summary.total === 1 ? '' : 's'
            }: ${summary.onCanvas} marked on the diagram, ${
              summary.elsewhere
            } not on it.`
          })()}
        </p>
      )}

      {batch.length === 0 ? null : (
        <ul className="changeset-batch-diagnostics" role="alert">
          {batch.map((diagnostic) => (
            <DiagnosticLine key={`${diagnostic.code}-${diagnostic.pointer}`} diagnostic={diagnostic} />
          ))}
        </ul>
      )}

      {operations.length === 0 ? null : (
        <ol className="changeset-rows">
          {operations.map((operation, index) => (
            <ChangesetRow
              key={index}
              index={index}
              row={describeChangesetRow(operation, graph)}
              diagnostics={byRow.get(index) ?? []}
              conflict={stagedRowConflict(
                operation,
                state.pendingChangeset.sourceDigests,
                state.model,
              )}
              onDiscard={() => onDiscardChange(index)}
            />
          ))}
        </ol>
      )}

      <div className="changeset-actions">
        <button
          type="button"
          className="changeset-commit"
          disabled={operations.length === 0 || committing}
          aria-busy={committing}
          onClick={onCommitChangeset}
        >
          {committing ? 'Committing…' : 'Commit changes'}
        </button>
      </div>

      {state.commitNotice === null ? null : (
        <div className="changeset-notice" role="status">
          <p>
            Committed · {state.commitNotice.length}{' '}
            {state.commitNotice.length === 1 ? 'file' : 'files'}
          </p>
          <ul>
            {state.commitNotice.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
