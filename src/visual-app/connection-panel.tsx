import type React from 'react'
import { useState } from 'react'
import type { CanvasGraph } from '../graph-projection.js'
import type { YarramateOperation } from '../operations.js'
import type { RelationshipKind } from '../profile.js'
import {
  connectableKinds,
  draftRelationship,
} from '../relationship-drafting.js'
import type { ConnectionDraft } from './workspace-state.js'

export interface TargetMatch {
  readonly id: string
  readonly name: string
}

/**
 * Subjects a typed query names as connection targets (#309). The canvas tap
 * stays the fast path; this is the KEYBOARD path — the one mandatory canvas
 * interaction was pointer-only, so a screen-reader or keyboard-only reviewer
 * could not author a relationship at all. Name and id both match,
 * case-insensitively, because the reviewer knows whichever the rail showed
 * them; the source is excluded because a self-edge is never what a typed
 * query means. An empty query matches nothing rather than everything: the
 * list is an answer to a question, not a roster.
 */
export const searchTargets = (
  graph: CanvasGraph,
  from: string,
  query: string,
  cap = 8,
): { readonly matches: readonly TargetMatch[]; readonly more: number } => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { matches: [], more: 0 }
  const all = graph.nodes
    .filter((node) => node.id !== from)
    .filter(
      (node) =>
        node.name.toLowerCase().includes(needle) ||
        node.id.toLowerCase().includes(needle),
    )
    .map((node) => ({ id: node.id, name: node.name }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
  return { matches: all.slice(0, cap), more: Math.max(0, all.length - cap) }
}

/**
 * The typed way to name a target (#309). A child component so the hook
 * lives only where the search exists: `ConnectionPanel` itself stays a
 * plain function of its props, which is also how its tests call it.
 */
const TargetSearch = ({
  graph,
  from,
  onTarget,
}: {
  readonly graph: CanvasGraph
  readonly from: string
  readonly onTarget: (id: string) => void
}): React.ReactElement => {
  const [query, setQuery] = useState('')
  const { matches, more } = searchTargets(graph, from, query)
  return (
    <>
      <label
        className="connection-search-label"
        htmlFor="connection-target-search"
      >
        Search targets
      </label>
      <input
        id="connection-target-search"
        className="connection-search"
        type="search"
        autoComplete="off"
        placeholder="Target name or id"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {query.trim() === '' ? null : matches.length === 0 ? (
        <p className="connection-empty">No subject matches.</p>
      ) : (
        <ul className="connection-targets">
          {matches.map((match) => (
            <li key={match.id}>
              <button type="button" onClick={() => onTarget(match.id)}>
                {match.name}
                <span className="connection-target-id"> {match.id}</span>
              </button>
            </li>
          ))}
          {more === 0 ? null : (
            <li className="connection-targets-more">{more} more match</li>
          )}
        </ul>
      )}
    </>
  )
}

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
  onTarget,
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
  /**
   * Names the target, exactly as a canvas tap would (#309): same reducer
   * action, same draft transition. The panel adds the keyboard way in, not
   * a second connect flow.
   */
  readonly onTarget: (id: string) => void
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
          target on the diagram, or search for one.
        </p>
        <TargetSearch graph={graph} from={draft.from} onTarget={onTarget} />
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
