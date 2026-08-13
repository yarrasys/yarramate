import { describe, expect, it } from 'vitest'
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  visualDescriptionText,
  visualWorkspaceReducer,
  type SelectedDiagramSubject,
} from '../src/visual-app/workspace-state.js'

const elementSubject: SelectedDiagramSubject = {
  type: 'element',
  id: 'node-1',
  modelRef: 'system.api',
  deploymentRef: null,
  identity: 'system.api',
  title: 'API',
  kind: 'service',
  description: 'Handles requests.',
  technology: 'TypeScript',
  tags: ['public'],
  navigateTo: 'api-detail',
  metadata: null,
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
  it('prefers model identity for deployment nodes and flattens descriptions', () => {
    const selected = normalizeSelectedElement({
      id: 'rendered-node',
      modelRef: 'system.api',
      deploymentRef: 'prod.api',
      title: 'API',
      kind: 'service',
      description: { txt: '  Handles requests.  ' },
      technology: 'TypeScript',
      tags: ['public'],
      navigateTo: 'api-detail',
      metadata: { owner: 'platform' },
    })
    expect(selected).toMatchObject({
      identity: 'system.api',
      description: 'Handles requests.',
      modelRef: 'system.api',
      deploymentRef: 'prod.api',
    })
  })

  it('falls back through deployment identity to rendered node identity', () => {
    expect(
      normalizeSelectedElement({
        id: 'deployment-node',
        deploymentRef: 'prod.api',
        title: 'Production API',
      }).identity,
    ).toBe('prod.api')
    expect(
      normalizeSelectedElement({ id: 'group-1', title: 'Services' }).identity,
    ).toBe('group-1')
  })

  it('preserves edge endpoints, rendered description, and aggregate count', () => {
    const selected = normalizeSelectedRelationship(
      {
        id: 'edge-1',
        source: 'missing-source',
        target: 'api',
        label: 'routes to',
        description: { txt: 'Requests cross this boundary.' },
        kind: 'sync',
        technology: 'HTTPS',
        notation: 'request',
        relations: ['relation-1', 'relation-2'],
      },
      new Map([['api', 'API']]),
    )
    expect(selected).toMatchObject({
      sourceId: 'missing-source',
      sourceTitle: 'missing-source',
      targetTitle: 'API',
      description: 'Requests cross this boundary.',
      aggregateCount: 2,
      relationshipIds: ['relation-1', 'relation-2'],
    })
  })

  it('treats absent or blank descriptions as missing', () => {
    expect(visualDescriptionText(undefined)).toBeNull()
    expect(visualDescriptionText({ txt: '   ' })).toBeNull()
  })

  it('formats the exact visible text sent through the existing chat seam', () => {
    expect(formatContextualQuestion('What owns this?', elementSubject)).toBe(
      'About element “API” (system.api): What owns this?',
    )

    const relationship = normalizeSelectedRelationship(
      {
        id: 'edge-1',
        source: 'web',
        target: 'api',
        label: 'calls',
        relations: ['one', 'two'],
      },
      new Map([
        ['web', 'Web'],
        ['api', 'API'],
      ]),
    )
    expect(formatContextualQuestion('Why synchronous?', relationship)).toBe(
      'About relationship “Web → API — calls” (2 model relationships): Why synchronous?',
    )
    expect(formatContextualQuestion('  General question  ', null)).toBe(
      'General question',
    )
  })
})
