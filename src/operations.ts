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

export type YarramateOperation =
  | { readonly op: 'add-concept'; readonly document: string; readonly concept: ConceptFields }
  | { readonly op: 'add-relationship'; readonly document: string; readonly relationship: RelationshipFields }
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
  }
  readonly documents: readonly string[]
}
