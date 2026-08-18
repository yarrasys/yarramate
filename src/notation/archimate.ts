// Single source of truth for ArchiMate-inspired rendering data: layer
// palette, aspect-driven shape tokens, per-concept-kind glyphs, and
// per-relationship-kind line/arrow styles. Pure data + lookups, no
// cytoscape/DOM dependency - the same zero-import discipline as
// `src/visual-app/kind-icons.ts` and `badges.ts`, so this module can be
// published standalone (`yarramate/notation/archimate`) and consumed by
// non-canvas renderers. Not wired into `graph-canvas.tsx` yet (Task 4
// switches the canvas to read from here instead of its own inline tables).
import { conceptKinds, layers, relationshipKinds, type Aspect, type Layer, type RelationshipKind } from '../profile.js'

export const ICON_SIZE = 14
const INK = '#182228' // --ink (src/visual-app/styles.css:12)

// The locked canvas layer palette (`graph-canvas.tsx`'s `LAYER_COLORS`
// selectors) - `physical` and `composite` deliberately share the same
// neutral grey since neither carries a distinct layer identity of its own.
export const LAYER_COLORS = {
  motivation: { fill: '#CCCCFF', border: '#8F8FE0' },
  strategy: { fill: '#F5DEAA', border: '#C9A355' },
  business: { fill: '#FFFF99', border: '#C9C355' },
  application: { fill: '#CCFFFF', border: '#4FB8B8' },
  technology: { fill: '#CCFFCC', border: '#5FAE5F' },
  implementation: { fill: '#FFE0E0', border: '#D89999' },
  physical: { fill: '#F0F0F0', border: '#999999' },
  composite: { fill: '#F0F0F0', border: '#999999' },
} as const satisfies Record<Layer, { readonly fill: string; readonly border: string }>

export interface ShapeMeta {
  readonly shape: 'rectangle' | 'round-rectangle' | 'octagon'
  /** Passive-structure's ArchiMate header-stripe convention. */
  readonly accent?: 'top-band'
  /** Composite (grouping/location/junction) convention. */
  readonly borderStyle?: 'dashed'
}

// Aspect -> shape/accent/borderStyle, mirroring `graph-canvas.tsx`'s
// `node[aspect = "…"]` selectors (Task 8/11 ArchiMate notation mode).
export const ASPECT_SHAPES: Record<Aspect, ShapeMeta> = {
  motivation: { shape: 'octagon' },
  'active-structure': { shape: 'rectangle' },
  behavior: { shape: 'round-rectangle' },
  'passive-structure': { shape: 'rectangle', accent: 'top-band' },
  composite: { shape: 'rectangle', borderStyle: 'dashed' },
}

function svg(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" ` +
    `viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">` +
    `<g fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    `</svg>`
  )
}

function toDataUri(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`
}

// The 17 kinds the canvas already draws a glyph for (`src/visual-app/
// kind-icons.ts` `BASE_KIND_SVG`), copied verbatim. Every other core kind
// (e.g. `stakeholder`) has no glyph body and resolves to `null` below -
// that's an allowed gap, not a coverage failure: `CONCEPT_NOTATION` still
// carries a row for it, just with `glyph: null`.
const BASE_KIND_SVG: Record<string, string> = {
  // Component: UML/ArchiMate component box with two connector notches on
  // its left edge.
  applicationComponent:
    '<rect x="3" y="2" width="9" height="10"/>' +
    '<rect x="1" y="4" width="2.5" height="1.5"/>' +
    '<rect x="1" y="8" width="2.5" height="1.5"/>',
  // Function: rounded process box with a right-pointing chevron.
  applicationFunction: '<rect x="2" y="3" width="10" height="8" rx="2"/><path d="M5.5 5 L8 7 L5.5 9"/>',
  // Service: a pill/oval, ArchiMate's rounded-rectangle service shape.
  applicationService: '<rect x="1.5" y="4" width="11" height="6" rx="3"/>',
  // Artifact: a document with a folded top-right corner.
  artifact: '<path d="M3 1.5 H9 L11 3.5 V12.5 H3 Z"/><path d="M9 1.5 V3.5 H11"/>',
  // Actor: a stick figure - head, torso, arms, legs.
  businessActor: '<circle cx="7" cy="3.5" r="1.8"/><path d="M7 5.3 V9 M4 7 H10 M7 9 L4.5 12.5 M7 9 L9.5 12.5"/>',
  // Function: same process-box convention as applicationFunction, an
  // upward chevron distinguishes the business layer.
  businessFunction: '<rect x="2" y="3" width="10" height="8" rx="2"/><path d="M5 8 L7 5.5 L9 8"/>',
  // Capability: a box with a compass-style arrow toward its top-right
  // corner (capability-as-direction motif).
  capability: '<rect x="2" y="2" width="10" height="10" rx="1"/><path d="M5 9 L9 5 M9 5 H6.5 M9 5 V7.5"/>',
  // Data object: a record box with a header divider.
  dataObject: '<rect x="2" y="2" width="10" height="10"/><path d="M2 5.5 H12"/>',
  // Deliverable: a folded-corner document (like artifact) with a ribbon
  // check-mark distinguishing it as a completed output.
  deliverable:
    '<path d="M3 1.5 H8 L11 4.5 V12.5 H3 Z"/><path d="M8 1.5 V4.5 H11"/><path d="M5 9.5 L7 12.5 L9 9.5"/>',
  // Driver: a steering-wheel motif - a circle with four radiating spokes.
  driver: '<circle cx="7" cy="7" r="5"/><path d="M7 2 V5 M7 9 V12 M2 7 H5 M9 7 H12"/>',
  // Goal: a target - two concentric circles.
  goal: '<circle cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="2.2"/>',
  // Node: a 3D cuboid, ArchiMate's technology-node glyph.
  node: '<path d="M2 5 L7 2.5 L12 5 L12 10 L7 12.5 L2 10 Z"/><path d="M2 5 L7 7.5 L12 5 M7 7.5 V12.5"/>',
  // Plateau: a flat-topped trapezoid.
  plateau: '<path d="M2 11 L4.5 4 H9.5 L12 11 Z"/><path d="M2 11 H12"/>',
  // Representation: a document with a wavy bottom edge (curled paper).
  representation: '<path d="M3 2 H11 V9 Q9.5 11 8 9.5 Q6.5 8 5 9.5 Q3.5 11 3 9 Z"/>',
  // Requirement: a pointed banner/shield shape with a header divider.
  requirement: '<path d="M3 2.5 H11 V9 L7 11.5 L3 9 Z"/><path d="M3 5 H11"/>',
  // System software: a nested box, a smaller box docked inside the larger.
  systemSoftware: '<rect x="2" y="2" width="10" height="10"/><rect x="4" y="4" width="4" height="3"/>',
  // Function: same process convention again, technology layer gets a gear
  // motif - a circle with radiating teeth.
  technologyFunction:
    '<circle cx="7" cy="7" r="4"/>' +
    '<path d="M7 2 V3.2 M7 10.8 V12 M2 7 H3.2 M10.8 7 H12 ' +
    'M3.5 3.5 L4.3 4.3 M9.7 9.7 L10.5 10.5 M3.5 10.5 L4.3 9.7 M9.7 4.3 L10.5 3.5"/>',
}

export interface ConceptNotation extends ShapeMeta {
  readonly id: string
  readonly notation: string
  readonly layer: Layer
  readonly aspect: Aspect
  readonly glyph: string | null
  readonly colors: { readonly fill: string; readonly border: string }
}

// Built from `conceptKinds` (not enumerated by hand) so coverage cannot
// drift from the core vocabulary - a new kind added to `profile.ts` gets a
// notation row automatically, and a removed one disappears automatically.
export const CONCEPT_NOTATION: readonly ConceptNotation[] = conceptKinds.map((kind) => ({
  id: kind.id,
  notation: kind.name,
  layer: kind.layer,
  aspect: kind.aspect,
  ...ASPECT_SHAPES[kind.aspect],
  glyph: BASE_KIND_SVG[kind.id] ?? null,
  colors: LAYER_COLORS[kind.layer],
}))

const CONCEPT_NOTATION_BY_ID: Record<string, ConceptNotation> = Object.fromEntries(
  CONCEPT_NOTATION.map((row) => [row.id, row]),
)

export function conceptNotationOf(kindLabel: string): ConceptNotation | null {
  return CONCEPT_NOTATION_BY_ID[kindLabel] ?? null
}

export function kindGlyphDataUriOf(kindLabel: string): string | null {
  const glyph = CONCEPT_NOTATION_BY_ID[kindLabel]?.glyph
  return glyph == null ? null : toDataUri(svg(glyph))
}

export interface ArrowNotation {
  readonly shape: 'none' | 'diamond' | 'triangle' | 'circle' | 'vee'
  readonly fill?: 'filled' | 'hollow'
}

export interface RelationshipNotation {
  readonly id: RelationshipKind
  readonly lineStyle: 'solid' | 'dotted' | 'dashed'
  readonly sourceArrow: ArrowNotation
  readonly targetArrow: ArrowNotation
}

type RelationshipStyle = Omit<RelationshipNotation, 'id'>

// The 11 rows from `graph-canvas.tsx`'s ArchiMate edge selectors (Task 11).
const RELATIONSHIP_STYLE: Record<RelationshipKind, RelationshipStyle> = {
  composition: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'diamond', fill: 'filled' },
    targetArrow: { shape: 'none' },
  },
  aggregation: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'diamond', fill: 'hollow' },
    targetArrow: { shape: 'none' },
  },
  assignment: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'circle', fill: 'filled' },
    targetArrow: { shape: 'triangle', fill: 'filled' },
  },
  realization: {
    lineStyle: 'dotted',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'triangle', fill: 'hollow' },
  },
  specialization: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'triangle', fill: 'hollow' },
  },
  serving: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'vee' },
  },
  access: {
    lineStyle: 'dotted',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'vee' },
  },
  influence: {
    lineStyle: 'dashed',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'vee' },
  },
  triggering: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'triangle', fill: 'filled' },
  },
  flow: {
    lineStyle: 'dashed',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'triangle', fill: 'filled' },
  },
  association: {
    lineStyle: 'solid',
    sourceArrow: { shape: 'none' },
    targetArrow: { shape: 'none' },
  },
}

// Built from `relationshipKinds` so coverage cannot drift, same discipline
// as `CONCEPT_NOTATION` above.
export const RELATIONSHIP_NOTATION: readonly RelationshipNotation[] = relationshipKinds.map((id) => ({
  id,
  ...RELATIONSHIP_STYLE[id],
}))

const RELATIONSHIP_NOTATION_BY_ID: Record<string, RelationshipNotation> = Object.fromEntries(
  RELATIONSHIP_NOTATION.map((row) => [row.id, row]),
)

export function relationshipNotationOf(kindLabel: string): RelationshipNotation | null {
  return RELATIONSHIP_NOTATION_BY_ID[kindLabel] ?? null
}

// `layers` is re-exported so consumers of this subpath don't need a second
// import from `../profile.js` just to iterate the palette.
export { layers }
