import type React from 'react'
import { useState } from 'react'
import type { VisualKindOption } from '../adapters/visual/protocol-contract.js'
import { conceptKinds, layers } from '../profile.js'
import { ICON_SIZE, kindIconUriOf } from './kind-icons.js'

/**
 * The kind palette (#295): the profile's concept kinds, listed to be picked up.
 *
 * The kinds are the same vocabulary the Add-subject dialog's Kind select
 * compiles from - `vocabulary.conceptKinds`, sent with every model frame - so
 * nothing here decides what a workspace may contain. A row is a thing to drag
 * onto the canvas, and a thing to click for the same result without a pointer
 * gesture: either way the details dialog opens with the kind already chosen,
 * and the palette itself holds nothing afterwards (ADR 0116).
 */

/**
 * The drag payload's type. Custom rather than `text/plain`, so the canvas
 * accepts exactly what the palette offers and a stray text drop onto the
 * diagram stays inert. The payload is the kind's LABEL, not its full identity:
 * a document names a kind the short way, and `apply` refuses the identity as
 * an unknown kind (`YM401`) - the same rule the dialog's own select follows.
 */
export const KIND_MIME = 'application/x-yarramate-kind'

/** Where a kind whose lineage resolves outside the core profile is grouped,
 * last - the same word the model tree uses for a subject with no layer. */
const UNLAYERED = 'unlayered'

// A kind's layer, off its CORE label: the wire carries no layer, but every
// option names the nearest core kind it descends from, and the core profile
// declares a layer for each of those. An extension kind therefore files under
// its parent's layer, which is where a reader fluent in the bands would look.
const LAYER_OF_CORE_KIND: ReadonlyMap<string, string> = new Map(
  conceptKinds.map((kind) => [kind.id, kind.layer] as const),
)

export interface PaletteGroup {
  readonly layer: string
  readonly kinds: readonly VisualKindOption[]
}

/**
 * Rows grouped by layer, in the profile's own layer order - the same bands the
 * model tree groups subjects by, so the palette and the rail read as one
 * organisation. Within a group the wire's order is kept: the vocabulary
 * arrives sorted and re-sorting it here would be a second opinion.
 */
export const paletteGroups = (
  kinds: readonly VisualKindOption[],
): readonly PaletteGroup[] => {
  const byLayer = new Map<string, VisualKindOption[]>()
  for (const option of kinds) {
    const layer = LAYER_OF_CORE_KIND.get(option.coreLabel) ?? UNLAYERED
    const group = byLayer.get(layer)
    if (group === undefined) {
      byLayer.set(layer, [option])
    } else {
      group.push(option)
    }
  }
  return [...layers, UNLAYERED].flatMap((layer) => {
    const grouped = byLayer.get(layer)
    return grouped === undefined ? [] : [{ layer, kinds: grouped }]
  })
}

export const KindPalette = ({
  kinds,
  onPick,
}: {
  readonly kinds: readonly VisualKindOption[]
  /** A kind chosen without the drag - a click, a keyboard - which opens the
   * same dialog a drop does. */
  readonly onPick: (kindLabel: string) => void
}): React.ReactElement => {
  // Collapsed layer bands, per mount. 62 kinds is a lot of scroll for a
  // reviewer working in one band; every band starts open so nothing is
  // hidden until the reviewer hides it, matching the section headers above.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleLayer = (layer: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  return (
    <div className="kind-palette">
      {paletteGroups(kinds).map((group) => {
        const isCollapsed = collapsed.has(group.layer)
        return (
          <div className="kind-palette-layer" key={group.layer}>
            <button
              type="button"
              className="kind-palette-layer-name"
              aria-expanded={!isCollapsed}
              onClick={() => toggleLayer(group.layer)}
            >
              <span className="kind-palette-caret" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
              {group.layer}
            </button>
            {isCollapsed ? null : (
              <ul className="kind-palette-rows">
                {group.kinds.map((option) => {
            // The glyph the canvas already draws on a node of this kind; an
            // extension kind borrows its core parent's. No glyph, no image -
            // the label alone still names the kind.
            const icon =
              kindIconUriOf(option.label) ?? kindIconUriOf(option.coreLabel)
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className="kind-palette-row"
                  draggable
                  data-kind={option.label}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(KIND_MIME, option.label)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onPick(option.label)}
                >
                  {icon === null ? null : (
                    <img
                      src={icon}
                      alt=""
                      width={ICON_SIZE}
                      height={ICON_SIZE}
                    />
                  )}
                  <span>{option.label}</span>
                </button>
              </li>
            )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
