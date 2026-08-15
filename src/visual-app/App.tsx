import { GraphCanvas } from './graph-canvas.js'
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
  type VisualAppRecord,
  type VisualAppState,
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
  detailsOpen,
  conversationOpen,
  unread,
  onToggleDetails,
  onToggleConversation,
  onEnd,
}: {
  readonly state: VisualAppState
  readonly connection: string
  readonly detailsOpen: boolean
  readonly conversationOpen: boolean
  readonly unread: number
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
  selectedId,
  waiting,
  onSelect,
}: {
  readonly state: VisualAppState
  readonly selectedId: string | null
  readonly waiting: string | null
  readonly onSelect: (subject: SelectedDiagramSubject) => void
}) => {
  // An edge names its endpoints by node id; the reviewer reads titles. The
  // rendering model the renderer itself draws answers that, so nothing here
  // reaches into the compiled document.
  const nodeTitles = useMemo(
    () =>
      new Map(
        (state.model?.graph.nodes ?? []).map(
          (node) => [node.id, node.name] as const,
        ),
      ),
    [state.model],
  )

  return (
    <section className="diagram-workspace" aria-label="Architecture diagram">
      <div className="canvas">
        {state.model === null ? null : (
          <GraphCanvas
            graph={state.model.graph}
            selectedId={selectedId}
            onSelect={(id, type) => {
              const graph = state.model!.graph
              if (type === 'node') {
                const node = graph.nodes.find((n) => n.id === id)
                if (node !== undefined) onSelect(normalizeSelectedElement(node))
              } else {
                const edge = graph.edges.find((e) => e.id === id)
                if (edge !== undefined)
                  onSelect(normalizeSelectedRelationship(edge, nodeTitles))
              }
            }}
            matchedIds={state.activeFilter?.matchedIds ?? null}
            quickFilterText={state.quickFilterText}
          />
        )}
        {waiting === null ? null : <p className="waiting">{waiting}</p>}
      </div>
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
}: {
  readonly subject: SelectedDiagramSubject
  readonly expanded: boolean
  readonly onToggleDescription: () => void
  readonly onClear: () => void
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
            <code>{subject.id}</code>
          </dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{subject.kind}</dd>
        </div>
      </dl>
    ) : (
      <dl className="subject-facts">
        <div>
          <dt>Label</dt>
          <dd>{subject.label ?? 'Unlabelled relationship'}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{subject.kind}</dd>
        </div>
      </dl>
    )}

    <ExpandableDescription
      text={subject.description}
      expanded={expanded}
      onToggle={onToggleDescription}
    />
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
  const { state, connected, ask, choose, end } = useVisualSession()

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

  // Promotion replaces the model the reviewer was pointing at, so a subject
  // held from the old one no longer describes anything. Views and lifecycle
  // change under the same model and must leave the selection alone.
  const activeCandidate = useRef(state.model)
  useEffect(() => {
    if (state.model !== activeCandidate.current) {
      activeCandidate.current = state.model
      dispatchWorkspace({ type: 'model.replaced' })
    }
  }, [state.model])

  // "No model to draw" is only true before anything has arrived; once a
  // model exists there is always something on the canvas to show.
  const waiting =
    state.model !== null
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
        detailsOpen={workspace.detailsOpen}
        conversationOpen={conversationOpen}
        unread={workspace.conversation.unread}
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
          selectedId={workspace.selectedSubject?.id ?? null}
          waiting={waiting}
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
        />
      </div>
    </main>
  )
}
