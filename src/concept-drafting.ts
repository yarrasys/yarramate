import type { CanvasGraph } from './graph-projection.js'
import type { YarramateOperation } from './operations.js'

/**
 * Drafting a new subject, the counterpart to `relationship-drafting.ts`.
 *
 * A canvas can connect two subjects but could not make one, which left the
 * editor able to describe relationships between things it had no way to bring
 * into existence. These functions are pure and hold no React, so what an
 * editor would produce can be compiled rather than asserted about.
 */

/** What `yarramate-document.schema.json` accepts as an id. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * A kebab-case id derived from a name, unique across the graph, or `null` when
 * the name yields nothing an id may be made of.
 *
 * Deriving rather than asking is the point: an id is a stable address a human
 * reads in a diff, and asking a reviewer to invent one while they are thinking
 * about a name produces worse ids than a transliteration of the name does.
 * Returning null rather than a placeholder keeps a subject called `"???"` from
 * landing as `subject-1`, which nothing could later be traced back from.
 *
 * `reserved` carries ids the graph does not know yet: a staged-but-uncommitted
 * draft never enters the rendered graph, so without it a second subject whose
 * name slugs to the same id re-proposed it and the editor's replace-by-target
 * staging silently swallowed the first (#315) - the identical blind spot
 * `proposeRelationshipId` had before #306's fix, and the identical way out.
 */
export const proposeConceptId = (
  graph: CanvasGraph,
  name: string,
  reserved: Iterable<string> = [],
): string | null => {
  const base = name
    .normalize('NFKD')
    // The marks NFKD split off, dropped rather than treated as boundaries:
    // otherwise every accent becomes a hyphen and "Ünïcodé" reads as
    // "u-ni-code".
    .replace(/[\u0300-\u036f]/g, '')
    // Anything else that is not a letter or digit becomes a boundary, so
    // "Order Intake (v2)" reads as "order-intake-v2".
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  // An id starts with a letter. Dropping a leading digit would turn "2FA
  // Gateway" into "fa-gateway", an id that no longer names the thing, so this
  // is a name an id cannot be made of and the caller is told so.
  if (base === '' || !ID_PATTERN.test(base)) return null

  const taken = new Set([
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
    ...reserved,
  ])
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The operation that lands a new subject, or `null` when the draft is one no
 * document could accept.
 *
 * `kinds` is the vocabulary the workspace's profile actually offers. Refusing
 * a kind outside it here, rather than trusting the caller's palette, is the
 * same posture `draftRelationship` takes: the guarantee has to hold for any
 * caller, not only one that filtered first.
 *
 * A caller holding drafts the graph has not landed yet - an editor with a
 * pending changeset - passes their ids as `reserved`, so a second subject
 * slugging to a taken id steps to `-2` instead of colliding with the first
 * (#315).
 */
export const draftConcept = (
  graph: CanvasGraph,
  input: {
    readonly name: string
    readonly kind: string
    readonly document: string
  },
  kinds: readonly string[],
  reserved: Iterable<string> = [],
): YarramateOperation | null => {
  if (input.document === '') return null
  if (!kinds.includes(input.kind)) return null
  const name = input.name.trim()
  if (name === '') return null
  const id = proposeConceptId(graph, name, reserved)
  if (id === null) return null
  return {
    op: 'add-concept',
    document: input.document,
    concept: { id, kind: input.kind, name },
  }
}

/**
 * What a reviewer chose for one slot of a pattern instance (#473 phase 4).
 *
 * `null` is a slot left alone, which is legal for an optional slot and is what
 * the interview later asks about (ADR 0140). A required slot left null is
 * refused here rather than staged and refused by the compiler, because a
 * changeset that cannot land is worse than a form that will not submit.
 */
export type SlotBinding =
  | { readonly mode: 'existing'; readonly subject: string }
  | { readonly mode: 'new'; readonly name: string; readonly kind: string }
  | null

export interface InstanceDraft {
  readonly name: string
  readonly document: string
  /** The pattern's own kind, as a label, the same spelling an operation uses. */
  readonly kind: string
  readonly slots: readonly {
    readonly name: string
    readonly required: boolean
    /** Kind labels this slot accepts, descendants already resolved. */
    readonly admits: readonly string[]
  }[]
}

/**
 * A pattern instance and every child it mints, as ONE batch.
 *
 * Children first and the instance last, though `apply` compiles the whole
 * candidate workspace atomically and would take either order: item 4.1 proved
 * both, and emitting the order a reader would write by hand costs nothing and
 * makes the diff read forwards.
 *
 * Every minted id is reserved as it is proposed, so two slots filled with the
 * same name do not both slug to `payload` and have the second silently replace
 * the first (#315, the defect that made `reservedIds` required).
 *
 * `null` rather than a partial batch when anything is wrong: a form that stages
 * half an instance leaves the reviewer to discover the rest from a compile
 * error.
 */
export const draftInstance = (
  graph: CanvasGraph,
  input: InstanceDraft,
  bindings: ReadonlyMap<string, SlotBinding>,
  reserved: Iterable<string> = [],
): readonly YarramateOperation[] | null => {
  if (input.document === '') return null
  const name = input.name.trim()
  if (name === '') return null

  const claimed = new Set(reserved)
  const children: YarramateOperation[] = []
  const parts: Record<string, string> = {}

  for (const slot of input.slots) {
    const binding = bindings.get(slot.name) ?? null
    if (binding === null) {
      // The model does not stand up without it, so the form cannot stage it.
      if (slot.required) return null
      continue
    }
    if (binding.mode === 'existing') {
      if (binding.subject === '') return null
      parts[slot.name] = binding.subject
      continue
    }
    // A minted child: its kind has to be one the slot admits, or the compiler
    // refuses the binding and the reviewer learns it from a diagnostic.
    if (!slot.admits.includes(binding.kind)) return null
    const childName = binding.name.trim()
    if (childName === '') return null
    const childId = proposeConceptId(graph, childName, claimed)
    if (childId === null) return null
    claimed.add(childId)
    children.push({
      op: 'add-concept',
      // The instance's document, not a choice: a part authored somewhere else
      // is a part the reader has to go looking for.
      document: input.document,
      concept: { id: childId, kind: binding.kind, name: childName },
    })
    parts[slot.name] = childId
  }

  const instanceId = proposeConceptId(graph, name, claimed)
  if (instanceId === null) return null

  return [
    ...children,
    {
      op: 'add-concept',
      document: input.document,
      concept: {
        id: instanceId,
        kind: input.kind,
        name,
        // Omitted rather than empty where nothing was bound: an empty `parts`
        // says the instance binds nothing, and the compiler reads the two the
        // same way but a reader does not.
        ...(Object.keys(parts).length === 0 ? {} : { parts }),
      },
    },
  ]
}

/**
 * Filling ONE slot of an instance that already exists (#473 phase 4).
 *
 * The other half of {@link draftInstance}: that one mints an instance and its
 * parts together, this one answers a slot left open, which is what a
 * `missing-part` card asks about (ADR 0140, #447). Both stage the same shape,
 * so the model cannot tell which surface a binding came from.
 *
 * Merges BY SLOT, per ADR 0062's recorded convention: the operation names only
 * the slot being filled, and the slots it does not mention are left alone
 * (#448). There is no null idiom for retraction here, because retraction is
 * coarse `remove: ['parts']` and is a different gesture from filling one.
 *
 * `null` rather than a partial batch: a child minted without the binding that
 * uses it is a subject nobody asked for.
 */
export const draftSlotBinding = (
  graph: CanvasGraph,
  input: {
    /** The instance whose slot is being filled. */
    readonly instance: string
    readonly slot: string
    /** The document the operation writes to, and any minted child with it. */
    readonly document: string
    /** Kind labels the slot accepts, descendants already resolved. */
    readonly admits: readonly string[]
  },
  binding: SlotBinding,
  reserved: Iterable<string> = [],
): readonly YarramateOperation[] | null => {
  if (binding === null) return null
  if (input.document === '') return null
  if (input.slot === '') return null

  if (binding.mode === 'existing') {
    if (binding.subject === '') return null
    return [
      {
        op: 'update-concept',
        document: input.document,
        concept: { id: input.instance, parts: { [input.slot]: binding.subject } },
      },
    ]
  }

  if (!input.admits.includes(binding.kind)) return null
  const childName = binding.name.trim()
  if (childName === '') return null
  const childId = proposeConceptId(graph, childName, reserved)
  if (childId === null) return null
  return [
    {
      op: 'add-concept',
      document: input.document,
      concept: { id: childId, kind: binding.kind, name: childName },
    },
    {
      op: 'update-concept',
      document: input.document,
      concept: { id: input.instance, parts: { [input.slot]: childId } },
    },
  ]
}
