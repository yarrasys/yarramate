/**
 * What contains what on a canvas, and what a folded container draws instead of
 * its contents (#473).
 *
 * Two questions, one module, because they are the same question asked twice. A
 * VIEW says which relationships nest (ADR 0101); a PATTERN says which subjects
 * are parts of an instance (ADR 0123). Both produce a parent-of map over the
 * same node ids, and folding reads that one map. Answering them apart would
 * mean two trees that can disagree about who owns a node.
 *
 * Imports nothing but the `NestingKind` type, and that from `./nesting.js`,
 * which itself imports nothing. The same weight argument that split
 * `nesting.ts` out of `projection.ts` applies here and harder: this module is
 * reached from `yarramate/adapter/visual-graph`, the runtime-neutral subpath a
 * Durable Object imports, where `node:module` and Ajv are not available at any
 * price. `test/visual-app-browser-safety.test.ts` is what holds that line.
 *
 * Everything here is a pure function over plain data. The canvas adapts its own
 * shapes to {@link FoldInput}; nothing in this file knows what cytoscape is.
 */

import type { NestingKind } from './nesting.js'

const COMPOSITION_RELATIONSHIP_KIND = 'yarramate/core@0.1#composition'
const ASSIGNMENT_RELATIONSHIP_KIND = 'yarramate/core@0.1#assignment'

/**
 * A view names which relationships nest, in precedence order (ADR 0101). The
 * short names a projection is authored in resolve to the kind identities the
 * graph carries, in one place, so the schema's vocabulary and the canvas's
 * cannot drift.
 */
export const NESTING_KIND_IDS: Readonly<Record<NestingKind, string>> = {
  composition: COMPOSITION_RELATIONSHIP_KIND,
  assignment: ASSIGNMENT_RELATIONSHIP_KIND,
}

/**
 * A subject the model states a ruling about rather than a part of a thing.
 *
 * A ruling never becomes a node inside a folded box (review F5). Nesting a
 * rate limit inside the API it constrains would draw a policy as though it were
 * machinery, and a ruling is routinely shared by several instances, which a
 * single-parent tree cannot represent anyway. Phase 3 gives them rows; until
 * then they stay where they are.
 *
 * Keyed on the CORE kind, so a profile's `rate-limit-constraint` is caught by
 * the same rule as a bare `constraint` without anyone listing subkinds.
 */
const RULING_CORE_KINDS: ReadonlySet<string> = new Set(['constraint'])

/**
 * Whether a view draws pattern instances folded by default (#473).
 *
 * Lives here rather than in `projection.ts` for the reason `nesting.ts` exists:
 * the browser needs the VALUE, and `projection.ts` drags Ajv and the projection
 * schema in behind it. `projection.ts` re-exports both.
 */
export type FoldMode = 'instances' | 'none'

/**
 * What a view folds when it does not say: nothing. Folding hides detail, and a
 * view that hid detail without being asked would be a surprise its author never
 * wrote down.
 */
export const DEFAULT_FOLD: FoldMode = 'none'

/** One node, reduced to what containment needs to know about it. */
export interface FoldNode {
  readonly id: string
  /** The kind as authored, profile-qualified or not. Unused by the rules here. */
  readonly kind: string
  /**
   * The core-vocabulary kind this resolves to. Every rule below reads THIS and
   * never `kind`: a profile's `mule-api-operation` is an `applicationService`
   * and must be treated as one, and the label it happens to carry is not a
   * fact about what it is.
   */
  readonly coreKind: string
}

/** One relationship, reduced to what containment needs to know about it. */
export interface FoldEdge {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
}

/** How a pattern's wiring relates a slot to the instance that declares it. */
export type SlotWiring = 'owned' | 'context' | 'unwired'

/** One bound slot, as {@link foldTree} needs it. */
export interface FoldMembership {
  readonly member: string
  readonly slot: string
  readonly instance: string
  readonly wiring?: SlotWiring
}

export interface FoldInput {
  readonly nodes: readonly FoldNode[]
  readonly edges: readonly FoldEdge[]
  readonly memberships: readonly FoldMembership[]
  readonly nesting: readonly NestingKind[]
}

/**
 * Two parents claiming one child at the same precedence. Returned rather than
 * resolved: picking a winner would hide a real modelling anomaly behind a
 * layout that looks deliberate. The caller renders the child unnested and says
 * so, which is what composition alone already did.
 */
export interface NestingConflict {
  readonly child: string
  readonly claims: readonly {
    readonly edgeId: string
    readonly kind: string
    readonly from: string
  }[]
}

export interface FoldTree {
  readonly parentOf: ReadonlyMap<string, string>
  readonly consumedEdgeIds: ReadonlySet<string>
  readonly conflicts: readonly NestingConflict[]
  /** Ids left unnested because their parent chain loops. */
  readonly cycleMembers: readonly string[]
}

/**
 * Assignment nests internal behaviour, never a service — except where the
 * source is an interface, which is what exposing a service means (ADR 0101, as
 * amended by #473).
 *
 * A service is the promise the layer above consumes, so burying it inside the
 * component that implements it inverts what it is for. But an interface
 * assigned a service is the opposite relation: the interface is the exposure,
 * and the service is what it exposes, so the service belongs inside it.
 *
 * Both tests read CORE kinds. The rule this replaces tested the profile kind's
 * label, so a profile that named a service `mule-api-operation` slipped through
 * and nested while a plain `applicationService` beside it did not — the same
 * relation drawn two ways depending on what somebody called it.
 */
const nestsAsAssignment = (
  edge: FoldEdge,
  coreKindOf: (id: string) => string,
): boolean =>
  !coreKindOf(edge.to).endsWith('Service') ||
  coreKindOf(edge.from).endsWith('Interface')

/**
 * The parent-of map a view's nesting kinds imply.
 *
 * The compiler's `YM501` rule rejects one pair declaring both composition and
 * aggregation; it does not reject two different compositions naming one child,
 * which a single-parent field cannot represent either, nor a composition chain
 * that loops. Both are real modelling anomalies, surfaced here rather than
 * silently resolved: affected subjects come back unnested and every edge naming
 * them stays an ordinary line, so the conflicting claims remain visible.
 */
export function nestingTree(
  edges: readonly FoldEdge[],
  nesting: readonly NestingKind[],
  coreKindOf: (id: string) => string,
): FoldTree {
  // Precedence is the order the view listed: a child claimed by a composition
  // and by an assignment nests under the composition.
  const rankOf = new Map(
    nesting.map((kind, rank) => [NESTING_KIND_IDS[kind], rank]),
  )
  const nestingEdges = edges.filter(
    (edge) =>
      rankOf.has(edge.kind) &&
      (edge.kind !== ASSIGNMENT_RELATIONSHIP_KIND ||
        nestsAsAssignment(edge, coreKindOf)),
  )

  const claimsByChild = new Map<string, FoldEdge[]>()
  for (const edge of nestingEdges) {
    const claims = claimsByChild.get(edge.to)
    if (claims === undefined) claimsByChild.set(edge.to, [edge])
    else claims.push(edge)
  }

  const parentOf = new Map<string, string>()
  const conflicts: NestingConflict[] = []
  for (const [child, claims] of claimsByChild) {
    // Only claims at the best rank compete. Two of them naming different
    // parents stays undecidable and falls through to unnested.
    const best = Math.min(...claims.map((claim) => rankOf.get(claim.kind)!))
    const winners = claims.filter((claim) => rankOf.get(claim.kind) === best)
    const parents = new Set(winners.map((claim) => claim.from))
    if (parents.size === 1) {
      parentOf.set(child, winners[0]!.from)
    } else {
      conflicts.push({
        child,
        claims: winners.map((claim) => ({
          edgeId: claim.id,
          kind: claim.kind,
          from: claim.from,
        })),
      })
    }
  }

  const cycleMembers = unnestCycles(parentOf)

  const consumedEdgeIds = new Set<string>()
  for (const edge of nestingEdges) {
    if (parentOf.get(edge.to) === edge.from) consumedEdgeIds.add(edge.id)
  }

  return { parentOf, consumedEdgeIds, conflicts, cycleMembers }
}

/**
 * Walk each child's parent chain; an id revisited before the chain runs out
 * marks a cycle. Only the cycle itself is unnested, not whatever leads into it:
 * a straight-line ancestor of a cycle is still validly nested under its own
 * non-cyclic parent. Mutates `parentOf` and returns what it removed.
 */
/** Whether `id` sits anywhere inside `ancestor` in the tree built so far. */
const isDescendantOf = (
  id: string,
  ancestor: string,
  parentOf: ReadonlyMap<string, string>,
): boolean => {
  const seen = new Set<string>([id])
  let current = parentOf.get(id)
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true
    seen.add(current)
    current = parentOf.get(current)
  }
  return false
}

function unnestCycles(parentOf: Map<string, string>): readonly string[] {
  const cycleMembers = new Set<string>()
  for (const start of parentOf.keys()) {
    const path: string[] = []
    const indexInPath = new Map<string, number>()
    let current: string | undefined = start
    while (current !== undefined) {
      const seenAt = indexInPath.get(current)
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cycleMembers.add(id)
        break
      }
      indexInPath.set(current, path.length)
      path.push(current)
      current = parentOf.get(current)
    }
  }
  for (const id of cycleMembers) parentOf.delete(id)
  return [...cycleMembers]
}

/**
 * The lowest node that contains every one of `ids`, counting each id as an
 * ancestor of itself, or `undefined` when they do not share one.
 *
 * "Counting each id as an ancestor of itself" is the part that matters: where
 * one holder already sits inside another, the answer is the outer holder rather
 * than something above them both.
 */
const lowestCommonAncestor = (
  ids: readonly string[],
  parentOf: ReadonlyMap<string, string>,
): string | undefined => {
  const chainOf = (id: string): string[] => {
    const chain: string[] = []
    const seen = new Set<string>()
    let current: string | undefined = id
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      chain.push(current)
      current = parentOf.get(current)
    }
    return chain
  }
  const [first, ...rest] = ids
  if (first === undefined) return undefined
  const others = rest.map((id) => new Set(chainOf(id)))
  // Walking the first chain from the node OUTWARDS makes the first hit the
  // lowest by construction.
  return chainOf(first).find((candidate) =>
    others.every((chain) => chain.has(candidate)),
  )
}

/**
 * The containment tree: what a view nests, plus what a pattern owns.
 *
 * A slot member joins the tree only when all of these hold, and each condition
 * is a different way of getting the answer wrong:
 *
 * - **Held inside one box.** A member's HOLDERS are every instance whose slots
 *   name it. One holder puts the member in that holder. Several put it in their
 *   lowest common ancestor, which is the level at which the holders diverge and
 *   therefore the innermost box that contains all of them. Holders with no
 *   common ancestor leave the member outside, because there is no one box it
 *   sits within and a single-parent tree would have to pick.
 *
 *   This AMENDS ADR 0143's "Exclusive" rule, which kept every shared subject
 *   outside (#473 phase 3, ADR 0145, Nabeel's decision of 2026-09-05). The
 *   original reasoning was that two owners force a silent choice; it is only
 *   true when the owners sit in different boxes. Where both already sit under
 *   one box there is nothing to choose, and the old rule left 14 of the
 *   reference Landscape's 30 data objects outside the single application whose
 *   own parts were the things binding them.
 * - **`owned` or `unwired`, never `context` alone.** A context slot names
 *   something the instance USES and does not contain — the upstream API it
 *   calls, the plane it runs on. Folding those would swallow half the landscape
 *   into whichever box happened to reference it. At least one binding must be
 *   `owned` or `unwired` for the member to fold at all.
 * - **Not a ruling.** See {@link RULING_CORE_KINDS}.
 *
 * A view's own nesting wins where both apply: the view is the more specific
 * statement, and a reader who wrote `nesting: [composition]` meant it.
 */
export function foldTree(input: FoldInput): FoldTree {
  const coreKindById = new Map(
    input.nodes.map((node) => [node.id, node.coreKind]),
  )
  const coreKindOf = (id: string) => coreKindById.get(id) ?? ''
  const fromNesting = nestingTree(input.edges, input.nesting, coreKindOf)

  const instancesOf = new Map<string, Set<string>>()
  for (const membership of input.memberships) {
    const instances = instancesOf.get(membership.member)
    if (instances === undefined)
      instancesOf.set(membership.member, new Set([membership.instance]))
    else instances.add(membership.instance)
  }

  // Whether ANY of a member's bindings is one the instance holds it out by. A
  // member bound only through context slots never folds, however many hold it.
  const heldOutSomewhere = new Set<string>()
  for (const membership of input.memberships) {
    if (membership.wiring !== 'context') heldOutSomewhere.add(membership.member)
  }

  const parentOf = new Map(fromNesting.parentOf)

  const candidates = [
    ...new Set(
      input.memberships
        .map(({ member }) => member)
        .filter(
          (member) =>
            // A view's own nesting already placed it, and the view wins.
            !parentOf.has(member) &&
            heldOutSomewhere.has(member) &&
            !RULING_CORE_KINDS.has(coreKindOf(member)) &&
            // A node the input does not carry cannot be drawn inside anything.
            coreKindById.has(member) &&
            // Something that holds itself is not held by anything.
            instancesOf.get(member)?.has(member) !== true,
        ),
    ),
  ]

  // Resolved in ROUNDS rather than one pass, because a member's holders may
  // themselves be members whose own parents are decided here. Placing a member
  // before its holders are settled would measure the lowest common ancestor
  // against a tree that is still missing the levels that separate them, and the
  // reference has five-deep chains (spec, mapping, call, client, application),
  // so this is exercised rather than theoretical.
  //
  // A member is settled once it is placed or once it is known to stay outside.
  // Whatever a round cannot decide it hands to the next; when a round decides
  // nothing, what is left is a mutual dependency and stays outside, which is the
  // same answer the cycle guard below would reach for it anyway.
  let pending = candidates
  while (pending.length > 0) {
    const deferred: string[] = []
    let decided = false
    for (const member of pending) {
      const holders = [...(instancesOf.get(member) ?? [])]
      if (holders.some((holder) => pending.includes(holder) && holder !== member)) {
        deferred.push(member)
        continue
      }
      decided = true
      const parent =
        holders.length === 1
          ? holders[0]
          : lowestCommonAncestor(holders, parentOf)
      if (parent === undefined || parent === member) continue
      // A member that already contains one of its holders cannot also sit
      // inside it. The cycle guard below is the backstop, not the rule.
      if (holders.some((holder) => isDescendantOf(holder, member, parentOf))) {
        continue
      }
      parentOf.set(member, parent)
    }
    if (!decided) break
    pending = deferred
  }

  // Slot membership can close a loop the view's nesting alone did not, so the
  // guard runs again over the combined tree rather than trusting the first.
  const cycleMembers = [
    ...fromNesting.cycleMembers,
    ...unnestCycles(parentOf),
  ]

  return {
    parentOf,
    consumedEdgeIds: fromNesting.consumedEdgeIds,
    conflicts: fromNesting.conflicts,
    cycleMembers,
  }
}

/** An edge that stands for one or more relationships hidden inside a fold. */
export interface LiftedEdge {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly count: number
  readonly relationshipIds: readonly string[]
}

/** The id a lifted edge takes. Deterministic, so a re-render is stable. */
export const liftedEdgeId = (from: string, to: string, kind: string): string =>
  `lift:${from}|${to}|${kind}`

/**
 * The nearest ancestor that is visible: the outermost folded ancestor if there
 * is one, otherwise the node itself.
 */
const visibleAncestorOf = (
  id: string,
  parentOf: ReadonlyMap<string, string>,
  folded: ReadonlySet<string>,
): string => {
  let visible = id
  let current: string | undefined = parentOf.get(id)
  const seen = new Set<string>([id])
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (folded.has(current)) visible = current
    current = parentOf.get(current)
  }
  return visible
}

/**
 * What the canvas draws once some instances are folded.
 *
 * A folded instance KEEPS its own node — it is still a subject, still
 * selectable, still the thing a question is about — and gains what it is
 * standing in for. Its descendants leave the output, and every edge with an end
 * inside it is lifted to the box.
 *
 * Lifted edges of one kind between one ordered pair merge into a single edge
 * carrying `count` and the ids it stands for, so seven `serving` relationships
 * between two applications draw as one line labelled ×7 rather than as seven
 * lines the reader has to count. An edge whose ends fold into the SAME box
 * vanishes: it is internal, and the box is the statement now.
 */
export function foldGraph<
  N extends { readonly id: string },
  E extends {
    readonly id: string
    readonly kind: string
    readonly from: string
    readonly to: string
  },
>(
  graph: { readonly nodes: readonly N[]; readonly edges: readonly E[] },
  tree: Pick<FoldTree, 'parentOf'>,
  folded: ReadonlySet<string>,
): {
  readonly nodes: (N & {
    readonly folded: boolean
    readonly insideIds: readonly string[]
  })[]
  readonly edges: (E | LiftedEdge)[]
} {
  const visibleOf = new Map<string, string>()
  for (const node of graph.nodes) {
    visibleOf.set(node.id, visibleAncestorOf(node.id, tree.parentOf, folded))
  }

  const insideIds = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const visible = visibleOf.get(node.id)!
    if (visible === node.id) continue
    const inside = insideIds.get(visible)
    if (inside === undefined) insideIds.set(visible, [node.id])
    else inside.push(node.id)
  }

  const nodes = graph.nodes
    .filter((node) => visibleOf.get(node.id) === node.id)
    .map((node) => ({
      ...node,
      folded: folded.has(node.id),
      insideIds: (insideIds.get(node.id) ?? []) as readonly string[],
    }))

  const edges: (E | LiftedEdge)[] = []
  const lifted = new Map<string, { edge: LiftedEdge; ids: string[] }>()
  for (const edge of graph.edges) {
    const from = visibleOf.get(edge.from) ?? edge.from
    const to = visibleOf.get(edge.to) ?? edge.to
    if (from === edge.from && to === edge.to) {
      edges.push(edge)
      continue
    }
    // Both ends inside one box: the relationship is internal to what the box
    // now stands for, and drawing it as a self-loop would say nothing.
    if (from === to) continue
    const id = liftedEdgeId(from, to, edge.kind)
    const held = lifted.get(id)
    if (held === undefined) {
      lifted.set(id, {
        edge: { id, kind: edge.kind, from, to, count: 1, relationshipIds: [edge.id] },
        ids: [edge.id],
      })
    } else {
      held.ids.push(edge.id)
    }
  }
  for (const { edge, ids } of lifted.values()) {
    edges.push({ ...edge, count: ids.length, relationshipIds: ids })
  }

  return { nodes, edges }
}
