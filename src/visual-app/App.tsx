import { LikeC4Model, type AnyLikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, ReactLikeC4 } from 'likec4/react'
import {
  useEffect,
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
  visualWorkspaceReducer,
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
      <span className="connection-state">{connection}</span>
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
    <div
      id="session-details"
      className="session-details"
      hidden={!detailsOpen}
    >
      <p>{state.description}</p>
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
}: {
  readonly state: VisualAppState
  readonly drawing: VisualDrawing<AnyLikeC4Model>
  readonly waiting: string | null
  readonly reduceGraphics: boolean
  readonly onNavigate: (viewId: string) => void
}) => (
  <section className="diagram-workspace" aria-label="Architecture diagram">
    <div className="canvas">
      {drawing.drawn === null ? null : (
        <LikeC4ModelProvider likec4model={drawing.drawn}>
          <ReactLikeC4
            viewId={state.activeView}
            onNavigateTo={(viewId) => onNavigate(viewId)}
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

const ConversationPanel = ({
  state,
  hidden,
  disabled,
  onSend,
  onChoice,
}: {
  readonly state: VisualAppState
  readonly hidden: boolean
  readonly disabled: boolean
  readonly onSend: (text: string) => void
  readonly onChoice: (optionId: string) => void
}) => {
  const [draft, setDraft] = useState('')

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
            state.chatEnabled
              ? 'Ask about this design'
              : 'This session is read-only'
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-foot">
          <p className="agent-status">
            {state.agentStatus === null
              ? '\u00a0'
              : (STATUS_WORDS[state.agentStatus.state] ?? '\u00a0')}
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
  onResize,
}: {
  readonly width: number
  readonly onResize: (width: number, viewportWidth: number) => void
}) => {
  const bounds = conversationWidthBounds(window.innerWidth)
  const drag = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startWidth: number
  } | null>(null)
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointerId !== event.pointerId) return
    onResize(
      active.startWidth + active.startX - event.clientX,
      window.innerWidth,
    )
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
    onResize(
      width + (event.key === 'ArrowLeft' ? step : -step),
      window.innerWidth,
    )
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
        />
        {conversationOpen ? (
          <ConversationSeparator
            width={workspace.conversation.width}
            onResize={(width, viewportWidth) =>
              dispatchWorkspace({
                type: 'conversation.resized',
                width,
                viewportWidth,
              })
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
}
