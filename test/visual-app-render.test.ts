import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAppState } from '../src/visual-app/state.js'
import type * as WorkspaceState from '../src/visual-app/workspace-state.js'

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
    pendingChangeset: { operations: [], sourceDigests: {} },
    undoStack: [],
    redoStack: [],
    commitStatus: 'idle',
    commitDiagnostics: null,
    commitNotice: null,
    layoutNotice: null,
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

// The command strip's layout control lives on local `useReducer` workspace
// state, not `VisualAppState` - so a render test that wants to see the
// direction button disabled under a non-`layered` backend has to override
// the reducer's initial value the same way `session` overrides session state
// above, rather than driving it through props the App component doesn't have.
// `notationOverride` follows the same pattern for the ArchiMate direction pin,
// and `directionOverride` for a stored direction the pin has to override in
// the label without touching what is stored.
const workspace = vi.hoisted(() => ({
  layoutOverride: undefined as 'layered' | 'radial' | 'force' | undefined,
  notationOverride: undefined as 'native' | 'archimate' | undefined,
  directionOverride: undefined as 'top-down' | 'left-right' | undefined,
}))

vi.mock('../src/visual-app/workspace-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceState>()
  return {
    ...actual,
    createVisualWorkspaceState: (viewportWidth: number) => ({
      ...actual.createVisualWorkspaceState(viewportWidth),
      ...(workspace.layoutOverride === undefined
        ? {}
        : { layout: workspace.layoutOverride }),
      ...(workspace.notationOverride === undefined
        ? {}
        : { notation: workspace.notationOverride }),
      ...(workspace.directionOverride === undefined
        ? {}
        : { direction: workspace.directionOverride }),
    }),
  }
})

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

  it.each(['chat', 'panel'] as const)(
    'shows a filter pill naming a %s-issued query the picker cannot name',
    (source) => {
      const markup = renderSession({
        activeFilter: { query: { layers: ['application'] }, matchedIds: ['a'], source },
      })

      expect(markup).toContain('class="filter-pill"')
      expect(markup).toContain(`Filtered by ${source}:`)
      expect(markup).toContain('layers: application')
      expect(markup).toContain('>Show all</button>')
    },
  )

  it('hides the filter pill for a view-sourced filter the picker already names', () => {
    const markup = renderSession({
      activeFilter: { query: { layers: ['application'] }, matchedIds: ['a'], source: 'view' },
    })

    expect(markup).not.toContain('class="filter-pill"')
  })

  it('hides the filter pill when there is no active filter', () => {
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

describe('layout control', () => {
  beforeEach(() => {
    workspace.layoutOverride = undefined
    workspace.notationOverride = undefined
    workspace.directionOverride = undefined
  })

  afterAll(() => {
    workspace.layoutOverride = undefined
    workspace.notationOverride = undefined
    workspace.directionOverride = undefined
  })

  it('enables the direction button under the default layered backend', () => {
    workspace.layoutOverride = undefined
    const markup = renderSession()

    expect(markup).toContain('<button type="button">Top-Down</button>')
  })

  it.each(['radial', 'force'] as const)(
    'disables the direction button under %s',
    (layout) => {
      workspace.layoutOverride = layout
      const markup = renderSession()

      expect(markup).toContain('<button type="button" disabled="">Top-Down</button>')
    },
  )

  it('disables the direction button and shows the reason under archimate notation', () => {
    workspace.layoutOverride = undefined
    workspace.notationOverride = 'archimate'
    const markup = renderSession()

    expect(markup).toContain('<button type="button" disabled="">Top-Down</button>')
    expect(markup).toContain(
      '<span class="direction-notice" role="status">ArchiMate notation fixes direction to Top-Down.</span>',
    )
  })

  it('shows no direction notice under native notation', () => {
    workspace.layoutOverride = undefined
    workspace.notationOverride = 'native'
    const markup = renderSession()

    expect(markup).toContain('<span class="direction-notice" role="status"></span>')
  })

  it('reports the pinned direction while archimate makes a stored left-right inert', () => {
    workspace.notationOverride = 'archimate'
    workspace.directionOverride = 'left-right'
    const markup = renderSession()

    // The canvas laid out DOWN, so the strip cannot advertise the stored value.
    expect(markup).toContain('<button type="button" disabled="">Top-Down</button>')
  })

  it('keeps the stored direction and drops the notice where archimate pins nothing', () => {
    workspace.layoutOverride = 'radial'
    workspace.notationOverride = 'archimate'
    workspace.directionOverride = 'left-right'
    const markup = renderSession()

    // Radial never reads a direction, so the pin is not what disabled this.
    expect(markup).toContain('<button type="button" disabled="">Left-Right</button>')
    expect(markup).toContain('<span class="direction-notice" role="status"></span>')
  })
})
