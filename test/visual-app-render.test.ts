import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAppState } from '../src/visual-app/state.js'
import type { CanvasNode } from '../src/graph-projection.js'
import type { VisualRenderedModel } from '../src/adapters/visual/wire.js'
import type { EditorHost } from '../src/visual-app/editor-host.js'
import type { RightSectionId } from '../src/visual-app/workspace-state.js'

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
// A host that answers nothing: `useVisualSession` is mocked above, so what
// this exercises is that `App` takes one at all - the prop is the seam an
// embedder supplies instead of a socket (#252).
const idleHost: EditorHost = {
  open: () => () => {},
  send: () => {},
}

const renderSession = (
  overrides: Partial<VisualAppState> = {},
  props: { readonly sections?: readonly RightSectionId[] } = {},
): string => {
  session.state = { ...session.baseState, ...overrides }
  return renderToStaticMarkup(createElement(App, { host: idleHost, ...props }))
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
  folder: null,
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

  it('explains that returning to the agent is preparing the handoff', () => {
    const markup = renderSession({ lifecycle: 'ending', handoff: null })

    expect(markup).toContain('class="end-transition-status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain(
      'Ending conversation — preparing a handoff for the main agent.',
    )
    expect(markup).toContain('>Returning…</button>')
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
    'keeps the Return label before a return is requested while %s',
    (lifecycle) => {
      const markup = renderSession({ lifecycle })

      expect(markup).toContain('>Return to agent</button>')
      expect(markup).not.toContain('>Returning…</button>')
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

  it('shows a staged view, and the folder it declares, before any commit lands it', () => {
    // The #299 repro: "New folder…" stages the first view of a folder no
    // landed document declares, and the rail used to show nothing at all.
    const markup = renderSession({
      pendingChangeset: {
        operations: [],
        viewOperations: [
          {
            op: 'write-view',
            path: '.yarramate/projections/roadmap-first.yaml',
            projection: {
              format: 'yarramate/projection/v1',
              id: 'roadmap-first',
              version: '1.0',
              query: {},
              presentation: {
                title: 'Roadmap first',
                description: 'staged',
                folder: 'Roadmap',
              },
            },
          },
        ],
        sourceDigests: {},
      },
    })

    // The folder branch and its first view, at once, visibly staged — and no
    // count, because nothing has measured a query that has not landed.
    expect(markup).toContain('<span class="tree-label">Roadmap</span>')
    expect(markup).toContain('tree-row-staged')
    expect(markup).toContain(
      '<span class="tree-label">Roadmap first</span><span class="tree-staged">staged</span>',
    )
  })

  it('marks a staged delete in the tree rather than dropping the row', () => {
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
      pendingChangeset: {
        operations: [],
        viewOperations: [
          { op: 'delete-view', path: '.yarramate/projections/v1.yaml' },
        ],
        sourceDigests: {},
      },
    })

    expect(markup).toContain('tree-row-staged-delete')
    expect(markup).toContain(
      '<span class="tree-label">View One</span><span class="tree-staged">staged delete</span>',
    )
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

  it('puts the quick filter on the canvas it narrows, not in the strip', () => {
    // It used to sit in the command strip, as far from the diagram as the
    // window allows, beside controls with nothing to do with it (#249).
    const markup = renderSession({ model: renderedModel, quickFilterText: 'checkout' })

    expect(markup).toContain('class="canvas-controls"')
    expect(markup).toContain('class="quick-filter"')
    expect(markup).toContain('value="checkout"')
    const strip = markup.slice(0, markup.indexOf('</header>'))
    expect(strip).not.toContain('quick-filter')
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

/**
 * The shell the design asks for (#249): identity in the strip, three sections
 * in the right column, and the session's own control beside the conversation.
 */
describe('the right column, as a stack of sections', () => {
  it('draws all three sections, chat last', () => {
    const markup = renderSession()

    expect(markup).toContain('class="section-stack"')
    const order = ['properties', 'changes', 'chat'].map((id) =>
      markup.indexOf(`stack-section-${id}`),
    )
    expect(order.every((at) => at !== -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('says what a section holds while it is shut', () => {
    // A closed strip button said nothing. A closed header says whose turn it
    // is, how many rows are staged, and which subject is selected.
    const markup = renderSession()

    expect(markup).toContain('>Element properties</span>')
    expect(markup).toContain('class="section-meta">nothing staged</span>')
  })

  it('gives each pair of sections a handle a keyboard can reach', () => {
    const markup = renderSession()

    expect(markup).toContain('aria-label="Resize the changes section"')
    expect(markup).toContain('aria-label="Resize the chat section"')
    expect(markup).toContain('aria-orientation="horizontal"')
    expect(markup).toContain('tabindex="0"')
  })

  it('leaves the command strip carrying identity and nothing else', () => {
    const markup = renderSession()
    const strip = markup.slice(0, markup.indexOf('</header>'))

    expect(strip).toContain('class="command-identity"')
    for (const gone of [
      '>Details</button>',
      '>Conversation</button>',
      '>Save view</button>',
      'class="quick-filter"',
      'class="end-session"',
    ]) {
      expect(strip, `${gone} has left the strip`).not.toContain(gone)
    }
  })

  it('ends the session from the chat section, and calls it what it does', () => {
    // One button, not two. The design draws `End session` beside it for a
    // handback that leaves the session live; nothing can do that yet, and a
    // button that claimed to would be lying about the lifecycle.
    const markup = renderSession()
    const chat = markup.slice(markup.indexOf('stack-section-chat'))

    expect(chat).toContain('>Return to agent</button>')
    expect(markup).not.toContain('>End session</button>')
  })

  it('reads the session description in the strip rather than behind a disclosure', () => {
    const markup = renderSession()

    expect(markup).toContain('class="session-description"')
    expect(markup).not.toContain('id="session-details"')
  })
})

/**
 * The sections a host declares (#252). A product with no agent behind it takes
 * properties and changes and leaves chat out; the section and the session
 * button go with it.
 */
describe('a host that asks for some of the sections', () => {
  it('draws only what was asked for', () => {
    const markup = renderSession({}, { sections: ['properties', 'changes'] })

    expect(markup).toContain('stack-section-properties')
    expect(markup).toContain('stack-section-changes')
    expect(markup).not.toContain('stack-section-chat')
  })

  it('takes the session button out with the chat section', () => {
    // There is nobody to hand control back to in a product that declined chat,
    // so a button offering to would be lying about what it does.
    const markup = renderSession({}, { sections: ['properties', 'changes'] })

    expect(markup).not.toContain('>Return to agent</button>')
    expect(markup).not.toContain('class="composer"')
  })

  it('gives a single section no handle to resize it against', () => {
    const markup = renderSession({}, { sections: ['changes'] })

    expect(markup).toContain('stack-section-changes')
    expect(markup).not.toContain('class="section-splitter"')
  })

  it('draws all three when the host says nothing', () => {
    const markup = renderSession()

    for (const id of ['properties', 'changes', 'chat']) {
      expect(markup).toContain(`stack-section-${id}`)
    }
  })
})

/**
 * A saved layout silently re-pins every relayout, so when one is actually in
 * force for the active view the canvas says so and offers the way out (#273).
 * "In force" means the view's sidecar names at least one subject the view
 * draws - a stale sidecar naming only undrawn subjects is inert and earns no
 * pill.
 */
describe('saved layout indicator (#273)', () => {
  const viewFilter = {
    query: {},
    matchedIds: ['app.checkout'],
    excluded: [],
    source: 'view' as const,
  }

  it('shows the pill, with a discard affordance, when the sidecar pins a drawn subject', () => {
    const markup = renderSession({
      model: {
        ...renderedModel,
        layouts: { v1: { 'app.checkout': { x: 10, y: 20 } } },
      },
      activeView: 'v1',
      activeFilter: viewFilter,
    })

    expect(markup).toContain('class="saved-layout-pill" role="status"')
    expect(markup).toContain('Saved layout in force')
    expect(markup).toContain('>Discard</button>')
  })

  it('shows nothing when the view has no sidecar', () => {
    const markup = renderSession({
      model: renderedModel,
      activeView: 'v1',
      activeFilter: viewFilter,
    })

    expect(markup).not.toContain('saved-layout-pill')
    expect(markup).not.toContain('Saved layout in force')
  })

  it('shows nothing when the sidecar names only subjects the view does not draw', () => {
    // The stale-sidecar case: `app.ledger` has a position but the view draws
    // only `app.checkout`, so the entry is inert and no layout is in force.
    const markup = renderSession({
      model: {
        ...renderedModel,
        layouts: { v1: { 'app.ledger': { x: 10, y: 20 } } },
      },
      activeView: 'v1',
      activeFilter: viewFilter,
    })

    expect(markup).not.toContain('saved-layout-pill')
  })
})

describe('open questions section (#292)', () => {
  const overlay = {
    catalogue: 'core-enrichment@1.1',
    semantics: '1',
    workspace: [
      {
        questionId: 'outcome-missing',
        question: 'What outcome justifies this system?',
        authority: 'human' as const,
      },
    ],
    subjects: {
      'app.checkout': [
        {
          questionId: 'component-realizes-nothing',
          question: 'What does Checkout realize?',
          authority: 'either' as const,
        },
      ],
    },
  }

  it('draws the section, with the workspace questions, when the model carries the overlay', () => {
    const markup = renderSession({
      model: { ...renderedModel, interrogation: overlay },
    })
    expect(markup).toContain('Open questions')
    expect(markup).toContain('What outcome justifies this system?')
    expect(markup).toContain('1 open')
  })

  it('draws no section at all when the host shipped no overlay', () => {
    // Absence-safe by contract: an older or embedded host that computes no
    // overlay must see the canvas it always saw, not a section of zeros.
    const markup = renderSession({ model: renderedModel })
    expect(markup).not.toContain('Open questions')
  })
})
