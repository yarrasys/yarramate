import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  VisualServerFrame,
  VisualSessionSnapshot,
} from '../adapters/visual/wire.js'
import type { ProjectionQuery } from '../projection.js'
import type {
  VisualLayoutSavePayload,
  VisualViewOperation,
} from '../adapters/visual/protocol-contract.js'
import type { YarramateOperation } from '../operations.js'
import {
  canReconnect,
  changesetIsEmpty,
  initialVisualAppState,
  filterToReresolve,
  visualAppActionsForFrame,
  visualAppReducer,
  visualAppSnapshotFrom,
  visualBrowserInputFor,
  type VisualAppIntent,
  type VisualAppState,
} from './state.js'

/**
 * The session as the page holds it: one reducer, one socket, and nothing that
 * decides anything on its own.
 *
 * Both routes are same-origin, so the session cookie the server minted at
 * bootstrap authenticates them without this code ever seeing it. Nothing here
 * reads or writes a credential, and nothing puts an identifier in the URL.
 */

const SESSION_ROUTE = '/api/session'
const SOCKET_ROUTE = '/socket'

/** Long enough not to hammer a restarting socket, short enough to feel live. */
const RETRY_MS = 1000

export interface VisualSession {
  readonly state: VisualAppState
  readonly connected: boolean
  readonly ask: (text: string) => void
  readonly choose: (optionId: string) => void
  readonly navigate: (viewId: string) => void
  readonly filter: (query: ProjectionQuery, origin?: 'view' | 'panel' | 'chat') => void
  readonly clearFilter: () => void
  readonly setQuickFilterText: (text: string) => void
  readonly stageViewChange: (operation: VisualViewOperation) => void
  readonly stageChange: (operation: YarramateOperation) => void
  readonly discardChange: (index: number) => void
  readonly clearChangeset: () => void
  readonly undoChangeset: () => void
  readonly redoChangeset: () => void
  readonly commitChangeset: () => void
  readonly saveLayout: (payload: VisualLayoutSavePayload) => void
  readonly end: () => void
}

export const useVisualSession = (): VisualSession => {
  const [state, dispatch] = useReducer(visualAppReducer, initialVisualAppState)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  // Senders read the settled state rather than a render's copy of it, so every
  // frame carries the sequence this browser has actually seen acknowledged.
  const stateRef = useRef(state)
  stateRef.current = state
  // A filter result names what matched, never why it was asked. This records
  // the reason the browser last asked, so a result can be told apart from a
  // named view being applied. Panel is the honest default: an unsolicited
  // result is not a view this browser can claim to be showing.
  const filterOriginRef = useRef<'view' | 'panel' | 'chat'>('panel')

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lostAt: number | null = null

    const socketUrl = () => {
      const url = new URL(SOCKET_ROUTE, window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      // Bootstrap for a resumed socket: where this browser's record stops. The
      // per-frame acknowledgement is what admission checks against.
      url.searchParams.set('after', String(stateRef.current.lastSequence))
      return url
    }

    const reconnect = () => {
      if (stopped) return
      lostAt ??= Date.now()
      // Past the grace the server has already recovered the handoff, so there
      // is nothing left to reconnect to.
      if (!canReconnect(lostAt, Date.now())) {
        dispatch({ type: 'session.closed', reason: 'browser-timeout' })
        return
      }
      timer = setTimeout(connect, RETRY_MS)
    }

    const connect = () => {
      if (stopped) return
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket
      socket.addEventListener('open', () => {
        lostAt = null
        setConnected(true)
      })
      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeof event.data !== 'string') return
        let frame: VisualServerFrame
        try {
          frame = JSON.parse(event.data) as VisualServerFrame
        } catch {
          return
        }
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
        const stale = filterToReresolve(frame, stateRef.current)
        if (stale !== null) {
          filterOriginRef.current = stale.source
          socket.send(
            JSON.stringify(
              visualBrowserInputFor(
                { kind: 'filter', query: stale.query },
                stateRef.current,
              ),
            ),
          )
        }
      })
      socket.addEventListener('close', () => {
        setConnected(false)
        socketRef.current = null
        if (stopped || stateRef.current.lifecycle === 'closed') return
        dispatch({ type: 'connection.lost' })
        reconnect()
      })
      socket.addEventListener('error', () => socket.close())
    }

    const load = async () => {
      const response = await fetch(SESSION_ROUTE, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Session request answered ${response.status}`)
      }
      const snapshot = (await response.json()) as VisualSessionSnapshot
      if (stopped) return
      dispatch({
        type: 'session.loaded',
        snapshot: visualAppSnapshotFrom(snapshot),
      })
      connect()
    }

    void load().catch(() => {
      if (stopped) return
      dispatch({ type: 'connection.lost' })
      reconnect()
    })

    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      socketRef.current?.close()
    }
  }, [])

  const send = useCallback((intent: VisualAppIntent) => {
    const socket = socketRef.current
    if (socket === null || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(visualBrowserInputFor(intent, stateRef.current)))
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
    (query: ProjectionQuery, origin: 'view' | 'panel' | 'chat' = 'panel') => {
      filterOriginRef.current = origin
      send({ kind: 'filter', query })
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
