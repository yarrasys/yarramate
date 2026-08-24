import type {
  VisualBrowserInput,
} from '../adapters/visual/protocol-contract.js'
import type {
  VisualServerFrame,
  VisualSessionSnapshot,
} from '../adapters/visual/wire.js'
import type { EditorHost, EditorHostEvents } from './editor-host.js'
import { canReconnect } from './state.js'

/**
 * The session server, as one host (#252).
 *
 * Everything the socket used to do inside `session-client.tsx` is here, and
 * nothing else moved: same two same-origin routes, same reconnect grace, same
 * `?after=` bootstrap. The session cookie the server minted authenticates both
 * without this code ever seeing it; nothing here reads or writes a credential,
 * and nothing puts an identifier in a URL.
 *
 * The opening snapshot arrives over HTTP and is reported as the `ready` FRAME
 * the reducer already reads, rather than as a second kind of event. A host has
 * one way to say things, which is what lets a host with no wire at all
 * (`local-host.ts`) be the same shape.
 */

const SESSION_ROUTE = '/api/session'
const SOCKET_ROUTE = '/socket'

/** Long enough not to hammer a restarting socket, short enough to feel live. */
const RETRY_MS = 1000

export const createSocketHost = (): EditorHost => {
  let socket: WebSocket | null = null

  return {
    open: (events: EditorHostEvents) => {
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let lostAt: number | null = null

      const socketUrl = () => {
        const url = new URL(SOCKET_ROUTE, window.location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        // Read at connect time rather than captured: a reconnect bootstraps
        // from what has landed since, not from where the last one started.
        url.searchParams.set('after', String(events.session().lastSequence))
        return url
      }

      const reconnect = () => {
        if (stopped) return
        lostAt ??= Date.now()
        // Past the grace the server has already recovered the handoff, so
        // there is nothing left to reconnect to.
        if (!canReconnect(lostAt, Date.now())) {
          events.frame({ kind: 'closing', reason: 'browser-timeout' })
          return
        }
        timer = setTimeout(connect, RETRY_MS)
      }

      const connect = () => {
        if (stopped) return
        const opened = new WebSocket(socketUrl())
        socket = opened
        opened.addEventListener('open', () => {
          lostAt = null
          events.connected(true)
        })
        opened.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (typeof event.data !== 'string') return
          try {
            events.frame(JSON.parse(event.data) as VisualServerFrame)
          } catch {
            // A frame this browser cannot parse is one it cannot act on.
          }
        })
        opened.addEventListener('close', () => {
          events.connected(false)
          socket = null
          if (stopped || events.session().closed) return
          events.lost()
          reconnect()
        })
        opened.addEventListener('error', () => opened.close())
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
        events.frame({ kind: 'ready', snapshot })
        connect()
      }

      void load().catch(() => {
        if (stopped) return
        events.lost()
        reconnect()
      })

      return () => {
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
        socket?.close()
      }
    },

    send: (input: VisualBrowserInput) => {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(input))
    },
  }
}
