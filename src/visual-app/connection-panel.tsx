import type React from 'react'
import type { CanvasGraph } from '../graph-projection.js'
import type { YarramateOperation } from '../operations.js'
import type { RelationshipKind } from '../profile.js'
import {
  connectableKinds,
  draftRelationship,
} from '../relationship-drafting.js'
import type { ConnectionDraft } from './workspace-state.js'

/**
 * The connection tool: pick a source, pick a target, pick a kind.
 *
 * Every kind offered here comes from the ArchiMate relationship table, so the
 * reviewer cannot draw an edge `check` would refuse with `YM404`
 * (ADR 0097). Nothing filters the list by hand: `connectableKinds` is the same
 * lookup the compiler performs, and `draftRelationship` refuses a kind that is
 * not in it even if this panel somehow offered one.
 *
 * A pair the table knows always permits `association`, so an empty list here
 * means an endpoint outside the ArchiMate vocabulary rather than a dead end,
 * and the panel says which.
 */
export const ConnectionPanel = ({
  draft,
  graph,
  reservedIds,
  onStage,
  onCancel,
}: {
  readonly draft: ConnectionDraft
  readonly graph: CanvasGraph
  /**
   * Ids the pending changeset already claims. The graph only knows what has
   * landed, so without these a second relationship between the same pair
   * proposed the identical id and replace-by-target staging swallowed it
   * silently (#306). Required rather than defaulted: a caller has to say
   * what is staged, even when the answer is nothing.
   */
  readonly reservedIds: readonly string[]
  readonly onStage: (operation: YarramateOperation) => void
  readonly onCancel: () => void
}): React.ReactElement => {
  const titleOf = (id: string): string =>
    graph.nodes.find((node) => node.id === id)?.name ?? id

  if (draft.to === null) {
    return (
      <section className="connection-panel" aria-label="Connect subjects">
        <p className="connection-prompt">
          Connecting from <strong>{titleOf(draft.from)}</strong>. Choose a
          target on the diagram.
        </p>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </section>
    )
  }

  const target = draft.to
  const kinds = connectableKinds(graph, draft.from, target)

  return (
    <section className="connection-panel" aria-label="Connect subjects">
      <p className="connection-prompt">
        <strong>{titleOf(draft.from)}</strong> to{' '}
        <strong>{titleOf(target)}</strong>
      </p>
      {kinds.length === 0 ? (
        <p className="connection-empty">
          No relationship is defined between these kinds. One of them is
          outside the ArchiMate vocabulary the table covers.
        </p>
      ) : (
        <ul className="connection-kinds">
          {kinds.map((kind: RelationshipKind) => (
            <li key={kind}>
              <button
                type="button"
                onClick={() => {
                  const operation = draftRelationship(
                    graph,
                    draft.from,
                    kind,
                    target,
                    reservedIds,
                  )
                  // Null here would mean this panel offered a kind the table
                  // does not permit, which `connectableKinds` cannot produce.
                  // Staging nothing is the safe reading of an impossible state.
                  if (operation !== null) onStage(operation)
                  onCancel()
                }}
              >
                {kind}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
