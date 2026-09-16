import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSocketHost } from '../src/visual-app/socket-host.js'
import type { EditorHostEvents } from '../src/visual-app/editor-host.js'

/**
 * The socket host's options (ADR 0156, #543): where the snapshot and the
 * socket live, how long to retry. The protocol is untouched, so the test
 * watches the URLs and the frames, with the browser globals stubbed.
 */

class FakeSocket {
  static opened: FakeSocket[] = []
  static readonly OPEN = 1
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  readyState = 0
  readonly url: string
  constructor(url: string | URL) {
    // The real constructor takes a URL object too; keep the text for the assertions.
    this.url = String(url)
    FakeSocket.opened.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  close(): void {
    this.readyState = 3
    this.emit('close', {})
  }
  send(): void {}
}

const events = (): EditorHostEvents & { readonly frames: unknown[] } => {
  const frames: unknown[] = []
  return {
    frames,
    frame: (frame) => frames.push(frame),
    connected: () => {},
    lost: () => {},
    session: () => ({ lastSequence: 7, closed: false }),
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSocketHost', () => {
  const fetches: string[] = []
  beforeEach(() => {
    FakeSocket.opened = []
    fetches.length = 0
    vi.stubGlobal('window', { location: { href: 'https://yarramate.dev/w/halcyon/' } })
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', async (input: URL | string) => {
      fetches.push(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => ({ lastSequence: 7, model: {} }),
      }
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('with no options fetches /api/session and connects to /socket?after=, as before', async () => {
    const host = createSocketHost()
    const stop = host.open(events())
    await flush()
    expect(fetches).toEqual(['https://yarramate.dev/api/session'])
    expect(FakeSocket.opened.map(({ url }) => url)).toEqual([
      'wss://yarramate.dev/socket?after=7',
    ])
    stop()
  })

  it('takes its routes from the options and keeps the protocol', async () => {
    const host = createSocketHost({
      session: 'session',
      socket: 'socket',
    })
    const delivered = events()
    const stop = host.open(delivered)
    await flush()
    expect(fetches).toEqual(['https://yarramate.dev/w/halcyon/session'])
    expect(FakeSocket.opened.map(({ url }) => url)).toEqual([
      'wss://yarramate.dev/w/halcyon/socket?after=7',
    ])
    expect(delivered.frames[0]).toMatchObject({ kind: 'ready' })
    stop()
  })

  it('lets a function put the sequence wherever the server wants it', async () => {
    const host = createSocketHost({
      socket: (after) => `https://yarramate.dev/w/halcyon/socket/${after}`,
    })
    const stop = host.open(events())
    await flush()
    expect(FakeSocket.opened.map(({ url }) => url)).toEqual([
      'https://yarramate.dev/w/halcyon/socket/7',
    ])
    stop()
  })

  it('gives up with a closing frame once the reconnect window has passed', async () => {
    vi.useFakeTimers()
    try {
      const host = createSocketHost({ retryMs: 10, reconnectWindowMs: 25 })
      const delivered = events()
      const stop = host.open(delivered)
      await vi.advanceTimersByTimeAsync(0)
      expect(FakeSocket.opened).toHaveLength(1)
      FakeSocket.opened[0]!.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(FakeSocket.opened).toHaveLength(2)
      FakeSocket.opened[1]!.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(FakeSocket.opened).toHaveLength(3)
      // Lost at T; retries at T+10 and T+20 are inside the 25 ms window, the
      // one at T+30 is not: that close is the one that gives up.
      FakeSocket.opened[2]!.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(FakeSocket.opened).toHaveLength(4)
      FakeSocket.opened[3]!.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(FakeSocket.opened).toHaveLength(4)
      expect(delivered.frames.at(-1)).toEqual({
        kind: 'closing',
        reason: 'browser-timeout',
      })
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
