import type React from 'react'
import { useState } from 'react'
import type { CanvasGraph } from '../graph-projection.js'
import type { YarramateOperation } from '../operations.js'
import { draftConcept, proposeConceptId } from '../concept-drafting.js'
import type { VisualKindOption } from '../adapters/visual/protocol-contract.js'

/**
 * Making a subject, the counterpart to the connection tool.
 *
 * The kinds come from the workspace's own profile, sent with every model
 * frame, so nothing here decides what a workspace may contain. The id is
 * derived from the name rather than asked for: an id is a stable address a
 * human reads in a diff, and a reviewer thinking about a name writes worse ids
 * than a transliteration of the name does. It is shown before landing, because
 * a derived address the author never saw is one nobody agreed to.
 */
export const SubjectDraftPanel = ({
  graph,
  kinds,
  documents,
  defaultDocument,
  onStage,
  onCancel,
}: {
  readonly graph: CanvasGraph
  readonly kinds: readonly VisualKindOption[]
  readonly documents: readonly string[]
  readonly defaultDocument: string
  readonly onStage: (operation: YarramateOperation) => void
  readonly onCancel: () => void
}): React.ReactElement => {
  const [name, setName] = useState('')
  const [kind, setKind] = useState(kinds[0]?.id ?? '')
  const [document, setDocument] = useState(defaultDocument)

  const proposed = name.trim() === '' ? null : proposeConceptId(graph, name)
  const operation =
    proposed === null
      ? null
      : draftConcept(
          graph,
          { name, kind, document },
          kinds.map((option) => option.id),
        )

  return (
    <section className="subject-draft-panel" aria-label="Add a subject">
      <label className="subject-draft-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="subject-draft-field">
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="subject-draft-field">
        <span>Document</span>
        <select
          value={document}
          onChange={(event) => setDocument(event.target.value)}
        >
          {documents.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </select>
      </label>

      <p className="subject-draft-id">
        {name.trim() === '' ? (
          'Give it a name.'
        ) : proposed === null ? (
          // The two names this cannot serve: nothing an id may be made of, and
          // one that would start with a digit.
          'That name makes no id. An id starts with a letter and is made of letters, digits and hyphens.'
        ) : (
          <>
            Id: <code>{proposed}</code>
          </>
        )}
      </p>

      <button
        type="button"
        disabled={operation === null}
        onClick={() => {
          if (operation === null) return
          onStage(operation)
          onCancel()
        }}
      >
        Add
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
