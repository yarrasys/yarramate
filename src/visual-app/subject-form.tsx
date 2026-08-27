import { useEffect, useState } from 'react'
import { kindLabelOf } from '../kind-label.js'
import { relationshipKindOffer } from './relationship-kind-options.js'
import type { CanvasEdge, CanvasNode } from '../graph-projection.js'
import type { VisualRenderedModel } from '../adapters/visual/wire.js'
import type { VisualKindOption } from '../adapters/visual/protocol-contract.js'
import type {
  ConstraintReference,
  IdentifiedReference,
  RelationshipFields,
  YarramateOperation,
} from '../operations.js'
import type { ConceptFields } from '../operations.js'

/**
 * The editable twin of the read-only inspector: every field `apply-command.ts`
 * knows how to splice, as a dropdown-constrained control, staged through
 * `onStageChange` rather than written straight to the model. Nothing here
 * writes a document — that is the server's job once the reviewer commits.
 */

// Mirrors `SCALAR_CONCEPT_FIELDS`/`LIST_CONCEPT_FIELDS`/etc in
// `src/apply-command.ts` (not exported there, so duplicated here) — the
// splice layer's field partition is what makes a scalar replace and a list
// append, and this form has to stage operations that partition agrees with.
const CONCEPT_SCALAR_FIELDS = ['kind', 'name', 'description', 'status', 'owner'] as const
const CONCEPT_LIST_FIELDS = [
  'aka',
  'constraints',
  'references',
  'presentIn',
  'attestations',
  'distinctFrom',
  'supersedes',
] as const
const RELATIONSHIP_SCALAR_FIELDS = [
  'kind',
  'from',
  'to',
  'name',
  'description',
  'status',
  'mode',
  'content',
] as const
const RELATIONSHIP_LIST_FIELDS = ['references', 'presentIn'] as const

type ConceptScalarField = (typeof CONCEPT_SCALAR_FIELDS)[number]
type ConceptListField = (typeof CONCEPT_LIST_FIELDS)[number]
type RelationshipScalarField = (typeof RELATIONSHIP_SCALAR_FIELDS)[number]
type RelationshipListField = (typeof RELATIONSHIP_LIST_FIELDS)[number]

type ConstraintRow = CanvasNode['constraints'][number]
type AttestationRow = CanvasNode['attestations'][number]

/** The operation-payload shape of one attestation entry (`recordedBy` required, never `null`). */
interface AttestationEntry {
  readonly topic: string
  readonly by: string
  readonly recordedBy: string
  readonly on: string
}

// ---------------------------------------------------------------------------
// Pure operation construction. Every function here answers "what would
// staging this edit mean", never touches a DOM node, and is what
// test/subject-form.test.ts exercises directly.

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
}

type ScalarDiff = { readonly kind: 'none' } | { readonly kind: 'remove' } | { readonly kind: 'set'; readonly value: string }

// Never emits a retraction for a field that is already empty/absent (ADR
// 0057's remove is rejected server-side when the field is not set), and
// scalars replace — no two-op dance needed the way lists require.
const diffScalar = (previous: string | null, next: string): ScalarDiff => {
  const before = previous ?? ''
  if (next === before) return { kind: 'none' }
  if (next === '') return { kind: 'remove' }
  return { kind: 'set', value: next }
}

type ListDiff<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'append'; readonly added: readonly T[] }
  | { readonly kind: 'replace'; readonly next: readonly T[] }

// A pure append — `next` is `previous` with only trailing entries added —
// stays a single op; anything that drops, reorders, or rewrites an existing
// entry needs the retract-then-set pair `apply-command.ts` requires, because
// list fields only ever append within one operation.
const diffList = <T,>(previous: readonly T[], next: readonly T[]): ListDiff<T> => {
  if (deepEqual(previous, next)) return { kind: 'none' }
  const isExtension =
    next.length >= previous.length && previous.every((item, index) => deepEqual(item, next[index]))
  if (isExtension) return { kind: 'append', added: next.slice(previous.length) }
  return { kind: 'replace', next }
}

const conceptScalarOperation = (
  document: string,
  id: string,
  field: ConceptScalarField,
  set: boolean,
  value: string,
): YarramateOperation =>
  set
    ? { op: 'update-concept', document, concept: { id, [field]: value } as ConceptFields }
    : { op: 'update-concept', document, concept: { id }, remove: [field] }

const conceptListOperation = <T,>(
  document: string,
  id: string,
  field: ConceptListField,
  items: readonly T[] | null,
): YarramateOperation =>
  items === null
    ? { op: 'update-concept', document, concept: { id }, remove: [field] }
    : { op: 'update-concept', document, concept: { id, [field]: items } as ConceptFields }

const relationshipScalarOperation = (
  document: string,
  id: string,
  field: RelationshipScalarField,
  set: boolean,
  value: string,
): YarramateOperation =>
  set
    ? { op: 'update-relationship', document, relationship: { id, [field]: value } as RelationshipFields }
    : { op: 'update-relationship', document, relationship: { id }, remove: [field] }

const relationshipListOperation = <T,>(
  document: string,
  id: string,
  field: RelationshipListField,
  items: readonly T[] | null,
): YarramateOperation =>
  items === null
    ? { op: 'update-relationship', document, relationship: { id }, remove: [field] }
    : { op: 'update-relationship', document, relationship: { id, [field]: items } as RelationshipFields }

export const stageConceptScalarChange = (
  document: string,
  id: string,
  field: ConceptScalarField,
  previous: string | null,
  next: string,
): readonly YarramateOperation[] => {
  const diff = diffScalar(previous, next)
  if (diff.kind === 'none') return []
  return diff.kind === 'remove'
    ? [conceptScalarOperation(document, id, field, false, '')]
    : [conceptScalarOperation(document, id, field, true, diff.value)]
}

export const stageRelationshipScalarChange = (
  document: string,
  id: string,
  field: RelationshipScalarField,
  previous: string | null,
  next: string,
): readonly YarramateOperation[] => {
  const diff = diffScalar(previous, next)
  if (diff.kind === 'none') return []
  return diff.kind === 'remove'
    ? [relationshipScalarOperation(document, id, field, false, '')]
    : [relationshipScalarOperation(document, id, field, true, diff.value)]
}

export const stageConceptListChange = <T,>(
  document: string,
  id: string,
  field: ConceptListField,
  previous: readonly T[],
  next: readonly T[],
): readonly YarramateOperation[] => {
  const diff = diffList(previous, next)
  if (diff.kind === 'none') return []
  if (diff.kind === 'append') {
    return diff.added.length === 0 ? [] : [conceptListOperation(document, id, field, diff.added)]
  }
  const ops: YarramateOperation[] = [conceptListOperation<T>(document, id, field, null)]
  if (diff.next.length > 0) ops.push(conceptListOperation(document, id, field, diff.next))
  return ops
}

export const stageRelationshipListChange = <T,>(
  document: string,
  id: string,
  field: RelationshipListField,
  previous: readonly T[],
  next: readonly T[],
): readonly YarramateOperation[] => {
  const diff = diffList(previous, next)
  if (diff.kind === 'none') return []
  if (diff.kind === 'append') {
    return diff.added.length === 0 ? [] : [relationshipListOperation(document, id, field, diff.added)]
  }
  const ops: YarramateOperation[] = [relationshipListOperation<T>(document, id, field, null)]
  if (diff.next.length > 0) ops.push(relationshipListOperation(document, id, field, diff.next))
  return ops
}

// `ConstraintReference.expects` is optional (absent when there is none);
// `CanvasNode.constraints[].expects` is nullable (always present, `null`
// when there is none) — the row editor works in the display shape so it can
// round-trip through `overlayConceptFields`, and only converts to the
// operation shape at the point of staging.
const toConstraintReference = (row: ConstraintRow): ConstraintReference =>
  row.expects === null ? { id: row.id, ref: row.ref } : { id: row.id, ref: row.ref, expects: row.expects }

export const stageConstraintsChange = (
  document: string,
  id: string,
  previous: readonly ConstraintRow[],
  next: readonly ConstraintRow[],
): readonly YarramateOperation[] => {
  const diff = diffList(previous, next)
  if (diff.kind === 'none') return []
  if (diff.kind === 'append') {
    return diff.added.length === 0
      ? []
      : [conceptListOperation(document, id, 'constraints', diff.added.map(toConstraintReference))]
  }
  const ops: YarramateOperation[] = [conceptListOperation<ConstraintReference>(document, id, 'constraints', null)]
  if (diff.next.length > 0) {
    ops.push(conceptListOperation(document, id, 'constraints', diff.next.map(toConstraintReference)))
  }
  return ops
}

// The operations contract requires `recordedBy` (a batch is a machine's
// transcription of someone's judgment, never anonymous); the canvas shows it
// nullable because a hand-written document may omit it. A blank recorder
// here stages a batch the server schema will reject with a diagnostic, the
// same way any other incomplete row would.
const toAttestationEntry = (row: AttestationRow): AttestationEntry => ({
  topic: row.topic,
  by: row.by,
  recordedBy: row.recordedBy ?? '',
  on: row.on,
})

export const stageAttestationsChange = (
  document: string,
  id: string,
  previous: readonly AttestationRow[],
  next: readonly AttestationRow[],
): readonly YarramateOperation[] => {
  const diff = diffList(previous, next)
  if (diff.kind === 'none') return []
  if (diff.kind === 'append') {
    return diff.added.length === 0
      ? []
      : [conceptListOperation(document, id, 'attestations', diff.added.map(toAttestationEntry))]
  }
  const ops: YarramateOperation[] = [
    conceptListOperation<AttestationEntry>(document, id, 'attestations', null),
  ]
  if (diff.next.length > 0) {
    ops.push(conceptListOperation(document, id, 'attestations', diff.next.map(toAttestationEntry)))
  }
  return ops
}

// ---------------------------------------------------------------------------
// The overlay: pending operations folded onto the model's field values, so
// reselecting a subject shows unsaved edits instead of the committed model.
// Replays each matching operation in tray order exactly the way
// `apply-command.ts` replays a batch — scalars set, then lists appended,
// then removals cleared, per operation.

const applyConceptOperation = (
  node: Record<string, unknown>,
  op: Extract<YarramateOperation, { op: 'update-concept' }>,
): Record<string, unknown> => {
  const draft = { ...node }
  const payload = op.concept as unknown as Record<string, unknown>
  for (const field of CONCEPT_SCALAR_FIELDS) {
    if (payload[field] !== undefined) draft[field] = payload[field]
  }
  for (const field of CONCEPT_LIST_FIELDS) {
    const additions = payload[field] as readonly unknown[] | undefined
    if (additions !== undefined && additions.length > 0) {
      draft[field] = [...(draft[field] as readonly unknown[]), ...additions]
    }
  }
  for (const field of op.remove ?? []) {
    draft[field] = (CONCEPT_LIST_FIELDS as readonly string[]).includes(field) ? [] : null
  }
  return draft
}

export const overlayConceptFields = (node: CanvasNode, operations: readonly YarramateOperation[]): CanvasNode => {
  let draft: Record<string, unknown> = node as unknown as Record<string, unknown>
  for (const op of operations) {
    if (
      op.op !== 'update-concept' ||
      op.document !== node.document ||
      op.concept.id !== node.localId
    ) {
      continue
    }
    draft = applyConceptOperation(draft, op)
  }
  return draft as unknown as CanvasNode
}

const applyRelationshipOperation = (
  edge: Record<string, unknown>,
  op: Extract<YarramateOperation, { op: 'update-relationship' }>,
): Record<string, unknown> => {
  const draft = { ...edge }
  const payload = op.relationship as unknown as Record<string, unknown>
  for (const field of RELATIONSHIP_SCALAR_FIELDS) {
    if (payload[field] !== undefined) draft[field] = payload[field]
  }
  for (const field of RELATIONSHIP_LIST_FIELDS) {
    const additions = payload[field] as readonly unknown[] | undefined
    if (additions !== undefined && additions.length > 0) {
      draft[field] = [...(draft[field] as readonly unknown[]), ...additions]
    }
  }
  for (const field of op.remove ?? []) {
    draft[field] = (RELATIONSHIP_LIST_FIELDS as readonly string[]).includes(field) ? [] : null
  }
  return draft
}

export const overlayRelationshipFields = (
  edge: CanvasEdge,
  operations: readonly YarramateOperation[],
): CanvasEdge => {
  let draft: Record<string, unknown> = edge as unknown as Record<string, unknown>
  for (const op of operations) {
    if (
      op.op !== 'update-relationship' ||
      op.document !== edge.document ||
      op.relationship.id !== edge.localId
    ) {
      continue
    }
    draft = applyRelationshipOperation(draft, op)
  }
  return draft as unknown as CanvasEdge
}

// ---------------------------------------------------------------------------
// Shared controls.


// Chrome's audit wants every form field to carry an id or name (#309); the
// name is derived from the visible label so autofill and the a11y tooling
// see a stable identity without inventing a second vocabulary.
const fieldNameOf = (label: string): string =>
  `subject-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

const SelectRow = ({
  label,
  value,
  options,
  onCommit,
}: {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  readonly onCommit: (next: string) => void
}) => (
  <label className="subject-form-field">
    <span className="subject-form-label">{label}</span>
    <select
      name={fieldNameOf(label)}
      value={value}
      onChange={(event) => onCommit(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
)

const TextRow = ({
  label,
  value,
  onCommit,
}: {
  readonly label: string
  readonly value: string
  readonly onCommit: (next: string) => void
}) => {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="subject-form-field">
      <span className="subject-form-label">{label}</span>
      <input
        type="text"
        name={fieldNameOf(label)}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
      />
    </label>
  )
}

interface RowHelpers<T> {
  readonly set: (next: T) => void
  readonly commit: () => void
  readonly replace: (next: T) => void
}

// A repeatable-row list editor generic over the row shape: text edits stage
// on blur (`set` then `commit`), row-level changes — add, remove, a toggle —
// stage immediately (`replace`). `onCommit` always receives the filtered,
// well-formed rows; blank in-progress rows never reach the caller.
const RepeatableRows = <T,>({
  label,
  values,
  emptyRow,
  isRowFilled,
  renderRow,
  onCommit,
}: {
  readonly label: string
  readonly values: readonly T[]
  readonly emptyRow: T
  readonly isRowFilled: (row: T) => boolean
  readonly renderRow: (row: T, helpers: RowHelpers<T>) => React.ReactNode
  readonly onCommit: (next: readonly T[]) => void
}) => {
  const [rows, setRows] = useState<readonly T[]>(values)
  useEffect(() => setRows(values), [values])

  const commitRows = (next: readonly T[]) => {
    setRows(next)
    onCommit(next.filter(isRowFilled))
  }

  return (
    <div className="subject-form-field subject-form-list">
      <span className="subject-form-label">{label}</span>
      {rows.map((row, index) => (
        <div className="subject-form-row" key={index}>
          {renderRow(row, {
            set: (next) => setRows(rows.map((existing, i) => (i === index ? next : existing))),
            commit: () => commitRows(rows),
            replace: (next) => commitRows(rows.map((existing, i) => (i === index ? next : existing))),
          })}
          <button
            type="button"
            className="subject-form-row-remove"
            onClick={() => commitRows(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="subject-form-row-add" onClick={() => setRows([...rows, emptyRow])}>
        Add {label}
      </button>
    </div>
  )
}

const StringRows = ({
  label,
  values,
  onCommit,
}: {
  readonly label: string
  readonly values: readonly string[]
  readonly onCommit: (next: readonly string[]) => void
}) => (
  <RepeatableRows<string>
    label={label}
    values={values}
    emptyRow=""
    isRowFilled={(row) => row.trim() !== ''}
    onCommit={onCommit}
    renderRow={(row, { set, commit }) => (
      <input type="text" value={row} onChange={(event) => set(event.target.value)} onBlur={commit} />
    )}
  />
)

const EMPTY_REFERENCE: IdentifiedReference = { id: '', ref: '' }

const ReferenceRows = ({
  label,
  values,
  onCommit,
}: {
  readonly label: string
  readonly values: readonly IdentifiedReference[]
  readonly onCommit: (next: readonly IdentifiedReference[]) => void
}) => (
  <RepeatableRows<IdentifiedReference>
    label={label}
    values={values}
    emptyRow={EMPTY_REFERENCE}
    isRowFilled={(row) => row.id.trim() !== '' && row.ref.trim() !== ''}
    onCommit={onCommit}
    renderRow={(row, { set, commit }) => (
      <>
        <input
          type="text"
          placeholder="id"
          value={row.id}
          onChange={(event) => set({ ...row, id: event.target.value })}
          onBlur={commit}
        />
        <input
          type="text"
          placeholder="ref"
          value={row.ref}
          onChange={(event) => set({ ...row, ref: event.target.value })}
          onBlur={commit}
        />
      </>
    )}
  />
)

const EMPTY_CONSTRAINT: ConstraintRow = { id: '', ref: '', expects: null }

const ConstraintRows = ({
  label,
  values,
  onCommit,
}: {
  readonly label: string
  readonly values: readonly ConstraintRow[]
  readonly onCommit: (next: readonly ConstraintRow[]) => void
}) => (
  <RepeatableRows<ConstraintRow>
    label={label}
    values={values}
    emptyRow={EMPTY_CONSTRAINT}
    isRowFilled={(row) => row.id.trim() !== '' && row.ref.trim() !== ''}
    onCommit={onCommit}
    renderRow={(row, { set, commit, replace }) => (
      <div className="subject-form-row-body">
        <input
          type="text"
          placeholder="id"
          value={row.id}
          onChange={(event) => set({ ...row, id: event.target.value })}
          onBlur={commit}
        />
        <input
          type="text"
          placeholder="ref"
          value={row.ref}
          onChange={(event) => set({ ...row, ref: event.target.value })}
          onBlur={commit}
        />
        <label className="subject-form-toggle">
          <input
            type="checkbox"
            checked={row.expects !== null}
            onChange={(event) =>
              replace({
                ...row,
                expects: event.target.checked ? { provider: '', key: '', value: '' } : null,
              })
            }
          />
          Expects
        </label>
        {row.expects === null ? null : (
          <div className="subject-form-row-body">
            <input
              type="text"
              placeholder="provider"
              value={row.expects.provider}
              onChange={(event) =>
                row.expects !== null && set({ ...row, expects: { ...row.expects, provider: event.target.value } })
              }
              onBlur={commit}
            />
            <input
              type="text"
              placeholder="key"
              value={row.expects.key}
              onChange={(event) =>
                row.expects !== null && set({ ...row, expects: { ...row.expects, key: event.target.value } })
              }
              onBlur={commit}
            />
            <input
              type="text"
              placeholder="value"
              value={row.expects.value}
              onChange={(event) =>
                row.expects !== null && set({ ...row, expects: { ...row.expects, value: event.target.value } })
              }
              onBlur={commit}
            />
          </div>
        )}
      </div>
    )}
  />
)

const EMPTY_ATTESTATION: AttestationRow = { topic: '', by: '', on: '', recordedBy: null }

const AttestationRows = ({
  label,
  values,
  onCommit,
}: {
  readonly label: string
  readonly values: readonly AttestationRow[]
  readonly onCommit: (next: readonly AttestationRow[]) => void
}) => (
  <RepeatableRows<AttestationRow>
    label={label}
    values={values}
    emptyRow={EMPTY_ATTESTATION}
    isRowFilled={(row) => row.topic.trim() !== '' && row.by.trim() !== '' && row.on.trim() !== ''}
    onCommit={onCommit}
    renderRow={(row, { set, commit }) => (
      <div className="subject-form-row-body">
        <input
          type="text"
          placeholder="topic"
          value={row.topic}
          onChange={(event) => set({ ...row, topic: event.target.value })}
          onBlur={commit}
        />
        <input
          type="text"
          placeholder="by"
          value={row.by}
          onChange={(event) => set({ ...row, by: event.target.value })}
          onBlur={commit}
        />
        <input
          type="text"
          placeholder="on"
          value={row.on}
          onChange={(event) => set({ ...row, on: event.target.value })}
          onBlur={commit}
        />
        <input
          type="text"
          placeholder="recorded by"
          value={row.recordedBy ?? ''}
          onChange={(event) => set({ ...row, recordedBy: event.target.value })}
          onBlur={commit}
        />
      </div>
    )}
  />
)

// ---------------------------------------------------------------------------
// Forms.

const UNSET_OPTION = { value: '', label: '— unset —' } as const

const STATUS_OPTIONS = [
  UNSET_OPTION,
  { value: 'planned', label: 'planned' },
  { value: 'current', label: 'current' },
  { value: 'retired', label: 'retired' },
]

const MODE_OPTIONS = [
  UNSET_OPTION,
  { value: 'read', label: 'read' },
  { value: 'write', label: 'write' },
  { value: 'read-write', label: 'read-write' },
  { value: 'unspecified', label: 'unspecified' },
]

const kindLabelFor = (kind: string, options: readonly VisualKindOption[]): string =>
  options.find((option) => option.id === kind)?.label ?? kindLabelOf(kind)

export interface ConceptFormProps {
  readonly node: CanvasNode
  readonly model: VisualRenderedModel
  readonly operations: readonly YarramateOperation[]
  readonly onStageChange: (operation: YarramateOperation) => void
}

export const ConceptForm = ({ node, model, operations, onStageChange }: ConceptFormProps) => {
  const effective = overlayConceptFields(node, operations)
  const document = node.document
  // An operation addresses the subject the way its file authored it: `apply`
  // locates `id` inside `document` and never sees the qualified identity the
  // compile derived - which is the one the canvas and the inspector show.
  const id = node.localId
  const stage = (ops: readonly YarramateOperation[]) => ops.forEach(onStageChange)
  const kindOptions = model.vocabulary.conceptKinds.map((option) => ({ value: option.label, label: option.label }))
  const currentKind = kindLabelFor(effective.kind, model.vocabulary.conceptKinds)

  return (
    <div className="subject-form">
      <div className="subject-form-field">
        <span className="subject-form-label">Identity</span>
        <code>{node.id}</code>
      </div>
      <SelectRow
        label="Kind"
        value={currentKind}
        options={kindOptions}
        onCommit={(next) => stage(stageConceptScalarChange(document, id, 'kind', currentKind, next))}
      />
      <TextRow
        label="Name"
        value={effective.name}
        onCommit={(next) => stage(stageConceptScalarChange(document, id, 'name', effective.name, next))}
      />
      <TextRow
        label="Description"
        value={effective.description ?? ''}
        onCommit={(next) => stage(stageConceptScalarChange(document, id, 'description', effective.description, next))}
      />
      <SelectRow
        label="Status"
        value={effective.status ?? ''}
        options={STATUS_OPTIONS}
        onCommit={(next) => stage(stageConceptScalarChange(document, id, 'status', effective.status, next))}
      />
      <TextRow
        label="Owner"
        value={effective.owner ?? ''}
        onCommit={(next) => stage(stageConceptScalarChange(document, id, 'owner', effective.owner, next))}
      />
      <StringRows
        label="Aka"
        values={effective.aka}
        onCommit={(next) => stage(stageConceptListChange(document, id, 'aka', effective.aka, next))}
      />
      <StringRows
        label="Distinct from"
        values={effective.distinctFrom}
        onCommit={(next) => stage(stageConceptListChange(document, id, 'distinctFrom', effective.distinctFrom, next))}
      />
      <StringRows
        label="Supersedes"
        values={effective.supersedes}
        onCommit={(next) => stage(stageConceptListChange(document, id, 'supersedes', effective.supersedes, next))}
      />
      <StringRows
        label="Present in"
        values={effective.presentIn}
        onCommit={(next) => stage(stageConceptListChange(document, id, 'presentIn', effective.presentIn, next))}
      />
      <ReferenceRows
        label="References"
        values={effective.references}
        onCommit={(next) => stage(stageConceptListChange(document, id, 'references', effective.references, next))}
      />
      <ConstraintRows
        label="Constraints"
        values={effective.constraints}
        onCommit={(next) => stage(stageConstraintsChange(document, id, effective.constraints, next))}
      />
      <AttestationRows
        label="Attestations"
        values={effective.attestations}
        onCommit={(next) => stage(stageAttestationsChange(document, id, effective.attestations, next))}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The read-only twins (#298, ADR 0117). The same fields the forms edit, said
// as values: a read-only mount renders these instead of the forms, so the
// facts still read where nothing may be staged. Fields the model does not
// declare are skipped rather than shown empty - a viewer reads what is there,
// and a wall of blank labels says less than their absence.

const FactRow = ({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) =>
  value === '' ? null : (
    <div className="subject-form-field">
      <span className="subject-form-label">{label}</span>
      <span className="subject-fact-value">{value}</span>
    </div>
  )

export const ConceptFacts = ({
  node,
  model,
}: {
  readonly node: CanvasNode
  readonly model: VisualRenderedModel
}) => (
  <div className="subject-form subject-facts">
    <div className="subject-form-field">
      <span className="subject-form-label">Identity</span>
      <code>{node.id}</code>
    </div>
    <FactRow label="Kind" value={kindLabelFor(node.kind, model.vocabulary.conceptKinds)} />
    <FactRow label="Name" value={node.name} />
    <FactRow label="Status" value={node.status ?? ''} />
    <FactRow label="Owner" value={node.owner ?? ''} />
    <FactRow label="Aka" value={node.aka.join(', ')} />
    <FactRow label="Distinct from" value={node.distinctFrom.join(', ')} />
    <FactRow label="Supersedes" value={node.supersedes.join(', ')} />
    <FactRow label="Present in" value={node.presentIn.join(', ')} />
    <FactRow
      label="References"
      value={node.references.map((row) => `${row.id}: ${row.ref}`).join('; ')}
    />
    <FactRow
      label="Constraints"
      value={node.constraints.map((row) => `${row.id}: ${row.ref}`).join('; ')}
    />
    <FactRow
      label="Attestations"
      value={node.attestations
        .map((row) => `${row.topic} by ${row.by} on ${row.on}`)
        .join('; ')}
    />
  </div>
)

export const RelationshipFacts = ({
  edge,
  model,
}: {
  readonly edge: CanvasEdge
  readonly model: VisualRenderedModel
}) => {
  // Endpoints are node ids; the reviewer reads titles, the same answer the
  // editable form's endpoint selects give.
  const titleOf = (ref: string): string =>
    model.graph.nodes.find((candidate) => candidate.id === ref)?.name ?? ref
  return (
    <div className="subject-form subject-facts">
      <div className="subject-form-field">
        <span className="subject-form-label">Identity</span>
        <code>{edge.id}</code>
      </div>
      <FactRow label="Kind" value={kindLabelFor(edge.kind, model.vocabulary.relationshipKinds)} />
      <FactRow label="From" value={titleOf(edge.from)} />
      <FactRow label="To" value={titleOf(edge.to)} />
      <FactRow label="Name" value={edge.name ?? ''} />
      <FactRow label="Mode" value={edge.mode ?? ''} />
      <FactRow label="Content" value={edge.content ?? ''} />
      <FactRow label="Status" value={edge.status ?? ''} />
      <FactRow
        label="References"
        value={edge.references.map((row) => `${row.id}: ${row.ref}`).join('; ')}
      />
      <FactRow label="Present in" value={edge.presentIn.join(', ')} />
    </div>
  )
}

export interface RelationshipFormProps {
  readonly edge: CanvasEdge
  readonly model: VisualRenderedModel
  readonly operations: readonly YarramateOperation[]
  readonly onStageChange: (operation: YarramateOperation) => void
}

export const RelationshipForm = ({ edge, model, operations, onStageChange }: RelationshipFormProps) => {
  const effective = overlayRelationshipFields(edge, operations)
  const document = edge.document
  const id = edge.localId
  const stage = (ops: readonly YarramateOperation[]) => ops.forEach(onStageChange)
  const currentKind = kindLabelFor(effective.kind, model.vocabulary.relationshipKinds)
  // The same guarantee `connectableKinds` gives the connection tool, given to
  // the edge that already exists: this select offered the whole vocabulary, so
  // re-typing `applicationComponent --composition--> businessActor` was one
  // click away and `YM404` only arrived at commit. Endpoints come from
  // `effective`, not from the edge, so a staged `from` change moves the row of
  // the table this is asked against.
  const kindOptions = relationshipKindOffer(
    model.graph,
    { from: effective.from, to: effective.to },
    model.vocabulary.relationshipKinds,
    currentKind,
  ).options.map((option) => ({
    value: option.label,
    label: option.label,
  }))
  // Endpoints are refs, not addresses: `qualifyReference` leaves an already
  // qualified ref alone, so writing the canvas id keeps a cross-document
  // endpoint unambiguous instead of guessing which document to read it in.
  const nodeOptions = model.graph.nodes.map((candidate) => ({ value: candidate.id, label: candidate.name }))

  return (
    <div className="subject-form">
      <div className="subject-form-field">
        <span className="subject-form-label">Identity</span>
        <code>{edge.id}</code>
      </div>
      <SelectRow
        label="Kind"
        value={currentKind}
        options={kindOptions}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'kind', currentKind, next))}
      />
      <SelectRow
        label="From"
        value={effective.from}
        options={nodeOptions}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'from', effective.from, next))}
      />
      <SelectRow
        label="To"
        value={effective.to}
        options={nodeOptions}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'to', effective.to, next))}
      />
      <TextRow
        label="Name"
        value={effective.name ?? ''}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'name', effective.name, next))}
      />
      <TextRow
        label="Description"
        value={effective.description ?? ''}
        onCommit={(next) =>
          stage(stageRelationshipScalarChange(document, id, 'description', effective.description, next))
        }
      />
      <SelectRow
        label="Mode"
        value={effective.mode ?? ''}
        options={MODE_OPTIONS}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'mode', effective.mode, next))}
      />
      <TextRow
        label="Content"
        value={effective.content ?? ''}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'content', effective.content, next))}
      />
      <SelectRow
        label="Status"
        value={effective.status ?? ''}
        options={STATUS_OPTIONS}
        onCommit={(next) => stage(stageRelationshipScalarChange(document, id, 'status', effective.status, next))}
      />
      <ReferenceRows
        label="References"
        values={effective.references}
        onCommit={(next) => stage(stageRelationshipListChange(document, id, 'references', effective.references, next))}
      />
      <StringRows
        label="Present in"
        values={effective.presentIn}
        onCommit={(next) => stage(stageRelationshipListChange(document, id, 'presentIn', effective.presentIn, next))}
      />
    </div>
  )
}
