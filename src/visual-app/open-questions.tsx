import type {
  VisualInterrogationOverlay,
  VisualQuestionEntry,
} from '../adapters/visual/wire.js'

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
}: {
  readonly overlay: VisualInterrogationOverlay
  readonly selectedId: string | null
}) {
  const entries =
    selectedId === null
      ? overlay.workspace
      : (overlay.subjects[selectedId] ?? [])
  const scopeNote =
    selectedId === null
      ? 'Whole-model questions. Select a subject to see what names it.'
      : null
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
            <QuestionRow key={entry.questionId} entry={entry} />
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

const QuestionRow = ({ entry }: { readonly entry: VisualQuestionEntry }) => (
  <li className="question-row">
    <span className="question-text">{entry.question}</span>
    <span className="question-meta">
      <span className={`question-authority question-authority-${entry.authority}`}>
        {entry.authority}
      </span>
      {entry.since === undefined ? null : (
        <span className="question-since">since {entry.since}</span>
      )}
    </span>
  </li>
)
