import { LikeC4Model, type AnyLikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, ReactLikeC4 } from 'likec4/react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  VisualChoicePresentPayload,
  VisualDiagnostic,
} from '../adapters/visual/protocol-contract.js'
import { useVisualSession } from './session-client.js'
import {
  visualAuthorityLabel,
  visualDrawingFor,
  type VisualAppRecord,
  type VisualAppState,
  type VisualDrawing,
} from './state.js'
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  visualWorkspaceReducer,
  type SelectedDiagramSubject,
} from './workspace-state.js'

/**
 * A drawing board, not a document: the diagram holds the workspace, one compact
 * strip carries the facts and the controls above it, and the conversation is a
 * panel the reviewer sizes or puts away without losing what it holds.
 */

/**
 * The rendered model as LikeC4's own object graph.
 *
 * `@likec4/core/model` is the module `likec4/react` imports for the same class,
 * so the provider and this factory share one instance of it. `likec4/model`'s
 * `createLikeC4Model` is this exact call — `LikeC4Model.create` — behind an
 * entry point that takes `createRequire` at load and so cannot run in a
 * browser. The compiled document belongs to LikeC4, which reads its own shape.
 */
const likeC4ModelFrom = (compiled: unknown): AnyLikeC4Model =>
  LikeC4Model.create(compiled as Parameters<typeof LikeC4Model.create>[0])

const SPEAKERS: Readonly<Record<VisualAppRecord['speaker'], string>> = {
  reviewer: 'You',
  agent: 'Agent',
  session: 'Session',
}

const STATUS_WORDS: Readonly<
  Record<'thinking' | 'compiling' | 'waiting' | 'idle', string>
> = {
  thinking: 'Agent is thinking',
  compiling: 'Agent is compiling the model',
  waiting: 'Agent is waiting',
  idle: 'Agent is idle',
}

const connectionOf = (state: VisualAppState, connected: boolean): string => {
  switch (state.lifecycle) {
    case 'connecting':
      return 'Opening'
    case 'active':
      return connected ? 'Live' : 'Reconnecting'
    case 'ending':
      return 'Ending'
    case 'disconnected':
      return 'Reconnecting'
    case 'closed':
      return 'Closed'
  }
}

const endTransitionStatus = (state: VisualAppState): string => {
  if (state.lifecycle === 'closed') {
    return 'Visual conversation ended. Continue in the main agent.'
  }
  if (state.lifecycle !== 'ending') return ''
  if (state.handoff !== null) {
    return 'Handoff ready — returning control to the main agent.'
  }
  return 'Ending conversation — preparing a handoff for the main agent.'
}

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
      <span className="beta-badge">Beta</span>
      <span className={`authority authority-${state.authority}`}>
        {visualAuthorityLabel(state.authority)}
      </span>
      <span className="connection-state" role="status">{connection}</span>
    </div>
    <div className="command-actions">
      <span
        className="end-transition-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {endTransitionStatus(state)}
      </span>
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
        {state.lifecycle === 'ending' || state.lifecycle === 'closed'
          ? 'Ending…'
          : 'End'}
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

const Faults = ({
  diagnostics,
}: {
  readonly diagnostics: readonly VisualDiagnostic[]
}) =>
  diagnostics.length === 0 ? null : (
    <div className="faults" role="alert">
      <p className="faults-title">
        The last change did not compile. The diagram still shows the model that
        did.
      </p>
      <ul>
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.code}-${diagnostic.pointer}`}>
            <span className="code">{diagnostic.code}</span> {diagnostic.message}
            <span className="where">
              {diagnostic.path}:{diagnostic.line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

const Choices = ({
  choices,
  disabled,
  onChoice,
}: {
  readonly choices: VisualChoicePresentPayload
  readonly disabled: boolean
  readonly onChoice: (optionId: string) => void
}) => (
  <div className="choices">
    <p className="question">{choices.question}</p>
    <ul>
      {choices.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            onClick={() => onChoice(option.id)}
            disabled={disabled}
          >
            <span className="label">{option.label}</span>
            {option.description === undefined ? null : (
              <span className="detail">{option.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  </div>
)

const DiagramWorkspace = ({
  state,
  drawing,
  waiting,
  reduceGraphics,
  onNavigate,
  onSelect,
}: {
  readonly state: VisualAppState
  readonly drawing: VisualDrawing<AnyLikeC4Model>
  readonly waiting: string | null
  readonly reduceGraphics: boolean
  readonly onNavigate: (viewId: string) => void
  readonly onSelect: (subject: SelectedDiagramSubject) => void
}) => {
  // An edge names its endpoints by node id; the reviewer reads titles. The
  // rendering model the renderer itself draws answers that, so nothing here
  // reaches into the compiled document.
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
  const canvas = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = canvas.current?.querySelector<HTMLElement>(
      '[data-likec4-instance]',
    )
    const sheet = host?.shadowRoot?.adoptedStyleSheets[0]
    if (
      sheet === undefined ||
      [...sheet.cssRules].some((rule) =>
        rule.cssText.includes('--yarramate-focus-ring'),
      )
    ) {
      return
    }
    sheet.insertRule(
      ':focus-visible { outline: var(--yarramate-focus-ring, 3px solid #2457a6) !important; outline-offset: 3px !important; }',
      sheet.cssRules.length,
    )
  }, [drawing.drawn, state.activeView])

  return (
    <section className="diagram-workspace" aria-label="Architecture diagram">
      <div className="canvas" ref={canvas}>
        {drawing.drawn === null ? null : (
          <LikeC4ModelProvider likec4model={drawing.drawn}>
            <ReactLikeC4
              viewId={state.activeView}
              onNodeClick={(node) => onSelect(normalizeSelectedElement(node))}
              onEdgeClick={(edge) =>
                onSelect(normalizeSelectedRelationship(edge, nodeTitles))
              }
              // LikeC4 1.59.2 declares the originating node optional and never
              // passes it: the runtime emits `navigateTo` with `viewId` alone,
              // so this branch is dead against the pinned renderer and the
              // subject the reviewer clicked is what the reducer keeps across
              // the navigation. The branch stays because the declared contract
              // allows the node, but a renderer bump that starts passing it
              // changes the behaviour from "keep the prior selection" to
              // "select the navigated node" — a visible change, not a silent
              // one, and this is where it lands.
              onNavigateTo={(viewId, _event, node) => {
                if (node !== undefined) onSelect(normalizeSelectedElement(node))
                onNavigate(viewId)
              }}
              injectFontCss={false}
              colorScheme="light"
              background="dots"
              controls
              pannable
              zoomable
              fitView
              keepAspectRatio={false}
              // The custom inspector is the only details surface, so the
              // renderer's own overlays stay shut.
              enableElementDetails={false}
              enableRelationshipDetails={false}
              enableNotes
              enableSearch={false}
              // The renderer injects its own stylesheets; this session's
              // policy admits them under this nonce and nothing else.
              styleNonce={state.styleNonce}
              showNavigationButtons
              reduceGraphics={reduceGraphics ? true : 'auto'}
              className="diagram"
            />
          </LikeC4ModelProvider>
        )}
        {waiting === null ? null : <p className="waiting">{waiting}</p>}
      </div>

      {drawing.fault === null ? null : (
        // The renderer's exception describes its own internals and may carry
        // anything: the reviewer reads this application's words instead.
        <div className="faults" role="alert">
          <p className="faults-title">{drawing.fault}</p>
        </div>
      )}
    </section>
  )
}

/**
 * A description is worth reading in full and worth not burying the rest of the
 * panel under. Three lines are the default; the disclosure appears only when
 * the browser actually clipped something, measured rather than guessed, because
 * panel width and font metrics both move.
 */
const ExpandableDescription = ({
  text,
  expanded,
  onToggle,
}: {
  readonly text: string | null
  readonly expanded: boolean
  readonly onToggle: () => void
}) => {
  const description = text ?? 'No description declared in this model'
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

/**
 * What the reviewer clicked, said back to them in the model's own words: the
 * facts the diagram cannot fit, and nothing the renderer would have to be
 * trusted to render.
 */
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
          {subject.type === 'element'
            ? 'Selected element'
            : 'Selected relationship'}
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
        <div>
          <dt>Identity</dt>
          <dd>
            <code>{subject.identity}</code>
          </dd>
        </div>
        {subject.kind === null ? null : (
          <div>
            <dt>Kind</dt>
            <dd>{subject.kind}</dd>
          </div>
        )}
        {subject.technology === null ? null : (
          <div>
            <dt>Technology</dt>
            <dd>{subject.technology}</dd>
          </div>
        )}
        {subject.tags.length === 0 ? null : (
          <div>
            <dt>Tags</dt>
            <dd>{subject.tags.join(', ')}</dd>
          </div>
        )}
      </dl>
    ) : (
      <dl className="subject-facts">
        <div>
          <dt>Label</dt>
          <dd>{subject.label ?? 'Unlabelled relationship'}</dd>
        </div>
        {subject.kind === null ? null : (
          <div>
            <dt>Kind</dt>
            <dd>{subject.kind}</dd>
          </div>
        )}
        {subject.technology === null ? null : (
          <div>
            <dt>Technology</dt>
            <dd>{subject.technology}</dd>
          </div>
        )}
        {subject.notation === null ? null : (
          <div>
            <dt>Notation</dt>
            <dd>{subject.notation}</dd>
          </div>
        )}
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
          if (subject.type === 'element' && subject.navigateTo !== null) {
            onNavigate(subject.navigateTo)
          }
        }}
      >
        Open related view
      </button>
    ) : null}
  </section>
)

const ConversationPanel = ({
  state,
  hidden,
  disabled,
  selectedSubject,
  descriptionExpanded,
  onSend,
  onChoice,
  onToggleDescription,
  onClearSubject,
  onNavigate,
}: {
  readonly state: VisualAppState
  readonly hidden: boolean
  readonly disabled: boolean
  readonly selectedSubject: SelectedDiagramSubject | null
  readonly descriptionExpanded: boolean
  readonly onSend: (text: string) => void
  readonly onChoice: (optionId: string) => void
  readonly onToggleDescription: () => void
  readonly onClearSubject: () => void
  readonly onNavigate: (viewId: string) => void
}) => {
  const [draft, setDraft] = useState('')
  const agentWaiting =
    state.lifecycle === 'active' && state.awaitingAgent
  const visibleAgentStatus =
    state.lifecycle === 'active' ? state.agentStatus : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (text === '' || disabled) return
    onSend(text)
    setDraft('')
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <section
      id="conversation-panel"
      className="talk"
      aria-label="Conversation"
      hidden={hidden}
    >
      <div className="conversation-scroll">
        {selectedSubject === null ? null : (
          <SelectedSubjectInspector
            subject={selectedSubject}
            expanded={descriptionExpanded}
            onToggleDescription={onToggleDescription}
            onClear={onClearSubject}
            onNavigate={onNavigate}
          />
        )}

        <ol className="ledger" role="log" aria-live="polite">
          {state.transcript.length === 0 ? (
            <li className="empty">
              <p>Nothing asked yet. Question anything on the diagram.</p>
            </li>
          ) : (
            state.transcript.map((record) => (
              <li key={record.id} className={`said said-${record.speaker}`}>
                <p className="who">{SPEAKERS[record.speaker]}</p>
                <p className="words">{record.text}</p>
              </li>
            ))
          )}
        </ol>

        <Faults diagnostics={state.diagnostics} />

        {state.choices === null ? null : (
          <Choices
            choices={state.choices}
            disabled={disabled}
            onChoice={onChoice}
          />
        )}
      </div>

      <form className="composer" onSubmit={submit}>
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
        <label className="offscreen" htmlFor="composer-text">
          Ask about this design
        </label>
        <textarea
          id="composer-text"
          name="question"
          rows={3}
          value={draft}
          disabled={disabled}
          placeholder={
            !state.chatEnabled
              ? 'This session is read-only'
              : selectedSubject?.type === 'element'
                ? 'Ask about this element'
                : selectedSubject?.type === 'relationship'
                  ? 'Ask about this relationship'
                  : 'Ask about this design'
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-foot">
          <p
            className="agent-status"
            role="status"
            aria-live="polite"
            aria-busy={agentWaiting}
          >
            {agentWaiting ? (
              <span className="agent-spinner" aria-hidden="true" />
            ) : null}
            <span>
              {visibleAgentStatus === null
                ? agentWaiting
                  ? 'Awaiting agent response'
                  : '\u00a0'
                : (STATUS_WORDS[visibleAgentStatus.state] ?? '\u00a0')}
            </span>
          </p>
          <button type="submit" disabled={disabled || draft.trim() === ''}>
            Send
          </button>
        </div>
      </form>
    </section>
  )
}

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

export const App = () => {
  const { state, connected, ask, choose, navigate, end } = useVisualSession()
  const lastDrawn = useRef<AnyLikeC4Model | null>(null)

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

  // Only what arrived from the agent counts as attention: everything the
  // reviewer did themselves is already in front of them.
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

  const drawing = useMemo(() => {
    const next = visualDrawingFor(
      state.model,
      likeC4ModelFrom,
      lastDrawn.current,
    )
    lastDrawn.current = next.drawn
    return next
  }, [state.model])

  const reduceGraphics = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Promotion replaces the model the reviewer was pointing at, so a subject
  // held from the old one no longer describes anything. Views and lifecycle
  // change under the same model and must leave the selection alone.
  const activeCandidate = useRef(state.model?.candidate ?? null)
  useEffect(() => {
    const candidate = state.model?.candidate ?? null
    if (candidate !== activeCandidate.current) {
      activeCandidate.current = candidate
      dispatchWorkspace({ type: 'model.replaced' })
    }
  }, [state.model?.candidate])

  // A fault already accounts for the empty canvas, and saying there is no model
  // would contradict the one that arrived and could not be drawn.
  const waiting =
    drawing.drawn !== null || drawing.fault !== null
      ? null
      : state.lifecycle === 'connecting'
        ? 'Reading the session'
        : 'No model to draw'

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
          onSelect={(subject) =>
            dispatchWorkspace({ type: 'subject.selected', subject })
          }
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
          selectedSubject={workspace.selectedSubject}
          descriptionExpanded={workspace.descriptionExpanded}
          onSend={(text) =>
            ask(formatContextualQuestion(text, workspace.selectedSubject))
          }
          onChoice={choose}
          onToggleDescription={() =>
            dispatchWorkspace({ type: 'description.toggled' })
          }
          onClearSubject={() => dispatchWorkspace({ type: 'subject.cleared' })}
          onNavigate={navigate}
        />
      </div>
    </main>
  )
}
