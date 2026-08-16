// Pure kind-icon generation: a 14x14 ArchiMate-glyph SVG (as an inline
// `data:` URI) per element kind this repo's graph actually uses. No
// cytoscape/DOM dependency here, same isolation as `badges.ts` (the sibling
// module for the same stylesheet) - this stays testable as a plain
// string-in/string-out lookup. Not wired to `graph-canvas.tsx` yet: Task 11
// consumes this from the stylesheet as a `background-image` on the node's
// top-right slot.

// An SVG `data:` URI can't read `var(--token)`, so the stroke colour below
// is `--ink` (`src/visual-app/styles.css:11-21`), resolved once to its
// literal rendered hex - same value `badges.ts` uses for `INK`, redeclared
// here rather than imported so this module keeps its own zero-import,
// zero-dependency footprint.
const INK = '#182228' // --ink (styles.css:12)

// 14px: the brief's fixed icon size for the node's top-right badge slot.
const ICON_SIZE = 14

function toDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Stroke colour/width/cap/join are declared once on the wrapping `<g>`
// rather than repeated per shape - every glyph body below is bare
// `rect`/`circle`/`path` markup with no fill or stroke attributes of its
// own, which is what keeps these icons single-stroke by construction.
function svg(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" ` +
    `viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">` +
    `<g fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    `</svg>`
  )
}

// The 17 kinds `yarramate/core@0.1` and `.yarramate/profiles/
// yarramate-development.yaml` (the two that don't inherit) declare, each
// rendered as a simplified single-stroke take on its ArchiMate element
// glyph. Descriptive notation only - no trademark or conformance claim.
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

const BASE_KIND_ICON_URI: Record<string, string> = Object.fromEntries(
  Object.entries(BASE_KIND_SVG).map(([kind, body]) => [kind, toDataUri(svg(body))]),
)

// `compiler-module` and `repository-file` are the two kinds
// `.yarramate/profiles/yarramate-development.yaml` adds beyond
// `yarramate/core@0.1`'s 17. Both inherit their parent's glyph verbatim -
// the same URI constant is reused below, not a re-serialized copy, so the
// two pairs are byte-identical.
const KIND_ICON_URI: Record<string, string> = {
  ...BASE_KIND_ICON_URI,
  'compiler-module': BASE_KIND_ICON_URI['applicationComponent']!,
  'repository-file': BASE_KIND_ICON_URI['artifact']!,
}

// `kindLabel` is a kind's local id (`kindLabelOf` in `src/kind-label.ts`),
// not the qualified `<profile>#<id>` identity. Unknown label -> no icon, no
// crash: the top-right slot simply stays empty.
export function kindIconUriOf(kindLabel: string): string | null {
  return KIND_ICON_URI[kindLabel] ?? null
}
