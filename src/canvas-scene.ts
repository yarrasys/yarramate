/**
 * What the canvas draws, as plain data (#577).
 *
 * Two steps, both pure, and the canvas itself runs both:
 *
 * 1. {@link canvasSceneInput} builds the scene's elements from the model:
 *    which box holds what, which folded box stands for what, which edges are
 *    drawn at all, and the edges lifted onto a folded box. `graphToElements`
 *    turns exactly this into cytoscape elements.
 * 2. {@link resolveCanvasScene} decides, for one view and one quick-filter
 *    text, what is on screen: the nodes, the boxes pulled in to hold them, the
 *    containment that holds while both ends are visible, what a folded box's
 *    chip counts, which edges draw and what a lifted edge's count says.
 *    `applyFilter` applies exactly this to the live canvas.
 *
 * So a host that draws the canvas's picture somewhere else, a server-side
 * figure renderer, reads the same decisions rather than restating them. A
 * restated copy was measured wrong twice in its edge labels alone (#576, #587).
 *
 * Positions are deliberately NOT here. Every rebuild, view switch and fold runs
 * ELK over what is visible, and a saved layout is pinned over the result
 * afterwards, so a subject the saved layout does not name is wherever ELK put
 * it; a box's bounds are cytoscape's, derived from its members. Neither can be
 * restated without the layout engine, and a host drawing an unsaved view
 * places it by its own rules.
 *
 * Imports nothing with a runtime of its own, so it ships on the
 * runtime-neutral `yarramate/adapter/visual-graph` subpath.
 */
import type { CanvasEdge, CanvasGraph } from './graph-projection.js'
import { foldGraph, foldTree, type FoldMembership, type FoldTree } from './fold-tree.js'
import type { NestingKind } from './nesting.js'
import { spansNesting } from './visual-app/nesting-span.js'
import { subjectMatchesQuickFilter } from './visual-app/subject-filter.js'

/** One node of the scene, carrying what {@link resolveCanvasScene} reads. */
export interface CanvasSceneNode {
  readonly id: string
  /** Matched by the quick filter, with `id` and `kindLabel`. */
  readonly name?: string
  readonly kindLabel?: string
  /** The box the model nests this in, whether or not it is drawn nested. */
  readonly parent?: string
  /** Drawn folded: everything under it is hidden and its edges lifted to it. */
  readonly folded: boolean
  /** Everything nested under it, at any depth, over the whole model. */
  readonly insideIds: readonly string[]
}

/** One edge of the scene: a drawn relationship, or one lifted onto a fold. */
export interface CanvasSceneEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  /**
   * Present only on a lifted edge (`lift:` ids): the relationships it stands
   * for. Such an edge draws while the view selected any of them.
   */
  readonly relationshipIds?: readonly string[]
  /** A lifted edge's kind, as its label names it. */
  readonly liftedKind?: string
}

export interface CanvasSceneInput {
  readonly nodes: readonly CanvasSceneNode[]
  /**
   * The drawn relationships (nesting-consumed and, unless shown,
   * responsibility edges already left out), then the lifted edges.
   */
  readonly edges: readonly CanvasSceneEdge[]
  /** For the caller's own warnings: nesting conflicts and cycles. */
  readonly tree: FoldTree
}

export interface CanvasSceneFold {
  /** Which instances draw folded. Empty or absent draws everything. */
  readonly folded?: ReadonlySet<string>
  /** From the model frame; without them only view nesting contains anything. */
  readonly memberships?: readonly FoldMembership[]
  /** Whether responsibility edges are drawn (#557, ADR 0159). */
  readonly showResponsibility?: boolean
}

/** The drawn relationships: what nesting did not consume, and RACI only if shown. */
export function drawnCanvasEdges(
  graph: Pick<CanvasGraph, 'edges'>,
  tree: Pick<FoldTree, 'consumedEdgeIds'>,
  showResponsibility: boolean,
): CanvasEdge[] {
  return graph.edges.filter(
    (edge) =>
      !tree.consumedEdgeIds.has(edge.id) &&
      (showResponsibility || (edge.responsibility ?? null) === null),
  )
}

/**
 * The scene's elements for a model, before any view narrows them. What
 * `graphToElements` builds cytoscape elements from.
 */
export function canvasSceneInput(
  graph: CanvasGraph,
  nesting: readonly NestingKind[],
  fold: CanvasSceneFold = {},
): CanvasSceneInput {
  // CORE kinds, not the authored ones (#473): the rule that decides whether
  // an assignment may nest reads what a subject IS.
  const tree = foldTree({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      coreKind: node.coreKindLabel,
    })),
    edges: graph.edges,
    memberships: fold.memberships ?? [],
    nesting,
  })

  // What each box stands for, over the WHOLE tree rather than what a view
  // shows; `resolveCanvasScene` narrows the chip to the view.
  const insideIds = new Map<string, string[]>()
  for (const id of tree.parentOf.keys()) {
    let ancestor = tree.parentOf.get(id)
    const seen = new Set<string>([id])
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor)
      const held = insideIds.get(ancestor)
      if (held === undefined) insideIds.set(ancestor, [id])
      else held.push(id)
      ancestor = tree.parentOf.get(ancestor)
    }
  }
  const folded = fold.folded ?? new Set<string>()

  const nodes = graph.nodes.map((node): CanvasSceneNode => {
    const parent = tree.parentOf.get(node.id)
    return {
      id: node.id,
      name: node.name,
      kindLabel: node.kindLabel,
      ...(parent === undefined ? {} : { parent }),
      folded: folded.has(node.id),
      insideIds: insideIds.get(node.id) ?? [],
    }
  })

  const drawn = drawnCanvasEdges(graph, tree, fold.showResponsibility === true)
  // Every relationship with an end inside a shut box, lifted onto the box
  // (#473). The originals stay: the view hides them, so opening the box has
  // nothing to rebuild.
  const lifted =
    folded.size === 0
      ? []
      : foldGraph({ nodes: graph.nodes, edges: drawn }, tree, folded).edges.flatMap(
          (edge): CanvasSceneEdge[] =>
            'count' in edge
              ? [
                  {
                    id: edge.id,
                    from: edge.from,
                    to: edge.to,
                    relationshipIds: edge.relationshipIds,
                    liftedKind: edge.kind,
                  },
                ]
              : [],
        )

  return {
    nodes,
    edges: [...drawn.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })), ...lifted],
    tree,
  }
}

/** What one view, with one quick-filter text, puts on screen. */
export interface CanvasScene {
  /** The nodes drawn: matched, surviving the filter, pulled in, not folded away. */
  readonly visibleNodeIds: ReadonlySet<string>
  /** Of those, the boxes drawn only to hold something the view matched. */
  readonly contextNodeIds: ReadonlySet<string>
  /** Containment as drawn: a node sits in its box only while both are visible. */
  readonly parentOf: ReadonlyMap<string, string>
  /** For each folded node: how many of what it holds this view selected. */
  readonly insideCount: ReadonlyMap<string, number>
  /** The edges drawn, lifted ones included. */
  readonly visibleEdgeIds: ReadonlySet<string>
  /** For each lifted edge: how many of its relationships this view selected. */
  readonly liftedCount: ReadonlyMap<string, number>
  /**
   * Edges between a box and something nested in it, left undrawn: the nesting
   * already says it (ADR 0147). Whether or not they would otherwise draw.
   */
  readonly impliedEdgeIds: ReadonlySet<string>
  /**
   * What a saved layout names for this view (#578): the matched subjects and
   * the boxes that hold them, before the filter or a fold hides any. Null
   * when no view narrows the canvas.
   */
  readonly viewNodeIds: ReadonlySet<string> | null
}

/**
 * What the canvas shows for a view. `matchedIds` is the view's match set, or
 * null when no view narrows the canvas; it may name relationships as well as
 * subjects. An edge draws only where the view selected it AND both its ends
 * are drawn (#579, ADR 0164).
 */
export function resolveCanvasScene(
  input: Pick<CanvasSceneInput, 'nodes' | 'edges'>,
  matchedIds: readonly string[] | null,
  quickFilterText: string,
): CanvasScene {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const parentOfModel = (id: string): string | undefined => nodeById.get(id)?.parent
  const filter = quickFilterText.trim().toLowerCase()

  // A match set names relationships too; only its subjects seed the nodes.
  const baseIds =
    matchedIds === null ? input.nodes.map((node) => node.id) : matchedIds.filter((id) => nodeById.has(id))
  const baseVisible = new Set(
    baseIds.filter((id) => {
      const node = nodeById.get(id)!
      return subjectMatchesQuickFilter(filter, id, node.name, node.kindLabel)
    }),
  )

  // A nested part is drawn in its box, so every visible node's ancestor chain
  // is pulled in.
  const visible = new Set(baseVisible)
  for (const id of baseVisible) {
    const seen = new Set<string>([id])
    let ancestor = parentOfModel(id)
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor)
      visible.add(ancestor)
      ancestor = parentOfModel(ancestor)
    }
  }

  // A FOLDED ancestor hides everything under it, whatever the view said
  // (#473): a reader who shut a box asked not to see inside it.
  for (const id of [...visible]) {
    const seen = new Set<string>([id])
    let ancestor = parentOfModel(id)
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor)
      if (nodeById.get(ancestor)?.folded === true) {
        visible.delete(id)
        break
      }
      ancestor = parentOfModel(ancestor)
    }
  }

  // Containment is a rendering device: it holds only while both ends are drawn.
  const parentOf = new Map<string, string>()
  for (const node of input.nodes) {
    if (node.parent !== undefined && visible.has(node.id) && visible.has(node.parent)) {
      parentOf.set(node.id, node.parent)
    }
  }

  // The chip counts what THIS VIEW shows: a member hidden by its own box still
  // counts, one the view never selected does not.
  const insideCount = new Map<string, number>()
  for (const node of input.nodes) {
    if (!node.folded) continue
    insideCount.set(
      node.id,
      node.insideIds.filter((id) => nodeById.has(id) && baseVisible.has(id)).length,
    )
  }

  const selected = matchedIds === null ? null : new Set(matchedIds)
  const liftedCount = new Map<string, number>()
  for (const edge of input.edges) {
    if (edge.relationshipIds === undefined) continue
    liftedCount.set(
      edge.id,
      selected === null
        ? edge.relationshipIds.length
        : edge.relationshipIds.filter((id) => selected.has(id)).length,
    )
  }
  const viewSelected = (edge: CanvasSceneEdge): boolean =>
    selected === null ||
    (edge.relationshipIds !== undefined
      ? edge.relationshipIds.some((id) => selected.has(id))
      : selected.has(edge.id))

  const impliedEdgeIds = new Set(
    input.edges.filter((edge) => spansNesting(edge.from, edge.to, parentOf)).map((edge) => edge.id),
  )
  const visibleEdgeIds = new Set(
    input.edges
      .filter(
        (edge) =>
          visible.has(edge.from) &&
          visible.has(edge.to) &&
          viewSelected(edge) &&
          !impliedEdgeIds.has(edge.id),
      )
      .map((edge) => edge.id),
  )

  let viewNodeIds: Set<string> | null = null
  if (matchedIds !== null) {
    viewNodeIds = new Set(baseIds)
    for (const id of baseIds) {
      let ancestor = parentOfModel(id)
      while (ancestor !== undefined && !viewNodeIds.has(ancestor)) {
        viewNodeIds.add(ancestor)
        ancestor = parentOfModel(ancestor)
      }
    }
  }

  return {
    visibleNodeIds: visible,
    contextNodeIds: new Set([...visible].filter((id) => !baseVisible.has(id))),
    parentOf,
    insideCount,
    visibleEdgeIds,
    liftedCount,
    impliedEdgeIds,
    viewNodeIds,
  }
}
