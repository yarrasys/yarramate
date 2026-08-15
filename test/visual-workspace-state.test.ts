import { describe, expect, it } from 'vitest'
import type { CanvasEdge, CanvasNode } from '../src/graph-projection.js'
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  visualWorkspaceReducer,
  type SelectedDiagramSubject,
} from '../src/visual-app/workspace-state.js'

const canvasNode = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'system.api',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  layer: 'application',
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
  kind: 'yarramate/core@0.1#dependency',
  kindLabel: 'dependency',
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

  it('opens for a direct selection and clears only on model replacement', () => {
    const selected = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: 'subject.selected',
      subject: elementSubject,
    })
    expect(selected.conversation.mode).toBe('open')
    expect(selected.selectedSubject).toEqual(elementSubject)

    const replaced = visualWorkspaceReducer(selected, {
      type: 'model.replaced',
    })
    expect(replaced.selectedSubject).toBeNull()
    expect(replaced.conversation.mode).toBe('open')
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
