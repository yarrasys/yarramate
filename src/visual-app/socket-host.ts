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
 * The session server, as one host (#252), and any server that speaks the
 * same protocol over its own routes (ADR 0156).
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
 *
 * With no options this is byte for byte what `yarramate-visual` mounts. A
 * hosted page passes where its snapshot and its socket live; the protocol
 * does not move.
 */

const SESSION_ROUTE = '/api/session'
const SOCKET_ROUTE = '/socket'

/** Long enough not to hammer a restarting socket, short enough to feel live. */
const RETRY_MS = 1000

export interface SocketHostOptions {
  /**
   * Where the opening `VisualSessionSnapshot` is fetched (GET, same-origin
   * credentials, `Accept: application/json`). Resolved against the page.
   * Default `/api/session`.
   */
  readonly session?: string | URL
  /**
   * Where the socket connects. A string or URL is resolved against the page
   * and its scheme flipped to ws/wss; `after` is appended as a query
   * parameter. A function receives `after` and returns the URL itself, for a
   * server that wants it on the path. Default `/socket`.
   */
  readonly socket?: string | URL | ((after: number) => string | URL)
  /** Delay before a reconnect attempt. Default 1000 ms. */
  readonly retryMs?: number
  /**
   * How long a lost socket keeps retrying before the host reports a
   * `closing` frame with reason `browser-timeout`. Default: the reducer's
   * published grace (`canReconnect`). A hosted workspace that never hands
   * off may pass `Infinity`.
   */
  readonly reconnectWindowMs?: number
}

export const createSocketHost = (options: SocketHostOptions = {}): EditorHost => {
  let socket: WebSocket | null = null
  const retryMs = options.retryMs ?? RETRY_MS
  const mayReconnect = (lostAt: number, now: number): boolean =>
    options.reconnectWindowMs === undefined
      ? canReconnect(lostAt, now)
      : now - lostAt < options.reconnectWindowMs

  return {
    open: (events: EditorHostEvents) => {
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let lostAt: number | null = null

      const socketUrl = () => {
        // Read at connect time rather than captured: a reconnect bootstraps
        // from what has landed since, not from where the last one started.
        const after = events.session().lastSequence
        if (typeof options.socket === 'function') {
          return new URL(String(options.socket(after)), window.location.href)
        }
        const url = new URL(options.socket ?? SOCKET_ROUTE, window.location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol
        url.searchParams.set('after', String(after))
        return url
      }

      const reconnect = () => {
        if (stopped) return
        lostAt ??= Date.now()
        // Past the grace the server has already recovered the handoff, so
        // there is nothing left to reconnect to.
        if (!mayReconnect(lostAt, Date.now())) {
          events.frame({ kind: 'closing', reason: 'browser-timeout' })
          return
        }
        timer = setTimeout(connect, retryMs)
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
        opened.addEventListener('close', (event: CloseEvent) => {
          events.connected(false)
          socket = null
          if (stopped || events.session().closed) return
          // A close code in the application range is the server ending the
          // session for good, with its reason in the close frame (#545,
          // ADR 0157): a connection cap, a member removed, a workspace
          // deleted. That is a `closing`, not a drop, and there is nothing
          // to retry. Every other code stays a drop that may come back.
          if (event.code >= 4000 && event.code <= 4999) {
            events.frame({
              kind: 'closing',
              reason: 'host-ended',
              ...(event.reason === '' ? {} : { message: event.reason }),
            })
            return
          }
          events.lost()
          reconnect()
        })
        opened.addEventListener('error', () => opened.close())
      }

      const load = async () => {
        const response = await fetch(
          new URL(options.session ?? SESSION_ROUTE, window.location.href),
          {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          },
        )
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
