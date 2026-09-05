/**
 * How a view arranges itself, kept in a module that imports nothing.
 *
 * Apart from `projection.ts` for the reason `./layout-direction.ts` gives: the
 * browser needs the value and not only the type, and `projection.ts` drags Ajv
 * and the projection schema in for one constant. `projection.ts` re-exports
 * everything here.
 *
 * The four modes are a ladder; each keeps everything below it (ADR 0147).
 *
 * - `layered`: ELK places the nodes and cytoscape draws its own orthogonal
 *   lines between them, through whatever happens to sit in the way. This is
 *   what shipped before 1.24; measured on the ApertureX reference model, 127
 *   of the Landscape's 206 drawn edges cut through a box that was not one of
 *   their endpoints.
 * - `routed`: ELK also routes every edge around the nodes and reserves room
 *   for each label. Zero edges through boxes on every view measured.
 * - `served-by`: routed, and serving, realization and specialization are
 *   layered UPWARD, so the served, realized or general element sits above
 *   what serves, realizes or specializes it, and the label reads down the
 *   page as "served by". Only the layering turns; the arrowhead, which says
 *   which end is which, keeps its ArchiMate form.
 * - `bands`: served-by, and every element is pinned to its ArchiMate layer's
 *   band, motivation at the top and physical at the bottom.
 */
export const LAYOUT_MODES = ['layered', 'routed', 'served-by', 'bands'] as const

export type LayoutMode = (typeof LAYOUT_MODES)[number]

/**
 * How a view lays out when it does not say. Served-by, because it is the
 * mode that read correctly the first time anyone looked at real tiers: the
 * plain top-down run put the system API above the experience API (ADR 0147).
 * A view that wants the pre-1.24 picture declares `layout: layered`.
 */
export const DEFAULT_LAYOUT: LayoutMode = 'served-by'

export const isLayoutMode = (value: unknown): value is LayoutMode =>
  typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value)

/** Whether ELK's own routes are drawn, rather than cytoscape's straight lines. */
export const routesEdges = (mode: LayoutMode): boolean => mode !== 'layered'

/** Whether the upward kinds are layered target-above-source. */
export const reversesForLayering = (mode: LayoutMode): boolean =>
  mode === 'served-by' || mode === 'bands'

/** Whether every node is pinned to its ArchiMate layer's band. */
export const partitionsByLayer = (mode: LayoutMode): boolean => mode === 'bands'

/**
 * The kinds ArchiMate draws with the TARGET above the source: the served
 * element above its server, the realized above its realizer, the general
 * above its specialization. Reversed for layering only; the notation module
 * still draws the arrowhead at the target.
 */
export const LAYERING_REVERSED_KINDS: ReadonlySet<string> = new Set([
  'serving',
  'realization',
  'specialization',
])

/**
 * Each ArchiMate layer's band under `bands`, top to bottom. `composite` has no
 * band of its own - a grouping holds members from any layer - and a subject
 * with no layer floats free, so neither is listed: ELK partitions only what
 * names a partition, and leaves the rest to the layering.
 */
export const LAYER_BAND: Readonly<Record<string, number>> = {
  motivation: 0,
  strategy: 1,
  business: 2,
  application: 3,
  technology: 4,
  physical: 5,
  implementation: 6,
}

export const layerBandOf = (layer: string | null | undefined): number | undefined =>
  layer === null || layer === undefined ? undefined : LAYER_BAND[layer]
