import { LikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, ReactLikeC4 } from 'likec4/react'
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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

/**
 * The review desk: the diagram the reviewer is judging, the rail that carries
 * the four facts they have to trust, and the conversation they answer in.
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
const likeC4ModelFrom = (compiled: unknown) =>
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

const Rail = ({
  authority,
  connection,
  view,
  onEnd,
  endEnabled,
}: {
  readonly authority: 'canonical' | 'ad-hoc'
  readonly connection: string
  readonly view: string
  readonly onEnd: () => void
  readonly endEnabled: boolean
}) => (
  <div className={`rail rail-${authority}`}>
    <p className="station station-authority">
      <span className="tick" />
      <span className="value">
        {authority === 'canonical' ? 'Checked' : 'Ad hoc'}
      </span>
    </p>
    <p
      className={`station station-link link-${connection.toLowerCase()}`}
      role="status"
    >
      <span className="tick" />
      <span className="value">{connection}</span>
    </p>
    <p className="station station-view">
      <span className="tick" />
      <span className="value">{view === '' ? 'No view' : view}</span>
    </p>
    <button
      type="button"
      className="end"
      onClick={onEnd}
      disabled={!endEnabled}
      aria-label="End the review and return control to the main agent"
    >
      End
    </button>
  </div>
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

const ChatPanel = ({
  state,
  disabled,
  onSend,
  onChoice,
}: {
  readonly state: VisualAppState
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
    <section className="talk" aria-label="Conversation">
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

export const App = () => {
  const { state, connected, ask, choose, navigate, end } = useVisualSession()
  const lastGood = useRef<ReturnType<typeof likeC4ModelFrom> | null>(null)

  const likec4model = useMemo(() => {
    if (state.model === null) return lastGood.current
    try {
      lastGood.current = likeC4ModelFrom(state.model.compiled)
    } catch {
      // A rendering the browser cannot read is the same failure as one that did
      // not compile: keep the last good drawing on screen.
      return lastGood.current
    }
    return lastGood.current
  }, [state.model])

  const reduceGraphics = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const authorityLabel = visualAuthorityLabel(state.authority)
  const views = state.model?.views ?? []

  return (
    <main className="desk">
      <section className="plan" aria-label="Architecture diagram">
        <header>
          <p className={`authority authority-${state.authority}`}>
            {authorityLabel}
          </p>
          <h1>{state.title === '' ? 'Opening the session' : state.title}</h1>
          <p className="lede">{state.description}</p>
        </header>

        <div className="canvas">
          {likec4model === null ? (
            <p className="waiting">
              {state.lifecycle === 'connecting'
                ? 'Reading the session'
                : 'No model to draw'}
            </p>
          ) : (
            <LikeC4ModelProvider likec4model={likec4model}>
              <ReactLikeC4
                viewId={state.activeView}
                onNavigateTo={(viewId) => navigate(viewId)}
                injectFontCss={false}
                colorScheme="light"
                background="dots"
                controls
                pannable
                zoomable
                fitView
                keepAspectRatio={false}
                enableElementDetails
                enableRelationshipDetails
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
        </div>

        {views.length < 2 ? null : (
          <nav className="views" aria-label="Views in this model">
            <ul>
              {views.map((viewId) => (
                <li key={viewId}>
                  <button
                    type="button"
                    onClick={() => navigate(viewId)}
                    aria-current={viewId === state.activeView ? 'true' : undefined}
                  >
                    {viewId}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      <Rail
        authority={state.authority}
        connection={connectionOf(state, connected)}
        view={state.activeView}
        onEnd={end}
        endEnabled={state.lifecycle === 'active'}
      />

      <ChatPanel
        state={state}
        disabled={!state.composerEnabled}
        onSend={ask}
        onChoice={choose}
      />
    </main>
  )
}
