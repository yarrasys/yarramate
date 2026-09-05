import type React from 'react'
import { useState } from 'react'
import type { CanvasGraph } from '../graph-projection.js'
import type { YarramateOperation } from '../operations.js'
import { draftInstance, type SlotBinding } from '../concept-drafting.js'
import type { VisualPatternOption } from '../adapters/visual/protocol-contract.js'

/**
 * Making a pattern INSTANCE, which is a different act from making a subject
 * (#473 phase 4, ADR 0146).
 *
 * Dropping "System API" is one gesture that mints an application, its
 * interface, its service and the wires between them. Assembling the same thing
 * from the layer bands is five drops and three connections, and every one of
 * them is a chance to bind the wrong slot.
 *
 * The form asks for the slots the PATTERN declares, in the order it declared
 * them, and stages ONE changeset: the drafted children first, then the instance
 * whose `parts` names them. Item 4.1 proved that batch lands, in either order.
 */
export const InstanceDraftPanel = ({
  graph,
  pattern,
  documents,
  defaultDocument,
  reservedIds,
  onStage,
  onCancel,
}: {
  readonly graph: CanvasGraph
  readonly pattern: VisualPatternOption
  readonly documents: readonly string[]
  readonly defaultDocument: string
  /**
   * Ids the pending changeset already claims, on the same terms the subject
   * form takes them: the graph knows only what has landed (#315).
   */
  readonly reservedIds: readonly string[]
  readonly onStage: (operation: YarramateOperation) => void
  readonly onCancel: () => void
}): React.ReactElement => {
  const [name, setName] = useState('')
  const [document, setDocument] = useState(defaultDocument)
  const [bindings, setBindings] = useState<ReadonlyMap<string, SlotBinding>>(
    new Map(),
  )

  const setSlot = (slot: string, binding: SlotBinding) =>
    setBindings((was) => {
      const next = new Map(was)
      if (binding === null) next.delete(slot)
      else next.set(slot, binding)
      return next
    })

  /** Subjects a slot will take, by the kind labels it admits. */
  const candidatesFor = (admits: readonly string[]) =>
    graph.nodes.filter((node) => admits.includes(node.kindLabel))

  const operations = draftInstance(
    graph,
    {
      name,
      document,
      kind: pattern.label,
      slots: pattern.slots.map((slot) => ({
        name: slot.name,
        required: slot.required,
        admits: slot.admits,
      })),
    },
    bindings,
    reservedIds,
  )

  return (
    <section className="subject-draft instance-draft" aria-label="Add an instance">
      <h3>{pattern.name ?? pattern.label}</h3>

      <label className="subject-draft-field" htmlFor="instance-draft-name">
        <span>Name</span>
        <input
          id="instance-draft-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="subject-draft-field" htmlFor="instance-draft-document">
        <span>Document</span>
        <select
          id="instance-draft-document"
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

      <ul className="instance-draft-slots">
        {pattern.slots.map((slot) => {
          const binding = bindings.get(slot.name) ?? null
          const candidates = candidatesFor(slot.admits)
          const selectValue =
            binding === null
              ? ''
              : binding.mode === 'new'
                ? '__new__'
                : binding.subject
          return (
            <li key={slot.name} className="instance-draft-slot">
              <label htmlFor={`instance-slot-${slot.name}`}>
                <span className="instance-draft-slot-name">{slot.name}</span>
                {slot.required ? (
                  <span className="instance-draft-required">required</span>
                ) : null}
                {/* A context slot names what the instance USES rather than
                    what it holds, and it is the one kind of row that will not
                    fold inside the box. Saying so here is cheaper than a
                    reader discovering it from the canvas. */}
                {slot.wiring === 'context' ? (
                  <span className="instance-draft-context">context</span>
                ) : null}
              </label>
              <select
                id={`instance-slot-${slot.name}`}
                value={selectValue}
                onChange={(event) => {
                  const chosen = event.target.value
                  if (chosen === '') return setSlot(slot.name, null)
                  if (chosen === '__new__') {
                    return setSlot(slot.name, {
                      mode: 'new',
                      name: '',
                      kind: slot.admits[0] ?? '',
                    })
                  }
                  setSlot(slot.name, { mode: 'existing', subject: chosen })
                }}
              >
                <option value="">
                  {slot.required ? 'Choose one' : 'Leave for later'}
                </option>
                {candidates.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
                <option value="__new__">New…</option>
              </select>

              {binding?.mode !== 'new' ? null : (
                <div className="instance-draft-new">
                  <input
                    aria-label={`New ${slot.name} name`}
                    value={binding.name}
                    onChange={(event) =>
                      setSlot(slot.name, { ...binding, name: event.target.value })
                    }
                  />
                  {/* Only where the slot admits a family. One kind is not a
                      choice, and a select of one is a question with an answer
                      already in it. */}
                  {slot.admits.length < 2 ? null : (
                    <select
                      aria-label={`New ${slot.name} kind`}
                      value={binding.kind}
                      onChange={(event) =>
                        setSlot(slot.name, { ...binding, kind: event.target.value })
                      }
                    >
                      {slot.admits.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {pattern.wiring.length === 0 ? null : (
        <div className="instance-draft-wiring">
          <h4>The compiler will mint</h4>
          <ul>
            {pattern.wiring.map((wire) => (
              <li key={`${wire.from}-${wire.kind}-${wire.to}`}>
                <code>{`${wire.from} ${wire.kind} ${wire.to}`}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        disabled={operations === null}
        onClick={() => {
          if (operations === null) return
          // One changeset: every operation staged before the panel closes, in
          // the order the batch declares them.
          for (const operation of operations) onStage(operation)
          onCancel()
        }}
      >
        Add instance
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
