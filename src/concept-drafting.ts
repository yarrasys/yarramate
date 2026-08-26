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
