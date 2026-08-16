import type React from 'react'
import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue, ElementDefinition, Layouts, NodeCollection, NodeSingular } from 'cytoscape'
import elk from 'cytoscape-elk'
import type {
  CanvasGraph,
  CanvasNode,
  CanvasEdge,
} from '../graph-projection.js'
import type {
  VisualLayoutPositions,
  VisualLayoutSavePayload,
} from '../adapters/visual/protocol-contract.js'
import {
  EVIDENCE_BADGE_URI,
  LIFECYCLE_BADGE_URI,
  isLifecycleStatus,
  ownerBadgeUri,
  ownerInitialsOf,
} from './badges.js'
import { ICON_SIZE, kindIconUriOf } from './kind-icons.js'

// Register elk extension once at module load, guarded against re-registration
let elkRegistered = false
if (!elkRegistered) {
  cytoscape.use(elk)
  elkRegistered = true
}

// Layer → color palette from approved ArchiMate mockups (6 of 8 union values used)
export const LAYER_COLORS = {
  motivation: { fill: '#CCCCFF', border: '#8F8FE0' },
  strategy: { fill: '#F5DEAA', border: '#C9A355' },
  business: { fill: '#FFFF99', border: '#C9C355' },
  application: { fill: '#CCFFFF', border: '#4FB8B8' },
  technology: { fill: '#CCFFCC', border: '#5FAE5F' },
  implementation: { fill: '#FFE0E0', border: '#D89999' },
} as const satisfies Record<
  'motivation' | 'strategy' | 'business' | 'application' | 'technology' | 'implementation',
  { readonly fill: string; readonly border: string }
>

// Default neutral style for uncolored layers (physical, composite, or null)
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
// ELK `layoutOptions`). `elk.direction` is optional because the `force`
// backend (elk's `stress` algorithm) ignores direction entirely - only
// `layered` sets it.
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

// FNV-1a hash: deterministically convert a seed string to a signed int32.
// ELK's `org.eclipse.elk.randomSeed` is INT-typed; handed a non-numeric string
// (like the `'default'` a view that declares no seed of its own lays out under)
// it silently ignores the option, so the wire-format string seed has to become
// an integer before it reaches elk.
//
// `Math.imul` is the exact int32 multiply - a plain `hash * 16777619` overflows
// the 53-bit mantissa once `hash` passes 2^29 and starts rounding, which is
// still deterministic but is no longer FNV-1a. Same string always hashes to the
// same int32, across reloads and machines.
function seedToInt32(seed: string): number {
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  }
  return hash | 0
}

// Shared by the full-graph layout effect and the visible-subgraph relayout
// that runs on view switch, so both always agree on algorithm/direction.
//
// Three backends, chosen by headless measurement on this repo's own 258-node
// graph:
// - `layered` - elk's `layered` algorithm, today's default directional
//   (org-chart style) layout. Seed has no measurable effect on crossing
//   minimization on this repo's graph and is silently ignored.
// - `radial` - cytoscape's own built-in `concentric`, not elk's `radial`
//   algorithm (measured unusable on this graph: a tree algorithm, 17.5k
//   overlapping node pairs). Concentric filters compound parents itself
//   (`eles.nodes().not(':parent')`), so parents wrap their children instead
//   of being concentric-positioned themselves - measured 0 parent overlaps.
//   Not elk-based, so no seed support.
// - `force` - elk's `stress` algorithm, first pass only. Seed deterministically
//   changes the initial random placement; measured to be the only backend where
//   randomSeed visibly alters final positions. The `sporeOverlap` overlap-removal
//   second pass is Task 3's business: it needs this first pass to have finished
//   before it can run.
//
// `elk.direction` is ignored by every elk algorithm except `layered`
// (verified: identical container boxes for DOWN and RIGHT on `stress`), so
// only `layered` reads `direction`. Under ArchiMate notation, `layered`
// pins `elk.direction: 'DOWN'` regardless of `direction` - ArchiMate's
// layer bands (motivation/strategy/business/application/technology) only
// read top-down, so a left-right layered run under ArchiMate would draw
// bands that don't correspond to anything. The pin is applied here, at
// config-build time, and nowhere else: stored `direction` in workspace
// state is never overwritten, so switching back to native notation
// restores whatever direction the reviewer had declared.
export function buildLayoutConfig(
  layout: 'layered' | 'radial' | 'force',
  direction: 'top-down' | 'left-right',
  seed?: string,
  notation: 'native' | 'archimate' = 'native',
): cytoscape.LayoutOptions {
  if (layout === 'radial') {
    return {
      name: 'concentric',
      avoidOverlap: true,
      spacingFactor: 1.4,
      animate: false,
      nodeDimensionsIncludeLabels: false,
    }
  }
  if (layout === 'force') {
    const config: ElkLayoutOptions = {
      name: 'elk',
      elk: {
        algorithm: 'stress',
        'org.eclipse.elk.stress.desiredEdgeLength': 320,
      },
    }
    if (seed !== undefined) {
      config.elk['elk.randomSeed'] = seedToInt32(seed)
    }
    return config as unknown as cytoscape.LayoutOptions
  }
  // layered: no seed wiring (seed has no measurable effect on crossing
  // minimization in this repo's graph; measured via headless elk on a
  // 10-node asymmetric crossing-prone fixture)
  const elk: ElkLayoutOptions['elk'] = {
    algorithm: 'layered',
    'elk.direction':
      notation === 'archimate' ? 'DOWN' : direction === 'top-down' ? 'DOWN' : 'RIGHT',
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
// Kind icon top-left (ArchiMate notation only), lifecycle top-right, evidence
// bottom-left, ownership bottom-right - each corner gets at most one image, so
// none ever overlap on a single node. Plan Task 10 named the top-right slot for
// the icon, but Task 5 had already spent that corner on the lifecycle chip
// (on by default), so the icon takes the one free corner rather than stacking.
// Each layer is gated by its own presentation flag *and* the data it needs, so
// `showEvidence: true` on a concept with no attestations draws nothing - the
// same binary presence/absence rule `applyFilter` uses for hide/show, never a
// dimmed "maybe" state. Ownership requires both owner (non-null) and derived
// ownerInitials (non-null), since ownerInitialsOf filters out malformed local
// ids that leave no words (e.g., "###" or a bare document prefix). The kind
// icon is an ArchiMate element glyph, so it draws only under that notation, and
// only for a kind the catalogue maps - an unmapped kind leaves the slot empty.
function badgeLayersFor(
  ele: NodeSingular,
  showLifecycle: boolean,
  showEvidence: boolean,
  showOwnership: boolean,
  notation: 'native' | 'archimate',
): BadgeLayer[] {
  const layers: BadgeLayer[] = []
  if (notation === 'archimate') {
    const icon = kindIconUriOf(String(ele.data('kindLabel')))
    if (icon !== null) {
      layers.push({ image: icon, positionX: '0%', positionY: '0%', size: ICON_SIZE })
    }
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
  if (showOwnership && owner !== null && ownerInitials !== null) {
    layers.push({
      image: ownerBadgeUri(owner, ownerInitials),
      positionX: '100%',
      positionY: '100%',
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
// future toggle effect (Task 7 wires the checkboxes to `GraphCanvasProps`;
// Task 11 passes notation mode the same way) both call this with whatever is
// current instead of racing a shared mutable stylesheet.
export function buildStylesheet(
  showLifecycle: boolean,
  showEvidence: boolean,
  showOwnership: boolean,
  notation: 'native' | 'archimate',
): cytoscape.StylesheetJsonBlock[] {
  // Cytoscape re-evaluates every mapper on each style recalculation - a single
  // selection change re-runs all seven over every node - and rebuilding the
  // percent-encoded SVG payloads that often is pure waste. Which images a node
  // gets is a pure function of five data fields (the three toggles and the
  // notation mode are fixed for this stylesheet's lifetime), so keying on those
  // per recalculation into one per distinct badge combination on the graph.
  // Cytoscape only reads these arrays, so nodes sharing a combination share
  // one set.
  const badgeStyleCache = new Map<string, BadgeStyleArrays>()
  const badgeStyleFor = (ele: NodeSingular): BadgeStyleArrays => {
    const key =
      `${String(ele.data('status'))}\u0000${String(ele.data('hasAttestations'))}` +
      `\u0000${String(ele.data('owner'))}\u0000${String(ele.data('ownerInitials'))}` +
      `\u0000${String(ele.data('kindLabel'))}`
    const cached = badgeStyleCache.get(key)
    if (cached !== undefined) return cached
    const layers = badgeLayersFor(ele, showLifecycle, showEvidence, showOwnership, notation)
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
    {
      selector: 'node[layer = "motivation"]',
      style: {
        'background-color': LAYER_COLORS.motivation.fill,
        'border-color': LAYER_COLORS.motivation.border,
      },
    },
    {
      selector: 'node[layer = "strategy"]',
      style: {
        'background-color': LAYER_COLORS.strategy.fill,
        'border-color': LAYER_COLORS.strategy.border,
      },
    },
    {
      selector: 'node[layer = "business"]',
      style: {
        'background-color': LAYER_COLORS.business.fill,
        'border-color': LAYER_COLORS.business.border,
      },
    },
    {
      selector: 'node[layer = "application"]',
      style: {
        'background-color': LAYER_COLORS.application.fill,
        'border-color': LAYER_COLORS.application.border,
      },
    },
    {
      selector: 'node[layer = "technology"]',
      style: {
        'background-color': LAYER_COLORS.technology.fill,
        'border-color': LAYER_COLORS.technology.border,
      },
    },
    {
      selector: 'node[layer = "implementation"]',
      style: {
        'background-color': LAYER_COLORS.implementation.fill,
        'border-color': LAYER_COLORS.implementation.border,
      },
    },
    {
      // Compound container (see resolveCompositionParents below): keeps its own
      // layer fill/border from the rules above but at low opacity with a dashed
      // border, so its ArchiMate type stays legible while still reading as a
      // grouping box rather than a plain node. The label is drawn above the box
      // entirely, in the `CONTAINER_LABEL_GAP` band ELK reserves but cytoscape
      // does not draw into, so it clears both the children and its own border.
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
      selector: 'edge.selected',
      style: {
        'line-color': '#FF6B6B',
        'target-arrow-color': '#FF6B6B',
        width: 2.5,
      },
    },
  ]

  if (notation !== 'archimate') return baseStylesheet

  // ArchiMate notation mode (Task 11): node shape by `aspect` (Task 8) and
  // relationship line/arrow treatment by `coreKindLabel` - the edge's
  // resolved core-vocabulary kind (Task 11), not its raw `kindLabel`, so a
  // derived kind (e.g. `implements` -> `realization`) renders through its
  // lineage identically to the core kind it inherits from. Appended after
  // `baseStylesheet` rather than folded in, so `notation === 'native'`
  // returns the exact same array untouched.
  const archimateNodeShapes: cytoscape.StylesheetJsonBlock[] = [
    {
      selector: 'node[aspect = "active-structure"]',
      style: { shape: 'rectangle' },
    },
    {
      selector: 'node[aspect = "behavior"]',
      style: { shape: 'round-rectangle' },
    },
    {
      // Rectangle with a top accent band: a short gradient from the neutral
      // border color into the neutral fill stands in for ArchiMate's passive
      // structure header stripe without a second stacked shape.
      selector: 'node[aspect = "passive-structure"]',
      style: {
        shape: 'rectangle',
        'background-fill': 'linear-gradient',
        'background-gradient-direction': 'to-bottom',
        'background-gradient-stop-colors': [DEFAULT_BORDER, DEFAULT_FILL],
        'background-gradient-stop-positions': ['0%', '20%'],
      },
    },
    {
      selector: 'node[aspect = "motivation"]',
      style: { shape: 'octagon' },
    },
    {
      selector: 'node[aspect = "composite"]',
      style: { shape: 'rectangle', 'border-style': 'dashed' },
    },
  ]

  const archimateEdgeStyles: cytoscape.StylesheetJsonBlock[] = [
    {
      selector: 'edge[coreKindLabel = "composition"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'diamond',
        'source-arrow-fill': 'filled',
        'target-arrow-shape': 'none',
      },
    },
    {
      selector: 'edge[coreKindLabel = "aggregation"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'diamond',
        'source-arrow-fill': 'hollow',
        'target-arrow-shape': 'none',
      },
    },
    {
      selector: 'edge[coreKindLabel = "assignment"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'circle',
        'source-arrow-fill': 'filled',
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'filled',
      },
    },
    {
      selector: 'edge[coreKindLabel = "realization"]',
      style: {
        'line-style': 'dotted',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'hollow',
      },
    },
    {
      selector: 'edge[coreKindLabel = "specialization"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'hollow',
      },
    },
    {
      selector: 'edge[coreKindLabel = "serving"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'vee',
      },
    },
    {
      selector: 'edge[coreKindLabel = "access"]',
      style: {
        'line-style': 'dotted',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'vee',
      },
    },
    {
      selector: 'edge[coreKindLabel = "influence"]',
      style: {
        'line-style': 'dashed',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'vee',
      },
    },
    {
      selector: 'edge[coreKindLabel = "triggering"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'filled',
      },
    },
    {
      selector: 'edge[coreKindLabel = "flow"]',
      style: {
        'line-style': 'dashed',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'filled',
      },
    },
    {
      selector: 'edge[coreKindLabel = "association"]',
      style: {
        'line-style': 'solid',
        'source-arrow-shape': 'none',
        'target-arrow-shape': 'none',
      },
    },
  ]

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
function resolveCompositionParents(edges: readonly CanvasEdge[]): {
  readonly parentOf: ReadonlyMap<string, string>
  readonly consumedEdgeIds: ReadonlySet<string>
} {
  const compositionEdges = edges.filter((edge) => edge.kind === COMPOSITION_RELATIONSHIP_KIND)

  const claimsByChild = new Map<string, CanvasEdge[]>()
  for (const edge of compositionEdges) {
    const claims = claimsByChild.get(edge.to)
    if (claims === undefined) {
      claimsByChild.set(edge.to, [edge])
    } else {
      claims.push(edge)
    }
  }

  const parentOf = new Map<string, string>()
  for (const [child, claims] of claimsByChild) {
    if (claims.length === 1) {
      parentOf.set(child, claims[0]!.from)
    } else {
      console.warn(
        `Composition conflict: "${child}" is claimed as a part by ${claims.length} different wholes (${claims.map((claim) => claim.from).join(', ')}) - rendering it unnested; every claim stays drawn as a regular edge.`
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
    console.warn(`Composition cycle detected among: ${[...cycleMembers].join(', ')} - rendering them unnested.`)
    for (const id of cycleMembers) parentOf.delete(id)
  }

  const consumedEdgeIds = new Set<string>()
  for (const edge of compositionEdges) {
    if (parentOf.get(edge.to) === edge.from) consumedEdgeIds.add(edge.id)
  }

  return { parentOf, consumedEdgeIds }
}

// Convert CanvasGraph nodes and edges to cytoscape ElementDefinition format
function graphToElements(graph: CanvasGraph): ElementDefinition[] {
  const { parentOf, consumedEdgeIds } = resolveCompositionParents(graph.edges)

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
        // `parent` is cytoscape's live nesting pointer and `applyFilter` moves
        // it as views come and go, so the model's own claim is kept alongside
        // it under a key cytoscape does not interpret. Without this the
        // canonical parent would be unrecoverable after the first detach.
        ...(parent === undefined ? {} : { parent, compositionParent: parent }),
      },
      group: 'nodes',
    }
  })

  const edgeElements = graph.edges
    .filter((edge) => !consumedEdgeIds.has(edge.id))
    .map(
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

// Shown while a `force` run is in flight. Measured at 5.4 s on this repo's
// 258-node graph, so the canvas must say something rather than sit frozen.
const LAYOUT_BUSY_NOTICE = 'Laying out...'

// elk's overlap-removal algorithm, run as `force`'s second pass over the same
// collection the first pass just placed. It reads the positions already on the
// nodes, so it carries no configuration of its own.
const SPORE_OVERLAP_CONFIG: ElkLayoutOptions = {
  name: 'elk',
  elk: { algorithm: 'sporeOverlap' },
}

// Runs `work` only once the browser has had its chance to paint the notice the
// caller just announced. Two hops are needed, and neither one covers the other:
//
//   1. React does not commit a `setState` made from inside an effect during
//      that effect - it schedules the re-render as a task. So the notice is
//      still absent from the DOM when this function is called, and a frame
//      taken right now would paint the canvas exactly as it already was. The
//      timer yields to that already-queued render task first.
//   2. A `requestAnimationFrame` callback runs *before* its own frame renders,
//      so one frame is not enough either: the second frame's callback is the
//      first point at which the previous frame - now carrying the committed
//      notice - is on screen.
//
// Without rAF (the headless tests) or with the tab hidden, where rAF never
// fires at all and there is nothing to paint anyway, the work runs straight
// away rather than never.
function paintFirst(work: () => void): void {
  const hidden = typeof document !== 'undefined' && document.hidden
  if (typeof requestAnimationFrame !== 'function' || hidden) {
    work()
    return
  }
  setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => work())
    })
  }, 0)
}

// The `force` backend's first pass (elk `stress`) still leaves nodes
// overlapping; `sporeOverlap` is a second elk pass that spreads them apart
// once the first has settled, so it can only start after the first pass's
// own `layoutstop` fires. Every other backend stays the single synchronous
// pass it always was - built once by `buildLayoutConfig` and run.
//
// `inFlightRef` is shared by every caller (the graph-change effect and
// `relayoutVisible`) so a newer request - of either kind - supersedes a
// force chain still running: it becomes the new `inFlightRef.current`, and
// each layoutstop handler below compares itself against `inFlightRef.current`
// before acting, so a superseded run can neither start its second pass over
// a collection a newer request has already moved past nor flip `waiting`
// back to idle after that newer request claimed it. `.stop()` is still
// called on the way out for any future backend whose `stop()` really does
// cancel a running layout.
function runLayout(
  eles: Core | CollectionReturnValue,
  layout: 'layered' | 'radial' | 'force',
  direction: 'top-down' | 'left-right',
  inFlightRef: { current: Layouts | null },
  onWaitingChange: (waiting: string | null) => void,
  notation: 'native' | 'archimate' = 'native',
  seed?: string,
): void {
  // Clear the ref *before* stopping: `stop()` can emit `layoutstop`
  // synchronously, and the superseded run's handler must already see itself
  // disowned when it does.
  const superseded = inFlightRef.current
  inFlightRef.current = null
  superseded?.stop()

  const first = eles.layout(buildLayoutConfig(layout, direction, seed, notation))
  if (layout !== 'force') {
    // A superseded force chain's handlers all bail on the guards below, so
    // nobody else will retire its busy notice. This run owns the canvas now,
    // and it is the single synchronous pass it always was - nothing to wait
    // for, so switching backends mid-force clears "Laying out..." here.
    onWaitingChange(null)
    first.run()
    return
  }

  inFlightRef.current = first
  onWaitingChange(LAYOUT_BUSY_NOTICE)
  first.one('layoutstop', () => {
    if (inFlightRef.current !== first) return
    const second = eles.layout(SPORE_OVERLAP_CONFIG as unknown as cytoscape.LayoutOptions)
    inFlightRef.current = second
    second.one('layoutstop', () => {
      if (inFlightRef.current !== second) return
      inFlightRef.current = null
      onWaitingChange(null)
    })
    second.run()
  })
  // elk's `stress` pass blocks the main thread outright - measured 6.1 s on this
  // repo's 258-node graph - so React cannot commit the notice above until the
  // pass is already over: it would only ever paint *after* the freeze it exists
  // to explain. Yielding until the notice has actually painted (see
  // `paintFirst`) puts it on screen first, then the pass runs. A newer request
  // can claim `inFlightRef` while this one waits for its frames, so it
  // re-checks that it still owns the canvas before handing elk the thread.
  paintFirst(() => {
    if (inFlightRef.current !== first) return
    first.run()
  })
}

// Positions come from the last full-graph layout, which packs every node
// (including ones a view hides) into one shared coordinate space. Reusing
// those positions for a disjoint visible subset leaves it scattered across
// the old full-graph span - relaying out just the visible collection gives
// each view a fresh, compact layout instead. cytoscape-elk's own `fit: true`
// default re-frames the viewport to the result, so no separate fit call is
// needed; `layout()` is a no-op on an empty visible collection, so callers
// never need to guard against "the new view matched nothing". `inFlightRef`
// and `onWaitingChange` default to a fresh, unshared guard and a no-op
// callback so every existing caller that only cares about layered/radial's
// synchronous behaviour keeps working unchanged. `notation` likewise
// defaults to `'native'` so a caller that has never heard of ArchiMate
// notation gets the direction mapping it always did. `seed` is the active
// view's `presentation.seed`; only the `force` backend reads it (see
// `buildLayoutConfig`), and omitting it leaves elk on its own default.
export function relayoutVisible(
  cy: Core,
  layout: 'layered' | 'radial' | 'force',
  direction: 'top-down' | 'left-right',
  inFlightRef: { current: Layouts | null } = { current: null },
  onWaitingChange: (waiting: string | null) => void = () => {},
  notation: 'native' | 'archimate' = 'native',
  seed?: string,
): void {
  runLayout(
    cy.elements(':visible'),
    layout,
    direction,
    inFlightRef,
    onWaitingChange,
    notation,
    seed,
  )
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

// Pins every node the sidecar names to its saved position; a node the
// sidecar doesn't mention keeps wherever the layout run that just finished
// placed it. Runs after layout completes - there is no per-node "leave this
// one alone" hook in `nodeLayoutOptions`, so overriding the finished result
// is the only way to keep a subset fixed while ELK freely places the rest.
export function applySavedPositions(cy: Core, saved: VisualLayoutPositions | undefined): void {
  if (saved === undefined) return
  cy.nodes().forEach((node) => {
    const position = saved[node.id()]
    if (position !== undefined) node.position(position)
  })
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
  readonly matchedIds: readonly string[] | null
  readonly quickFilterText: string
  readonly layout: 'layered' | 'radial' | 'force'
  readonly direction: 'top-down' | 'left-right'
  readonly showLifecycle: boolean
  readonly showEvidence: boolean
  readonly showOwnership: boolean
  readonly notation: 'native' | 'archimate'
  /**
   * The active view's `presentation.seed`. Only the `force` backend reads it
   * (elk `stress`'s initial random placement); the other two are deterministic
   * by construction and ignore it.
   */
  readonly seed: string
  readonly activeViewId: string
  /** Saved layout for the active view, or undefined when it has none yet. */
  readonly savedPositions: VisualLayoutPositions | undefined
  readonly onSaveLayout: (payload: VisualLayoutSavePayload) => void
  readonly onWaitingChange: (waiting: string | null) => void
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
  matchedIds,
  quickFilterText,
  layout,
  direction,
  activeViewId,
  savedPositions,
  onSaveLayout,
  onWaitingChange,
  showLifecycle,
  showEvidence,
  showOwnership,
  notation,
  seed,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)
  const isInitialSyncRef = useRef(true)
  const isInitialPresentationSyncRef = useRef(true)
  const activeViewIdRef = useRef(activeViewId)
  const directionRef = useRef(direction)
  const layoutRef = useRef(layout)
  const notationRef = useRef(notation)
  const seedRef = useRef(seed)
  const pendingViewFitRef = useRef(false)
  // Keep latest onSaveLayout and savedPositions for the drag-save handler
  const onSaveLayoutRef = useRef(onSaveLayout)
  const savedPositionsRef = useRef(savedPositions)
  const dragSaveHandleRef = useRef<DragSaveHandle | null>(null)
  // The force backend's in-flight layout (see `runLayout`), shared by the
  // graph-change effect and the view-switch relayout so either can supersede
  // the other instead of stacking a second stress+sporeOverlap chain on top.
  const forceLayoutRef = useRef<Layouts | null>(null)
  // Keep latest onWaitingChange for effects and the layoutstop handlers
  // `runLayout` sets up, which must always report through the current prop.
  const onWaitingChangeRef = useRef(onWaitingChange)
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

  // Keep onSaveLayoutRef up-to-date for the drag-save handler
  useEffect(() => {
    onSaveLayoutRef.current = onSaveLayout
  }, [onSaveLayout])

  // Keep savedPositionsRef up-to-date for the layoutstop handler
  useEffect(() => {
    savedPositionsRef.current = savedPositions
  }, [savedPositions])

  // Keep onWaitingChangeRef up-to-date so runLayout's layoutstop handlers
  // always report busy state through the latest prop
  useEffect(() => {
    onWaitingChangeRef.current = onWaitingChange
  }, [onWaitingChange])

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
      elements: graphToElements(graph),
      // `showLifecycle`/`showEvidence`/`showOwnership` seed the stylesheet the
      // mount builds; the effect below re-applies it to the live instance on
      // every later toggle, without remounting or re-laying-out.
      style: buildStylesheet(showLifecycle, showEvidence, showOwnership, notation),
      wheelSensitivity: 0.1,
      layout: { name: 'null' },
    })

    cyRef.current = cy

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

    // Drag-end → debounced layout save with full position snapshot
    dragSaveHandleRef.current = registerDragSave(
      cy,
      () => activeViewIdRef.current,
      (payload) => onSaveLayoutRef.current(payload),
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
      forceLayoutRef.current?.stop()
      forceLayoutRef.current = null
      onWaitingChangeRef.current(null)
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
    cyRef.current.style(buildStylesheet(showLifecycle, showEvidence, showOwnership, notation))
  }, [showLifecycle, showEvidence, showOwnership, notation])

  // Update elements whenever the graph itself changes, laying out with the
  // current layout and direction. Deliberately NOT keyed on `layout`/
  // `direction` - a full remove/re-add + unscoped layout over every element
  // (not just what's currently visible) on every toggle would blow away the
  // filtered/view-scoped canvas and reintroduce the sprawl a view switch
  // once had. Layout/direction-only changes are handled by the pending-fit
  // effect below, which reruns `relayoutVisible` scoped to what's actually
  // shown.
  useEffect(() => {
    if (!cyRef.current) return

    if (isInitialSyncRef.current) {
      isInitialSyncRef.current = false
    } else {
      const elements = graphToElements(graph)
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
    }

    // Read through the ref inside the wrapper, not once at the call site:
    // an async force chain keeps calling this long after the effect ran, and
    // it must always reach the current prop (same reason as `registerDragSave`).
    runLayout(
      cyRef.current,
      layout,
      direction,
      forceLayoutRef,
      (waiting) => onWaitingChangeRef.current(waiting),
      notation,
      seed,
    )
  }, [graph])

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

  // Arms a pending fit whenever the active view, layout backend, layout
  // direction, notation mode, or seed changes. Notation belongs here because
  // `buildLayoutConfig` pins `elk.direction: 'DOWN'` under `archimate` - the
  // stylesheet effect above swaps node shapes on the live instance
  // immediately, so without a matching relayout an archimate toggle would
  // leave ArchiMate shapes sitting in the native direction's geometry. Seed
  // belongs here for the same reason: under `force` it is layout input, so a
  // reviewer who declares a new seed has to see the placement it produces.
  // Declared before the filter-apply effect below - same-phase effects commit
  // in source order, so a view switch whose filter result lands in the very
  // same render (e.g. clearing back to "All") is still armed in time for that
  // commit.
  useEffect(() => {
    const viewChanged = activeViewId !== activeViewIdRef.current
    const layoutChanged = layout !== layoutRef.current
    const directionChanged = direction !== directionRef.current
    const notationChanged = notation !== notationRef.current
    const seedChanged = seed !== seedRef.current
    if (
      !viewChanged &&
      !layoutChanged &&
      !directionChanged &&
      !notationChanged &&
      !seedChanged
    )
      return
    activeViewIdRef.current = activeViewId
    layoutRef.current = layout
    directionRef.current = direction
    notationRef.current = notation
    seedRef.current = seed
    pendingViewFitRef.current = true
  }, [activeViewId, layout, direction, notation, seed])

  // Apply structural filter (matchedIds) and quick-filter narrowing, then,
  // only once a pending view-switch relayout is armed and its filter result
  // has actually landed, rerun layout scoped to whatever is visible now -
  // see `relayoutVisible` for why a fresh layout (not just a re-fit) is
  // needed here.
  useEffect(() => {
    if (!cyRef.current) return
    applyFilter(cyRef.current, matchedIds, quickFilterText)
    if (pendingViewFitRef.current) {
      pendingViewFitRef.current = false
      relayoutVisible(
        cyRef.current,
        layout,
        direction,
        forceLayoutRef,
        (waiting) => onWaitingChangeRef.current(waiting),
        notation,
        seed,
      )
    }
  }, [matchedIds, quickFilterText, graph, layout, direction, notation, seed])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
