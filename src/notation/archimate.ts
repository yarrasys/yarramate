// Single source of truth for ArchiMate rendering data: layer
// palette, aspect-driven shape tokens, per-concept-kind glyphs, and
// per-relationship-kind line/arrow styles. Pure data + lookups, no
// cytoscape/DOM dependency - the same zero-import discipline as
// `src/visual-app/kind-icons.ts` and `badges.ts`, so this module can be
// published standalone (`yarramate/notation/archimate`) and consumed by
// non-canvas renderers. Wired into `graph-canvas.tsx` via `kind-icons.ts`'s
// thin wrapper, which is this module's only canvas-side caller.
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
  /** Grouping's convention. The other composites draw a solid border. */
  readonly borderStyle?: 'dashed'
}

// Aspect -> shape/accent/borderStyle, mirroring `graph-canvas.tsx`'s
// `node[aspect = "…"]` selectors (Task 8/11 ArchiMate notation mode).
export const ASPECT_SHAPES: Record<Aspect, ShapeMeta> = {
  motivation: { shape: 'octagon' },
  'active-structure': { shape: 'rectangle' },
  behavior: { shape: 'round-rectangle' },
  'passive-structure': { shape: 'rectangle', accent: 'top-band' },
  composite: { shape: 'rectangle' },
}

// Per-kind overrides layered over the aspect default. ArchiMate draws
// Grouping with a dashed border and every other composite - product,
// location, plateau, gap, the junctions - with a solid one, so the dashed
// convention belongs to the one kind rather than to the aspect.
const KIND_SHAPE_OVERRIDES: Readonly<Partial<Record<string, Partial<ShapeMeta>>>> = {
  grouping: { borderStyle: 'dashed' },
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

// Every core concept kind gets a glyph body, alphabetical by kind id. The
// first 17 below are the icons the canvas already drew before this module
// existed (`src/visual-app/kind-icons.ts`'s original `BASE_KIND_SVG`), kept
// byte-identical; the rest close what was previously an allowed gap -
// `CONCEPT_NOTATION` used to carry a row with `glyph: null` for them.
// Shared silhouettes are deliberately reused across layers (the same
// two-circle Venn for every *Collaboration, the same lollipop for every
// *Interface, the same forward arrow for every *Process, opposing arrows for
// every *Interaction, a pointed pentagon for every *Event, and the pill for
// every *Service) so the family reads consistently regardless of which
// layer colours it; only the layer fill/border tells those apart, same as
// ArchiMate's own convention.
const BASE_KIND_SVG: Record<string, string> = {
  // AND junction: a filled circle where converging relationships meet.
  andJunction: '<circle cx="7" cy="7" r="2.6" fill="#182228"/>',
  // Collaboration: two overlapping circles, ArchiMate's standard motif.
  applicationCollaboration: '<circle cx="5.5" cy="7" r="4"/><circle cx="8.5" cy="7" r="4"/>',
  // Component: UML/ArchiMate component box with two connector notches on
  // its left edge.
  applicationComponent:
    '<rect x="3" y="2" width="9" height="10"/>' +
    '<rect x="1" y="4" width="2.5" height="1.5"/>' +
    '<rect x="1" y="8" width="2.5" height="1.5"/>',
  // Event: a pointed pentagon, a state change with a direction.
  applicationEvent: '<path d="M3 3 H8 L11 7 L8 11 H3 Z"/>',
  // Function: rounded process box with a right-pointing chevron.
  applicationFunction: '<rect x="2" y="3" width="10" height="8" rx="2"/><path d="M5.5 5 L8 7 L5.5 9"/>',
  // Interaction: two opposing arrows, a two-way exchange.
  applicationInteraction:
    '<path d="M2 5 H9 M9 5 L7 3 M9 5 L7 7"/><path d="M12 9 H5 M5 9 L7 7 M5 9 L7 11"/>',
  // Interface: a lollipop - a small circle on a line, ArchiMate's socket motif.
  applicationInterface: '<line x1="1.5" y1="7" x2="6" y2="7"/><circle cx="9" cy="7" r="3"/>',
  // Process: a plain forward arrow, simpler than Function's boxed chevron.
  applicationProcess: '<path d="M2 7 H10 M10 7 L7.5 4.5 M10 7 L7.5 9.5"/>',
  // Service: a pill/oval, ArchiMate's rounded-rectangle service shape.
  applicationService: '<rect x="1.5" y="4" width="11" height="6" rx="3"/>',
  // Artifact: a document with a folded top-right corner.
  artifact: '<path d="M3 1.5 H9 L11 3.5 V12.5 H3 Z"/><path d="M9 1.5 V3.5 H11"/>',
  // Assessment: a magnifying glass over the state of affairs.
  assessment: '<circle cx="6" cy="6" r="3.5"/><path d="M8.5 8.5 L12 12"/>',
  // Actor: a stick figure - head, torso, arms, legs.
  businessActor: '<circle cx="7" cy="3.5" r="1.8"/><path d="M7 5.3 V9 M4 7 H10 M7 9 L4.5 12.5 M7 9 L9.5 12.5"/>',
  businessCollaboration: '<circle cx="5.5" cy="7" r="4"/><circle cx="8.5" cy="7" r="4"/>',
  businessEvent: '<path d="M3 3 H8 L11 7 L8 11 H3 Z"/>',
  // Function: same process-box convention as applicationFunction, an
  // upward chevron distinguishes the business layer.
  businessFunction: '<rect x="2" y="3" width="10" height="8" rx="2"/><path d="M5 8 L7 5.5 L9 8"/>',
  businessInteraction:
    '<path d="M2 5 H9 M9 5 L7 3 M9 5 L7 7"/><path d="M12 9 H5 M5 9 L7 7 M5 9 L7 11"/>',
  businessInterface: '<line x1="1.5" y1="7" x2="6" y2="7"/><circle cx="9" cy="7" r="3"/>',
  // Business object: a plain record box, undivided - `dataObject`'s header
  // rule is what marks the automated-processing sibling instead.
  businessObject: '<rect x="2" y="3" width="10" height="8"/>',
  businessProcess: '<path d="M2 7 H10 M10 7 L7.5 4.5 M10 7 L7.5 9.5"/>',
  // Role: a badge/medal - responsibility worn, not owned.
  businessRole: '<circle cx="7" cy="6" r="4"/><path d="M5 9.5 L4 12.5 L7 11 L10 12.5 L9 9.5"/>',
  businessService: '<rect x="1.5" y="4" width="11" height="6" rx="3"/>',
  // Capability: a box with a compass-style arrow toward its top-right
  // corner (capability-as-direction motif).
  capability: '<rect x="2" y="2" width="10" height="10" rx="1"/><path d="M5 9 L9 5 M9 5 H6.5 M9 5 V7.5"/>',
  // Communication network: three nodes in a connected mesh.
  communicationNetwork:
    '<circle cx="3.5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="7" cy="10.5" r="1.2"/>' +
    '<path d="M3.5 4 L11 4 M3.5 4 L7 10.5 M11 4 L7 10.5"/>',
  // Constraint: a padlock - a limitation, not just a statement of intent.
  constraint: '<rect x="4" y="6.5" width="6" height="5.5" rx="0.5"/><path d="M5.2 6.5 V4.7 A1.8 1.8 0 0 1 8.8 4.7 V6.5"/>',
  // Contract: an object with two header lines (vs. one for a data object).
  contract: '<rect x="2" y="2" width="10" height="10"/><path d="M2 4.5 H12 M2 6.5 H12"/>',
  // Course of action: a signpost - two flags on one pole, alternative
  // directions to the same goal.
  courseOfAction: '<path d="M7 2 V12.5"/><path d="M7 4 H11 L9.5 5.5 L11 7 H7 Z"/><path d="M7 8 H4 L5.5 9.5 L4 11 H7 Z"/>',
  // Data object: a record box with a header divider.
  dataObject: '<rect x="2" y="2" width="10" height="10"/><path d="M2 5.5 H12"/>',
  // Deliverable: a folded-corner document (like artifact) with a ribbon
  // check-mark distinguishing it as a completed output.
  deliverable:
    '<path d="M3 1.5 H8 L11 4.5 V12.5 H3 Z"/><path d="M8 1.5 V4.5 H11"/><path d="M5 9.5 L7 12.5 L9 9.5"/>',
  // Device: a monitor on two feet, a physical IT resource.
  device: '<rect x="2" y="3" width="10" height="6" rx="0.5"/><path d="M4.5 9 V11 M9.5 9 V11 M3.5 11 H6 M8 11 H10.5"/>',
  // Distribution network: a branching physical route between three points.
  distributionNetwork:
    '<path d="M2 11 Q4 11 5 8 Q6 5 7 5 Q8 5 9 8 Q10 11 12 11"/>' +
    '<circle cx="2" cy="11" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="7" cy="5" r="1"/>',
  // Driver: a steering-wheel motif - a circle with four radiating spokes.
  driver: '<circle cx="7" cy="7" r="5"/><path d="M7 2 V5 M7 9 V12 M2 7 H5 M9 7 H12"/>',
  // Equipment: an open crate, physical gear built to be moved and used.
  equipment: '<rect x="2" y="3" width="10" height="8"/><path d="M2 3 L7 6 L12 3 M7 6 V11"/>',
  // Facility: a building - a purpose-built physical structure.
  facility: '<path d="M2 12.5 V6 L7 2.5 L12 6 V12.5 Z"/><path d="M5.5 12.5 V8.5 H8.5 V12.5"/>',
  // Gap: two block-ends with a dashed break between them.
  gap: '<path d="M2 4 H6 M2 10 H6"/><path d="M8 4 H12 M8 10 H12"/><path d="M7 3 V11" stroke-dasharray="1.4 1.3"/>',
  // Goal: a target - two concentric circles.
  goal: '<circle cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="2.2"/>',
  // Grouping: a dashed rectangle - an informal aggregation, not a whole.
  grouping: '<rect x="2" y="2" width="10" height="10" rx="1" stroke-dasharray="2 1.4"/>',
  implementationEvent: '<path d="M3 3 H8 L11 7 L8 11 H3 Z"/>',
  // Location: a map pin.
  location: '<path d="M7 12.5 C7 12.5 3 8 3 5.5 A4 4 0 0 1 11 5.5 C11 8 7 12.5 7 12.5 Z"/><circle cx="7" cy="5.5" r="1.3"/>',
  // Material: irregular stacked blocks - raw physical matter, not a product.
  material: '<rect x="2" y="8" width="4" height="4"/><rect x="6.5" y="6" width="4" height="6"/><rect x="4" y="2.5" width="4" height="4"/>',
  // Meaning: a speech bubble - interpretation attached to a business object.
  meaning: '<path d="M2 3 H12 V9 H6 L4 11 V9 H2 Z"/><path d="M4.5 6 H9.5"/>',
  // Node: a 3D cuboid, ArchiMate's technology-node glyph.
  node: '<path d="M2 5 L7 2.5 L12 5 L12 10 L7 12.5 L2 10 Z"/><path d="M2 5 L7 7.5 L12 5 M7 7.5 V12.5"/>',
  // OR junction: the same circle as the AND junction, left unfilled - any
  // one of the converging relationships is enough.
  orJunction: '<circle cx="7" cy="7" r="2.6"/>',
  // Outcome: a flag - a result actually reached, planted like a marker.
  outcome: '<path d="M3 1.5 V12.5"/><path d="M3 2 H9 L7 4 L9 6 H3 Z"/>',
  // Path: two endpoints joined by a dashed connector - a link, not a node.
  path: '<circle cx="3" cy="7" r="1.3"/><circle cx="11" cy="7" r="1.3"/><path d="M4.5 7 H9.5" stroke-dasharray="1.6 1.4"/>',
  // Plateau: a flat-topped trapezoid.
  plateau: '<path d="M2 11 L4.5 4 H9.5 L12 11 Z"/><path d="M2 11 H12"/>',
  // Principle: the same banner as Requirement, with a checkmark rather than
  // a header rule - a value judged satisfied, not a line item.
  principle: '<path d="M3 2.5 H11 V9 L7 11.5 L3 9 Z"/><path d="M5 6 L6.5 7.5 L9.5 4.5"/>',
  // Product: an object with a triangular roof - a service bundled for sale.
  product: '<rect x="2" y="5" width="10" height="7"/><path d="M2 5 L7 1.5 L12 5"/>',
  // Representation: a document with a wavy bottom edge (curled paper).
  representation: '<path d="M3 2 H11 V9 Q9.5 11 8 9.5 Q6.5 8 5 9.5 Q3.5 11 3 9 Z"/>',
  // Requirement: a pointed banner/shield shape with a header divider.
  requirement: '<path d="M3 2.5 H11 V9 L7 11.5 L3 9 Z"/><path d="M3 5 H11"/>',
  // Resource: a battery - a chargeable, spendable asset.
  resource: '<rect x="2" y="4.5" width="9" height="5" rx="1"/><rect x="11" y="6" width="1.5" height="2"/><path d="M4 6 V8 M6.5 6 V8 M9 6 V8"/>',
  // Stakeholder: a bust silhouette - an interest held, not a role performed
  // (unlike businessActor's full stick figure).
  stakeholder: '<circle cx="7" cy="5" r="2.2"/><path d="M2.5 12.5 Q2.5 8 7 8 Q11.5 8 11.5 12.5"/>',
  // System software: a nested box, a smaller box docked inside the larger.
  systemSoftware: '<rect x="2" y="2" width="10" height="10"/><rect x="4" y="4" width="4" height="3"/>',
  technologyCollaboration: '<circle cx="5.5" cy="7" r="4"/><circle cx="8.5" cy="7" r="4"/>',
  technologyEvent: '<path d="M3 3 H8 L11 7 L8 11 H3 Z"/>',
  // Function: same process convention again, technology layer gets a gear
  // motif - a circle with radiating teeth.
  technologyFunction:
    '<circle cx="7" cy="7" r="4"/>' +
    '<path d="M7 2 V3.2 M7 10.8 V12 M2 7 H3.2 M10.8 7 H12 ' +
    'M3.5 3.5 L4.3 4.3 M9.7 9.7 L10.5 10.5 M3.5 10.5 L4.3 9.7 M9.7 4.3 L10.5 3.5"/>',
  technologyInteraction:
    '<path d="M2 5 H9 M9 5 L7 3 M9 5 L7 7"/><path d="M12 9 H5 M5 9 L7 7 M5 9 L7 11"/>',
  technologyInterface: '<line x1="1.5" y1="7" x2="6" y2="7"/><circle cx="9" cy="7" r="3"/>',
  technologyProcess: '<path d="M2 7 H10 M10 7 L7.5 4.5 M10 7 L7.5 9.5"/>',
  technologyService: '<rect x="1.5" y="4" width="11" height="6" rx="3"/>',
  // Value: a diamond - relative worth, cut and faceted.
  value: '<path d="M7 2 L11.5 7 L7 12 L2.5 7 Z"/>',
  // Value stream: a thick forward arrow - a sequence that creates a result.
  valueStream: '<path d="M2 5 H8 V3.5 L12 7 L8 10.5 V9 H2 Z"/>',
  // Work package: a briefcase - bounded work with a handle to carry it by.
  workPackage: '<rect x="2" y="5" width="10" height="7"/><path d="M5 5 V3.5 A1 1 0 0 1 6 2.5 H8 A1 1 0 0 1 9 3.5 V5"/>',
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
  ...KIND_SHAPE_OVERRIDES[kind.id],
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
