import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisualAppState } from '../src/visual-app/state.js'
import type { CanvasNode } from '../src/graph-projection.js'
import type { VisualRenderedModel } from '../src/adapters/visual/wire.js'
import type { EditorHost } from '../src/visual-app/editor-host.js'
import type {
  RightSectionId,
  SelectedDiagramSubject,
} from '../src/visual-app/workspace-state.js'

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
  focusReturn: null,
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

// Static markup cannot click, so the workspace the shell opens with is the
// seam: everything real is re-exported, and only the initial state is bent -
// which is exactly what a session that had hidden the column looks like on
// the next render (#294). `selectedSubject` and `panelOpen` bend the same
// seam for the inspector and the query panel (#298), which otherwise only a
// click could reach.
const workspace = vi.hoisted(() => ({
  hidden: false,
  unread: 0,
  selectedSubject: null as SelectedDiagramSubject | null,
  panelOpen: false,
}))

vi.mock('../src/visual-app/workspace-state.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/visual-app/workspace-state.js')>()
  return {
    ...actual,
    createVisualWorkspaceState: (width: number, height?: number) => {
      const state = actual.createVisualWorkspaceState(width, height)
      return {
        ...state,
        selectedSubject: workspace.selectedSubject,
        bottomPanel: workspace.panelOpen
          ? { ...state.bottomPanel, open: true }
          : state.bottomPanel,
        conversation: {
          ...state.conversation,
          hidden: workspace.hidden,
          unread: workspace.unread,
        },
      }
    },
  }
})

import { App } from '../src/visual-app/App.js'
import { KIND_MIME } from '../src/visual-app/kind-palette.js'

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

beforeEach(() => {
  workspace.hidden = false
  workspace.unread = 0
  workspace.selectedSubject = null
  workspace.panelOpen = false
})

const renderSession = (
  overrides: Partial<VisualAppState> = {},
  props: {
    readonly sections?: readonly RightSectionId[]
    readonly readOnly?: boolean
  } = {},
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
  it('draws the sections in the stack order, palette first and chat last', () => {
    const markup = renderSession()

    expect(markup).toContain('class="section-stack"')
    const order = ['palette', 'properties', 'changes', 'chat'].map((id) =>
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

  it('draws every section when the host says nothing', () => {
    const markup = renderSession()

    for (const id of ['palette', 'properties', 'changes', 'chat']) {
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

/**
 * A filter that matches nothing used to leave the canvas silently blank, with
 * every control still describing the whole model (#307). The canvas now says
 * so where the subjects would be, names the narrowing that caused it, and
 * offers the way out: the standing query's Show all when its own match set
 * draws no subject, clearing the quick filter when its text zeroed an
 * otherwise drawn set.
 */
describe('an empty filter result says so on the canvas (#307)', () => {
  it('names the quick-filter text that matched nothing, with the way out', () => {
    const markup = renderSession({
      model: renderedModel,
      quickFilterText: 'zzz',
    })

    expect(markup).toContain('class="filter-empty-pill" role="status"')
    expect(markup).toContain('Nothing matches “zzz”')
    expect(markup).toContain('>Clear filter</button>')
  })

  it('renders no pill while the quick filter still matches subjects', () => {
    const markup = renderSession({
      model: renderedModel,
      quickFilterText: 'checkout',
    })

    expect(markup).not.toContain('filter-empty-pill')
    expect(markup).not.toContain('Nothing matches')
  })

  it('names the standing query when its own match set draws no subject', () => {
    const markup = renderSession({
      model: renderedModel,
      activeFilter: {
        query: { layers: ['technology'] },
        matchedIds: [],
        excluded: [],
        source: 'panel',
      },
    })

    expect(markup).toContain('filter-empty-pill')
    expect(markup).toContain('Nothing matches this filter:')
    expect(markup).toContain('layers: technology')
  })

  it('treats a match set naming only relationships as drawing no subject', () => {
    // The match set is non-empty, but nothing in it is a node: the canvas is
    // exactly as blank as with `matchedIds: []`, and as honest about it.
    const markup = renderSession({
      model: renderedModel,
      activeFilter: {
        query: { layers: ['technology'] },
        matchedIds: ['checkout-serves-ledger'],
        excluded: [],
        source: 'panel',
      },
    })

    expect(markup).toContain('filter-empty-pill')
    expect(markup).toContain('Nothing matches this filter:')
  })

  it('speaks even for a view-sourced filter the top pill stays silent about', () => {
    // The tree names a view, so the top-left filter-pill deliberately does
    // not render for it - which left a view that matches nothing with NO
    // on-screen explanation at all.
    const markup = renderSession({
      model: renderedModel,
      activeFilter: {
        query: { layers: ['technology'] },
        matchedIds: [],
        excluded: [],
        source: 'view',
      },
    })

    expect(markup).not.toContain('class="filter-pill"')
    expect(markup).toContain('filter-empty-pill')
    expect(markup).toContain('>Show all</button>')
  })

  it('attributes emptiness to the standing query, not the quick filter, when both stand', () => {
    // Clearing the quick filter would change nothing here: the match set is
    // already empty, so the pill names the query and offers Show all.
    const markup = renderSession({
      model: renderedModel,
      quickFilterText: 'zzz',
      activeFilter: {
        query: { layers: ['technology'] },
        matchedIds: [],
        excluded: [],
        source: 'panel',
      },
    })

    expect(markup).toContain('Nothing matches this filter:')
    expect(markup).not.toContain('Nothing matches “zzz”')
  })

  it('stays silent over a model with no subjects, where nothing was hidden', () => {
    const markup = renderSession({
      model: { ...renderedModel, graph: { nodes: [], edges: [] } },
      quickFilterText: 'zzz',
    })

    expect(markup).not.toContain('filter-empty-pill')
  })

  it('stays silent with no model at all', () => {
    const markup = renderSession({ quickFilterText: 'zzz' })

    expect(markup).not.toContain('filter-empty-pill')
  })
})

/**
 * On-canvas zoom and fit (#308): the canvas's only zoom affordance was wheel
 * zoom at a tenth sensitivity, so a mouse-only reviewer over a register-scale
 * fit had no discoverable way in. The cluster sits bottom-right - the free
 * corner - and travels with the canvas: any mount that draws the diagram
 * draws it, read-only included, because looking is exactly the work there.
 */
describe('zoom and fit controls (#308)', () => {
  it('draws the cluster, each control named for assistive tech', () => {
    const markup = renderSession({ model: renderedModel })

    expect(markup).toContain('class="zoom-controls"')
    expect(markup).toContain('aria-label="Zoom in"')
    expect(markup).toContain('aria-label="Zoom out"')
    expect(markup).toContain('aria-label="Fit diagram"')
  })

  it('keeps the cluster in a read-only mount', () => {
    const markup = renderSession({ model: renderedModel }, { readOnly: true })

    expect(markup).toContain('class="zoom-controls"')
    expect(markup).toContain('aria-label="Fit diagram"')
  })

  it('draws no cluster while there is no canvas to zoom', () => {
    const markup = renderSession()

    expect(markup).not.toContain('zoom-controls')
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

/**
 * The kind palette (#295): the profile's concept kinds as a section, each row
 * a thing to drag onto the canvas or click, either way opening the Add-subject
 * dialog with the kind preselected. The rows come from the model frame's own
 * `vocabulary.conceptKinds` - the list the dialog's Kind select compiles from -
 * so the palette and the select can never disagree.
 */
describe('kind palette (#295)', () => {
  const kindsModel: VisualRenderedModel = {
    ...renderedModel,
    vocabulary: {
      conceptKinds: [
        {
          id: 'yarramate/core@0.1#applicationComponent',
          label: 'applicationComponent',
          coreLabel: 'applicationComponent',
        },
        {
          id: 'yarramate/core@0.1#businessActor',
          label: 'businessActor',
          coreLabel: 'businessActor',
        },
        {
          id: 'yarramate/core@0.1#goal',
          label: 'goal',
          coreLabel: 'goal',
        },
      ],
      relationshipKinds: [],
    },
  }

  it('lists the vocabulary the model frame carries, and counts it in the header', () => {
    const markup = renderSession({ model: kindsModel })

    expect(markup).toContain('stack-section-palette')
    expect(markup).toContain('>Kind palette</span>')
    expect(markup).toContain('class="section-meta">3 kinds</span>')
    expect(markup).toContain('data-kind="applicationComponent"')
    expect(markup).toContain('data-kind="businessActor"')
    expect(markup).toContain('data-kind="goal"')
  })

  it('makes every row draggable and clickable, never a plain span', () => {
    const markup = renderSession({ model: kindsModel })

    const rows = [...markup.matchAll(/class="kind-palette-row"/g)]
    expect(rows).toHaveLength(3)
    expect(
      [...markup.matchAll(/<button[^>]*class="kind-palette-row"[^>]*>/g)].every(
        (row) => row[0].includes('draggable="true"'),
      ),
    ).toBe(true)
  })

  it('groups the rows into layer bands, in the profile layer order', () => {
    // The same organisation the model tree reads in: motivation before
    // business before application, whatever order the wire listed the kinds.
    const markup = renderSession({ model: kindsModel })

    const bands = ['motivation', 'business', 'application'].map((layer) =>
      markup.indexOf(`</span>${layer}</button>`),
    )
    expect(bands.every((at) => at !== -1)).toBe(true)
    expect(bands).toEqual([...bands].sort((a, b) => a - b))
  })

  it('says the kinds arrive with the model while there is none', () => {
    const markup = renderSession()

    expect(markup).toContain('stack-section-palette')
    expect(markup).toContain('No model yet. The kinds arrive with it.')
  })

  it('renders no palette for a host that did not ask for one', () => {
    // The section vocabulary is the host's opt-in, like every other section.
    const markup = renderSession(
      { model: kindsModel },
      { sections: ['properties', 'changes'] },
    )

    expect(markup).not.toContain('stack-section-palette')
    expect(markup).not.toContain('kind-palette-row')
    // And exactly then the canvas strip keeps its Add-subject button: the
    // fallback authoring entry for a mount with no palette to pick from.
    expect(markup).toContain('>Add subject</button>')
  })

  it('opens every layer band, as a collapsible the keyboard can reach', () => {
    // Collapsed state is per mount and starts open: nothing is hidden until
    // the reviewer hides it. Static markup shows the default; the band
    // header is a real button with aria-expanded, so assistive tech both
    // reaches it and hears its state.
    const markup = renderSession({ model: kindsModel })

    const headers = [
      ...markup.matchAll(/class="kind-palette-layer-name"[^>]*aria-expanded="(\w+)"/g),
    ]
    expect(headers).toHaveLength(3)
    expect(headers.every((header) => header[1] === 'true')).toBe(true)
    expect(markup).toContain('kind-palette-row')
  })

  it('names the drag payload type hosts and tests can rely on', () => {
    // The wire format of the gesture: a canvas accepts exactly this type, so
    // a stray text drop stays inert. Static markup cannot carry the
    // `dataTransfer` call; the constant is the contract.
    expect(KIND_MIME).toBe('application/x-yarramate-kind')
  })
})

/**
 * The right column can leave (#294): a hide control on the column, a thin
 * reopen strip in its place, and the attention a hidden column would have
 * shown carried on the strip.
 */
describe('a hidden right column (#294)', () => {
  it('offers the hide control on the column while it is on screen', () => {
    const markup = renderSession()

    expect(markup).toContain('class="conversation-hide"')
    expect(markup).toContain('aria-label="Hide the session panel"')
    expect(markup).not.toContain('conversation-reopen')
  })

  it('takes the column, its separator and its grid track away when hidden', () => {
    workspace.hidden = true
    const markup = renderSession()

    expect(markup).not.toContain('section-stack')
    expect(markup).not.toContain('stack-section-')
    expect(markup).not.toContain('conversation-separator')
    expect(markup).toContain('--conversation-width:0px')
  })

  it('leaves a reopen strip standing where the column stood', () => {
    workspace.hidden = true
    const markup = renderSession()

    expect(markup).toContain('class="conversation-reopen"')
    expect(markup).toContain('aria-label="Show the session panel"')
  })

  it('carries the unread count on the strip', () => {
    // The presenting moments are exactly when a reply must not be missed:
    // what the chat header would have counted, the strip counts.
    workspace.hidden = true
    workspace.unread = 3
    const markup = renderSession()

    expect(markup).toContain('class="attention-count">3</span>')
    expect(markup).toContain(
      'aria-label="Show the session panel, 3 unread"',
    )
  })

  it('signals a pending agent choice on the strip', () => {
    workspace.hidden = true
    const markup = renderSession({
      choices: {
        choiceId: 'choice-1',
        question: 'Which option?',
        options: [{ id: 'option-a', label: 'Option A' }],
      },
    })

    expect(markup).toContain('class="attention-choice"')
    expect(markup).toContain(
      'aria-label="Show the session panel, the agent is waiting on a choice"',
    )
  })

  it('keeps the dragged width in the shell while shown', () => {
    // The width the strip restores is the one the state still holds: hiding
    // is a mode, not a zero width.
    const markup = renderSession()

    expect(markup).not.toContain('--conversation-width:0px')
    expect(markup).toContain('--conversation-width:')
  })
})

/**
 * A read-only mount (#298, ADR 0117): the same visual language with the pen
 * absent. Everything that reads still renders - the tree, the canvas, the
 * facts, the questions - and every affordance that stages or commits is not
 * drawn at all, never drawn disabled.
 */
describe('a read-only mount (#298)', () => {
  const selected: SelectedDiagramSubject = {
    type: 'element',
    id: 'app.checkout',
    title: 'Checkout',
    kind: 'applicationComponent',
    description: null,
  }

  const activeViewState: Partial<VisualAppState> = {
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
        subjectCount: 2,
      },
    ],
  }

  /** The inspector's own markup: heading row and fields, before the
   * description block that closes it. */
  const inspectorOf = (markup: string): string =>
    markup.slice(
      markup.indexOf('subject-inspector'),
      markup.indexOf('subject-description'),
    )

  it('offers no Add subject button, while the quick filter stays', () => {
    const markup = renderSession({ model: renderedModel }, { readOnly: true })

    expect(markup).not.toContain('>Add subject</button>')
    expect(markup).toContain('class="quick-filter"')
  })

  it('strips the palette and changes sections from whatever the host names', () => {
    const markup = renderSession(
      { model: renderedModel },
      { sections: ['palette', 'properties', 'changes'], readOnly: true },
    )

    expect(markup).not.toContain('stack-section-palette')
    expect(markup).not.toContain('stack-section-changes')
    expect(markup).toContain('stack-section-properties')
  })

  it('renders the facts of a selected subject with nothing editable', () => {
    workspace.selectedSubject = selected
    const markup = renderSession({ model: renderedModel }, { readOnly: true })
    const inspector = inspectorOf(markup)

    expect(markup).toContain('subject-facts')
    expect(markup).toContain('class="subject-fact-value">Checkout</span>')
    expect(inspector).toContain('app.checkout')
    expect(inspector).not.toContain('<input')
    expect(inspector).not.toContain('<select')
  })

  it('keeps Clear on the inspector and drops Connect and Delete', () => {
    workspace.selectedSubject = selected
    const markup = renderSession({ model: renderedModel }, { readOnly: true })
    const inspector = inspectorOf(markup)

    expect(inspector).toContain('>Clear</button>')
    expect(inspector).not.toContain('>Connect</button>')
    expect(inspector).not.toContain('>Delete</button>')
  })

  it('offers no New view affordance in a rail that still reads the views', () => {
    const markup = renderSession(activeViewState, { readOnly: true })

    expect(markup).toContain('aria-label="Views and model"')
    expect(markup).toContain('View One')
    expect(markup).toContain('Checkout')
    expect(markup).toContain('Ledger')
    expect(markup).not.toContain('aria-label="New view"')
  })

  it('shows the view document without the affordance to stage it', () => {
    workspace.panelOpen = true
    const markup = renderSession(activeViewState, { readOnly: true })

    expect(markup).toContain('class="query-document"')
    expect(markup).not.toContain('>Stage view change</button>')
  })

  it('still reads the open questions the model carries', () => {
    const markup = renderSession(
      {
        model: {
          ...renderedModel,
          interrogation: {
            catalogue: 'core-enrichment@1.1',
            semantics: '1',
            workspace: [
              {
                questionId: 'outcome-missing',
                question: 'What outcome justifies this system?',
                authority: 'human' as const,
              },
            ],
            subjects: {},
          },
        },
      },
      { readOnly: true },
    )

    expect(markup).toContain('Open questions')
    expect(markup).toContain('What outcome justifies this system?')
  })

  it('leaves the default mount the authoring surface it was', () => {
    workspace.selectedSubject = selected
    workspace.panelOpen = true
    const markup = renderSession(activeViewState)
    const inspector = inspectorOf(markup)

    // The palette is the authoring entry; the canvas strip's Add-subject
    // button is the fallback for a mount WITHOUT the palette section, so on
    // the default mount it stands down rather than duplicating the entry.
    expect(markup).not.toContain('>Add subject</button>')
    expect(markup).toContain('stack-section-palette')
    expect(markup).toContain('stack-section-changes')
    expect(markup).toContain('aria-label="New view"')
    expect(markup).toContain('>Stage view change</button>')
    expect(inspector).toContain('>Connect</button>')
    expect(inspector).toContain('>Delete</button>')
    expect(inspector).toContain('<select')
  })
})
