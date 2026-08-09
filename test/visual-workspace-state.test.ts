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

  it('clamps width to both the panel maximum and the canvas floor', () => {
    expect(conversationWidthBounds(1568)).toEqual({ min: 320, max: 640 })
    expect(conversationWidthBounds(900)).toEqual({ min: 320, max: 370 })

    const widened = visualWorkspaceReducer(createVisualWorkspaceState(1568), {
      type: 'conversation.resized',
      width: 900,
      viewportWidth: 1568,
    })
    expect(widened.conversation.width).toBe(640)

    const narrowedViewport = visualWorkspaceReducer(widened, {
      type: 'viewport.resized',
      viewportWidth: 900,
    })
    expect(narrowedViewport.conversation.width).toBe(370)
  })
})

describe('selected diagram subjects', () => {
  it('prefers model identity and flattens element descriptions', () => {
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
      'About “API” (system.api): What owns this?',
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
