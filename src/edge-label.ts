/**
 * What an edge says, kept in a module that imports nothing with a runtime of
 * its own (#587). The canvas draws with it; a host that renders the same
 * picture somewhere else, a server-side SVG Worker, imports it from
 * `yarramate/adapter/visual-graph` without taking elkjs, React or cytoscape.
 * It was first published from the editor entry (#576), which is where a
 * consumer could not use it.
 */
import { LAYERING_REVERSED_KINDS, reversesForLayering, type LayoutMode } from './layout-mode.js'
import { humanizeKind, relationshipReading } from './relationship-reading.js'

/** The data fields an edge's label is decided from. */
export interface EdgeLabelData {
  readonly name?: string | null
  readonly kindLabel?: string
  readonly coreKindLabel?: string
  /** An extension kind with a reading of its own (ADR 0159), else absent. */
  readonly readingKind?: string
  /** A reading the endpoints decided (ADR 0160), else absent. */
  readonly reading?: string
  readonly liftedCount?: number
}

/**
 * The one place that decides what an edge says (ADR 0147).
 *
 * A named relationship says its name. An unnamed one says its reading -
 * "serves", or "served by" where the mode layers the served element above -
 * unless kind labels are off, in which case the line style and arrowhead
 * carry the kind alone. An extension kind has no reading in the table and is
 * spelled out from its own name ("deploys to" for `deploys-to`), in the active
 * voice whichever way it is layered, because nobody can conjugate a verb they
 * have not seen. A lifted edge stands for several relationships and says how
 * many.
 */
export const edgeLabelText = (
  data: EdgeLabelData,
  mode: LayoutMode,
  showKindLabels: boolean,
): string => {
  if (typeof data.name === 'string' && data.name !== '') return data.name
  if (!showKindLabels) return ''
  const core = data.coreKindLabel ?? ''
  const kind = data.kindLabel ?? core
  const readingKind = data.readingKind
  const reading =
    data.reading !== undefined && data.reading !== ''
      ? data.reading
      : readingKind !== undefined && readingKind !== core
        ? relationshipReading(readingKind)
        : kind !== core && kind !== ''
          ? humanizeKind(kind)
          : relationshipReading(core, reversesForLayering(mode) && LAYERING_REVERSED_KINDS.has(core))
  const count = typeof data.liftedCount === 'number' ? data.liftedCount : 0
  return count > 1 ? `${reading} ×${count}` : reading
}
