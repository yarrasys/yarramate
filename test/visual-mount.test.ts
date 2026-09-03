import { beforeEach, describe, expect, it, vi } from 'vitest'

const root = vi.hoisted(() => ({
  render: vi.fn(),
  unmount: vi.fn(),
}))
const createRoot = vi.hoisted(() => vi.fn(() => root))

vi.mock('react-dom/client', () => ({ createRoot }))
import {
  mountEditorWith,
  type DecorationMap,
  type EditorHost,
  type RightSectionId,
} from '../src/visual-app/mount.js'
import {
  editorPointerFor,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  type EditorPointer,
  type EditorPointerContext,
  type VisualWorkspaceAction,
} from '../src/visual-app/workspace-state.js'
import type {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
} from '../src/graph-projection.js'

const host: EditorHost = {
  open: () => () => undefined,
  send: () => undefined,
}

const sections: readonly RightSectionId[] = ['properties', 'changes']

/** The `onReady` seam the mounted `App` element carries (#297). */
const onReadyOf = (
  call: readonly unknown[],
): ((pointer: EditorPointer) => void) =>
  (call[0] as { props: { onReady: (pointer: EditorPointer) => void } }).props
    .onReady

describe('mountEditorWith', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders into the host element and unmounts its rendered root', () => {
    const element = {} as Element

    const editor = mountEditorWith(element, host, sections)

    expect(createRoot).toHaveBeenCalledWith(element)
    expect(root.render).toHaveBeenCalledOnce()

    editor.unmount()

    expect(root.unmount).toHaveBeenCalledOnce()
  })

  it('mounts an author unless told otherwise, and threads the read-only posture (#298)', () => {
    mountEditorWith({} as Element, host, sections)
    mountEditorWith({} as Element, host, sections, true)

    const [authoring, reading] = root.render.mock.calls.map(
      ([element]) => (element as { props: { readOnly: boolean } }).props,
    )
    expect(authoring?.readOnly).toBe(false)
    expect(reading?.readOnly).toBe(true)
  })

  it('threads the initial decorations to the shell (#314)', () => {
    // The static option is the mount-time map; everything after it travels
    // through the handle's setDecorations instead.
    mountEditorWith({} as Element, host, sections, false, {
      'app.checkout': 'added',
      'checkout-serves-ledger': 'changed',
    })

    const rendered = (
      root.render.mock.calls[0]![0] as {
        props: { decorations: Record<string, string> }
      }
    ).props
    expect(rendered.decorations).toEqual({
      'app.checkout': 'added',
      'checkout-serves-ledger': 'changed',
    })
  })

  it('answers false, without throwing, before the shell hands its pointer up (#297)', () => {
    // The mocked render never runs `App`, so `onReady` never fires: exactly
    // the window between mounting and the shell's first render.
    const editor = mountEditorWith({} as Element, host, sections)

    expect(editor.select('app.checkout')).toBe(false)
    expect(editor.openDraft({ kind: 'goal' })).toBe(false)
    expect(editor.startConnection('app.checkout')).toBe(false)
    expect(editor.setDecorations({ 'app.checkout': 'added' })).toBe(false)
    expect(editor.refresh()).toEqual({
      applied: false,
      reason: 'not-mounted',
    })
  })

  /**
   * A caller-built host already owns delivery (#444): it speaks the protocol
   * and can push a `model` frame whenever it likes, which is the same refresh
   * by another route. Saying so is better than a bare false, which would read
   * as "nothing to refresh" and send a host looking for a bug.
   */
  it('declines to refresh a host it did not build, and says which it is', () => {
    const editor = mountEditorWith({} as Element, host, sections)
    const pointer = {
      select: vi.fn(() => true),
      openDraft: vi.fn(() => true),
      startConnection: vi.fn(() => true),
      setDecorations: vi.fn(() => true),
      stagedPins: vi.fn(() => ({})),
    }
    onReadyOf(root.render.mock.calls[0]!)(pointer)

    expect(editor.refresh()).toEqual({
      applied: false,
      reason: 'not-supported',
    })
    // Nothing was asked of the pointer: there is no store behind this host to
    // compare pins against.
    expect(pointer.stagedPins).not.toHaveBeenCalled()
  })

  /**
   * The pins go across unread. The handle reports what is staged and the store
   * that minted those revisions decides what they mean (ADR 0100), so this
   * asserts the handoff rather than any comparison.
   */
  it('hands the staged pins to a store-owning host and returns its verdict', () => {
    const refresh = vi.fn(() => ({ applied: true }) as const)
    const storeHost = { ...host, refresh }
    const editor = mountEditorWith({} as Element, storeHost, sections)
    const pins = { 'architecture/main.yaml': '3' }
    const pointer = {
      select: vi.fn(() => true),
      openDraft: vi.fn(() => true),
      startConnection: vi.fn(() => true),
      setDecorations: vi.fn(() => true),
      stagedPins: vi.fn(() => pins),
    }
    onReadyOf(root.render.mock.calls[0]!)(pointer)

    expect(editor.refresh()).toEqual({ applied: true })
    expect(refresh).toHaveBeenCalledWith(pins)
  })

  it('passes a refusal back to the host unchanged, naming the documents', () => {
    const refused = {
      applied: false,
      reason: 'staged-against-changed-documents',
      documents: ['architecture/main.yaml'],
    } as const
    const storeHost = { ...host, refresh: vi.fn(() => refused) }
    const editor = mountEditorWith({} as Element, storeHost, sections)
    onReadyOf(root.render.mock.calls[0]!)({
      select: vi.fn(() => true),
      openDraft: vi.fn(() => true),
      startConnection: vi.fn(() => true),
      setDecorations: vi.fn(() => true),
      stagedPins: vi.fn(() => ({ 'architecture/main.yaml': '1' })),
    })

    // The named documents are what a host puts in front of a reviewer, so
    // they have to survive the trip rather than collapse to a boolean.
    expect(editor.refresh()).toEqual(refused)
  })

  it('delegates each method to the pointer the shell hands up (#297)', () => {
    const editor = mountEditorWith({} as Element, host, sections)
    const pointer = {
      select: vi.fn(() => true),
      openDraft: vi.fn(() => true),
      startConnection: vi.fn(() => false),
      setDecorations: vi.fn(() => true),
      stagedPins: vi.fn(() => ({})),
    }
    onReadyOf(root.render.mock.calls[0]!)(pointer)

    expect(editor.select('app.checkout')).toBe(true)
    expect(pointer.select).toHaveBeenCalledWith('app.checkout')
    expect(editor.openDraft({ kind: 'goal' })).toBe(true)
    expect(pointer.openDraft).toHaveBeenCalledWith({ kind: 'goal' })
    // The pointer's own refusal travels back unchanged.
    expect(editor.startConnection('app.ledger')).toBe(false)
    expect(pointer.startConnection).toHaveBeenCalledWith('app.ledger')
    // The whole map travels, replacement being the map's own contract (#314).
    expect(editor.setDecorations({ 'app.ledger': 'removed' })).toBe(true)
    expect(pointer.setDecorations).toHaveBeenCalledWith({
      'app.ledger': 'removed',
    })
  })

  it('still unmounts, and a disposed handle answers false again (#297)', () => {
    const editor = mountEditorWith({} as Element, host, sections)
    const pointer = {
      select: vi.fn(() => true),
      openDraft: vi.fn(() => true),
      startConnection: vi.fn(() => true),
      setDecorations: vi.fn(() => true),
      stagedPins: vi.fn(() => ({})),
    }
    onReadyOf(root.render.mock.calls[0]!)(pointer)

    editor.unmount()

    expect(root.unmount).toHaveBeenCalledOnce()
    expect(editor.select('app.checkout')).toBe(false)
    expect(pointer.select).not.toHaveBeenCalled()
    expect(editor.setDecorations({})).toBe(false)
    expect(pointer.setDecorations).not.toHaveBeenCalled()
  })
})

const node = (id: string, name: string): CanvasNode => ({
  id,
  localId: id.split('.').at(-1) ?? id,
  document: 'architecture/main.yaml',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  coreKindLabel: 'applicationComponent',
  portKinds: [],
  layer: 'application',
  aspect: 'active-structure',
  name,
  description: null,
  aka: [],
  status: null,
  owner: null,
  folder: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
})

const edge = (id: string, from: string, to: string): CanvasEdge => ({
  id,
  localId: id,
  document: 'architecture/main.yaml',
  kind: 'yarramate/core@0.1#serving',
  kindLabel: 'serving',
  coreKindLabel: 'serving',
  from,
  to,
  name: null,
  description: null,
  mode: null,
  content: null,
  status: null,
  references: [],
  presentIn: [],
})

const graph: CanvasGraph = {
  nodes: [node('app.checkout', 'Checkout'), node('app.ledger', 'Ledger')],
  edges: [edge('checkout-serves-ledger', 'app.checkout', 'app.ledger')],
}

/**
 * The pointer itself (#297, ADR 0118): the pure factory the shell binds to
 * its reducer. Each method dispatches the same action its on-screen twin
 * dispatches - asserted against the same normalizers the tap handlers run -
 * and answers false where nothing moved.
 */
describe('editorPointerFor', () => {
  const pointerOver = (context: EditorPointerContext) => {
    const dispatched: VisualWorkspaceAction[] = []
    const seeded: (string | undefined)[] = []
    const decorated: DecorationMap[] = []
    const pointer = editorPointerFor(
      () => context,
      (action) => dispatched.push(action),
      (kind) => seeded.push(kind),
      (decorations) => decorated.push(decorations),
    )
    return { pointer, dispatched, seeded, decorated }
  }

  it('selects a concept exactly as a canvas tap would', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.select('app.checkout')).toBe(true)
    expect(dispatched).toEqual([
      {
        type: 'subject.selected',
        subject: normalizeSelectedElement(graph.nodes[0]!),
      },
    ])
  })

  it('selects a relationship with its endpoint titles resolved', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.select('checkout-serves-ledger')).toBe(true)
    expect(dispatched).toEqual([
      {
        type: 'subject.selected',
        subject: normalizeSelectedRelationship(
          graph.edges[0]!,
          new Map([
            ['app.checkout', 'Checkout'],
            ['app.ledger', 'Ledger'],
          ]),
        ),
      },
    ])
  })

  it('still selects under a read-only mount, because selecting is reading', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: true, stagedPins: {} })

    expect(pointer.select('app.checkout')).toBe(true)
    expect(dispatched).toHaveLength(1)
  })

  it('moves nothing for an id the model does not name', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.select('app.gone')).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('opens the draft with the kind seeded, the same seed a palette pick rides (#295)', () => {
    const { pointer, dispatched, seeded } = pointerOver({
      graph,
      readOnly: false,
      stagedPins: {},
    })

    expect(pointer.openDraft({ kind: 'goal' })).toBe(true)
    expect(seeded).toEqual(['goal'])
    expect(dispatched).toEqual([{ type: 'subject.draft.opened' }])
  })

  it('opens a plain draft with no kind, clearing any earlier seed (ADR 0116)', () => {
    const { pointer, seeded } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.openDraft()).toBe(true)
    expect(seeded).toEqual([undefined])
  })

  it('refuses the draft in a viewer, where creation is withdrawn (#298)', () => {
    const { pointer, dispatched, seeded } = pointerOver({
      graph,
      readOnly: true,
      stagedPins: {},
    })

    expect(pointer.openDraft({ kind: 'goal' })).toBe(false)
    expect(seeded).toEqual([])
    expect(dispatched).toEqual([])
  })

  it('arms the connection tool from a subject, as Connect does', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.startConnection('app.checkout')).toBe(true)
    expect(dispatched).toEqual([
      { type: 'connection.started', from: 'app.checkout' },
    ])
  })

  it('refuses a source that is unknown, or not a concept at all', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: false, stagedPins: {} })

    expect(pointer.startConnection('app.gone')).toBe(false)
    // A relationship has no endpoint to draw from.
    expect(pointer.startConnection('checkout-serves-ledger')).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('refuses to arm the connection tool in a viewer (#298)', () => {
    const { pointer, dispatched } = pointerOver({ graph, readOnly: true, stagedPins: {} })

    expect(pointer.startConnection('app.checkout')).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('replaces the marks wholesale, dispatching nothing (#314)', () => {
    // The map is the unit of exchange: each hand-over is the whole picture,
    // never a merge into the last one - and no workspace action moves,
    // because a mark is rendering state, not a gesture.
    const { pointer, dispatched, decorated } = pointerOver({
      graph,
      readOnly: false,
      stagedPins: {},
    })

    expect(pointer.setDecorations({ 'app.checkout': 'added' })).toBe(true)
    expect(pointer.setDecorations({ 'app.ledger': 'changed' })).toBe(true)
    expect(decorated).toEqual([
      { 'app.checkout': 'added' },
      { 'app.ledger': 'changed' },
    ])
    expect(dispatched).toEqual([])
  })

  it('accepts marks before the model arrives and in a viewer (#314)', () => {
    // Unlike its siblings, no graph gate: the marks are client state, drawn
    // the moment a model is on screen - a host hands the map with the mount,
    // not after the first frame. And decorating is reading (#298), so the
    // read-only posture refuses nothing here.
    const early = pointerOver({ graph: null, readOnly: false, stagedPins: {} })
    expect(early.pointer.setDecorations({ 'app.checkout': 'removed' })).toBe(
      true,
    )
    expect(early.decorated).toEqual([{ 'app.checkout': 'removed' }])

    const viewer = pointerOver({ graph, readOnly: true, stagedPins: {} })
    expect(viewer.pointer.setDecorations({})).toBe(true)
    expect(viewer.decorated).toEqual([{}])
  })

  it('reads the model at call time, so the methods answer for the graph on screen', () => {
    // Before the host's first frame there is nothing to point at; the same
    // pointer starts answering true once the model arrives, with no re-bind.
    let context: EditorPointerContext = { graph: null, readOnly: false, stagedPins: {} }
    const dispatched: VisualWorkspaceAction[] = []
    const pointer = editorPointerFor(
      () => context,
      (action) => dispatched.push(action),
      () => undefined,
      () => undefined,
    )

    expect(pointer.select('app.checkout')).toBe(false)
    expect(pointer.openDraft()).toBe(false)
    expect(pointer.startConnection('app.checkout')).toBe(false)
    expect(dispatched).toEqual([])

    context = { graph, readOnly: false, stagedPins: {} }
    expect(pointer.select('app.checkout')).toBe(true)
    expect(pointer.openDraft()).toBe(true)
    expect(pointer.startConnection('app.checkout')).toBe(true)
  })
})
