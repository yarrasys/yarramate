import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { VisualAppState } from '../src/visual-app/state.js'

const session = vi.hoisted(() => {
  const baseState: VisualAppState = {
    lifecycle: 'active',
    authority: 'canonical',
    title: 'Visual architecture conversation',
    description: 'Checked architecture slice',
    chatEnabled: true,
    model: null,
    styleNonce: '',
    activeView: '',
    transcript: [
      {
        id: 'local-0',
        speaker: 'reviewer',
        text: 'What happens next?',
      },
    ],
    views: [],
    activeFilter: null,
    quickFilterText: '',
    choices: null,
    agentStatus: null,
    diagnostics: [],
    handoff: null,
    composerEnabled: false,
    awaitingAgent: true,
    localRecords: 1,
    lastSequence: 1,
    frozen: false,
    closedReason: null,
    pendingViewSave: null,
    viewSaveNotice: false,
  }
  return { baseState, state: baseState }
})

vi.mock('../src/visual-app/session-client.js', () => ({
  useVisualSession: () => ({
    state: session.state,
    connected: true,
    ask: vi.fn(),
    choose: vi.fn(),
    navigate: vi.fn(),
    filter: vi.fn(),
    clearFilter: vi.fn(),
    setQuickFilterText: vi.fn(),
    saveView: vi.fn(),
    dismissSavedNotice: vi.fn(),
    end: vi.fn(),
  }),
}))

import { App } from '../src/visual-app/App.js'

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: 1280,
      matchMedia: () => ({ matches: false }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })
})

afterAll(() => {
  if (previousWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window')
  } else {
    Object.defineProperty(globalThis, 'window', previousWindow)
  }
})
const renderSession = (overrides: Partial<VisualAppState> = {}): string => {
  session.state = { ...session.baseState, ...overrides }
  return renderToStaticMarkup(createElement(App))
}


describe('visual conversation rendering', () => {
  it('shows an active waiting indicator immediately after a question is submitted', () => {
    const markup = renderSession()

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('class="agent-spinner"')
    expect(markup).toContain('Awaiting agent response')
  })

  it('explains that End is preparing the main-agent handoff', () => {
    const markup = renderSession({ lifecycle: 'ending', handoff: null })

    expect(markup).toContain('class="end-transition-status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain(
      'Ending conversation — preparing a handoff for the main agent.',
    )
    expect(markup).toContain('>Ending…</button>')
  })

  it('reports when the handoff is ready for the main agent', () => {
    const markup = renderSession({
      lifecycle: 'ending',
      handoff: {
        summary: 'Option B confirmed.',
        confirmedDecisions: ['option-b'],
        requestedChanges: [],
        unresolvedQuestions: [],
        finalViews: ['overview'],
      },
    })

    expect(markup).toContain(
      'Handoff ready — returning control to the main agent.',
    )
  })

  it('directs the reviewer to continue after the visual session closes', () => {
    const markup = renderSession({ lifecycle: 'closed' })

    expect(markup).toContain(
      'Visual conversation ended. Continue in the main agent.',
    )
  })

  it('labels the session Beta in the command strip', () => {
    const markup = renderSession()

    expect(markup).toContain('class="beta-badge">Beta</span>')
  })

  it.each(['connecting', 'disconnected'] as const)(
    'keeps the End label before an End request while %s',
    (lifecycle) => {
      const markup = renderSession({ lifecycle })

      expect(markup).toContain('>End</button>')
      expect(markup).not.toContain('>Ending…</button>')
    },
  )

  it.each(['ending', 'closed'] as const)(
    'stops showing an active agent wait while %s',
    (lifecycle) => {
      const markup = renderSession({
        lifecycle,
        awaitingAgent: true,
        agentStatus: { state: 'thinking' },
      })

      expect(markup).toContain('aria-busy="false"')
      expect(markup).not.toContain('class="agent-spinner"')
      expect(markup).not.toContain('Awaiting agent response')
      expect(markup).not.toContain('Agent is thinking')
    },
  )

  it('shows a chat filter pill naming the active chat-issued query', () => {
    const markup = renderSession({
      activeFilter: {
        query: { layers: ['application'] },
        matchedIds: ['a'],
        source: 'chat',
      },
    })

    expect(markup).toContain('class="filter-pill"')
    expect(markup).toContain('Filtered by chat:')
    expect(markup).toContain('layers: application')
    expect(markup).toContain('>Show all</button>')
  })

  it.each(['view', 'panel'] as const)(
    'hides the chat filter pill for a %s-sourced filter',
    (source) => {
      const markup = renderSession({
        activeFilter: { query: { layers: ['application'] }, matchedIds: ['a'], source },
      })

      expect(markup).not.toContain('class="filter-pill"')
    },
  )

  it('hides the chat filter pill when there is no active filter', () => {
    const markup = renderSession()

    expect(markup).not.toContain('class="filter-pill"')
  })

  it('renders view options in the picker when state.views is populated', () => {
    const markup = renderSession({
      views: [
        {
          id: 'v1',
          title: 'View One',
          description: '',
          query: {},
          presentation: {},
        },
      ],
    })

    expect(markup).toContain('<select')
    expect(markup).toContain('<option value="v1">View One</option>')
  })

  it('renders the quick-filter box with the current quickFilterText as its value', () => {
    const markup = renderSession({ quickFilterText: 'checkout' })

    expect(markup).toContain('class="quick-filter"')
    expect(markup).toContain('value="checkout"')
  })

  it('renders the filter panel toggle button', () => {
    const markup = renderSession()

    expect(markup).toContain('class="filter-panel"')
    expect(markup).toContain('>Filter</button>')
  })
})
