# Visual Workspace Layout and Subject Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the visual-conversation page into a diagram-first workspace with a collapsible, resizable conversation panel and browser-local element or relationship context that can be attached to ordinary chat questions.

**Architecture:** Add one pure `workspace-state.ts` deep module for conversation layout, selected-subject normalization, and contextual-question formatting. Keep transport and protocol state in the existing `state.ts`/`session-client.tsx` seam; refactor `App.tsx` into three private presentation surfaces that consume both states without adding a wire event. LikeC4 public click callbacks supply local selection records, and the existing `ask(text)` path remains the only chat submission path.

**Tech Stack:** TypeScript 7, React 19, LikeC4 1.59.2, Vite 8, Vitest 4, CSS Grid, Pointer Events, ResizeObserver.

## Global Constraints

- Preserve all nine `yarramate/visual-*` v1 schemas, the existing browser/agent session protocol, recovery behavior, and journal semantics unchanged.
- Do not add a runtime or development dependency.
- Selection is browser-local: a click alone must not call `ask`, write a frame, or add a journal record.
- Context enters the agent boundary only when the reviewer submits; the transcript must display the exact contextual text passed to `ask(text)`.
- Element identity precedence is `modelRef`, then `deploymentRef`, then rendered node ID.
- One rendered edge may aggregate multiple model relationships; expose the count without inventing a canonical relationship ID.
- Flatten LikeC4 `MarkdownOrString` descriptions to plain text and render them through React text nodes. Never inject HTML.
- Description copy is three lines by default with real **Show more** and **Show less** controls when truncation is possible.
- The desktop conversation width defaults to `clamp(320px, 28vw, 480px)` and resizes between a 320px minimum and the design's `min(45vw, 640px)` maximum.
- Below 900px, use a non-modal bottom sheet and remove the desktop resize separator.
- Empty sessions start with conversation mode `auto` and visually collapsed. A direct subject click or explicit toggle opens it.
- A manual close survives background chat, choices, and diagnostics; these increment an unread count instead of reopening the panel.
- Active-model replacement clears selection. Session close preserves the selected subject for local inspection while disabling submission.
- Do not persist workspace state in `localStorage`; it belongs to the ephemeral browser session.
- Keep LikeC4 navigation, pan, zoom, fit-view, notes, reduced-motion behavior, last-good rendering, and CSP nonce behavior intact.

---

## File Structure

- Create `src/visual-app/workspace-state.ts`: pure workspace reducer, width bounds, selected-subject types and normalization, description flattening, contextual-question formatting.
- Create `test/visual-workspace-state.test.ts`: contract tests for panel transitions, clamping, identity precedence, relationship aggregation/fallbacks, description flattening, model replacement, and exact contextual text.
- Modify `src/visual-app/App.tsx`: replace the header/rail/three-column composition with `CommandStrip`, `DiagramWorkspace`, and `ConversationPanel`; wire pointer/keyboard resize and LikeC4 selection callbacks.
- Modify `src/visual-app/styles.css`: full-height diagram-first grid, compact command strip, resizable desktop panel, selected-subject inspector/chip, and sub-900px bottom sheet.
- Modify `test/fixtures/visual/model.json`: add representative long element and relationship descriptions to the existing valid layouted fixture so real browser verification exercises expansion for both subject kinds.
- No schema, protocol, adapter, package export, self-model, or user-facing CLI document changes are required: this feature changes only the private browser presentation and browser-local state.

---

### Task 1: Browser-Local Workspace State

**Files:**
- Create: `src/visual-app/workspace-state.ts`
- Create: `test/visual-workspace-state.test.ts`

**Interfaces:**
- Consumes: `flattenMarkdownOrString(value: MarkdownOrString | null | undefined): string` from `@likec4/core/types`.
- Produces: `VisualWorkspaceState`, `VisualWorkspaceAction`, `SelectedDiagramSubject`, `SelectedElement`, `SelectedRelationship`, `createVisualWorkspaceState(viewportWidth: number): VisualWorkspaceState`, `visualWorkspaceReducer(state, action): VisualWorkspaceState`, `conversationWidthBounds(viewportWidth: number): { min: number; max: number }`, `normalizeSelectedElement(node: DiagramElementInput): SelectedElement`, `normalizeSelectedRelationship(edge: DiagramRelationshipInput, nodeTitles: ReadonlyMap<string, string>): SelectedRelationship`, `visualDescriptionText(value): string | null`, and `formatContextualQuestion(question, subject): string`.
- Invariant for later tasks: `conversation.mode === 'open'` is the only state that renders the panel; `auto` and `closed` are visually collapsed.

- [ ] **Step 1: Write failing tests for workspace transitions and width limits**

Create `test/visual-workspace-state.test.ts` with the reducer cases below. Keep every subject value explicit so a later type/property rename fails at compile time.

```ts
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

  it('tracks the viewport width even when the clamped panel width is unchanged', () => {
    const initial = createVisualWorkspaceState(1568)
    expect(initial.viewportWidth).toBe(1568)

    const wider = visualWorkspaceReducer(initial, {
      type: 'viewport.resized',
      viewportWidth: 1600,
    })
    expect(wider.conversation.width).toBe(initial.conversation.width)
    expect(wider.viewportWidth).toBe(1600)
  })
})
```

- [ ] **Step 2: Write failing tests for node/edge normalization and contextual text**

Append these cases to the same test file:

```ts
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
```

- [ ] **Step 3: Run the state test to verify RED**

Run:

```bash
pnpm exec vitest run test/visual-workspace-state.test.ts
```

Expected: FAIL because `src/visual-app/workspace-state.ts` does not exist.

- [ ] **Step 4: Implement selected-subject types and normalization**

Create `src/visual-app/workspace-state.ts`. Use these public shapes so LikeC4 callback objects are structurally assignable without coupling the module to renderer internals:

```ts
import {
  flattenMarkdownOrString,
  type MarkdownOrString,
} from '@likec4/core/types'

export type ConversationMode = 'auto' | 'open' | 'closed'

export interface DiagramElementInput {
  readonly id: string
  readonly modelRef?: string | null
  readonly deploymentRef?: string | null
  readonly title: string
  readonly kind?: string | null
  readonly description?: MarkdownOrString | null
  readonly technology?: string | null
  readonly tags?: readonly string[] | null
  readonly navigateTo?: string | null
  readonly metadata?: Readonly<Record<string, unknown>> | null
}

export interface DiagramRelationshipInput {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly label?: string | null
  readonly description?: MarkdownOrString | null
  readonly kind?: string | null
  readonly technology?: string | null
  readonly notation?: string | null
  readonly relations?: readonly string[] | null
}

export interface SelectedElement {
  readonly type: 'element'
  readonly id: string
  readonly modelRef: string | null
  readonly deploymentRef: string | null
  readonly identity: string
  readonly title: string
  readonly kind: string | null
  readonly description: string | null
  readonly technology: string | null
  readonly tags: readonly string[]
  readonly navigateTo: string | null
  readonly metadata: Readonly<Record<string, unknown>> | null
}

export interface SelectedRelationship {
  readonly type: 'relationship'
  readonly id: string
  readonly sourceId: string
  readonly sourceTitle: string
  readonly targetId: string
  readonly targetTitle: string
  readonly label: string | null
  readonly description: string | null
  readonly kind: string | null
  readonly technology: string | null
  readonly notation: string | null
  readonly relationshipIds: readonly string[]
  readonly aggregateCount: number
}

export type SelectedDiagramSubject = SelectedElement | SelectedRelationship

const optionalText = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}

export const visualDescriptionText = (
  value: MarkdownOrString | null | undefined,
): string | null => optionalText(flattenMarkdownOrString(value))

export const normalizeSelectedElement = (
  node: DiagramElementInput,
): SelectedElement => {
  const modelRef = optionalText(node.modelRef)
  const deploymentRef = optionalText(node.deploymentRef)
  return {
    type: 'element',
    id: String(node.id),
    modelRef,
    deploymentRef,
    identity: modelRef ?? deploymentRef ?? String(node.id),
    title: node.title,
    kind: optionalText(node.kind),
    description: visualDescriptionText(node.description),
    technology: optionalText(node.technology),
    tags: node.tags?.map(String) ?? [],
    navigateTo: optionalText(node.navigateTo),
    metadata: node.metadata ?? null,
  }
}

export const normalizeSelectedRelationship = (
  edge: DiagramRelationshipInput,
  nodeTitles: ReadonlyMap<string, string>,
): SelectedRelationship => {
  const sourceId = String(edge.source)
  const targetId = String(edge.target)
  const relationshipIds = edge.relations?.map(String) ?? []
  return {
    type: 'relationship',
    id: String(edge.id),
    sourceId,
    sourceTitle: nodeTitles.get(sourceId) ?? sourceId,
    targetId,
    targetTitle: nodeTitles.get(targetId) ?? targetId,
    label: optionalText(edge.label),
    description: visualDescriptionText(edge.description),
    kind: optionalText(edge.kind),
    technology: optionalText(edge.technology),
    notation: optionalText(edge.notation),
    relationshipIds,
    aggregateCount: relationshipIds.length,
  }
}
```

- [ ] **Step 5: Implement panel state, clamping, and contextual formatting**

Continue the same module with the exact actions below. Keep model replacement independent of panel visibility: clearing a stale subject must not unexpectedly close a conversation the reviewer opened.

```ts
export const CONVERSATION_MIN_WIDTH = 320
export const CONVERSATION_MAX_WIDTH = 640
/** The share of the viewport the approved design lets the conversation take. */
const CONVERSATION_MAX_VIEWPORT_SHARE = 0.45

export interface VisualWorkspaceState {
  readonly conversation: {
    readonly mode: ConversationMode
    readonly width: number
    readonly unread: number
  }
  /**
   * The viewport this state was last clamped against. Presentation reads its
   * resize bounds from here rather than from `window`, so every viewport change
   * reaches the separator's reported minimum and maximum.
   */
  readonly viewportWidth: number
  readonly selectedSubject: SelectedDiagramSubject | null
  readonly descriptionExpanded: boolean
  readonly detailsOpen: boolean
}

export type VisualWorkspaceAction =
  | { readonly type: 'conversation.toggled' }
  | { readonly type: 'conversation.resized'; readonly width: number }
  | { readonly type: 'viewport.resized'; readonly viewportWidth: number }
  | { readonly type: 'attention.received' }
  | { readonly type: 'subject.selected'; readonly subject: SelectedDiagramSubject }
  | { readonly type: 'subject.cleared' }
  | { readonly type: 'description.toggled' }
  | { readonly type: 'details.toggled' }
  | { readonly type: 'model.replaced' }

// `min(45vw, 640px)`, never below the 320px floor the panel is usable at.
export const conversationWidthBounds = (viewportWidth: number) => ({
  min: CONVERSATION_MIN_WIDTH,
  max: Math.max(
    CONVERSATION_MIN_WIDTH,
    Math.min(
      CONVERSATION_MAX_WIDTH,
      viewportWidth * CONVERSATION_MAX_VIEWPORT_SHARE,
    ),
  ),
})

const clampConversationWidth = (width: number, viewportWidth: number) => {
  const { min, max } = conversationWidthBounds(viewportWidth)
  return Math.min(max, Math.max(min, width))
}

// Initial width follows `clamp(320px, 28vw, 480px)` per the approved design;
// only a manual drag may widen the panel up to CONVERSATION_MAX_WIDTH (640).
const CONVERSATION_DEFAULT_MAX_WIDTH = 480

const clampInitialConversationWidth = (
  width: number,
  viewportWidth: number,
) => {
  const { min, max } = conversationWidthBounds(viewportWidth)
  return Math.min(Math.min(max, CONVERSATION_DEFAULT_MAX_WIDTH), Math.max(min, width))
}

export const createVisualWorkspaceState = (
  viewportWidth: number,
): VisualWorkspaceState => ({
  conversation: {
    mode: 'auto',
    width: clampInitialConversationWidth(viewportWidth * 0.28, viewportWidth),
    unread: 0,
  },
  viewportWidth,
  selectedSubject: null,
  descriptionExpanded: false,
  detailsOpen: false,
})

export const visualWorkspaceReducer = (
  state: VisualWorkspaceState,
  action: VisualWorkspaceAction,
): VisualWorkspaceState => {
  switch (action.type) {
    case 'conversation.toggled': {
      const mode = state.conversation.mode === 'open' ? 'closed' : 'open'
      return {
        ...state,
        conversation: {
          ...state.conversation,
          mode,
          unread: mode === 'open' ? 0 : state.conversation.unread,
        },
      }
    }
    case 'conversation.resized': {
      const width = clampConversationWidth(action.width, state.viewportWidth)
      return width === state.conversation.width
        ? state
        : { ...state, conversation: { ...state.conversation, width } }
    }
    case 'viewport.resized': {
      const width = clampConversationWidth(
        state.conversation.width,
        action.viewportWidth,
      )
      return width === state.conversation.width &&
        action.viewportWidth === state.viewportWidth
        ? state
        : {
            ...state,
            conversation: { ...state.conversation, width },
            viewportWidth: action.viewportWidth,
          }
    }
    case 'attention.received':
      if (state.conversation.mode === 'open') return state
      if (state.conversation.mode === 'auto') {
        return {
          ...state,
          conversation: { ...state.conversation, mode: 'open', unread: 0 },
        }
      }
      return {
        ...state,
        conversation: {
          ...state.conversation,
          unread: state.conversation.unread + 1,
        },
      }
    case 'subject.selected':
      return {
        ...state,
        conversation: { ...state.conversation, mode: 'open', unread: 0 },
        selectedSubject: action.subject,
        descriptionExpanded: false,
      }
    case 'subject.cleared':
      return state.selectedSubject === null
        ? state
        : { ...state, selectedSubject: null, descriptionExpanded: false }
    case 'description.toggled':
      return state.selectedSubject === null
        ? state
        : { ...state, descriptionExpanded: !state.descriptionExpanded }
    case 'details.toggled':
      return { ...state, detailsOpen: !state.detailsOpen }
    case 'model.replaced':
      return state.selectedSubject === null
        ? state
        : { ...state, selectedSubject: null, descriptionExpanded: false }
  }
}

export const formatContextualQuestion = (
  question: string,
  subject: SelectedDiagramSubject | null,
): string => {
  const text = question.trim()
  if (subject === null) return text
  if (subject.type === 'element') {
    return `About element “${subject.title}” (${subject.identity}): ${text}`
  }
  const route = `${subject.sourceTitle} → ${subject.targetTitle}`
  const name = subject.label === null ? route : `${route} — ${subject.label}`
  const aggregate =
    subject.aggregateCount > 1
      ? ` (${subject.aggregateCount} model relationships)`
      : ''
  return `About relationship “${name}”${aggregate}: ${text}`
}
```

- [ ] **Step 6: Run the focused state test to verify GREEN**

Run:

```bash
pnpm exec vitest run test/visual-workspace-state.test.ts
```

Expected: PASS with every transition, normalization, and exact-text assertion green.

- [ ] **Step 7: Run the visual TypeScript build**

Run:

```bash
pnpm build:visual
```

Expected: Vite build succeeds; TypeScript accepts the new browser-private module.

- [ ] **Step 8: Commit the state deep module**

```bash
git add src/visual-app/workspace-state.ts test/visual-workspace-state.test.ts
git commit -m "feat: add visual workspace state"
```

---

### Task 2: Diagram-First Workspace and Resizable Conversation

**Files:**
- Modify: `src/visual-app/App.tsx:1-368`
- Modify: `src/visual-app/styles.css:1-595`

**Interfaces:**
- Consumes: `createVisualWorkspaceState`, `visualWorkspaceReducer`, and `conversationWidthBounds` from Task 1; existing `useVisualSession(): { state, connected, ask, choose, navigate, end }` remains unchanged.
- Produces: private `CommandStrip`, `DiagramWorkspace`, `ConversationPanel`, and `ConversationSeparator` presentation functions in `App.tsx`.
- Invariant for Task 3: `DiagramWorkspace` owns all LikeC4 callbacks; `ConversationPanel` owns transcript, diagnostics, choices, and composer; neither owns transport state.

- [ ] **Step 1: Capture the current layout as the visual RED case**

Build the feature worktree and generate the request without committing an absolute path:

```bash
pnpm build
node --input-type=module -e "import { writeFileSync } from 'node:fs'; import { resolve } from 'node:path'; writeFileSync('/tmp/yarramate-workspace-smoke.json', JSON.stringify({ format: 'yarramate/visual-session-request/v1', authority: 'ad-hoc', title: 'Visual workspace smoke', description: 'Browser verification for the diagram-first workspace.', chatEnabled: true, compiler: { command: resolve('test/fixtures/visual/fake-likec4.mjs'), args: [] }, initialModel: { format: 'yarramate/visual-model/v1', authority: 'ad-hoc', initialView: 'choices', sourceDigests: {}, files: { 'model.likec4': '// workspace smoke\n', 'views.likec4': '// workspace smoke\n' } } }, null, 2))"
```

Start the long-running server with the Hub process manager, never as a blocking shell command:

```json
{
  "op": "start",
  "name": "visual-workspace-smoke",
  "application": "node",
  "args": [
    "dist/adapters/visual/visual-cli.js",
    "start",
    "/tmp/yarramate-workspace-smoke.json"
  ],
  "cwd": ".",
  "ready": {
    "log": "yarramate/visual-session-started/v1",
    "timeout": 30
  }
}
```

Read the started JSON with Hub logs, open its one-time `browserUrl` with the Browser tool at 1568×924, and record the RED observations: large descriptive header still consumes vertical space; fixed fact rail still consumes 56px; conversation cannot collapse or resize; canvas does not reclaim that space. Stop `visual-workspace-smoke` through Hub before editing.

- [ ] **Step 2: Refactor `App.tsx` into the three approved presentation surfaces**

Update React imports to add value imports `useEffect` and `useReducer`, plus type imports `CSSProperties` and `PointerEvent as ReactPointerEvent`. Task 3 will add `useLayoutEffect` when the description disclosure needs it. Import the Task 1 reducer functions. Remove `Rail` and the old page-header/view-tab composition.

Use this command-strip interface and markup; keep `connectionOf` and `visualAuthorityLabel` as the existing sources of truth:

```tsx
const CommandStrip = ({
  state,
  connection,
  views,
  detailsOpen,
  conversationOpen,
  unread,
  onNavigate,
  onToggleDetails,
  onToggleConversation,
  onEnd,
}: {
  readonly state: VisualAppState
  readonly connection: string
  readonly views: readonly string[]
  readonly detailsOpen: boolean
  readonly conversationOpen: boolean
  readonly unread: number
  readonly onNavigate: (viewId: string) => void
  readonly onToggleDetails: () => void
  readonly onToggleConversation: () => void
  readonly onEnd: () => void
}) => (
  <header className="command-strip">
    <div className="command-identity">
      <h1>{state.title === '' ? 'Opening the session' : state.title}</h1>
      <span className={`authority authority-${state.authority}`}>
        {visualAuthorityLabel(state.authority)}
      </span>
      <span className="connection-state" role="status">{connection}</span>
    </div>
    <div className="command-actions">
      <label className="offscreen" htmlFor="active-view">Active view</label>
      <select
        id="active-view"
        value={state.activeView}
        onChange={(event) => onNavigate(event.target.value)}
        disabled={views.length < 2}
      >
        {views.map((viewId) => (
          <option key={viewId} value={viewId}>{viewId}</option>
        ))}
      </select>
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-controls="session-details"
        onClick={onToggleDetails}
      >
        Details
      </button>
      <button
        type="button"
        aria-expanded={conversationOpen}
        aria-controls="conversation-panel"
        onClick={onToggleConversation}
      >
        Conversation
        {unread === 0 ? null : <span className="attention-count">{unread}</span>}
      </button>
      <button
        type="button"
        className="end-session"
        onClick={onEnd}
        disabled={state.lifecycle !== 'active'}
      >
        End
      </button>
    </div>
    {/* Static prose is not worth the canvas: the disclosure is laid over the
        workspace from the strip rather than taking a row of its own, so opening
        it never reflows the diagram or the conversation. */}
    <div
      id="session-details"
      className="session-details"
      hidden={!detailsOpen}
    >
      <p>{state.description}</p>
      <button type="button" className="details-close" onClick={onToggleDetails}>
        Close details
      </button>
    </div>
  </header>
)
```

Rename `ChatPanel` to `ConversationPanel`, add a required `hidden: boolean` prop, and render `<section id="conversation-panel" className="talk" aria-label="Conversation" hidden={hidden}>`. Wrap the existing transcript `<ol>`, `Faults`, and conditional `Choices` in one `<div className="conversation-scroll">`; keep the composer form as its sibling. Preserve the existing transcript mapping, composer submission, Enter/Shift+Enter behavior, agent status, and disabled logic unchanged in this task. Keeping the panel mounted while hidden preserves an unsent draft across collapse.

Move the current LikeC4 provider, renderer, waiting copy, and renderer-fault banner into `DiagramWorkspace`. Preserve every existing renderer prop except set `enableElementDetails={false}` and `enableRelationshipDetails={false}` so the custom inspector added in Task 3 is the only details surface. Keep `enableNotes`, `showNavigationButtons`, `styleNonce`, and `reduceGraphics` unchanged.

- [ ] **Step 3: Wire reducer lifecycle, background attention, and responsive reclamping**

In `App`, initialize workspace state once from the browser width and re-clamp it on viewport changes:

```tsx
const [workspace, dispatchWorkspace] = useReducer(
  visualWorkspaceReducer,
  window.innerWidth,
  createVisualWorkspaceState,
)

useEffect(() => {
  const resized = () =>
    dispatchWorkspace({
      type: 'viewport.resized',
      viewportWidth: window.innerWidth,
    })
  window.addEventListener('resize', resized)
  return () => window.removeEventListener('resize', resized)
}, [])
```

Track only newly arrived transcript records, choices, and non-empty diagnostic sets. This effect opens mode `auto`, but the reducer converts activity in mode `closed` into unread attention:

```tsx
const attention = useRef({
  transcriptLength: state.transcript.length,
  choices: state.choices,
  diagnostics: state.diagnostics,
})

useEffect(() => {
  const previous = attention.current
  let receivedTranscript = false
  for (
    let index = previous.transcriptLength;
    index < state.transcript.length;
    index += 1
  ) {
    if (state.transcript[index]?.speaker === 'agent') {
      receivedTranscript = true
      break
    }
  }
  const received =
    receivedTranscript ||
    (state.choices !== null && state.choices !== previous.choices) ||
    (state.diagnostics.length > 0 &&
      state.diagnostics !== previous.diagnostics)
  attention.current = {
    transcriptLength: state.transcript.length,
    choices: state.choices,
    diagnostics: state.diagnostics,
  }
  if (received) dispatchWorkspace({ type: 'attention.received' })
}, [state.transcript.length, state.choices, state.diagnostics])
```

Do not dispatch for agent status, socket lifecycle, view navigation, local choice submission, or local chat submission.

- [ ] **Step 4: Implement the pointer and keyboard separator**

Add a private `ConversationSeparator`. Track the pointer-down coordinate and starting panel width so grabbing any point inside the 10px handle does not introduce an offset. Pointer capture guarantees release even if the pointer leaves the handle. ArrowLeft expands, ArrowRight contracts, and Shift changes the step from 8px to 32px.

```tsx
const ConversationSeparator = ({
  width,
  viewportWidth,
  onResize,
}: {
  readonly width: number
  readonly viewportWidth: number
  readonly onResize: (width: number) => void
}) => {
  // From the state the reducer clamped against, never from `window`: a resize
  // that leaves the panel width alone still changes what this may be dragged
  // to, and a render that read the live global would only say so by accident.
  const bounds = conversationWidthBounds(viewportWidth)
  const drag = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startWidth: number
  } | null>(null)
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId !== event.pointerId) return
    onResize(active.startWidth + active.startX - event.clientX)
  }
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 8
    onResize(width + (event.key === 'ArrowLeft' ? step : -step))
  }
  return (
    <div
      className="conversation-separator"
      role="separator"
      aria-label="Resize conversation"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
    />
  )
}
```

Render the shell with an explicit open/closed grid class. Keep the conversation mounted but hidden while collapsed so the draft and `aria-controls` target survive:

```tsx
const conversationOpen = workspace.conversation.mode === 'open'
const shellStyle = {
  '--conversation-width': `${workspace.conversation.width}px`,
} as CSSProperties

return (
  <main className="visual-shell" style={shellStyle}>
    <CommandStrip
      state={state}
      connection={connectionOf(state, connected)}
      views={state.model?.views ?? []}
      detailsOpen={workspace.detailsOpen}
      conversationOpen={conversationOpen}
      unread={workspace.conversation.unread}
      onNavigate={navigate}
      onToggleDetails={() => dispatchWorkspace({ type: 'details.toggled' })}
      onToggleConversation={() =>
        dispatchWorkspace({ type: 'conversation.toggled' })
      }
      onEnd={end}
    />
    <div
      className={`workspace workspace-conversation-${
        conversationOpen ? 'open' : 'closed'
      }`}
    >
      <DiagramWorkspace
        state={state}
        drawing={drawing}
        waiting={waiting}
        reduceGraphics={reduceGraphics}
        onNavigate={navigate}
      />
      {conversationOpen ? (
        <ConversationSeparator
          width={workspace.conversation.width}
          viewportWidth={workspace.viewportWidth}
          onResize={(width) =>
            dispatchWorkspace({ type: 'conversation.resized', width })
          }
        />
      ) : null}
      <ConversationPanel
        state={state}
        hidden={!conversationOpen}
        disabled={!state.composerEnabled}
        onSend={ask}
        onChoice={choose}
      />
    </div>
  </main>
)
```

- [ ] **Step 5: Replace the page layout CSS without restyling the application**

Keep the existing font imports, color tokens, reset, button/input typography, transcript bubbles, choices, diagnostics, reduced-motion rule, and `@font-face` declarations. Replace `.desk`, `.plan`, `.rail`, `.talk`, `.canvas`, `.views`, and their old desktop/mobile layout rules with the following structural rules; delete every now-unused rail and view-tab selector.

```css
.visual-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  height: 100dvh;
  overflow: hidden;
  background: var(--paper);
  color: var(--ink);
}

.command-strip {
  position: relative;
  z-index: 10;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: calc(var(--step) * 2);
  min-height: 48px;
  padding: calc(var(--step) * 0.75) calc(var(--step) * 2);
  border-bottom: 1px solid var(--rule);
  background: var(--sheet);
}

.command-identity,
.command-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--step);
}

.command-identity h1 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-family: var(--display);
  font-size: 15px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-actions select,
.command-actions button {
  min-height: 32px;
  padding: 0 0.7rem;
  font-family: var(--utility);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule-firm);
  border-radius: 0;
  cursor: pointer;
}

.command-actions select {
  /* The native arrow is the one piece of OS chrome worth keeping: it is the
     only affordance saying this control has a list behind it. */
  padding-right: 0.35rem;
}

.command-actions select:hover:enabled,
.command-actions button:hover:enabled {
  border-color: var(--cobalt);
}

.command-actions select:disabled,
.command-actions button:disabled {
  color: var(--quiet);
  background: transparent;
  border-color: var(--rule);
  cursor: not-allowed;
}

.command-actions button[aria-expanded='true'] {
  color: var(--paper);
  background: var(--cobalt);
  border-color: var(--cobalt);
}

.command-actions .end-session:hover:enabled {
  color: var(--paper);
  background: var(--failure);
  border-color: var(--failure);
}

.connection-state {
  flex: none;
  font-family: var(--utility);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--quiet);
}

/* Laid over the workspace, never in it: static prose must not cost the diagram
   a single pixel of height, so the disclosure hangs off the strip instead of
   taking a row in the shell grid. */
.session-details {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  display: flex;
  align-items: flex-start;
  gap: calc(var(--step) * 2);
  padding: var(--step) calc(var(--step) * 2) calc(var(--step) * 1.5);
  border-bottom: 1px solid var(--rule);
  background: var(--sheet);
  box-shadow: 0 12px 28px rgb(19 35 57 / 12%);
}

.session-details[hidden] {
  display: none;
}

.session-details p {
  max-width: 90ch;
  margin: 0;
  color: var(--quiet);
}

.details-close {
  flex: none;
  margin-left: auto;
  min-height: 28px;
  padding: 0 0.6rem;
  font-family: var(--utility);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule-firm);
  border-radius: 0;
  cursor: pointer;
}

.details-close:hover {
  border-color: var(--cobalt);
}

.attention-count {
  min-width: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--cobalt);
  color: white;
  font-size: 11px;
  text-align: center;
}

.workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-conversation-open {
  grid-template-columns: minmax(0, 1fr) auto var(--conversation-width);
}

.workspace-conversation-closed {
  grid-template-columns: minmax(0, 1fr);
}

.diagram-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
}

.canvas,
.diagram {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.conversation-separator {
  position: relative;
  z-index: 3;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
}

.conversation-separator::before {
  position: absolute;
  inset: 0 auto 0 4px;
  width: 1px;
  background: var(--rule);
  content: '';
}

.conversation-separator:hover::before,
.conversation-separator:focus-visible::before {
  width: 2px;
  background: var(--cobalt);
}

.talk {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--rule);
  background: var(--sheet);
}

.talk[hidden] {
  display: none;
}

.conversation-scroll {
  min-height: 0;
  overflow: auto;
}

.ledger {
  min-height: 0;
  overflow: visible;
}

@media (max-width: 899px) {
  .command-strip {
    grid-template-columns: 1fr;
    gap: calc(var(--step) * 0.5);
    padding-inline: var(--step);
  }

  .command-identity,
  .command-actions {
    gap: calc(var(--step) * 0.5);
  }

  .command-actions {
    overflow-x: auto;
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    min-height: 0;
  }

  .conversation-separator {
    display: none;
  }

  .talk {
    max-height: 56dvh;
    border-top: 1px solid var(--rule);
    border-left: 0;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -12px 36px rgb(19 35 57 / 14%);
  }
}
```

The explicit closed class removes the panel column entirely, while the HTML `hidden` attribute keeps the panel subtree and unsent draft mounted without exposing it visually or to assistive technology.

- [ ] **Step 6: Verify the layout in a real browser**

Rebuild, start the request from Step 1, and drive the page with the Browser tool at 1568×924:

1. Confirm the compact command strip contains title, authority, connection, active-view selector, Details, Conversation, and End.
2. Confirm no large title/description header or vertical fact rail remains.
3. Confirm the diagram fills the viewport outside the open conversation.
4. Collapse Conversation and confirm the canvas consumes the reclaimed width.
5. Reopen it; pointer-drag the separator beyond both limits and confirm it settles within 320px and `min(45vw, 640px)`.
6. Focus the separator; verify ArrowLeft/ArrowRight move 8px and Shift+Arrow moves 32px within bounds.
7. Close the panel, create background choice/diagnostic activity through the running visual session, and confirm an attention count appears without reopening the panel.
8. Toggle Details and confirm the description is laid over the workspace, that the diagram and conversation keep the exact heights they had before the toggle, and that its labelled **Close details** action shuts it.

Resize the same browser to 390×844 and confirm the open conversation is a bottom sheet, the separator is absent, the canvas remains the primary row, controls remain reachable, and `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

Expected: all observations pass; Browser console contains no errors; Network contains no non-loopback requests.

- [ ] **Step 7: Run focused regressions**

Run:

```bash
pnpm exec vitest run test/visual-workspace-state.test.ts test/visual-app-state.test.ts
pnpm build:visual
```

Expected: both test files pass and the visual app builds.

- [ ] **Step 8: Commit the workspace layout**

```bash
git add src/visual-app/App.tsx src/visual-app/styles.css
git commit -m "feat: make visual sessions diagram first"
```

---

### Task 3: Element and Relationship Contextual Questions

**Files:**
- Modify: `src/visual-app/App.tsx`
- Modify: `src/visual-app/styles.css`
- Modify: `test/fixtures/visual/model.json`

**Interfaces:**
- Consumes: Task 1 normalization and formatting functions; Task 2 `DiagramWorkspace` and `ConversationPanel` ownership seams; LikeC4 `onNodeClick(node, event)`, `onEdgeClick(edge, event)`, and `onNavigateTo(viewId, event, node)` callbacks.
- Produces: private `SelectedSubjectInspector` and `ExpandableDescription` functions; selected-subject composer chip; exact contextual text through the unchanged `ask(text)` callback.
- Preserves: selected subject across view navigation and `state.lifecycle === 'closed'`; clears it when `state.model?.candidate` changes.

- [ ] **Step 1: Extend the proven fixture with descriptions for browser verification**

In `test/fixtures/visual/model.json`:

- Set the existing `streaming` element description and all three rendered `streaming` node descriptions to `{ "txt": "This option delivers each committed change as an event and applies it as it arrives. The path favors fast feedback over batch coordination. Operators can replay the event stream after an interruption. Literal safety probe: <img src=x onerror=window.visualSubjectPwned=true>." }`. At a 320px panel width this must exceed three inspector lines.
- Add `{ "txt": "The review compares an event-driven delivery path with the current decision context. This relationship exists only in the temporary explanatory model." }` as `description` on model relation `5l0pi9` and on both rendered edge objects with ID `18l3bv3`.
- Do not change coordinates, IDs, view membership, or relation arrays.
Use JSON `txt`, not HTML or Markdown rendering metadata. Run the existing compiler fixture test to ensure LikeC4 still accepts the export:

```bash
pnpm exec vitest run test/visual-likec4-compiler.test.ts
```

Expected: PASS; the layouted fixture remains a valid compiled model.

- [ ] **Step 2: Wire LikeC4 clicks into browser-local selection**

Import the value functions `formatContextualQuestion`, `normalizeSelectedElement`, and `normalizeSelectedRelationship`, plus `type SelectedDiagramSubject`, from `workspace-state.ts`.

Inside `DiagramWorkspace`, build the title lookup once for the active rendered view:

```tsx
const activeRenderedView = useMemo(
  () => drawing.drawn?.findView(state.activeView)?.$layouted ?? null,
  [drawing.drawn, state.activeView],
)
const nodeTitles = useMemo(
  () =>
    new Map(
      (activeRenderedView?.nodes ?? []).map(
        (node) => [String(node.id), node.title] as const,
      ),
    ),
  [activeRenderedView],
)
```

This uses LikeC4's public `findView(viewId).$layouted` rendering model and never parses `state.model.compiled`. Add a required `onSelect(subject: SelectedDiagramSubject): void` prop to `DiagramWorkspace`, then wire public callbacks:

```tsx
<ReactLikeC4
  viewId={state.activeView}
  onNodeClick={(node) => onSelect(normalizeSelectedElement(node))}
  onEdgeClick={(edge) =>
    onSelect(normalizeSelectedRelationship(edge, nodeTitles))
  }
  // LikeC4 1.59.2 never passes the originating node — it emits `navigateTo`
  // with `viewId` alone — so this branch is dead against the pinned renderer
  // and retention comes from the reducer keeping the prior selection.
  onNavigateTo={(viewId, _event, node) => {
    if (node !== undefined) onSelect(normalizeSelectedElement(node))
    onNavigate(viewId)
  }}
  enableElementDetails={false}
  enableRelationshipDetails={false}
/>
```

Keep every other renderer prop from Task 2 unchanged. In `App`, implement `onSelect` only as:

```tsx
(subject) => dispatchWorkspace({ type: 'subject.selected', subject })
```

No handler may call `ask`, `choose`, `navigate` except the explicit `onNavigateTo` branch above, or a session-client method.

Track promoted model identity separately and clear stale selection only when `candidate` changes:

```tsx
const activeCandidate = useRef(state.model?.candidate ?? null)
useEffect(() => {
  const candidate = state.model?.candidate ?? null
  if (candidate !== activeCandidate.current) {
    activeCandidate.current = candidate
    dispatchWorkspace({ type: 'model.replaced' })
  }
}, [state.model?.candidate])
```

Do not dispatch on view changes or lifecycle changes.

- [ ] **Step 3: Add an accessible progressively disclosed description**

Add `useLayoutEffect` to React imports. Implement `ExpandableDescription` with actual overflow measurement; a character-count heuristic is not acceptable because panel width and font metrics vary.

```tsx
const ExpandableDescription = ({
  text,
  expanded,
  onToggle,
}: {
  readonly text: string | null
  readonly expanded: boolean
  readonly onToggle: () => void
}) => {
  const description =
    text ?? 'No description declared in this model'
  const body = useRef<HTMLParagraphElement>(null)
  const [canExpand, setCanExpand] = useState(false)

  useLayoutEffect(() => {
    const element = body.current
    if (element === null || expanded) return
    const measure = () =>
      setCanExpand(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [description, expanded])

  return (
    <div className="subject-description">
      <p
        ref={body}
        className={expanded ? 'description-expanded' : 'description-clamped'}
      >
        {description}
      </p>
      {canExpand || expanded ? (
        <button type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}
```

When `description` changes, the reducer has already reset `expanded` to false; ResizeObserver re-measures after panel resize. Missing descriptions remain explicit and do not offer a disclosure button.

- [ ] **Step 4: Render element and relationship inspector content**

Add `SelectedSubjectInspector` above the transcript inside `ConversationPanel`. Its root is a labelled region with a real heading and clear action. Render all optional fields only when non-null/non-empty.

```tsx
const SelectedSubjectInspector = ({
  subject,
  expanded,
  onToggleDescription,
  onClear,
  onNavigate,
}: {
  readonly subject: SelectedDiagramSubject
  readonly expanded: boolean
  readonly onToggleDescription: () => void
  readonly onClear: () => void
  readonly onNavigate: (viewId: string) => void
}) => (
  <section className="subject-inspector" aria-labelledby="subject-heading">
    <div className="subject-heading-row">
      <div>
        <p className="subject-type">
          {subject.type === 'element' ? 'Selected element' : 'Selected relationship'}
        </p>
        <h2 id="subject-heading">
          {subject.type === 'element'
            ? subject.title
            : `${subject.sourceTitle} → ${subject.targetTitle}`}
        </h2>
      </div>
      <button type="button" className="subject-clear" onClick={onClear}>
        Clear
      </button>
    </div>

    {subject.type === 'element' ? (
      <dl className="subject-facts">
        <div><dt>Identity</dt><dd><code>{subject.identity}</code></dd></div>
        {subject.kind === null ? null : <div><dt>Kind</dt><dd>{subject.kind}</dd></div>}
        {subject.technology === null ? null : <div><dt>Technology</dt><dd>{subject.technology}</dd></div>}
        {subject.tags.length === 0 ? null : <div><dt>Tags</dt><dd>{subject.tags.join(', ')}</dd></div>}
      </dl>
    ) : (
      <dl className="subject-facts">
        <div><dt>Label</dt><dd>{subject.label ?? 'Unlabelled relationship'}</dd></div>
        {subject.kind === null ? null : <div><dt>Kind</dt><dd>{subject.kind}</dd></div>}
        {subject.technology === null ? null : <div><dt>Technology</dt><dd>{subject.technology}</dd></div>}
        {subject.notation === null ? null : <div><dt>Notation</dt><dd>{subject.notation}</dd></div>}
        <div>
          <dt>Model relations</dt>
          <dd>{subject.aggregateCount}</dd>
        </div>
      </dl>
    )}

    <ExpandableDescription
      text={subject.description}
      expanded={expanded}
      onToggle={onToggleDescription}
    />

    {subject.type === 'element' && subject.navigateTo !== null ? (
      <button
        type="button"
        className="subject-navigate"
        onClick={() => {
          if (
            subject.type === 'element' &&
            subject.navigateTo !== null
          ) {
            onNavigate(subject.navigateTo)
          }
        }}
      >
        Open related view
      </button>
    ) : null}
  </section>
)
```


- [ ] **Step 5: Add the removable composer chip and contextual submit path**

Extend `ConversationPanel` props with `selectedSubject`, `descriptionExpanded`, `onToggleDescription`, `onClearSubject`, and `onNavigate`. Render the inspector as the first child of the existing `.conversation-scroll`, immediately before `<ol className="ledger">`.

Inside the existing `<form className="composer">`, render this chip before the textarea:

```tsx
{selectedSubject === null ? null : (
  <div className="subject-chip">
    <span>
      {selectedSubject.type === 'element'
        ? selectedSubject.title
        : `${selectedSubject.sourceTitle} → ${selectedSubject.targetTitle}`}
    </span>
    <button
      type="button"
      aria-label="Remove selected diagram context"
      onClick={onClearSubject}
    >
      Remove
    </button>
  </div>
)}
```

Set placeholder copy from the subject kind while preserving the existing read-only copy:

```tsx
placeholder={
  !state.chatEnabled
    ? 'This session is read-only'
    : selectedSubject?.type === 'element'
      ? 'Ask about this element'
      : selectedSubject?.type === 'relationship'
        ? 'Ask about this relationship'
        : 'Ask about this design'
}
```

Keep `ConversationPanel` responsible only for trimming the reviewer draft. At the `App` callsite, format immediately before the unchanged seam:

```tsx
onSend={(text) => ask(formatContextualQuestion(text, workspace.selectedSubject))}
```

The existing `chat.sent` reducer records the same string `ask` sends, so the visible reviewer transcript becomes the audit of contextual text without a new event or state field.

- [ ] **Step 6: Style the inspector and allow one panel scroll hierarchy**

Keep `.talk` as the two-row `minmax(0, 1fr) auto` grid from Task 2. The inspector, transcript, diagnostics, and choices all live in `.conversation-scroll`, so expanded descriptions and long conversations share one vertical scrollbar while the composer stays reachable; do not restore overflow on `.ledger` or create nested horizontal scrolling.

Add these styles using existing color/type tokens:

```css
.subject-inspector {
  padding: calc(var(--step) * 1.5);
  border-bottom: 1px solid var(--rule);
  background: color-mix(in srgb, var(--sheet) 92%, var(--cobalt) 8%);
}

.subject-heading-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--step);
}

.subject-type {
  margin: 0 0 calc(var(--step) * 0.25);
  color: var(--quiet);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.subject-heading-row h2 {
  margin: 0;
  font-family: var(--display);
  font-size: 16px;
  line-height: 1.25;
}

.subject-facts {
  display: grid;
  gap: calc(var(--step) * 0.5);
  margin: var(--step) 0;
}

.subject-facts > div {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr);
  gap: var(--step);
}

.subject-facts dt {
  color: var(--quiet);
  font-size: 11px;
}

.subject-facts dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.subject-description p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.description-clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.subject-description button,
.subject-navigate,
.subject-clear {
  margin-top: calc(var(--step) * 0.5);
  min-height: 28px;
}

.subject-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--step);
  margin-bottom: calc(var(--step) * 0.75);
  padding: calc(var(--step) * 0.5) calc(var(--step) * 0.75);
  border: 1px solid var(--cobalt);
  border-radius: 999px;
  color: var(--cobalt);
}

.subject-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-chip button {
  flex: none;
  min-height: 24px;
  padding: 0 calc(var(--step) * 0.5);
  border: 0;
  background: transparent;
  color: inherit;
}
```

On mobile, keep the inspector inside the same non-modal bottom sheet. Do not add `position: fixed`, a backdrop, `role="dialog"`, or focus trapping.

- [ ] **Step 7: Run focused automated checks**

Run:

```bash
pnpm exec vitest run test/visual-workspace-state.test.ts test/visual-app-state.test.ts test/visual-likec4-compiler.test.ts
pnpm build:visual
```

Expected: all tests pass; TypeScript accepts `DiagramNode` and `DiagramEdge` callback payloads as the structural normalization inputs; the visual app build succeeds.

- [ ] **Step 8: Exercise the full selection journey in a real browser**

Start a fresh chat-enabled session with the Task 2 request and drive it at 1568×924:

1. Click an element. Confirm the panel opens without focus theft and shows title, stable identity, kind/technology/tags when present, and its description.
2. Use **Show more** and **Show less** on the long element description.
3. Remove the composer chip. Confirm the inspector clears and the unsent draft remains unchanged.
4. Click a relationship. Confirm endpoints, label, description, optional metadata, and model-relation count.
5. Type `Why is this path preferred?`, submit once, and confirm the reviewer transcript is exactly `About relationship “Delivery design review → Option 1 - Event-driven delivery — compares”: Why is this path preferred?` for the one-relation fixture.
6. Read the session journal before and after clicking a non-navigating element or relationship without submission; confirm the record count is unchanged.
7. Submit a second contextual question, then follow `skills/yarramate-architecture/references/visual-conversations.md` with the running session descriptor: poll the accepted `chat.message` event and answer that same `eventId` with a valid `model.replace` response. Confirm the promoted replacement clears the subject and chip while leaving the panel open.
8. Navigate through a node with `navigateTo`; confirm selection survives and identifies the originating node.
9. Select a subject again and End the session. Confirm the closed session retains the inspector and diagram, while textarea and Send remain disabled.

Repeat at 390×844. Confirm the same inspector/chip behavior inside the bottom sheet, **Show more** does not create horizontal overflow, controls remain keyboard reachable, and focus is not trapped.

Check Browser console and network after both dimensions:

- zero console errors;
- zero non-loopback requests;
- no DOM element created from description markup;
- `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

- [ ] **Step 9: Remove superseded presentation artifacts**

After the browser smoke is green, search `src/visual-app/App.tsx` and `src/visual-app/styles.css` for the exact obsolete symbols/selectors below:

```text
Rail
ChatPanel
className=\"desk\"
className=\"plan\"
className=\"rail\"
className=\"views\"
.desk
.plan
.rail
.views
```

Delete any remaining declarations or rules owned by the replaced header/rail/view-tab layout. Search `src/visual-app` for `dangerouslySetInnerHTML`; expected result is empty. Do not remove current transcript, choice, diagnostic, renderer-fault, reduced-motion, or font rules. Confirm the smoke request and any model-replacement helper remain under `/tmp`, not the worktree.

- [ ] **Step 10: Run final repository verification once**

Run the project-wide checks only after the browser journey passes:

```bash
pnpm build
pnpm test
pnpm self:check
pnpm validate
```

Expected: build succeeds; the full Vitest suite passes; self-model check returns `ok`; package validation succeeds. Existing nine visual protocol/schema tests remain unchanged and green.

- [ ] **Step 11: Commit the contextual-selection feature**

```bash
git add src/visual-app/App.tsx src/visual-app/styles.css test/fixtures/visual/model.json
git commit -m "feat: add visual subject context"
```
