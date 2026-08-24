import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAppState } from '../src/visual-app/state.js'
import type { CanvasNode } from '../src/graph-projection.js'
import type { VisualRenderedModel } from '../src/adapters/visual/wire.js'

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
    pendingChangeset: { operations: [], viewOperations: [], sourceDigests: {} },
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

const subject = (
  id: string,
  name: string,
  overrides: Partial<CanvasNode> = {},
): CanvasNode => ({
  id,
  localId: id.split('.').at(-1) ?? id,
  document: 'architecture/main.yaml',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  coreKindLabel: 'applicationComponent',
  layer: 'application',
  aspect: 'active-structure',
  name,
  description: null,
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

/** Two subjects, so a view that draws one leaves the other to be marked. */
const renderedModel: VisualRenderedModel = {
  authority: 'canonical',
  initialView: '',
  graph: {
    nodes: [
      subject('app.checkout', 'Checkout'),
      subject('app.ledger', 'Ledger'),
    ],
    edges: [],
  },
  documents: ['architecture/main.yaml'],
  vocabulary: { conceptKinds: [], relationshipKinds: [] },
  layouts: {},
  sourceDigests: {},
  projectionDigests: {},
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
    'shows a filter pill naming a %s-issued query the tree cannot name',
    (source) => {
      const markup = renderSession({
        activeFilter: {
          query: { layers: ['application'] },
          matchedIds: ['a'],
          excluded: [],
          source,
        },
      })

      expect(markup).toContain('class="filter-pill"')
      expect(markup).toContain(`Filtered by ${source}:`)
      expect(markup).toContain('layers: application')
      expect(markup).toContain('>Show all</button>')
    },
  )

  it('hides the filter pill for a view-sourced filter the tree already names', () => {
    const markup = renderSession({
      activeFilter: {
        query: { layers: ['application'] },
        matchedIds: ['a'],
        excluded: [],
        source: 'view',
      },
    })

    expect(markup).not.toContain('class="filter-pill"')
  })

  it('hides the filter pill when there is no active filter', () => {
    const markup = renderSession()

    expect(markup).not.toContain('class="filter-pill"')
  })

  it('renders a saved view as a row in the tree when state.views is populated', () => {
    const markup = renderSession({
      views: [
        {
          id: 'v1',
          title: 'View One',
          description: '',
          query: {},
          presentation: {},
          path: '.yarramate/projections/v1.yaml',
          subjectCount: 4,
        },
      ],
    })

    expect(markup).toContain('aria-label="Views and model"')
    expect(markup).toContain('View One')
    // The count the server measured, beside the title the reviewer authored.
    expect(markup).toContain('>4</span>')
    // The rail replaced the strip's dropdown outright.
    expect(markup).not.toContain('<option value="v1">')
  })

  it('lists every declared subject under Model, marking the ones the view leaves out', () => {
    const markup = renderSession({
      model: renderedModel,
      activeView: 'v1',
      views: [
        {
          id: 'v1',
          title: 'View One',
          description: '',
          query: {},
          presentation: {},
          path: '.yarramate/projections/v1.yaml',
          // Deliberately wrong for the graph below: the summary was measured
          // before whatever last changed the model.
          subjectCount: 9,
        },
      ],
      // The canvas is drawing one of the two subjects the model declares —
      // and the match set also names the relationship the view matched, which
      // is not a subject and must not be counted as one.
      activeFilter: {
        query: {},
        matchedIds: ['app.checkout', 'checkout-serves-ledger'],
        excluded: [],
        source: 'view',
      },
    })

    // The model root holds everything there is to draw, not what is drawn.
    expect(markup).toContain('Checkout')
    expect(markup).toContain('Ledger')
    expect(markup).toContain('not in view')
    expect(markup).toContain('tree-row-quiet')
    // The count beside the active view is what the canvas is drawing now —
    // one subject: not the nine its summary claimed, and not the two entries
    // the match set holds, one of which is a relationship.
    expect(markup).toContain(
      '<span class="tree-label">View One</span><span class="tree-count">1</span>',
    )
    expect(markup).not.toContain('>9</span>')
    // "All subjects" states the whole model, which is both of them.
    expect(markup).toContain(
      '<span class="tree-label">All subjects</span><span class="tree-count">2</span>',
    )
  })

  it('renders the quick-filter box with the current quickFilterText as its value', () => {
    const markup = renderSession({ quickFilterText: 'checkout' })

    expect(markup).toContain('class="quick-filter"')
    expect(markup).toContain('value="checkout"')
  })

  it('edits the query at the foot of the canvas, not in a dropdown over it', () => {
    const markup = renderSession()

    // The facets moved into the canvas column's own panel (#248), where the
    // match count, the excluded list and the document sit beside them. A
    // dropdown could only ever overlay the diagram it was narrowing.
    expect(markup).not.toContain('class="filter-panel"')
    expect(markup).not.toContain('>Filter</button>')
    expect(markup).toContain('class="bottom-panel"')
    expect(markup).toContain('>View query</button>')
  })

  it('leaves the query panel collapsed until it is asked for', () => {
    const markup = renderSession()

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('role="tabpanel"')
  })
})

// ArchiMate is the notation and it lays out top-down, so neither a notation
// picker nor a direction toggle has anything to offer. Asserted on the rendered
// markup rather than on state, because a control is gone when it stops being
// drawn - a reducer with no field behind it would still pass a state assertion
// while the strip carried a dead button.
describe('command strip', () => {
  it('offers no notation picker', () => {
    const markup = renderSession()

    expect(markup).not.toContain('aria-label="Notation"')
    expect(markup).not.toContain('>ArchiMate<')
    expect(markup).not.toContain('>Native<')
  })

  it('offers no direction control, and no notice explaining one', () => {
    const markup = renderSession()

    expect(markup).not.toContain('Top-Down')
    expect(markup).not.toContain('Left-Right')
    expect(markup).not.toContain('direction-notice')
  })
})
