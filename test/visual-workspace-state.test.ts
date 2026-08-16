import { describe, expect, it } from 'vitest'
import type { CanvasEdge, CanvasNode } from '../src/graph-projection.js'
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  presentationActionsFor,
  visualWorkspaceReducer,
  type SelectedDiagramSubject,
} from '../src/visual-app/workspace-state.js'

const canvasNode = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'system.api',
  localId: 'api',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  document: 'main.yaml',
  layer: 'application',
  aspect: null,
  name: 'API',
  description: 'Handles requests.',
  aka: [],
  status: null,
  owner: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
  ...overrides,
})

const canvasEdge = (overrides: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: 'edge-1',
  localId: 'edge-1',
  kind: 'yarramate/core@0.1#dependency',
  kindLabel: 'dependency',
  document: 'main.yaml',
  from: 'web',
  to: 'api',
  name: 'calls',
  description: null,
  mode: null,
  content: null,
  status: null,
  references: [],
  presentIn: [],
  ...overrides,
})

const elementSubject: SelectedDiagramSubject = {
  type: 'element',
  id: 'system.api',
  title: 'API',
  kind: 'service',
  description: 'Handles requests.',
}

describe('visual workspace state', () => {
  it('starts collapsed at the responsive default width', () => {
    const state = createVisualWorkspaceState(1568)
    expect(state.conversation).toEqual({
      mode: 'auto',
      width: expect.closeTo(439.04, 2),
      unread: 0,
    })
  })

  it('caps the default width at 480px on wide viewports', () => {
    const state = createVisualWorkspaceState(1920)
    expect(state.conversation).toEqual({
      mode: 'auto',
      width: 480,
      unread: 0,
    })
  })

  it('opens automatically for first activity but respects a manual close', () => {
    const initial = createVisualWorkspaceState(1568)
    const opened = visualWorkspaceReducer(initial, {
      type: 'attention.received',
    })
    expect(opened.conversation.mode).toBe('open')

    const closed = visualWorkspaceReducer(opened, {
      type: 'conversation.toggled',
    })
    const waiting = visualWorkspaceReducer(closed, {
      type: 'attention.received',
    })
    expect(waiting.conversation).toMatchObject({ mode: 'closed', unread: 1 })

    const reopened = visualWorkspaceReducer(waiting, {
      type: 'conversation.toggled',
    })
    expect(reopened.conversation).toMatchObject({ mode: 'open', unread: 0 })
  })

  it('re-reads a held subject from the replacement model and drops it only when removed', () => {
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: 'subject.selected',
      subject: elementSubject,
    })
    expect(selected.conversation.mode).toBe('open')
    expect(selected.selectedSubject).toEqual(elementSubject)

    // A commit that renamed the held subject: the inspector follows the edit
    // instead of closing under the reviewer who just made it.
    const renamed = visualWorkspaceReducer(selected, {
      type: 'model.replaced',
      graph: { nodes: [canvasNode({ name: 'Gateway API' })], edges: [] },
    })
    expect(renamed.selectedSubject).toMatchObject({
      type: 'element',
      id: 'system.api',
      title: 'Gateway API',
    })
    expect(renamed.conversation.mode).toBe('open')

    // A commit that deleted it, and a session with no model at all: nothing
    // left to point at either way.
    for (const graph of [{ nodes: [], edges: [] }, null]) {
      const gone = visualWorkspaceReducer(selected, {
        type: 'model.replaced',
        graph,
      })
      expect(gone.selectedSubject).toBeNull()
      expect(gone.conversation.mode).toBe('open')
    }
  })

  it('re-resolves a held relationship endpoint title after replacement', () => {
    const web = canvasNode({ id: 'web', name: 'Web' })
    const api = canvasNode({ id: 'api', name: 'API' })
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: 'subject.selected',
      subject: normalizeSelectedRelationship(
        canvasEdge(),
        new Map([
          ['web', 'Web'],
          ['api', 'API'],
        ]),
      ),
    })

    const replaced = visualWorkspaceReducer(selected, {
      type: 'model.replaced',
      graph: {
        nodes: [web, canvasNode({ id: 'api', name: 'Gateway API' })],
        edges: [canvasEdge({ name: 'invokes' })],
      },
    })
    expect(replaced.selectedSubject).toMatchObject({
      type: 'relationship',
      id: 'edge-1',
      sourceTitle: 'Web',
      targetTitle: 'Gateway API',
      label: 'invokes',
    })

    // The edge outlives one of its endpoints only in a broken model; a
    // relationship the commit removed closes the inspector.
    const dropped = visualWorkspaceReducer(selected, {
      type: 'model.replaced',
      graph: { nodes: [web, api], edges: [] },
    })
    expect(dropped.selectedSubject).toBeNull()
  })

  it('clamps width to the design maximum of min(45vw, 640px)', () => {
    expect(conversationWidthBounds(1568)).toEqual({ min: 320, max: 640 })
    expect(conversationWidthBounds(900)).toEqual({ min: 320, max: 405 })
    expect(conversationWidthBounds(600)).toEqual({ min: 320, max: 320 })

    const widened = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: 'conversation.resized',
      width: 900,
    })
    expect(widened.conversation.width).toBe(640)

    const narrowedViewport = visualWorkspaceReducer(widened, {
      type: 'viewport.resized',
      viewportWidth: 900,
    })
    expect(narrowedViewport.conversation.width).toBe(405)
  })

  // The separator reads its aria bounds from this state, so a viewport change
  // that leaves the panel width alone must still be observable.
  it('tracks the viewport width even when the clamped panel width is unchanged', () => {
    const initial = createVisualWorkspaceState(1568)
    expect(initial.viewportWidth).toBe(1568)

    const wider = visualWorkspaceReducer(initial, {
      type: 'viewport.resized',
      viewportWidth: 1600,
    })
    expect(wider.conversation.width).toBe(initial.conversation.width)
    expect(wider.viewportWidth).toBe(1600)

    // A drag clamps against the viewport the state already knows.
    const dragged = visualWorkspaceReducer(
      visualWorkspaceReducer(wider, { type: 'viewport.resized', viewportWidth: 900 }),
      { type: 'conversation.resized', width: 900 },
    )
    expect(dragged.conversation.width).toBe(405)
  })
})

describe('selected diagram subjects', () => {
  it('normalizes a node into a selected element, trimming its description', () => {
    const selected = normalizeSelectedElement(
      canvasNode({ id: 'rendered-node', name: 'API', kindLabel: 'service', description: '  Handles requests.  ' }),
    )
    expect(selected).toEqual({
      type: 'element',
      id: 'rendered-node',
      title: 'API',
      kind: 'service',
      description: 'Handles requests.',
    })
  })

  it('treats absent or blank descriptions as missing', () => {
    expect(normalizeSelectedElement(canvasNode({ description: null })).description).toBeNull()
    expect(normalizeSelectedElement(canvasNode({ description: '   ' })).description).toBeNull()
  })

  it('preserves edge endpoints and falls back to the id for unknown titles', () => {
    const selected = normalizeSelectedRelationship(
      canvasEdge({
        id: 'edge-1',
        from: 'missing-source',
        to: 'api',
        name: 'routes to',
        description: '  Requests cross this boundary.  ',
        kindLabel: 'sync',
      }),
      new Map([['api', 'API']]),
    )
    expect(selected).toEqual({
      type: 'relationship',
      id: 'edge-1',
      sourceId: 'missing-source',
      sourceTitle: 'missing-source',
      targetId: 'api',
      targetTitle: 'API',
      label: 'routes to',
      description: 'Requests cross this boundary.',
      kind: 'sync',
    })
  })

  it('formats the exact visible text sent through the existing chat seam', () => {
    expect(formatContextualQuestion('What owns this?', elementSubject)).toBe(
      'About element “API” (system.api): What owns this?',
    )

    const relationship = normalizeSelectedRelationship(
      canvasEdge({ id: 'edge-1', from: 'web', to: 'api', name: 'calls' }),
      new Map([
        ['web', 'Web'],
        ['api', 'API'],
      ]),
    )
    expect(formatContextualQuestion('Why synchronous?', relationship)).toBe(
      'About relationship “Web → API — calls”: Why synchronous?',
    )
    expect(formatContextualQuestion('  General question  ', null)).toBe(
      'General question',
    )
  })
})

describe('visualWorkspaceReducer layout', () => {
  const workspaceState = createVisualWorkspaceState(1280)

  it('starts on the layered backend', () => {
    expect(workspaceState.layout).toBe('layered')
  })

  it('sets the layout backend on layout.set', () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: 'layout.set',
      layout: 'force',
    })
    expect(next.layout).toBe('force')
    expect(next.direction).toBe(workspaceState.direction)
  })

  it('adopts a selected view declared layout and direction', () => {
    const actions = presentationActionsFor({ layout: 'radial', direction: 'left-right' })
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next.layout).toBe('radial')
    expect(next.direction).toBe('left-right')
  })

  it('leaves layout and direction untouched when a view declares neither', () => {
    const actions = presentationActionsFor({})
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next).toBe(workspaceState)
  })

  it('adopts only the field a view actually declares', () => {
    const actions = presentationActionsFor({ layout: 'force' })
    expect(actions).toEqual([{ type: 'layout.set', layout: 'force' }])
  })
})

describe('visualWorkspaceReducer presentation', () => {
  const workspaceState = createVisualWorkspaceState(1280)

  it('starts with lifecycle and evidence badges on and ownership off', () => {
    expect(workspaceState.showLifecycle).toBe(true)
    expect(workspaceState.showEvidence).toBe(true)
    expect(workspaceState.showOwnership).toBe(false)
  })

  it.each([
    ['showLifecycle', false] as const,
    ['showEvidence', false] as const,
    ['showOwnership', true] as const,
  ])('sets %s to %s on presentation.toggled', (flag, value) => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: 'presentation.toggled',
      flag,
      value,
    })
    expect(next[flag]).toBe(value)
  })

  it('leaves the other two flags untouched when one is toggled', () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: 'presentation.toggled',
      flag: 'showOwnership',
      value: true,
    })
    expect(next.showLifecycle).toBe(workspaceState.showLifecycle)
    expect(next.showEvidence).toBe(workspaceState.showEvidence)
  })

  it('adopts a selected view declared presentation flags', () => {
    const actions = presentationActionsFor({
      showLifecycle: false,
      showEvidence: false,
      showOwnership: true,
    })
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next.showLifecycle).toBe(false)
    expect(next.showEvidence).toBe(false)
    expect(next.showOwnership).toBe(true)
  })

  it('leaves presentation flags untouched when a view declares none of them', () => {
    const actions = presentationActionsFor({})
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next).toBe(workspaceState)
  })

  it('adopts only the presentation flag a view actually declares', () => {
    const actions = presentationActionsFor({ showOwnership: true })
    expect(actions).toEqual([
      { type: 'presentation.toggled', flag: 'showOwnership', value: true },
    ])
  })
})

describe('visualWorkspaceReducer notation', () => {
  const workspaceState = createVisualWorkspaceState(1280)

  it('starts with native notation', () => {
    expect(workspaceState.notation).toBe('native')
  })

  it('sets notation on notation.set', () => {
    const next = visualWorkspaceReducer(workspaceState, {
      type: 'notation.set',
      notation: 'archimate',
    })
    expect(next.notation).toBe('archimate')
  })

  it('adopts a selected view declared notation', () => {
    const actions = presentationActionsFor({ notation: 'archimate' })
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next.notation).toBe('archimate')
  })

  it('leaves notation untouched when a view declares none', () => {
    const actions = presentationActionsFor({})
    const next = actions.reduce(visualWorkspaceReducer, workspaceState)
    expect(next).toBe(workspaceState)
  })

  it('adopts only the notation field a view actually declares', () => {
    const actions = presentationActionsFor({ notation: 'archimate' })
    expect(actions).toEqual([
      { type: 'notation.set', notation: 'archimate' },
    ])
  })
})
