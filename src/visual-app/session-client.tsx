import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ProjectionQuery } from '../projection.js'
import type { NestingKind } from '../nesting.js'
import type {
  VisualLayoutSavePayload,
  VisualViewOperation,
} from '../adapters/visual/protocol-contract.js'
import type { YarramateOperation } from '../operations.js'
import type { EditorHost } from './editor-host.js'
import {
  changesetIsEmpty,
  initialVisualAppState,
  filterToReresolve,
  visualAppActionsForFrame,
  visualAppReducer,
  visualBrowserInputFor,
  type FilterSource,
  type VisualAppIntent,
  type VisualAppState,
} from './state.js'

/**
 * The session as the page holds it: one reducer, one host, and nothing that
 * decides anything on its own.
 *
 * The transport moved out (#252). What stays is everything that is true of the
 * editor whatever is answering it: the reducer, the sequence every input is
 * stamped with, which surface asked for the standing filter, and the re-ask
 * that keeps a matched set from outliving the model it was resolved against.
 * A host that owned those would have to reimplement them to be a host at all.
 */

export interface VisualSession {
  readonly state: VisualAppState
  readonly connected: boolean
  readonly ask: (text: string) => void
  readonly choose: (optionId: string) => void
  readonly navigate: (viewId: string) => void
  readonly filter: (
    query: ProjectionQuery,
    origin?: FilterSource,
    /**
     * The nesting the canvas is drawing with. Only `query.instances` reads it,
     * and it must: the closure IS the containment tree (#473 phase 2).
     */
    nesting?: readonly NestingKind[],
  ) => void
  readonly clearFilter: () => void
  readonly setQuickFilterText: (text: string) => void
  readonly stageViewChange: (operation: VisualViewOperation) => void
  /** One subject into or out of a view's own membership list, composed on top
   * of whatever is already staged for that view. */
  readonly stageViewMembership: (
    viewId: string,
    subjectId: string,
    membership: 'add' | 'remove',
  ) => void
  readonly stageChange: (operation: YarramateOperation) => void
  readonly discardChange: (index: number) => void
  readonly clearChangeset: () => void
  readonly undoChangeset: () => void
  readonly redoChangeset: () => void
  readonly commitChangeset: () => void
  readonly saveLayout: (payload: VisualLayoutSavePayload) => void
  readonly end: () => void
}

export const useVisualSession = (host: EditorHost): VisualSession => {
  const [state, dispatch] = useReducer(visualAppReducer, initialVisualAppState)
  const [connected, setConnected] = useState(false)
  // Senders read the settled state rather than a render's copy of it, so every
  // frame carries the sequence this browser has actually seen acknowledged.
  const stateRef = useRef(state)
  stateRef.current = state
  // A filter result names what matched, never why it was asked. This records
  // the reason the browser last asked, so a result can be told apart from a
  // named view being applied. Panel is the honest default: an unsolicited
  // result is not a view this browser can claim to be showing.
  const filterOriginRef = useRef<FilterSource>('panel')

  // The host is opened once. Everything it reports is a frame, so the only
  // thing this has to decide is what a frame means - which `state.ts` already
  // answers, purely, for every kind the wire defines.
  const hostRef = useRef(host)
  hostRef.current = host
  useEffect(() => {
    const stop = hostRef.current.open({
      frame: (frame) => {
        for (const action of visualAppActionsForFrame(
          frame,
          filterOriginRef.current,
        ))
          dispatch(action)
        // A landed commit replaces the model, which invalidates the matched
        // set every filter result described. Asking again here, off the frame
        // that invalidated it, is what keeps a subject the reviewer just
        // created from being hidden by a matched set resolved before it
        // existed. `stateRef` holds the state before this frame's actions
        // commit, which is exactly right: the standing filter is the one that
        // needs re-asking, not one this frame produced.
        //
        // It lives here rather than in the transport because it is true of the
        // editor, not of the socket: a host with no wire at all invalidates a
        // matched set the same way.
        const stale = filterToReresolve(frame, stateRef.current)
        if (stale !== null) {
          filterOriginRef.current = stale.source
          hostRef.current.send(
            visualBrowserInputFor(
              { kind: 'filter', query: stale.query },
              stateRef.current,
            ),
          )
        }
      },
      connected: setConnected,
      lost: () => dispatch({ type: 'connection.lost' }),
      session: () => ({
        lastSequence: stateRef.current.lastSequence,
        closed: stateRef.current.lifecycle === 'closed',
      }),
    })
    return stop
  }, [])

  const send = useCallback((intent: VisualAppIntent) => {
    hostRef.current.send(visualBrowserInputFor(intent, stateRef.current))
  }, [])

  const ask = useCallback(
    (text: string) => {
      dispatch({ type: 'chat.sent', text })
      send({ kind: 'chat', text })
    },
    [send],
  )

  const choose = useCallback(
    (optionId: string) => {
      const choiceId = stateRef.current.choices?.choiceId
      if (choiceId === undefined) return
      dispatch({ type: 'choice.sent', optionId })
      send({ kind: 'choice', choiceId, optionId })
    },
    [send],
  )

  const navigate = useCallback(
    (viewId: string) => {
      // The reviewer moves first; the agent is told where they went.
      dispatch({ type: 'view.navigated', viewId })
      send({ kind: 'navigate', viewId })
    },
    [send],
  )

  const filter = useCallback(
    (
      query: ProjectionQuery,
      origin: FilterSource = 'panel',
      nesting?: readonly NestingKind[],
    ) => {
      filterOriginRef.current = origin
      send({
        kind: 'filter',
        query,
        ...(nesting === undefined ? {} : { nesting }),
      })
    },
    [send],
  )

  const clearFilter = useCallback(() => {
    dispatch({ type: 'filter.cleared' })
  }, [])

  const setQuickFilterText = useCallback((text: string) => {
    dispatch({ type: 'quickFilter.changed', text })
  }, [])

  // Staging is local: nothing leaves the browser until the reviewer commits.
  // That is now true of views as well as subjects (ADR 0103), which is why
  // there is no `saveView` here any more - a view is staged, not sent.
  const stageChange = useCallback((operation: YarramateOperation) => {
    dispatch({ type: 'changeset.staged', operation })
  }, [])

  const stageViewChange = useCallback((operation: VisualViewOperation) => {
    dispatch({ type: 'changeset.viewStaged', operation })
  }, [])

  const stageViewMembership = useCallback(
    (viewId: string, subjectId: string, membership: 'add' | 'remove') => {
      dispatch({ type: 'changeset.viewMembership', viewId, subjectId, membership })
    },
    [],
  )

  const discardChange = useCallback((index: number) => {
    dispatch({ type: 'changeset.discarded', index })
  }, [])

  const clearChangeset = useCallback(() => {
    dispatch({ type: 'changeset.cleared' })
  }, [])

  // Undo/redo stay entirely in the browser: they move the staged set around,
  // never the workspace, which only `commit-changeset` touches.
  const undoChangeset = useCallback(() => {
    dispatch({ type: 'changeset.undone' })
  }, [])

  const redoChangeset = useCallback(() => {
    dispatch({ type: 'changeset.redone' })
  }, [])

  const commitChangeset = useCallback(() => {
    // An empty changeset has nothing to validate: the runtime would refuse it,
    // so the button never spends a round trip proving that. Empty means BOTH
    // lists - guarding on the model's alone made a changeset holding only a
    // staged view silently do nothing when the reviewer pressed Commit.
    if (changesetIsEmpty(stateRef.current.pendingChangeset)) return
    dispatch({ type: 'changeset.commit.sent' })
    send({ kind: 'commit-changeset' })
  }, [send])

  const saveLayout = useCallback(
    (payload: VisualLayoutSavePayload) => {
      send({ kind: 'save-layout', payload })
    },
    [send],
  )

  const end = useCallback(() => {
    dispatch({ type: 'end.requested' })
    send({ kind: 'end' })
  }, [send])

  return {
    state,
    connected,
    ask,
    choose,
    navigate,
    filter,
    clearFilter,
    setQuickFilterText,
    stageViewChange,
    stageViewMembership,
    stageChange,
    discardChange,
    clearChangeset,
    undoChangeset,
    redoChangeset,
    commitChangeset,
    saveLayout,
    end,
  }
}
