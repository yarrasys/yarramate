import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue, ElementDefinition, NodeCollection, NodeSingular } from 'cytoscape'
import elk from 'cytoscape-elk'
import type {
  CanvasGraph,
  CanvasNode,
  CanvasEdge,
} from '../graph-projection.js'
import { DEFAULT_NESTING, type NestingKind } from '../nesting.js'
import type {
  VisualLayoutPositions,
  VisualLayoutSavePayload,
} from '../adapters/visual/protocol-contract.js'
import {
  EVIDENCE_BADGE_URI,
  LIFECYCLE_BADGE_URI,
  isLifecycleStatus,
  openQuestionsBadgeUri,
  ownerBadgeUri,
  ownerInitialsOf,
} from './badges.js'
import { ICON_SIZE, kindIconUriOf } from './kind-icons.js'
import { KIND_MIME } from './kind-palette.js'
import { ASPECT_SHAPES, LAYER_COLORS, RELATIONSHIP_NOTATION } from '../notation/archimate.js'

// Register elk extension once at module load, guarded against re-registration
let elkRegistered = false
if (!elkRegistered) {
  cytoscape.use(elk)
  elkRegistered = true
}

// Re-exported so `badges.test.ts` (and any other existing consumer of this
// module's `LAYER_COLORS`) keeps working - the palette itself now lives in
// `src/notation/archimate.ts`, the single source of truth shared with any
// future standalone notation consumer.
export { LAYER_COLORS }

// Base node fill/border, used when a node has no `layer` attribute at all
// (falls through every `node[layer = "…"]` rule below) and reused as the
// passive-structure gradient's two stop colors further down. `physical` and
// `composite` resolve through `LAYER_COLORS` to these same values now, not
// through this fallback - they carry an explicit neutral row of their own.
const DEFAULT_FILL = '#F0F0F0'
const DEFAULT_BORDER = '#999999'

// `width: 'label'` / `height: 'label'` are deprecated in cytoscape.js (and, at this
// graph's scale with wrapped text, crash inside cytoscape's style-hint pool during
// `elements().remove()`). Every node gets the same fixed box regardless of label
// length - wrapped text that doesn't fit the box simply overflows it, the standard
// tradeoff diagram tools make for uniform node sizing.
const NODE_WIDTH = 170
const NODE_HEIGHT = 50
const LABEL_MAX_TEXT_WIDTH = 150

// Edge labels are free-floating text at a route midpoint with no box to sit
// in, so they wrap narrower than node labels - a tall, narrow label intrudes
// on far fewer neighbours than a wide, flat one.
const EDGE_LABEL_MAX_TEXT_WIDTH = 110

// Cytoscape's `text-wrap: 'wrap'` only breaks lines on whitespace (or an
// explicit zero-width space - `separatorRegex` in cytoscape's own text-layout
// code matches `[\s\u200b]+`). Identifiers with no whitespace - repo-relative
// file paths, dotted schema names, hyphenated ids - have no break opportunity
// at all, so instead of wrapping at `text-max-width` they render as one
// unbroken line that overflows the fixed node box into neighboring nodes.
// Inserting a zero-width space after each path/word separator gives the wrap
// engine somewhere to break without changing a single visible character, so
// it stays a rendering-only concern - the underlying `label`/`name` used for
// quick-filter substring matching is never touched.
const WRAP_POINT = '\u200b'
function withWrapPoints(text: string): string {
  return text.replace(/([/._-])/g, `$1${WRAP_POINT}`)
}

// ELK layout options: extends base layout with elk-specific config not in
// cytoscape's types. `nodeLayoutOptions` is cytoscape-elk's only per-node hook
// (`makeNode` calls it for every node and assigns the result to that node's
// ELK `layoutOptions`). `elk.direction` stays optional on the type because it
// describes elk's option bag rather than this canvas's use of it: `layered`
// reads it, other algorithms ignore it entirely.
interface ElkLayoutOptions extends Record<string, unknown> {
  name: 'elk'
  elk: {
    algorithm: string
    'elk.direction'?: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT'
    [key: string]: unknown
  }
  nodeLayoutOptions?: (node: cytoscape.NodeSingular) => Record<string, unknown> | undefined
}

// cytoscape draws a compound parent's box itself - cytoscape-elk only feeds
// positions back for leaf nodes (`nodes.filter((n) => !n.isParent())`), so the
// container rectangle is its children's bounding box grown by cytoscape's own
// `padding`. ELK independently reserves `elk.padding` around each child cluster
// when spacing siblings apart. If cytoscape's padding is the larger of the two,
// every container is drawn wider than the room ELK left for it and neighbouring
// boxes close up until they touch - so the two numbers must stay equal.
const CONTAINER_PADDING = 30

// Extra room ELK leaves above the children that cytoscape does not draw into,
// giving the container's own label - rendered outside the box by
// `text-valign: top` - somewhere to sit that isn't the box above it.
const CONTAINER_LABEL_GAP = 22

// Padding left around the graph when reframing after a canvas resize. Matches
// cytoscape-elk's own `padding: 20` fit default, so a resize-driven refit lands
// on the same framing the layout would have produced at the new canvas size.
const FIT_PADDING = 20

// Spacing, shared by the root graph and every compound container.
//
// ELK's defaults are ~20px throughout, which is too tight for 170x50 nodes
// carrying wrapped labels, and it does not account for edge labels at all:
// cytoscape-elk's `makeEdge` sends only id/source/target, never `labels[]`, so
// ELK reserves no midpoint space for the relationship text cytoscape then
// draws there. The between-layer gap therefore has to cover the edge label as
// well as the edge.
//
// A graph's layout options govern only that graph's own children, and
// cytoscape-elk sets them on the root graph alone, so each container is laid
// out as a separate child graph that would otherwise fall back to those ~20px
// defaults - measured: nodes inside a container sat 18px apart while their
// siblings outside sat 58px apart. Handing the same spacing to every parent
// through `nodeLayoutOptions` closes that gap. (`elk.hierarchyHandling:
// INCLUDE_CHILDREN` does not: measured on the 289-node graph it left the
// in-container gap at the default and widened the layout from 28.5k to 35k px.
// Direction is deliberately not passed down - ELK ignores it on child graphs,
// verified by identical container boxes for DOWN and RIGHT.)
const ELK_SPACING: Record<string, unknown> = {
  // Between siblings in the same layer.
  'elk.spacing.nodeNode': 60,
  // Across layers - the axis edge labels are drawn on.
  'elk.layered.spacing.nodeNodeBetweenLayers': 100,
  // Keep routed edges off the node boxes they pass.
  'elk.spacing.edgeNode': 30,
  'elk.layered.spacing.edgeNodeBetweenLayers': 30,
  // Keep parallel edges apart so their labels do not stack.
  'elk.spacing.edgeEdge': 20,
  'elk.layered.spacing.edgeEdgeBetweenLayers': 20,
  // Disconnected subgraphs read as separate clusters, not one mass.
  'elk.spacing.componentComponent': 80,
  'elk.padding': `[top=${CONTAINER_PADDING + CONTAINER_LABEL_GAP},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
}

// Shared by the full-graph layout effect and the visible-subgraph relayout
// that runs on view switch, so both always agree on algorithm and direction.
//
//
// One backend. `radial` (cytoscape `concentric`) and `force` (elk `stress`
// then `sporeOverlap`) were measured against `layered` on every view of the
// contact-update journey and lost on all three counts that matter: edge
// crossings, total edge length, and how large the graph draws once fitted to
// the canvas. They are removed rather than deprecated, and the `seed` only
// `force` ever read went with them - the projection schema had required a
// seed of every view that declared a layout at all, for one backend's benefit.
//
// `elk.direction` is read only by `layered`, and it is `DOWN`: ArchiMate's
// layer bands only read top-down, so a left-right run would draw bands
// corresponding to nothing. This used to be a pin applied over a reviewer's
// stored `direction`, kept so that returning to native notation restored what
// they declared. There is no native notation to return to, so the pin is now
// simply the value. `presentation.direction` stays in the projection format:
// the LikeC4 export reads it for its own `autoLayout`, which is not drawing
// ArchiMate bands and has no reason to be held top-down.
export function buildLayoutConfig(): cytoscape.LayoutOptions {
  const elk: ElkLayoutOptions['elk'] = {
    algorithm: 'layered',
    'elk.direction': 'DOWN',
    ...ELK_SPACING,
  }
  const config: ElkLayoutOptions = {
    name: 'elk',
    elk,
    nodeLayoutOptions: (node) => (node.isParent() ? ELK_SPACING : undefined),
  }
  return config as unknown as cytoscape.LayoutOptions
}

// Badge layer geometry: cytoscape has no single "layer" style value - each
// `background-*` property below takes its own same-length array, and index
// `i` across all of them describes one badge. `badgeLayersFor` is the one
// place that decides which badges exist and in what order, so the seven
// mapper functions in the `node` rule below can never disagree on length.
interface BadgeLayer {
  readonly image: string
  readonly positionX: string
  readonly positionY: string
  readonly size: number
}

// One node's seven badge style values, pre-split into the parallel arrays
// cytoscape wants. Held together so the seven mappers can never disagree on
// length even though each is asked for its own property separately.
interface BadgeStyleArrays {
  readonly images: string[]
  readonly positionsX: string[]
  readonly positionsY: string[]
  readonly sizes: number[]
  readonly containments: 'over'[]
  readonly clips: 'none'[]
}

const BADGE_SIZE = 12
// Kind icon top-left, lifecycle top-right, evidence
// bottom-left, ownership bottom-right - each corner gets at most one image on
// it, so none ever overlap on a single node. The open-questions chip (#292)
// also lives bottom-right but inset from the corner, and steps aside when
// the ownership chip is drawn. Plan Task 10 named the top-right slot for
// the icon, but Task 5 had already spent that corner on the lifecycle chip
// (on by default), so the icon takes the one free corner rather than stacking.
// Each layer is gated by its own presentation flag *and* the data it needs, so
// `showEvidence: true` on a concept with no attestations draws nothing - the
// same binary presence/absence rule `applyFilter` uses for hide/show, never a
// dimmed "maybe" state. Ownership requires both owner (non-null) and derived
// ownerInitials (non-null), since ownerInitialsOf filters out malformed local
// ids that leave no words (e.g., "###" or a bare document prefix). The kind
// icon draws for any kind the catalogue maps - an unmapped kind leaves the
// slot empty.
function badgeLayersFor(
  ele: NodeSingular,
  showLifecycle: boolean,
  showEvidence: boolean,
  showOwnership: boolean,
  showNudges: boolean,
): BadgeLayer[] {
  const layers: BadgeLayer[] = []
  const icon = kindIconUriOf(String(ele.data('kindLabel')))
  if (icon !== null) {
    layers.push({ image: icon, positionX: '0%', positionY: '0%', size: ICON_SIZE })
  }
  const status: unknown = ele.data('status')
  if (showLifecycle && isLifecycleStatus(status)) {
    layers.push({
      image: LIFECYCLE_BADGE_URI[status],
      positionX: '100%',
      positionY: '0%',
      size: BADGE_SIZE,
    })
  }
  if (showEvidence && ele.data('hasAttestations') === true) {
    layers.push({
      image: EVIDENCE_BADGE_URI,
      positionX: '0%',
      positionY: '100%',
      size: BADGE_SIZE,
    })
  }
  const owner = ele.data('owner')
  const ownerInitials = ele.data('ownerInitials')
  const ownershipDrawn =
    showOwnership && owner !== null && ownerInitials !== null
  if (ownershipDrawn) {
    layers.push({
      image: ownerBadgeUri(owner, ownerInitials),
      positionX: '100%',
      positionY: '100%',
      size: BADGE_SIZE,
    })
  }
  // Bottom-right, inset from the corner (percent positioning: 96%/88% is a
  // ~6px pad on the default node size). The ownership chip owns the corner
  // itself, so when it is drawn the count chip steps left to sit beside it
  // rather than under it. Gated on count > 0 - a bare node is how "nothing
  // open" is drawn, never a zero chip (#292).
  const openQuestions: unknown = ele.data('openQuestions')
  if (
    showNudges &&
    typeof openQuestions === 'number' &&
    openQuestions > 0
  ) {
    layers.push({
      image: openQuestionsBadgeUri(openQuestions),
      positionX: ownershipDrawn ? '84%' : '96%',
      positionY: ownershipDrawn ? '100%' : '88%',
      size: BADGE_SIZE,
    })
  }
  return layers
}

// Build the cytoscape stylesheet with base node style, layer-specific overrides,
// edge style, and selected-state highlight class.
// Stylesheet entries match StylesheetStyle shape (selector + style properties)
// `showLifecycle`/`showEvidence`/`showOwnership` are parameters, not module
// state, so the mount effect that builds a fresh cytoscape instance and a
// future toggle effect (Task 7 wires the checkboxes to `GraphCanvasProps`)
// both call this with whatever is current instead of racing a shared mutable
// stylesheet.
export function buildStylesheet(
  showLifecycle: boolean,
  showEvidence: boolean,
  showOwnership: boolean,
  showNudges: boolean,
): cytoscape.StylesheetJsonBlock[] {
  // Cytoscape re-evaluates every mapper on each style recalculation - a single
  // selection change re-runs all seven over every node - and rebuilding the
  // percent-encoded SVG payloads that often is pure waste. Which images a node
  // gets is a pure function of five data fields (the three toggles are fixed
  // for this stylesheet's lifetime), so keying on those
  // per recalculation into one per distinct badge combination on the graph.
  // Cytoscape only reads these arrays, so nodes sharing a combination share
  // one set.
  const badgeStyleCache = new Map<string, BadgeStyleArrays>()
  const badgeStyleFor = (ele: NodeSingular): BadgeStyleArrays => {
    const key =
      `${String(ele.data('status'))}\u0000${String(ele.data('hasAttestations'))}` +
      `\u0000${String(ele.data('owner'))}\u0000${String(ele.data('ownerInitials'))}` +
      `\u0000${String(ele.data('kindLabel'))}\u0000${String(ele.data('openQuestions'))}`
    const cached = badgeStyleCache.get(key)
    if (cached !== undefined) return cached
    const layers = badgeLayersFor(ele, showLifecycle, showEvidence, showOwnership, showNudges)
    const built: BadgeStyleArrays = {
      images: layers.map((layer) => layer.image),
      positionsX: layers.map((layer) => layer.positionX),
      positionsY: layers.map((layer) => layer.positionY),
      sizes: layers.map((layer) => layer.size),
      containments: layers.map((): 'over' => 'over'),
      clips: layers.map((): 'none' => 'none'),
    }
    badgeStyleCache.set(key, built)
    return built
  }

  const baseStylesheet: cytoscape.StylesheetJsonBlock[] = [
    {
      selector: 'node',
      style: {
        'background-color': DEFAULT_FILL,
        'border-color': DEFAULT_BORDER,
        'border-width': 2,
        shape: 'roundrectangle',
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        padding: '8px',
        label: 'data(wrapLabel)',
        'font-size': 12,
        'text-wrap': 'wrap',
        'text-max-width': `${LABEL_MAX_TEXT_WIDTH}px`,
        'text-halign': 'center',
        'text-valign': 'center',
        color: '#333333',
      },
    },
    {
      // Multi-value `background-image` family (verified present on the
      // installed cytoscape version): each property is a same-length array,
      // one entry per badge, composited over the shape fill rather than
      // clipped to it (`containment: 'over'`, `clip: 'none'`) so a badge can
      // sit right on a node's corner instead of being cropped by its border.
      selector: 'node',
      style: {
        'background-image': (ele: NodeSingular) => badgeStyleFor(ele).images,
        'background-position-x': (ele: NodeSingular) => badgeStyleFor(ele).positionsX,
        'background-position-y': (ele: NodeSingular) => badgeStyleFor(ele).positionsY,
        'background-width': (ele: NodeSingular) => badgeStyleFor(ele).sizes,
        'background-height': (ele: NodeSingular) => badgeStyleFor(ele).sizes,
        'background-image-containment': (ele: NodeSingular) => badgeStyleFor(ele).containments,
        'background-clip': (ele: NodeSingular) => badgeStyleFor(ele).clips,
      },
    },
    // One rule per `LAYER_COLORS` entry (8, including `physical` and
    // `composite`'s explicit neutral row) instead of six hand-written
    // blocks - coverage tracks the notation module's palette automatically.
    ...Object.entries(LAYER_COLORS).map(
      ([layer, colors]): cytoscape.StylesheetJsonBlock => ({
        selector: `node[layer = "${layer}"]`,
        style: {
          'background-color': colors.fill,
          'border-color': colors.border,
        },
      }),
    ),
    {
      // Compound container (see resolveCompositionParents below): keeps its own
      // layer fill/border from the rules above but at low opacity with a dashed
      // border, so its ArchiMate type stays legible while still reading as a
      // grouping box rather than a plain node. The label is drawn above the box
      // entirely, in the `CONTAINER_LABEL_GAP` band ELK reserves but cytoscape
      // does not draw into, so it clears both the children and its own border.
      // The low `background-opacity` fades only the shape fill, never the badge
      // layers: cytoscape passes it to its own fill colour and computes image
      // alpha from `background-image-opacity` alone, which already defaults to
      // 1. So a container's kind glyph and its lifecycle/evidence/ownership
      // badges are drawn at full strength here with nothing pinned, and an
      // applicationComponent shown as a group still reads as one.
      selector: 'node:parent',
      style: {
        shape: 'roundrectangle',
        'background-opacity': 0.25,
        'border-width': 2,
        'border-style': 'dashed',
        padding: `${CONTAINER_PADDING}px`,
        label: 'data(wrapLabel)',
        'font-size': 13,
        'font-weight': 'bold',
        'text-halign': 'center',
        'text-valign': 'top',
        'text-margin-y': -8,
        color: '#333333',
      },
    },
    {
      selector: 'node.selected',
      style: {
        'border-color': '#FF6B6B',
        'border-width': 4,
      },
    },
    {
      // A subject a diagnostic named. Declared after selection so a selected
      // element that is also refused still reads as refused: the reviewer can
      // move the selection, and the fault is the thing that has to stay
      // visible (ADR 0102).
      selector: 'node.faulted, edge.faulted',
      style: {
        'border-color': '#A3403A',
        'border-width': 4,
        'line-color': '#A3403A',
        'target-arrow-color': '#A3403A',
      },
    },
    {
      selector: 'edge',
      style: {
        'line-color': '#999999',
        width: 1.5,
        'curve-style': 'round-taxi',
        'taxi-radius': 25,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#999999',
        label: 'data(wrapLabel)',
        'font-size': 10,
        // ELK reserves no space for edge text (cytoscape-elk's `makeEdge` never
        // emits `labels[]`), so a long relationship name renders as one wide
        // banner across the midpoint and collides with whatever else routes
        // through there. Wrapping caps how far that text can reach sideways.
        'text-wrap': 'wrap',
        'text-max-width': `${EDGE_LABEL_MAX_TEXT_WIDTH}px`,
        'text-background-color': '#FFFFFF',
        'text-background-padding': '3px',
        // Fully opaque: labels that still overlap occlude cleanly instead of
        // interleaving into unreadable text.
        'text-background-opacity': 1,
      },
    },
    {
      // Two or more relationships between the same pair of endpoints. Taxi
      // routing is deterministic from the endpoints alone, so parallel edges
      // route identically and draw as one line - the second relationship
      // exists but cannot be seen or tapped (#306). Bezier is the one curve
      // family cytoscape separates automatically for multi-edges:
      // `control-point-step-size` fans them out, so each stays visible and
      // individually selectable. Single edges keep `round-taxi` untouched.
      selector: 'edge.parallel',
      style: {
        'curve-style': 'bezier',
        'control-point-step-size': 40,
      },
    },
    {
      selector: 'edge.selected',
      style: {
        'line-color': '#FF6B6B',
        'target-arrow-color': '#FF6B6B',
        width: 2.5,
      },
    },
  ]

  // ArchiMate is the notation this canvas draws in, so what follows is not a
  // mode: node shape by `aspect` and relationship line/arrow treatment by
  // `coreKindLabel` - the edge's resolved core-vocabulary kind, not its raw
  // `kindLabel`, so a derived kind (e.g. `implements` -> `realization`)
  // renders through its lineage identically to the core kind it inherits
  // from. Kept appended to `baseStylesheet` rather than folded into it: the
  // base carries what any notation would need (labels, selection, compound
  // containers) and these rules carry what ArchiMate specifically says, which
  // is the seam a second notation would attach at.
  // Node shapes: one rule per `ASPECT_SHAPES` entry, translating the
  // notation module's ShapeMeta into cytoscape node style. Passive
  // structure's top accent band and composite's dashed border are decoded
  // from `accent`/`borderStyle` here, using the same DEFAULT_BORDER /
  // DEFAULT_FILL gradient stops as before - only the table's source moved.
  const archimateNodeShapes: cytoscape.StylesheetJsonBlock[] = Object.entries(ASPECT_SHAPES).map(
    ([aspect, meta]): cytoscape.StylesheetJsonBlock => {
      const style: cytoscape.Css.Node = { shape: meta.shape }
      if (meta.accent === 'top-band') {
        style['background-fill'] = 'linear-gradient'
        style['background-gradient-direction'] = 'to-bottom'
        style['background-gradient-stop-colors'] = [DEFAULT_BORDER, DEFAULT_FILL]
        style['background-gradient-stop-positions'] = ['0%', '20%']
      }
      if (meta.borderStyle === 'dashed') {
        style['border-style'] = 'dashed'
      }
      // `:childless` confines this to leaf nodes: these rules run after
      // `node:parent` in the array below, so without it an aspect's shape
      // (e.g. active-structure's plain `rectangle`) would win the cascade
      // and silently undo the container's own `roundrectangle` + dashed
      // border - a compound box would look like whatever aspect its own
      // kind happens to be, not like a container.
      return { selector: `node[aspect = "${aspect}"]:childless`, style }
    },
  )

  // Edges: one rule per `RELATIONSHIP_NOTATION` row, translating
  // lineStyle/sourceArrow/targetArrow into cytoscape's edge style keys. An
  // arrow fill is only emitted when the notation row declares one (a
  // `'none'` shape never carries a fill), matching the arrow mappings
  // exactly - only the table's source moved, arrows unchanged.
  const archimateEdgeStyles: cytoscape.StylesheetJsonBlock[] = RELATIONSHIP_NOTATION.map(
    (rel): cytoscape.StylesheetJsonBlock => {
      const style: cytoscape.Css.Edge = {
        'line-style': rel.lineStyle,
        'source-arrow-shape': rel.sourceArrow.shape,
        'target-arrow-shape': rel.targetArrow.shape,
      }
      if (rel.sourceArrow.fill !== undefined) style['source-arrow-fill'] = rel.sourceArrow.fill
      if (rel.targetArrow.fill !== undefined) style['target-arrow-fill'] = rel.targetArrow.fill
      return { selector: `edge[coreKindLabel = "${rel.id}"]`, style }
    },
  )

  return [...baseStylesheet, ...archimateNodeShapes, ...archimateEdgeStyles]
}

// Composition expresses exclusive whole-part structure (ADR 0004: a workspace
// cannot claim both composition and aggregation over the same ordered pair),
// which maps 1:1 onto cytoscape's compound `parent` field - the container is
// the relationship's `from`, the nested child its `to`. Aggregation is
// deliberately excluded: it allows a part to belong to multiple wholes at
// once, which a single `parent` field can't represent, so it stays a normal
// rendered edge like every other relationship kind. Composition edges that
// are consumed into nesting are never also drawn as a line.
const COMPOSITION_RELATIONSHIP_KIND = 'yarramate/core@0.1#composition'
const ASSIGNMENT_RELATIONSHIP_KIND = 'yarramate/core@0.1#assignment'

// A view names which relationships nest, in precedence order (ADR 0101). The
// short names a projection is authored in resolve to the kind identities the
// graph carries here, in one place, so the schema's vocabulary and the
// canvas's cannot drift.
const NESTING_KIND_IDS: Readonly<Record<NestingKind, string>> = {
  composition: COMPOSITION_RELATIONSHIP_KIND,
  assignment: ASSIGNMENT_RELATIONSHIP_KIND,
}

/**
 * Assignment nests internal behaviour, never a service. A service is the
 * promise the layer above consumes, so burying it inside the thing that
 * exposes it inverts what it is for. This declines to *draw* a nesting, not to
 * accept the model: `applicationComponent -assignment-> applicationService` is
 * permitted by the ArchiMate 3.2 table (ADR 0097) and stays drawn as a line.
 * Composition is unaffected, because a composed service is a part.
 */
const nestsAsAssignment = (edge: CanvasEdge, kindOf: (id: string) => string) =>
  !kindOf(edge.to).endsWith('Service')

// The compiler's YM501 rule only rejects the same (from, to) pair declaring
// both composition and aggregation - it does not reject two different
// composition relationships naming the same `to`, which cytoscape's
// single-parent field can't represent either. Nor does anything upstream
// reject a composition chain that loops back on itself, which cytoscape's
// compound nesting must be acyclic to render. Both are real modeling
// anomalies this layer surfaces rather than silently resolving: affected
// subjects are left unnested (ordinary top-level nodes) and every
// composition edge naming them stays drawn as a regular edge, so the
// conflicting claims stay visible on the canvas instead of one silently
// winning.
export function resolveNestingParents(
  edges: readonly CanvasEdge[],
  nesting: readonly NestingKind[],
  kindOf: (id: string) => string
): {
  readonly parentOf: ReadonlyMap<string, string>
  readonly consumedEdgeIds: ReadonlySet<string>
} {
  // Precedence is the order the view listed: a child claimed by a composition
  // and by an assignment nests under the composition.
  const rankOf = new Map(
    nesting.map((kind, rank) => [NESTING_KIND_IDS[kind], rank])
  )
  const nestingEdges = edges.filter(
    (edge) =>
      rankOf.has(edge.kind) &&
      (edge.kind !== ASSIGNMENT_RELATIONSHIP_KIND ||
        nestsAsAssignment(edge, kindOf))
  )

  const claimsByChild = new Map<string, CanvasEdge[]>()
  for (const edge of nestingEdges) {
    const claims = claimsByChild.get(edge.to)
    if (claims === undefined) {
      claimsByChild.set(edge.to, [edge])
    } else {
      claims.push(edge)
    }
  }

  const parentOf = new Map<string, string>()
  for (const [child, claims] of claimsByChild) {
    // Only claims at the best rank compete. Two of them naming different
    // parents stays undecidable and falls through to unnest-and-warn, which is
    // the behaviour composition alone already had.
    const best = Math.min(...claims.map((claim) => rankOf.get(claim.kind)!))
    const winners = claims.filter((claim) => rankOf.get(claim.kind) === best)
    const parents = new Set(winners.map((claim) => claim.from))
    if (parents.size === 1) {
      parentOf.set(child, winners[0]!.from)
    } else {
      console.warn(
        `Nesting conflict: "${child}" is claimed by ${parents.size} different parents at the same precedence (${winners.map((claim) => `${claim.kindLabel} from ${claim.from}`).join(', ')}) - rendering it unnested; every claim stays drawn as a regular edge.`
      )
    }
  }

  // Walk each child's parent chain; a ancestor id revisited before the chain
  // runs out marks a cycle. Only the cycle itself is unnested, not whatever
  // leads into it - a straight-line ancestor of a cycle is still validly
  // nested under its own (non-cyclic) parent.
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
  if (cycleMembers.size > 0) {
    console.warn(`Nesting cycle detected among: ${[...cycleMembers].join(', ')} - rendering them unnested.`)
    for (const id of cycleMembers) parentOf.delete(id)
  }

  const consumedEdgeIds = new Set<string>()
  for (const edge of nestingEdges) {
    if (parentOf.get(edge.to) === edge.from) consumedEdgeIds.add(edge.id)
  }

  return { parentOf, consumedEdgeIds }
}

// Convert CanvasGraph nodes and edges to cytoscape ElementDefinition format.
// Exported for the headless tests: the parallel-edge class assignment below is
// a rendering guarantee (#306) that has to be assertable without a DOM.
export function graphToElements(
  graph: CanvasGraph,
  nesting: readonly NestingKind[],
  openQuestionCounts: ReadonlyMap<string, number>
): ElementDefinition[] {
  // A node's own kind decides whether an assignment may nest it, so the lookup
  // is built once here rather than searched per edge.
  const kindById = new Map(graph.nodes.map((node) => [node.id, node.kind]))
  const { parentOf, consumedEdgeIds } = resolveNestingParents(
    graph.edges,
    nesting,
    (id) => kindById.get(id) ?? ''
  )

  const nodeElements = graph.nodes.map((node): ElementDefinition => {
    const parent = parentOf.get(node.id)
    return {
      data: {
        id: node.id,
        label: node.name,
        wrapLabel: withWrapPoints(node.name),
        kind: node.kind,
        kindLabel: node.kindLabel,
        aspect: node.aspect,
        layer: node.layer,
        status: node.status,
        hasAttestations: node.attestations.length > 0,
        owner: node.owner,
        // Derived here, not drawn here - Task 6's owner-initials chip
        // consumes this same field rather than recomputing it from `owner`.
        ownerInitials: ownerInitialsOf(node.owner),
        // From the interrogation overlay, not the node: the overlay ships
        // beside the graph in the same model frame, so both refresh
        // together (#292). Zero draws nothing.
        openQuestions: openQuestionCounts.get(node.id) ?? 0,
        // `parent` is cytoscape's live nesting pointer and `applyFilter` moves
        // it as views come and go, so the model's own claim is kept alongside
        // it under a key cytoscape does not interpret. Without this the
        // canonical parent would be unrecoverable after the first detach.
        ...(parent === undefined ? {} : { parent, compositionParent: parent }),
      },
      group: 'nodes',
    }
  })

  const drawnEdges = graph.edges.filter(
    (edge) => !consumedEdgeIds.has(edge.id)
  )

  // How many drawn edges share each unordered endpoint pair. Members of a
  // multiple get the `parallel` class, which swaps their curve style to one
  // cytoscape separates automatically - under the default taxi routing they
  // draw exactly on top of each other and read as one relationship (#306).
  // Unordered, because an A->B over a B->A occludes just the same. Counted
  // over drawn edges only: an edge consumed into nesting is not on screen to
  // collide with.
  const drawnPerPair = new Map<string, number>()
  const pairKey = (edge: CanvasEdge): string =>
    edge.from < edge.to
      ? `${edge.from} ${edge.to}`
      : `${edge.to} ${edge.from}`
  for (const edge of drawnEdges) {
    const key = pairKey(edge)
    drawnPerPair.set(key, (drawnPerPair.get(key) ?? 0) + 1)
  }

  const edgeElements = drawnEdges.map(
    (edge): ElementDefinition => ({
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.name ?? edge.kindLabel,
        wrapLabel: withWrapPoints(edge.name ?? edge.kindLabel),
        coreKindLabel: edge.coreKindLabel,
      },
      group: 'edges',
      ...(drawnPerPair.get(pairKey(edge))! > 1
        ? { classes: 'parallel' }
        : {}),
    })
  )

  return [...nodeElements, ...edgeElements]
}

// Recompute which elements cytoscape shows from the structural (server-matched)
// `matchedIds` filter and the client-side `quickFilterText` narrowing, then
// hide/show elements in one pass. `matchedIds === null` means "no structural
// filter" (all nodes eligible); an empty/whitespace `quickFilterText` means "no
// quick-filter narrowing". An edge is visible iff both its endpoints are
// visible nodes - an edge's own label never keeps it visible independently.
// Binary hide/show only, mirroring the "no partial/dimmed state" principle
// used for selection highlighting below - never CSS opacity/dimming.
//
// Quick-filter narrows by substring match (case-insensitive) against a node's
// own id, name (`data('label')`), or kind label (`data('kindLabel')`) - the
// design doc's "name/id substring", extended to the kind label so filtering by
// e.g. "applicationComponent" also works.
export function applyFilter(
  cy: Core,
  matchedIds: readonly string[] | null,
  quickFilterText: string
): void {
  const trimmedQuickFilter = quickFilterText.trim().toLowerCase()
  const baseNodeIds = matchedIds === null ? cy.nodes().map((node) => node.id()) : matchedIds

  const nodeMatchesQuickFilter = (id: string): boolean => {
    if (id.toLowerCase().includes(trimmedQuickFilter)) return true
    const node = cy.getElementById(id)
    const label = node.data('label')
    if (typeof label === 'string' && label.toLowerCase().includes(trimmedQuickFilter)) return true
    const kindLabel = node.data('kindLabel')
    return typeof kindLabel === 'string' && kindLabel.toLowerCase().includes(trimmedQuickFilter)
  }

  const visibleNodeIds = new Set(
    trimmedQuickFilter === ''
      ? baseNodeIds
      : baseNodeIds.filter(nodeMatchesQuickFilter)
  )

  // A compound child that matches the filter needs its container(s) shown
  // too, or it renders as a stray top-level node instead of the nested part
  // the model claims it is - pull in every visible node's ancestor chain.
  // The walk follows the model's own `compositionParent` claim rather than
  // cytoscape's live `parent`, because a node detached by an earlier filter
  // pass has no live parent left to walk.
  const canonicalParentOf = (id: string): string | undefined => {
    const claimed = cy.getElementById(id).data('compositionParent')
    return typeof claimed === 'string' ? claimed : undefined
  }
  for (const id of [...visibleNodeIds]) {
    const seen = new Set<string>([id])
    let ancestor = canonicalParentOf(id)
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor)
      visibleNodeIds.add(ancestor)
      ancestor = canonicalParentOf(ancestor)
    }
  }

  // Containment is a rendering device, so it only holds while both ends of the
  // claim are on screen. cytoscape derives a compound parent's position from
  // its children, and a hidden child keeps the coordinates the last full-graph
  // layout gave it - so a container whose parts are all filtered out gets
  // dragged back to its old position the instant a scoped layout places it,
  // stranding it thousands of pixels from the view it belongs to. Detaching
  // hidden children leaves the whole as an ordinary node, which the layout can
  // place; re-attaching restores the nesting when the parts come back.
  // Decisions are read from canonical data and collected before any `move`,
  // since moving re-creates elements and invalidates live parent lookups.
  const reparents: { readonly node: string; readonly parent: string | null }[] = []
  for (const node of cy.nodes()) {
    const canonical = canonicalParentOf(node.id())
    if (canonical === undefined) continue
    const desired = visibleNodeIds.has(node.id()) && visibleNodeIds.has(canonical) ? canonical : null
    const current = node.parent().nonempty() ? node.parent().first().id() : null
    if (current !== desired) reparents.push({ node: node.id(), parent: desired })
  }
  // `move` carries data and classes across but drops inline style, so it has to
  // land before the display pass below rather than after it.
  for (const { node, parent } of reparents) cy.getElementById(node).move({ parent })

  const visibleIds = new Set<string>(visibleNodeIds)
  for (const edge of cy.edges()) {
    const source = edge.data('source') as string
    const target = edge.data('target') as string
    if (visibleNodeIds.has(source) && visibleNodeIds.has(target)) {
      visibleIds.add(edge.id())
    }
  }

  cy.elements().style('display', 'none')
  cy.elements()
    .filter((ele) => visibleIds.has(ele.id()))
    .style('display', 'element')
}

// One synchronous pass, built by `buildLayoutConfig` and run. The busy notice,
// the two-pass chain and the in-flight guard that used to live here existed
// only for the `force` backend, whose elk `stress` pass blocked the main
// thread for seconds and then needed a second `sporeOverlap` pass to separate
// the nodes it left overlapping. With `layered` the only backend a layout run
// cannot still be in flight when the next one is requested, so none of that
// apparatus has anything left to guard.
function runLayout(eles: Core | CollectionReturnValue): void {
  eles.layout(buildLayoutConfig()).run()
}


// Positions come from the last full-graph layout, which packs every node
// (including ones a view hides) into one shared coordinate space. Reusing
// those positions for a disjoint visible subset leaves it scattered across
// the old full-graph span - relaying out just the visible collection gives
// each view a fresh, compact layout instead. cytoscape-elk's own `fit: true`
// default re-frames the viewport to the result, so no separate fit call is
// needed; `layout()` is a no-op on an empty visible collection, so callers
// never need to guard against "the new view matched nothing".
export function relayoutVisible(cy: Core): void {
  runLayout(cy.elements(':visible'))
}

// `dragfree` fires once per drag (unlike `position`, which fires on every
// intermediate frame), so it is the natural trigger for a layout save - but a
// reviewer repositioning several nodes in quick succession should still
// coalesce into one save carrying the final layout, not one write per node.
export const DRAG_SAVE_DEBOUNCE_MS = 500

// Whole-sidecar snapshot of every node's current position, keyed by subject
// id. `layout.save` always writes the full map, never a partial patch, so
// the server's `yarramate/visual-layout/v1` document stays self-consistent
// with whatever the canvas showed at save time.
export function buildPositionMap(nodes: NodeCollection): VisualLayoutPositions {
  const positions: Record<string, { readonly x: number; readonly y: number }> = {}
  nodes.forEach((node) => {
    const { x, y } = node.position()
    positions[node.id()] = { x, y }
  })
  return positions
}

// Pins every drawn node the sidecar names to its saved position; a node the
// sidecar doesn't mention keeps wherever the layout run that just finished
// placed it. Runs after layout completes - there is no per-node "leave this
// one alone" hook in `nodeLayoutOptions`, so overriding the finished result
// is the only way to keep a subset fixed while ELK freely places the rest.
//
// Only drawn nodes: a sidecar entry for a subject the active view does not
// currently draw is inert (#273). A hidden node keeps coordinates from
// whatever full-graph layout last placed it, so re-pinning it to a sidecar
// written against a canvas sized for the whole model plants stale positions
// that the next whole-canvas drag-save would immortalise. `visible()` is the
// same judgement `relayoutVisible` scopes by (and returns true wholesale on a
// style-disabled instance, where nothing is ever hidden).
export function applySavedPositions(cy: Core, saved: VisualLayoutPositions | undefined): void {
  if (saved === undefined) return
  cy.nodes().forEach((node) => {
    if (!node.visible()) return
    const position = saved[node.id()]
    if (position !== undefined) node.position(position)
  })
}

// The sidecar the canvas actually honours: a view the reviewer discarded this
// session yields nothing to pin, every other view passes its sidecar through
// untouched. Session-local by design - the sidecar document stays on disk
// (deleting it is a staged, committed write this canvas does not own), so the
// discard lives beside the canvas instead of pretending to be a file change.
export function effectiveSavedPositions(
  saved: VisualLayoutPositions | undefined,
  viewId: string,
  discardedViews: ReadonlySet<string>,
): VisualLayoutPositions | undefined {
  return discardedViews.has(viewId) ? undefined : saved
}

// Whether a saved layout is actually in force for what is on screen: the
// sidecar names at least one subject the active view draws. Derived from the
// view's own match set (`matchedIds ?? every node` - the same base
// `applyFilter` starts from) rather than from cytoscape's live visibility, so
// the indicator is a pure function of rendered state: computable with no
// canvas mounted, and never a stale flag some effect forgot to clear. The
// match set may also name relationships; the sidecar only ever names
// subjects, so those entries simply never intersect.
export function savedLayoutInForce(
  saved: VisualLayoutPositions | undefined,
  graphNodeIds: readonly string[],
  matchedIds: readonly string[] | null,
): boolean {
  if (saved === undefined) return false
  const drawn = matchedIds ?? graphNodeIds
  return drawn.some((id) => saved[id] !== undefined)
}

// A drop lands in the container's own coordinates; the graph lives in model
// coordinates under whatever pan and zoom are standing. One conversion,
// cytoscape's own rendered-to-model arithmetic, exported so the sum is a fact
// a test can state without a canvas to drop on.
export function modelPositionOf(
  rendered: { readonly x: number; readonly y: number },
  pan: { readonly x: number; readonly y: number },
  zoom: number,
): { readonly x: number; readonly y: number } {
  return { x: (rendered.x - pan.x) / zoom, y: (rendered.y - pan.y) / zoom }
}

export interface DragSaveHandle {
  /** Cancels a queued save without unbinding the drag listener. */
  readonly cancelPending: () => void
  /** Unbinds the drag listener and cancels any queued save. */
  readonly dispose: () => void
}

// Wires cytoscape's `dragfree` to a debounced whole-layout save. `getActiveViewId`
// and `onSaveLayout` are read through indirection functions (rather than closed
// over directly) so the component can keep this registration alive for its
// whole lifetime while still always saving against the current view and
// calling the current prop.
export function registerDragSave(
  cy: Core,
  getActiveViewId: () => string,
  onSaveLayout: (payload: VisualLayoutSavePayload) => void,
): DragSaveHandle {
  let timer: NodeJS.Timeout | null = null
  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const handler = () => {
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      const projectionId = getActiveViewId()
      // The unfiltered pseudo-view is not a saved projection; the server
      // rejects a save aimed at it.
      if (projectionId === '') return
      onSaveLayout({ projectionId, positions: buildPositionMap(cy.nodes()) })
    }, DRAG_SAVE_DEBOUNCE_MS)
  }
  cy.on('dragfree', 'node', handler)
  return {
    cancelPending,
    dispose: () => {
      cy.off('dragfree', 'node', handler)
      cancelPending()
    },
  }
}

interface GraphCanvasProps {
  readonly graph: CanvasGraph
  readonly selectedId: string | null
  readonly onSelect: (id: string, type: 'node' | 'edge') => void
  /**
   * A right-click on the canvas, reported in VIEWPORT coordinates because the
   * menu is positioned against the window rather than against this container.
   * `id` is null for the background.
   */
  readonly onContextMenu: (
    target: { readonly type: 'node' | 'edge' | 'canvas'; readonly id: string | null },
    position: { readonly x: number; readonly y: number },
  ) => void
  readonly matchedIds: readonly string[] | null
  readonly quickFilterText: string
  /** What draws as nesting in this view, in precedence order (ADR 0101). */
  readonly nesting: readonly NestingKind[]
  /** Subjects a diagnostic named, marked so a failure is visible where it is. */
  readonly faultedIds: ReadonlySet<string>
  readonly showLifecycle: boolean
  readonly showEvidence: boolean
  readonly showOwnership: boolean
  readonly showNudges: boolean
  /** Open-question count per subject id, from the model's interrogation
   * overlay; an empty map (host shipped no overlay) draws no chips. */
  readonly openQuestionCounts: ReadonlyMap<string, number>
  readonly activeViewId: string
  /** Saved layout for the active view, or undefined when it has none yet. */
  readonly savedPositions: VisualLayoutPositions | undefined
  readonly onSaveLayout: (payload: VisualLayoutSavePayload) => void
  /**
   * A kind dropped from the palette (#295): the kind's label and the model
   * position under the pointer. Optional because only a shell with a palette
   * has anything to drop; a host without one never sees a drop at all - the
   * `dragover` acceptance is gated on the callback too, so a stray drag is
   * left to the browser's default refusal.
   */
  readonly onKindDrop?: (
    kindLabel: string,
    position: { readonly x: number; readonly y: number },
  ) => void
  /**
   * A way to take a picture of what is drawn, handed up once the instance
   * exists and withdrawn when it goes. The shell holds it so a menu item can
   * export a PNG without reaching into cytoscape itself; `null` means there is
   * no canvas to photograph, which is what the menu reads to stay honest.
   */
  readonly onCanvasReady?: (png: (() => string) | null) => void
}

/**
 * GraphCanvas: renders a CanvasGraph using cytoscape with elk hierarchical layout.
 *
 * - Creates a cytoscape instance once on mount, destroys it on unmount
 * - Updates elements and reruns layout whenever the graph reference changes
 * - Applies layer-based coloring via the ArchiMate palette
 * - Wires node/edge tap handlers to call onSelect(id, type)
 * - Reflects selectedId prop as a visual highlight class on the matching element
 */
export function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  onContextMenu,
  matchedIds,
  quickFilterText,
  nesting,
  faultedIds,
  activeViewId,
  savedPositions,
  onSaveLayout,
  onKindDrop,
  onCanvasReady,
  showLifecycle,
  showEvidence,
  showOwnership,
  showNudges,
  openQuestionCounts,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  // Views whose saved layout the reviewer discarded this session. Per view id,
  // not one flag: discarding view A's pin says nothing about view B's, and
  // returning to A later must not resurrect what was discarded. A drag-save
  // re-arms its view (see `registerDragSave` below): the reviewer's own fresh
  // sidecar supersedes the discard that cleared the old one.
  const [discardedViews, setDiscardedViews] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const effectiveSaved = effectiveSavedPositions(
    savedPositions,
    activeViewId,
    discardedViews,
  )
  const onSelectRef = useRef(onSelect)
  const onCanvasReadyRef = useRef(onCanvasReady)
  onCanvasReadyRef.current = onCanvasReady
  const onKindDropRef = useRef(onKindDrop)
  onKindDropRef.current = onKindDrop
  const onContextMenuRef = useRef(onContextMenu)
  const isInitialSyncRef = useRef(true)
  const isInitialPresentationSyncRef = useRef(true)
  const activeViewIdRef = useRef(activeViewId)
  const pendingViewFitRef = useRef(false)
  const matchedIdsRef = useRef(matchedIds)
  // Keep latest onSaveLayout and savedPositions for the drag-save handler
  const onSaveLayoutRef = useRef(onSaveLayout)
  const savedPositionsRef = useRef(effectiveSaved)
  const dragSaveHandleRef = useRef<DragSaveHandle | null>(null)
  // The force backend's in-flight layout (see `runLayout`), shared by the
  // graph-change effect and the view-switch relayout so either can supersede
  // the other instead of stacking a second stress+sporeOverlap chain on top.
  // The viewport a layout (or a resize refit) last left behind. Anything else
  // on screen is the reviewer's own pan/zoom, which a resize must not discard.
  const autoViewportRef = useRef<{
    zoom: number
    pan: { x: number; y: number }
  } | null>(null)

  // Keep onSelectRef up-to-date so tap handlers always call the latest prop
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    onContextMenuRef.current = onContextMenu
  }, [onContextMenu])

  // Keep onSaveLayoutRef up-to-date for the drag-save handler
  useEffect(() => {
    onSaveLayoutRef.current = onSaveLayout
  }, [onSaveLayout])

  // Keep savedPositionsRef up-to-date for the layoutstop handler. The ref
  // holds the *effective* sidecar - a discarded view's pin is already gone
  // here, so the layoutstop handler never has to know discards exist.
  useEffect(() => {
    savedPositionsRef.current = effectiveSaved
  }, [effectiveSaved])

  // Cancel pending drag-save when the active view changes, so a queued save
  // never lands against a different view's sidecar. Also cleared on unmount.
  useEffect(() => {
    dragSaveHandleRef.current?.cancelPending()
  }, [activeViewId])

  // Mount effect: create cytoscape instance once on mount, wire tap and
  // layoutstop handlers, setup drag-save, cleanup on unmount.
  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      elements: graphToElements(graph, nesting, openQuestionCounts),
      // `showLifecycle`/`showEvidence`/`showOwnership`/`showNudges` seed the
      // stylesheet the mount builds; the effect below re-applies it to the
      // live instance on every later toggle, without remounting or
      // re-laying-out.
      style: buildStylesheet(showLifecycle, showEvidence, showOwnership, showNudges),
      wheelSensitivity: 0.1,
      layout: { name: 'null' },
    })

    cyRef.current = cy

    // Hand the shell a way to photograph what is drawn. Cytoscape renders to a
    // canvas, so the only thing that can produce the image is the instance
    // itself; a white background rather than transparent, because a diagram
    // pasted onto a dark surface with transparent gaps is not a picture of
    // what was on screen.
    onCanvasReadyRef.current?.(() =>
      cy.png({ full: true, scale: 2, bg: '#ffffff' }),
    )

    // Tap handler for nodes
    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id()
      onSelectRef.current(nodeId, 'node')
    })

    // Tap handler for edges
    cy.on('tap', 'edge', (evt) => {
      const edgeId = evt.target.id()
      onSelectRef.current(edgeId, 'edge')
    })

    // Right-click. Cytoscape reports its own rendered position, which is
    // relative to this container; the menu is positioned against the window,
    // so the native event's client coordinates are the ones that place it.
    // A `cxttap` with no original event (a synthetic emit, as a test or a
    // console driver produces) falls back to the container's own origin plus
    // the rendered position, which is the same point by another route.
    const pointerOf = (evt: cytoscape.EventObject) => {
      const original = evt.originalEvent as MouseEvent | undefined
      if (original !== undefined && original !== null) {
        return { x: original.clientX, y: original.clientY }
      }
      const box = cy.container()?.getBoundingClientRect()
      const rendered = evt.renderedPosition as
        | { x: number; y: number }
        | undefined
      return {
        x: (box?.left ?? 0) + (rendered?.x ?? 0),
        y: (box?.top ?? 0) + (rendered?.y ?? 0),
      }
    }

    cy.on('cxttap', 'node', (evt) => {
      onContextMenuRef.current(
        { type: 'node', id: evt.target.id() },
        pointerOf(evt),
      )
    })

    cy.on('cxttap', 'edge', (evt) => {
      onContextMenuRef.current(
        { type: 'edge', id: evt.target.id() },
        pointerOf(evt),
      )
    })

    cy.on('cxttap', (evt) => {
      // Cytoscape fires the unfiltered handler for elements too, so the
      // background is the case where the target IS the core instance.
      if (evt.target !== cy) return
      onContextMenuRef.current({ type: 'canvas', id: null }, pointerOf(evt))
    })

    // Drag-end → debounced layout save with full position snapshot
    dragSaveHandleRef.current = registerDragSave(
      cy,
      () => activeViewIdRef.current,
      (payload) => {
        // A drag-save writes a fresh sidecar for this view, superseding
        // whatever the reviewer discarded - the new pin is their own work,
        // so it re-arms (#273). Untouched views keep their discards.
        setDiscardedViews((prev) => {
          if (!prev.has(payload.projectionId)) return prev
          const next = new Set(prev)
          next.delete(payload.projectionId)
          return next
        })
        onSaveLayoutRef.current(payload)
      },
    )

    const rememberFraming = (): void => {
      autoViewportRef.current = { zoom: cy.zoom(), pan: { ...cy.pan() } }
    }

    // After each layout run completes, pin nodes to their saved positions. The
    // layout's own `fit: true` has already framed the graph by the time this
    // runs, and saved positions can move nodes after it - so the framing worth
    // recording is the one standing once both have happened.
    cy.on('layoutstop', () => {
      applySavedPositions(cy, savedPositionsRef.current)
      rememberFraming()
    })

    // A layout frames the graph against the canvas as it was when the layout
    // ran. Opening the conversation or details panel - or resizing the window -
    // narrows that canvas without touching zoom or pan, so a graph that just
    // filled the old box is drawn past the edge of the new one, off-screen with
    // no scrollbar to reach it. Reframe on resize, but only while the framing
    // on screen is still the one a layout left: once the reviewer pans or
    // zooms, that viewport is their answer and a panel toggle must not take it.
    const container = containerRef.current
    let pendingFrame = 0
    const observer = new ResizeObserver(() => {
      // A panel animating open fires this every frame; only the last matters.
      cancelAnimationFrame(pendingFrame)
      pendingFrame = requestAnimationFrame(() => {
        cy.resize()
        const auto = autoViewportRef.current
        if (auto === null) return
        const pan = cy.pan()
        const framingIsOurs =
          Math.abs(cy.zoom() - auto.zoom) < 1e-6 &&
          Math.abs(pan.x - auto.pan.x) < 0.5 &&
          Math.abs(pan.y - auto.pan.y) < 0.5
        if (!framingIsOurs) return
        const visible = cy.elements(':visible')
        if (visible.empty()) return
        cy.fit(visible, FIT_PADDING)
        rememberFraming()
      })
    })
    observer.observe(container)

    return () => {
      cancelAnimationFrame(pendingFrame)
      observer.disconnect()
      dragSaveHandleRef.current?.dispose()
      // Withdrawn before the instance goes, so nothing can photograph a
      // destroyed canvas.
      onCanvasReadyRef.current?.(null)
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // Toggling a presentation flag repaints the live instance in place - it
  // must never remount cytoscape or rerun layout, since either would
  // discard the reviewer's dragged positions and viewport. Skipped on the
  // mount render (the mount effect above already built this exact
  // stylesheet once), mirroring `isInitialSyncRef` below.
  useEffect(() => {
    if (!cyRef.current) return
    if (isInitialPresentationSyncRef.current) {
      isInitialPresentationSyncRef.current = false
      return
    }
    cyRef.current.style(buildStylesheet(showLifecycle, showEvidence, showOwnership, showNudges))
  }, [showLifecycle, showEvidence, showOwnership, showNudges])

  // Update elements whenever the graph itself changes. Keyed on the graph and
  // nothing else: a full remove/re-add plus an unscoped layout over every
  // element (not just what is currently visible) would blow away the
  // filtered, view-scoped canvas and reintroduce the sprawl a view switch once
  // had. A view switch is handled by the pending-fit effect below, which
  // reruns `relayoutVisible` scoped to what is actually shown.
  useEffect(() => {
    if (!cyRef.current) return

    if (isInitialSyncRef.current) {
      isInitialSyncRef.current = false
    } else {
      const elements = graphToElements(graph, nesting, openQuestionCounts)
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
    }

    runLayout(cyRef.current)
    // `openQuestionCounts` is derived from the same model frame as `graph`,
    // so its identity moves exactly when the graph's does - listed for
    // honesty, never an extra rerun.
  }, [graph, openQuestionCounts])

  // Mark every subject a diagnostic named. Runs on its own rather than with
  // selection, because a fault outlives whatever the reviewer happens to have
  // selected and must not be cleared by moving the selection.
  useEffect(() => {
    if (!cyRef.current) return
    cyRef.current.elements().removeClass('faulted')
    for (const id of faultedIds) {
      const element = cyRef.current.getElementById(id)
      if (element.nonempty()) element.addClass('faulted')
    }
  }, [faultedIds, graph])

  // Update selection highlight when selectedId or graph changes
  useEffect(() => {
    if (!cyRef.current) return

    cyRef.current.elements().removeClass('selected')

    if (selectedId) {
      const element = cyRef.current.getElementById(selectedId)
      if (element.nonempty()) {
        element.addClass('selected')
      }
    }
  }, [selectedId, graph])

  // Arms a pending fit when the active view changes. It used to arm on layout
  // direction and notation too, because both fed `buildLayoutConfig` and a
  // notation swap would otherwise leave ArchiMate shapes sitting in the native
  // direction's geometry. Neither is a variable any more: there is one
  // notation and one direction, so the view is the only thing left that can
  // change what the layout should be.
  // Declared before the filter-apply effect below - same-phase effects commit
  // in source order, so a view switch whose filter result lands in the very
  // same render (e.g. clearing back to "All") is still armed in time for that
  // commit.
  useEffect(() => {
    if (activeViewId === activeViewIdRef.current) return
    activeViewIdRef.current = activeViewId
    pendingViewFitRef.current = true
  }, [activeViewId])

  // Apply structural filter (matchedIds) and quick-filter narrowing, then,
  // only once a pending view-switch relayout is armed and its filter result
  // has actually landed, rerun layout scoped to whatever is visible now -
  // see `relayoutVisible` for why a fresh layout (not just a re-fit) is
  // needed here.
  useEffect(() => {
    if (!cyRef.current) return
    applyFilter(cyRef.current, matchedIds, quickFilterText)
    // A structural filter result lands in a later commit than the view id that
    // asked for it. The arming effect above fires only on a view change, so on
    // a session's first paint the one layout that runs
    // is computed over every element - including the ones the filter is about
    // to hide - and the survivors are left spread across a layout built for a
    // graph that is no longer on screen, so it sprawls. Measured on the
    // contact-update solution view, which draws 20 of the workspace's 37
    // elements: first paint spanned 1910x2958 with 25,235px of edge at a fit
    // zoom of 0.34, against 922x2584 and 21,335px at 0.39 once any control was
    // touched - more than twice as wide for the same twenty nodes, purely
    // because touching a control re-ran the layout over the visible set.
    // (Crossings go the other way, 31 against 37: a sprawled layout crosses
    // less precisely because it is not compact.) Relaying out
    // whenever the matched set itself changes closes that gap, and `matchedIds`
    // is compared by reference because the server hands back a fresh array per
    // `filter-result` frame.
    const matchedChanged = matchedIds !== matchedIdsRef.current
    matchedIdsRef.current = matchedIds
    if (pendingViewFitRef.current || matchedChanged) {
      pendingViewFitRef.current = false
      relayoutVisible(cyRef.current)
    }
  }, [matchedIds, quickFilterText, graph])

  // Session-local discard of the active view's saved layout: record the
  // discard, drop the pin the layoutstop handler would re-apply, and run a
  // fresh layout over what is drawn. The ref is cleared synchronously rather
  // than left to the sync effect above, because `relayoutVisible`'s
  // `layoutstop` can land before React commits the state change - and a
  // discard whose own relayout re-pins the sidecar has discarded nothing.
  // A queued drag-save is cancelled too: it would snapshot the very
  // positions the reviewer just asked to be rid of.
  const discardSavedLayout = (): void => {
    setDiscardedViews((prev) => new Set(prev).add(activeViewId))
    savedPositionsRef.current = undefined
    dragSaveHandleRef.current?.cancelPending()
    if (cyRef.current !== null) relayoutVisible(cyRef.current)
  }

  // The standing indicator (#273): a saved layout silently overrides every
  // relayout, so whenever one is actually in force for this view the canvas
  // says so, with the way out beside it. Distinct from the transient
  // `layoutNotice` pill (a save receipt that happens to appear top-right):
  // this one is state, not an event, and lives bottom-left for as long as
  // the pin does.
  const savedLayoutShown = savedLayoutInForce(
    effectiveSaved,
    graph.nodes.map((node) => node.id),
    matchedIds,
  )

  // The browser's own menu is suppressed here rather than on `window`: every
  // other surface in this application should keep the one the platform gives
  // it, and only the canvas has a menu of its own to put in its place.
  return (
    <>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        onContextMenu={(event) => event.preventDefault()}
        // A kind dragged from the palette (#295). Accepted on the container
        // rather than on any cytoscape element: a new subject belongs to no
        // node yet, and the container is the one element that is always under
        // the pointer. Only the palette's own type is accepted - the payload
        // itself is unreadable until the drop, but the type list is not.
        onDragOver={(event) => {
          if (
            onKindDropRef.current !== undefined &&
            event.dataTransfer.types.includes(KIND_MIME)
          ) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          const kindLabel = event.dataTransfer.getData(KIND_MIME)
          if (kindLabel === '' || onKindDropRef.current === undefined) return
          event.preventDefault()
          const box = event.currentTarget.getBoundingClientRect()
          const cy = cyRef.current
          onKindDropRef.current(
            kindLabel,
            modelPositionOf(
              { x: event.clientX - box.left, y: event.clientY - box.top },
              cy?.pan() ?? { x: 0, y: 0 },
              cy?.zoom() ?? 1,
            ),
          )
        }}
      />
      {savedLayoutShown ? (
        <div className="saved-layout-pill" role="status">
          <span>Saved layout in force</span>
          <button type="button" onClick={discardSavedLayout}>
            Discard
          </button>
        </div>
      ) : null}
    </>
  )
}
