import type { VisualBrowserInput } from '../adapters/visual/protocol-contract.js'
import type { VisualServerFrame } from '../adapters/visual/wire.js'

/**
 * Where the editor's answers come from (#252).
 *
 * The editor used to be inseparable from one WebSocket: `session-client.tsx`
 * owned the socket, the session fetch and the reconnect loop, and the only way
 * to run the editor was to host the Node process behind them. A product that
 * wanted the canvas had to take the session server with it.
 *
 * A host is the seam. **The contract is the protocol that already exists** -
 * `VisualServerFrame` in, `VisualBrowserInput` out (ADR 0081) - rather than a
 * new interface of verbs, for three reasons. The reducer is already a pure
 * function of frames, so nothing above this line changes. The protocol is
 * already published and versioned, so there is one contract rather than two
 * that must be kept in step. And "the session server becomes one
 * implementation of the host contract" is then literally what happens: it
 * implements the protocol it already speaks.
 *
 * Two hosts ship. `socket-host.ts` is the session server over a websocket, and
 * is what `yarramate-visual` mounts. `local-host.ts` runs the engine in the
 * browser over a `SourceStore` the embedder owns, and needs no server at all.
 */
export interface EditorHostEvents {
  /** One frame, exactly as the wire defines it. */
  readonly frame: (frame: VisualServerFrame) => void
  /**
   * Whether the editor may send right now. A local host is connected from the
   * moment it opens and never stops being; a socket host reports what the
   * socket is doing.
   */
  readonly connected: (connected: boolean) => void
  /**
   * The transport dropped and may come back. A host that has given up says so
   * with a `closing` frame instead, which is how the reducer already learns a
   * session is over.
   */
  readonly lost: () => void
  /**
   * What the editor has seen, for a host that has to resume.
   *
   * The reducer owns both facts and neither is the transport's to keep: a
   * socket resuming after a drop bootstraps from the sequence this browser
   * acknowledged, and stops retrying once the session is over. A host with
   * nothing to resume never asks.
   */
  readonly session: () => { readonly lastSequence: number; readonly closed: boolean }
}

export interface EditorHost {
  /**
   * Starts the host. Every frame it will ever deliver arrives through
   * `events`, including the opening snapshot - which a socket host fetches and
   * a local host computes, and which both report as the `ready` frame the
   * reducer already knows how to read.
   *
   * Returns the stop. Calling it releases the transport and guarantees no
   * further event.
   */
  readonly open: (events: EditorHostEvents) => () => void
  /**
   * One input, already stamped with the sequence this browser has seen. A host
   * that cannot take it right now drops it rather than queueing: the editor
   * disables what it cannot send, and a queue would land an intent the
   * reviewer has stopped meaning.
   */
  readonly send: (input: VisualBrowserInput) => void
}
