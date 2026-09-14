import type {
  VisualInterrogationOverlay,
  VisualQuestionEntry,
} from '../adapters/visual/wire.js'
import { verbFor, type QuestionVerb } from './question-verbs.js'

/**
 * The interview, where the drawing happens (#292).
 *
 * One home for both scopes: a selected element shows the questions that name
 * it — the `design --subject` reading of the model — and no selection shows
 * the workspace-scoped questions, which name no subject and would otherwise
 * be the model's biggest holes rendered nowhere. Read-only by design: the
 * answer path stays `apply` (through the editor's own forms or an agent),
 * never a text box here that would bypass the compile gate.
 */
export function OpenQuestions({
  overlay,
  selectedId,
  readOnly = false,
  onVerb,
  onDelegate,
  delegateLabel,
}: {
  readonly overlay: VisualInterrogationOverlay
  readonly selectedId: string | null
  /** A viewer has no pen (#298): rows read, and offer nothing. */
  readonly readOnly?: boolean
  /**
   * Runs a row's verb (#515): the gesture that would answer it, derived from
   * the trigger. Absent, rows carry no button, which is how a host without
   * the gestures mounts the pane.
   */
  readonly onVerb?: (
    entry: VisualQuestionEntry,
    verb: QuestionVerb,
    subjectId: string | null,
  ) => void
  /**
   * Hands the question to whoever answers questions for this host (#515,
   * ADR 0151): the agent on the socket, the host's own assistant, or the
   * clipboard for an assistant that is elsewhere. The label says which.
   */
  readonly onDelegate?: (
    entry: VisualQuestionEntry,
    subjectId: string | null,
  ) => void
  readonly delegateLabel?: string
}) {
  const entries =
    selectedId === null
      ? overlay.workspace
      : (overlay.subjects[selectedId] ?? [])
  const scopeNote =
    selectedId === null
      ? 'Whole-model questions. Select a subject to see what names it.'
      : null
  // The row the interview would serve first (#534): the overlay names it,
  // the list only marks it, so the pane and the bottom panel cannot disagree.
  const isNext = (entry: VisualQuestionEntry): boolean =>
    overlay.next !== undefined &&
    overlay.next.questionId === entry.questionId &&
    (selectedId === null
      ? overlay.next.subjectId === undefined
      : overlay.next.subjectId === selectedId)
  return (
    <div className="open-questions">
      {scopeNote === null ? null : (
        <p className="open-questions-scope">{scopeNote}</p>
      )}
      {entries.length === 0 ? (
        <p className="section-empty">
          {selectedId === null
            ? 'Nothing open at the whole-model level.'
            : 'No open questions name this subject.'}
        </p>
      ) : (
        <ul className="question-list">
          {entries.map((entry) => (
            <QuestionRow
              key={entry.questionId}
              entry={entry}
              next={isNext(entry)}
              verb={readOnly || onVerb === undefined ? null : verbFor(entry)}
              onVerb={(verb) => onVerb?.(entry, verb, selectedId)}
              delegateLabel={
                readOnly || onDelegate === undefined ? null : (delegateLabel ?? 'Answer via agent')
              }
              onDelegate={() => onDelegate?.(entry, selectedId)}
            />
          ))}
        </ul>
      )}
      <p className="open-questions-catalogue">
        Catalogue {overlay.catalogue} · answers land through the changeset,
        never here.
      </p>
    </div>
  )
}

const QuestionRow = ({
  entry,
  next,
  verb,
  onVerb,
  delegateLabel,
  onDelegate,
}: {
  readonly entry: VisualQuestionEntry
  readonly next: boolean
  readonly verb: QuestionVerb | null
  readonly onVerb: (verb: QuestionVerb) => void
  readonly delegateLabel: string | null
  readonly onDelegate: () => void
}) => (
  <li className={next ? 'question-row question-row-next' : 'question-row'}>
    <span className="question-text" title={entry.materiality}>
      {entry.question}
    </span>
    <span className="question-meta">
      {next ? <span className="question-next">next</span> : null}
      <span className={`question-authority question-authority-${entry.authority}`}>
        {entry.authority}
      </span>
      {entry.since === undefined ? null : (
        <span className="question-since">since {entry.since}</span>
      )}
      {verb === null ? null : (
        <button
          type="button"
          className={`question-verb question-verb-${verb.kind}`}
          onClick={() => onVerb(verb)}
        >
          {verb.label}
        </button>
      )}
      {delegateLabel === null ? null : (
        <button
          type="button"
          className="question-verb question-verb-delegate"
          onClick={onDelegate}
        >
          {delegateLabel}
        </button>
      )}
    </span>
  </li>
)
