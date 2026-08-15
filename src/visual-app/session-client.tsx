import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  VisualServerFrame,
  VisualSessionSnapshot,
} from '../adapters/visual/wire.js'
import type { ProjectionQuery } from '../projection.js'
import type { VisualViewSavePayload } from '../adapters/visual/protocol-contract.js'
import {
  canReconnect,
  initialVisualAppState,
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
  readonly filter: (query: ProjectionQuery) => void
  readonly clearFilter: () => void
  readonly setQuickFilterText: (text: string) => void
  readonly saveView: (payload: VisualViewSavePayload) => void
  readonly dismissSavedNotice: () => void
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
        for (const action of visualAppActionsForFrame(frame)) dispatch(action)
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
    (query: ProjectionQuery) => {
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

  const saveView = useCallback(
    (payload: VisualViewSavePayload) => {
      dispatch({ type: 'view.save.sent', payload })
      send({ kind: 'save-view', payload })
    },
    [send],
  )

  const dismissSavedNotice = useCallback(() => {
    dispatch({ type: 'view.saveNotice.dismissed' })
  }, [])

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
    saveView,
    dismissSavedNotice,
    end,
  }
}
