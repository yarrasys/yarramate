import { useState, type KeyboardEvent } from 'react'
import type { LifecycleStatus, ProjectionQuery } from '../projection.js'

/**
 * The fields a `ProjectionQuery` is edited through, and the translation
 * between them and the wire shape.
 *
 * The panel that used to own them is gone: a query is edited in the canvas
 * column's bottom panel now (#248), where the match count, the excluded list
 * and the document a query resolves to sit beside the fields instead of
 * overlaying the diagram they narrow. The fields themselves did not change, so
 * they live here and `query-panel.tsx` composes them.
 */

/**
 * The form's own shape, not the wire shape: every one of the 13 query
 * dimensions is always present here (arrays default empty, single-choice
 * fields default to `''`), so every field is a controlled input with no
 * `undefined` to special-case. Composing back to `ProjectionQuery` — where an
 * empty array or an unset choice must be *absent*, never `[]` or `''` (the
 * schema's `minItems: 1` on the array fields rejects an empty array outright)
 * — happens once, at the point this leaves the form.
 */
export interface QueryFields {
  readonly subjects: readonly string[]
  readonly documents: readonly string[]
  readonly kinds: readonly string[]
  readonly layers: readonly string[]
  readonly statuses: readonly LifecycleStatus[]
  readonly excludeStatuses: readonly LifecycleStatus[]
  readonly states: readonly string[]
  readonly owners: readonly string[]
  readonly constraints: readonly string[]
  readonly relationshipKinds: readonly string[]
  readonly kindMatching: '' | 'exact' | 'descendants'
  readonly relationships: '' | 'between' | 'connected' | 'none'
  readonly isolatedConcepts: '' | 'include' | 'exclude'
}

export const EMPTY_FIELDS: QueryFields = {
  subjects: [],
  documents: [],
  kinds: [],
  layers: [],
  statuses: [],
  excludeStatuses: [],
  states: [],
  owners: [],
  constraints: [],
  relationshipKinds: [],
  kindMatching: '',
  relationships: '',
  isolatedConcepts: '',
}

const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  'planned',
  'current',
  'retired',
]

export const queryToFields = (query: ProjectionQuery | null): QueryFields =>
  query === null
    ? EMPTY_FIELDS
    : {
        subjects: query.subjects ?? [],
        documents: query.documents ?? [],
        kinds: query.kinds ?? [],
        layers: query.layers ?? [],
        statuses: query.statuses ?? [],
        excludeStatuses: query.excludeStatuses ?? [],
        states: query.states ?? [],
        owners: query.owners ?? [],
        constraints: query.constraints ?? [],
        relationshipKinds: query.relationshipKinds ?? [],
        kindMatching: query.kindMatching ?? '',
        relationships: query.relationships ?? '',
        isolatedConcepts: query.isolatedConcepts ?? '',
      }

/** Every populated field, and nothing else — an empty array or an unset
 * single-choice field is never sent, since `minItems: 1` on the schema's
 * array properties makes `[]` itself invalid. */
export const composeQuery = (fields: QueryFields): ProjectionQuery => ({
  ...(fields.subjects.length > 0 ? { subjects: fields.subjects } : {}),
  ...(fields.documents.length > 0 ? { documents: fields.documents } : {}),
  ...(fields.kinds.length > 0 ? { kinds: fields.kinds } : {}),
  ...(fields.layers.length > 0 ? { layers: fields.layers } : {}),
  ...(fields.statuses.length > 0 ? { statuses: fields.statuses } : {}),
  ...(fields.excludeStatuses.length > 0
    ? { excludeStatuses: fields.excludeStatuses }
    : {}),
  ...(fields.states.length > 0 ? { states: fields.states } : {}),
  ...(fields.owners.length > 0 ? { owners: fields.owners } : {}),
  ...(fields.constraints.length > 0 ? { constraints: fields.constraints } : {}),
  ...(fields.relationshipKinds.length > 0
    ? { relationshipKinds: fields.relationshipKinds }
    : {}),
  ...(fields.kindMatching !== '' ? { kindMatching: fields.kindMatching } : {}),
  ...(fields.relationships !== '' ? { relationships: fields.relationships } : {}),
  ...(fields.isolatedConcepts !== ''
    ? { isolatedConcepts: fields.isolatedConcepts }
    : {}),
})

/**
 * A tag/chip input for the 8 free-text `ProjectionQuery` array fields: no
 * fixed vocabulary exists for subject ids, kind names, layer names, etc., so
 * the reviewer types a value and commits it (Enter, comma, or blur) rather
 * than choosing from a list this component would have to invent.
 */
const TagField = ({
  id,
  label,
  values,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly values: readonly string[]
  readonly onChange: (values: readonly string[]) => void
}) => {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const value = draft.trim()
    setDraft('')
    if (value === '' || values.includes(value)) return
    onChange([...values, value])
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <div className="tag-input">
        {values.map((value) => (
          <span key={value} className="tag-chip">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((existing) => existing !== value))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          placeholder="Add…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
          onBlur={commit}
        />
      </div>
    </div>
  )
}

/** A checkbox group for the two `LifecycleStatus` multi-selects. */
const StatusGroup = ({
  legend,
  values,
  onChange,
}: {
  readonly legend: string
  readonly values: readonly LifecycleStatus[]
  readonly onChange: (values: readonly LifecycleStatus[]) => void
}) => (
  <fieldset className="filter-field filter-checkbox-group">
    <legend>{legend}</legend>
    {LIFECYCLE_STATUSES.map((status) => (
      <label key={status} className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={values.includes(status)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...values, status]
                : values.filter((existing) => existing !== status),
            )
          }
        />
        {status}
      </label>
    ))}
  </fieldset>
)

/** A `<select>` constrained to a fixed set of literal values, plus an "Any"
 * option standing in for the field being unset entirely. */
const ChoiceField = <Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: '' | Value
  readonly options: readonly Value[]
  readonly onChange: (value: '' | Value) => void
}) => (
  <div className="filter-field">
    <label htmlFor={id}>{label}</label>
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as '' | Value)}
    >
      <option value="">Any</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </div>
)

export type PresentationFlag =
  | 'showLifecycle'
  | 'showEvidence'
  | 'showOwnership'
  | 'showConstraints'
  | 'showNudges'

/** The checkbox's onChange handler, extracted so it is directly testable in
 * isolation from rendering: it calls `onTogglePresentation` and nothing
 * else — never `composeQuery`/`scheduleApply`. These three flags are
 * presentation state, not one of the 13 `ProjectionQuery` dimensions, so
 * toggling one must never compose a query or arm the debounced apply. */
export const presentationToggleHandler =
  (onTogglePresentation: (flag: PresentationFlag, value: boolean) => void, flag: PresentationFlag) =>
  (value: boolean): void =>
    onTogglePresentation(flag, value)

/**
 * All 13 `ProjectionQuery` dimensions as one always-valid-by-construction
 * grid. A malformed value (an unrecognised layer, say) is caught by the same
 * Ajv validation every other browser input goes through and surfaces through
 * `Faults` — this component adds no validation of its own.
 */
export function QueryFacets({
  fields,
  onChange,
}: {
  readonly fields: QueryFields
  readonly onChange: <K extends keyof QueryFields>(
    key: K,
    value: QueryFields[K],
  ) => void
}) {
  return (
    <div className="filter-grid">
      <TagField
        id="filter-subjects"
        label="Subjects"
        values={fields.subjects}
        onChange={(values) => onChange('subjects', values)}
      />
      <TagField
        id="filter-documents"
        label="Documents"
        values={fields.documents}
        onChange={(values) => onChange('documents', values)}
      />
      <TagField
        id="filter-kinds"
        label="Kinds"
        values={fields.kinds}
        onChange={(values) => onChange('kinds', values)}
      />
      <TagField
        id="filter-layers"
        label="Layers"
        values={fields.layers}
        onChange={(values) => onChange('layers', values)}
      />
      <TagField
        id="filter-states"
        label="States"
        values={fields.states}
        onChange={(values) => onChange('states', values)}
      />
      <TagField
        id="filter-owners"
        label="Owners"
        values={fields.owners}
        onChange={(values) => onChange('owners', values)}
      />
      <TagField
        id="filter-constraints"
        label="Constraints"
        values={fields.constraints}
        onChange={(values) => onChange('constraints', values)}
      />
      <TagField
        id="filter-relationship-kinds"
        label="Relationship kinds"
        values={fields.relationshipKinds}
        onChange={(values) => onChange('relationshipKinds', values)}
      />
      <StatusGroup
        legend="Statuses"
        values={fields.statuses}
        onChange={(values) => onChange('statuses', values)}
      />
      <StatusGroup
        legend="Exclude statuses"
        values={fields.excludeStatuses}
        onChange={(values) => onChange('excludeStatuses', values)}
      />
      <ChoiceField
        id="filter-kind-matching"
        label="Kind matching"
        value={fields.kindMatching}
        options={['exact', 'descendants'] as const}
        onChange={(value) => onChange('kindMatching', value)}
      />
      <ChoiceField
        id="filter-relationships"
        label="Relationships"
        value={fields.relationships}
        options={['between', 'connected', 'none'] as const}
        onChange={(value) => onChange('relationships', value)}
      />
      <ChoiceField
        id="filter-isolated-concepts"
        label="Isolated concepts"
        value={fields.isolatedConcepts}
        options={['include', 'exclude'] as const}
        onChange={(value) => onChange('isolatedConcepts', value)}
      />
    </div>
  )
}

/**
 * The three badge toggles. Presentation, not query: they are written into the
 * view document's `presentation` and never composed into a `ProjectionQuery`,
 * which is why they take their own handler rather than sharing `onChange`.
 */
export function PresentationToggles({
  showLifecycle,
  showEvidence,
  showOwnership,
  showConstraints,
  showNudges,
  onTogglePresentation,
}: {
  readonly showLifecycle: boolean
  readonly showEvidence: boolean
  readonly showOwnership: boolean
  readonly showConstraints: boolean
  readonly showNudges: boolean
  readonly onTogglePresentation: (flag: PresentationFlag, value: boolean) => void
}) {
  return (
    <fieldset className="filter-field filter-presentation-group">
      <legend>Presentation</legend>
      <label className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={showLifecycle}
          onChange={(event) =>
            presentationToggleHandler(onTogglePresentation, 'showLifecycle')(
              event.currentTarget.checked,
            )
          }
        />
        Lifecycle badges
      </label>
      <label className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={showEvidence}
          onChange={(event) =>
            presentationToggleHandler(onTogglePresentation, 'showEvidence')(
              event.currentTarget.checked,
            )
          }
        />
        Evidence badges
      </label>
      <label className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={showOwnership}
          onChange={(event) =>
            presentationToggleHandler(onTogglePresentation, 'showOwnership')(
              event.currentTarget.checked,
            )
          }
        />
        Ownership badges
      </label>
      {/* Not a badge: this one moves the NODE. A bound ruling becomes a row
          inside the instance that holds it rather than a box of its own
          (#473 phase 3, ADR 0145). It sits here because it is the same kind of
          choice to a reviewer - per view, saved with the view, never a
          changeset - and the alternative was a fourth place to look. */}
      <label className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={showConstraints}
          onChange={(event) =>
            presentationToggleHandler(onTogglePresentation, 'showConstraints')(
              event.currentTarget.checked,
            )
          }
        />
        Constraints as rows
      </label>
      {/* Workspace presentation only: unlike the three above, this flag is
          never written into a view document's `presentation` - a saved view
          does not decide whether a reviewer sees the interview's nudges. */}
      <label className="filter-checkbox-option">
        <input
          type="checkbox"
          checked={showNudges}
          onChange={(event) =>
            presentationToggleHandler(onTogglePresentation, 'showNudges')(
              event.currentTarget.checked,
            )
          }
        />
        Open-question badges
      </label>
    </fieldset>
  )
}
