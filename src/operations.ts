/**
 * The `yarramate/operations/v1` document shape, and the result of landing one.
 *
 * These declarations are the typed twin of `schema/yarramate-operations.schema.json`
 * and `schema/yarramate-apply-result.schema.json`. They live apart from
 * `./apply-command.js` - which owns the machinery that validates, splices, and
 * writes a batch - because the visual protocol carries the same documents to a
 * browser that must not pull Ajv, `yaml`, or `node:fs` into its bundle or its
 * typecheck. Types only: this module has no runtime dependency of any kind.
 */

export interface IdentifiedReference {
  readonly id: string
  readonly ref: string
}

export interface ConstraintReference extends IdentifiedReference {
  readonly expects?: {
    readonly provider: string
    readonly key: string
    readonly value: string
  }
}

export interface ConceptFields {
  readonly id: string
  readonly kind?: string
  readonly name?: string
  readonly description?: string
  readonly aka?: readonly string[]
  readonly status?: string
  readonly owner?: string
  readonly distinctFrom?: readonly string[]
  readonly supersedes?: readonly string[]
  readonly constraints?: readonly ConstraintReference[]
  readonly references?: readonly IdentifiedReference[]
  readonly presentIn?: readonly string[]
  // A batch is a machine's transcription of someone's judgment, so the
  // operations contract makes the recorder mandatory here even though a
  // hand-written document may omit it (the committer is the recorder).
  readonly attestations?: ReadonlyArray<{
    readonly topic: string
    readonly by: string
    readonly recordedBy: string
    readonly on: string
  }>
}

export interface RelationshipFields {
  readonly id: string
  readonly kind?: string
  readonly from?: string
  readonly to?: string
  readonly name?: string
  readonly description?: string
  readonly status?: string
  readonly mode?: string
  readonly content?: string
  readonly references?: readonly IdentifiedReference[]
  readonly presentIn?: readonly string[]
}

// An observation is addressed by the pair (target, key) rather than by an
// `id`, because an overlay entry has none: the pair is what `reconcile`
// already treats as unique per document (ADR 0075, and the YM803 duplicate
// -target diagnostic). A keyless observation is the presence claim for its
// target, so `key` absent is itself an address, not a wildcard.
export interface ObservationTarget {
  readonly subject?: string
  readonly claim?: string
  readonly key?: string
}

export interface ObservationFields extends ObservationTarget {
  readonly value?: string
  readonly result?: 'confirmed' | 'contradicted' | 'unknown' | 'not-observed'
  readonly evidence?: { readonly uri: string; readonly message?: string }
}

// An update addresses an entry by (target, key) and changes whatever else it
// names, so `key` here is an address rather than a field: unlike `add`, it
// carries no obligation to restate the value read at that key, and evidence
// can be corrected a field at a time.
export interface ObservationChange extends ObservationTarget {
  readonly value?: string
  readonly result?: 'confirmed' | 'contradicted' | 'unknown' | 'not-observed'
  readonly evidence?: { readonly uri?: string; readonly message?: string }
}

export type YarramateOperation =
  | {
      readonly op: 'add-concept'
      readonly document: string
      readonly concept: ConceptFields
    }
  | {
      readonly op: 'add-relationship'
      readonly document: string
      readonly relationship: RelationshipFields
    }
  | {
      readonly op: 'update-concept'
      readonly document: string
      readonly concept: ConceptFields
      readonly remove?: readonly string[]
    }
  | {
      readonly op: 'update-relationship'
      readonly document: string
      readonly relationship: RelationshipFields
      readonly remove?: readonly string[]
    }
  | {
      readonly op: 'delete-concept'
      readonly document: string
      readonly concept: { readonly id: string }
    }
  | {
      readonly op: 'delete-relationship'
      readonly document: string
      readonly relationship: { readonly id: string }
    }
  | {
      readonly op: 'add-observation'
      readonly document: string
      readonly observation: ObservationFields
    }
  | {
      readonly op: 'update-observation'
      readonly document: string
      readonly observation: ObservationChange
      readonly remove?: readonly string[]
    }
  | {
      readonly op: 'delete-observation'
      readonly document: string
      readonly observation: ObservationTarget
    }

export interface OperationsDocument {
  readonly format: 'yarramate/operations/v1'
  readonly operations: readonly YarramateOperation[]
}

export interface YarramateApplyResult {
  readonly format: 'yarramate/apply-result/v1'
  readonly workspace: string
  readonly applied: {
    readonly addedConcepts: number
    readonly addedRelationships: number
    readonly updatedConcepts: number
    readonly updatedRelationships: number
    readonly deletedConcepts: number
    readonly deletedRelationships: number
    readonly addedObservations: number
    readonly updatedObservations: number
    readonly deletedObservations: number
  }
  readonly documents: readonly string[]
}
