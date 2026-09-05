/**
 * A bound ruling drawn as a ROW inside the instance that holds it, rather than
 * as a box of its own (#473 phase 3, ADR 0145).
 *
 * Presentation, and only presentation. The model does not move, the query does
 * not move, and the selected set does not move: a reader turns
 * `presentation.showConstraints` off and the boxes come back. What changes is
 * that 82 of the reference's rulings stop being boxes carrying a single
 * association edge each, which takes the whole model from 173 boxes to 91.
 *
 * Pure, and separate from `graph-canvas.tsx` for the reason `slots-model.ts` is
 * separate: the arithmetic of which rulings belong to which box is a question
 * about the model, testable without a renderer, and a canvas that recomputed it
 * inline would be the only place it could be checked.
 */
import type { FoldMembership } from '../fold-tree.js'

/** What this module needs of a membership: the slot, the member, the holder and
 * the wiring. `PatternMembership` satisfies it; so does the canvas's
 * `FoldMembership`, which is what actually reaches the renderer. */
type Binding = FoldMembership

/** The core kind a ruling resolves to. Shared with `fold-tree.ts`'s rule 3. */
const RULING_CORE_KIND = 'constraint'

export interface ConstraintRow {
  /** The slot of the holding instance this ruling fills. */
  readonly slot: string
  readonly id: string
  readonly name: string
  /**
   * Who RULES it, by name, in id order.
   *
   * Measured on the reference: every one of the 82 rulings has its authored
   * edge from a ruler (`yarrasys`, `fgc-it-support`, `fgc-it-security`,
   * `guest-services-manager`), never from the holder, which reaches the ruling
   * only through the slot. Hide the ruling as a box and that edge has nowhere
   * to land, and a role whose every edge ran to a ruling becomes a box with no
   * edges at all. So the row carries the ruler and the reader still learns who
   * set the rule.
   */
  readonly rulers: readonly string[]
  /** Whether another instance binds the same ruling, which several do. */
  readonly shared: boolean
}

export interface ConstraintRowsResult {
  /** Rows per holding instance, in slot order. */
  readonly rowsByInstance: ReadonlyMap<string, readonly ConstraintRow[]>
  /** Rulings that became rows, and so are not drawn as nodes. */
  readonly hiddenNodeIds: ReadonlySet<string>
  /** Edges that ended on one, and so have nowhere to land. */
  readonly hiddenEdgeIds: ReadonlySet<string>
}

const EMPTY: ConstraintRowsResult = {
  rowsByInstance: new Map(),
  hiddenNodeIds: new Set(),
  hiddenEdgeIds: new Set(),
}

/**
 * Which rulings become rows, on which instances, and what that hides.
 *
 * `enabled` is a parameter rather than a caller-side branch so that the OFF
 * answer is this module's too: an empty result, which is what "draw everything
 * as boxes" means, and one place where that is decided.
 */
export function constraintRowsOf(
  graph: {
    readonly nodes: readonly {
      readonly id: string
      readonly name: string
      readonly coreKindLabel: string
    }[]
    readonly edges: readonly {
      readonly id: string
      readonly from: string
      readonly to: string
    }[]
  },
  memberships: readonly Binding[] = [],
  enabled = true,
): ConstraintRowsResult {
  if (!enabled) return EMPTY

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const isRuling = (id: string) =>
    nodeById.get(id)?.coreKindLabel === RULING_CORE_KIND

  // Only UNWIRED slots. A ruling wired `owned` or `context` is making a
  // statement about direction that a row cannot carry, and on the reference
  // every bound ruling fills an unwired slot.
  const bindings = memberships.filter(
    ({ member, wiring }) => wiring === 'unwired' && isRuling(member),
  )
  if (bindings.length === 0) return EMPTY

  const holdersOf = new Map<string, Set<string>>()
  for (const { member, instance } of bindings) {
    const holders = holdersOf.get(member)
    if (holders === undefined) holdersOf.set(member, new Set([instance]))
    else holders.add(instance)
  }

  // The ruler is whoever points AT the ruling from outside its own holders.
  // Reading it off the graph rather than naming the layers keeps it a rule
  // rather than a list: a list of business and motivation kinds would be right
  // for this reference and silently wrong for the next one, which is the ninth
  // rule (an allowlist cannot fail for the author who wrote it).
  const rulersOf = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!holdersOf.has(edge.to)) continue
    if (holdersOf.get(edge.to)?.has(edge.from) === true) continue
    const named = nodeById.get(edge.from)
    if (named === undefined) continue
    const rulers = rulersOf.get(edge.to)
    if (rulers === undefined) rulersOf.set(edge.to, [named.name])
    else if (!rulers.includes(named.name)) rulers.push(named.name)
  }

  const rowsByInstance = new Map<string, ConstraintRow[]>()
  for (const { member, instance, slot } of bindings) {
    const named = nodeById.get(member)
    if (named === undefined) continue
    const row: ConstraintRow = {
      slot,
      id: member,
      name: named.name,
      rulers: [...(rulersOf.get(member) ?? [])].sort(),
      shared: (holdersOf.get(member)?.size ?? 0) > 1,
    }
    const rows = rowsByInstance.get(instance)
    if (rows === undefined) rowsByInstance.set(instance, [row])
    else if (!rows.some((existing) => existing.id === row.id)) rows.push(row)
  }
  for (const rows of rowsByInstance.values()) {
    rows.sort((left, right) => left.slot.localeCompare(right.slot))
  }

  const hiddenNodeIds = new Set(holdersOf.keys())
  const hiddenEdgeIds = new Set(
    graph.edges
      .filter((edge) => hiddenNodeIds.has(edge.from) || hiddenNodeIds.has(edge.to))
      .map((edge) => edge.id),
  )
  return { rowsByInstance, hiddenNodeIds, hiddenEdgeIds }
}

/** One row as a reader sees it: `slot: name · ruler`, shared marked. */
export function constraintRowLabel(row: ConstraintRow): string {
  const rulers = row.rulers.length === 0 ? '' : ` · ${row.rulers.join(', ')}`
  return `${row.slot}: ${row.name}${rulers}${row.shared ? ' (shared)' : ''}`
}
