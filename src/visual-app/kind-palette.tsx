import type React from 'react'
import { useState } from 'react'
import type {
  VisualKindOption,
  VisualPatternOption,
} from '../adapters/visual/protocol-contract.js'
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

/** The core kind a ruling resolves to, the same one `fold-tree` never nests. */
const RULING_CORE_KIND = 'constraint'

/** "1 slot", never "1 slots". Seen in a browser, not in a test. */
const slotCount = (slots: number, required: number): string => {
  const noun = slots === 1 ? 'slot' : 'slots'
  return required === 0
    ? `${slots} ${noun}`
    : `${slots} ${noun}, ${required} required`
}

/**
 * A pattern document's name as a band header.
 *
 * The wire carries the PATH, because that is what a diagnostic names and what a
 * reader can open. A path is not a heading though: rendered whole,
 * `.yarramate/patterns/mulesoft-integration.yaml` wrapped onto two lines and
 * pushed the rows down. The basename is the document, and the full path stays
 * on the element's title for anyone who needs to find the file.
 */
const documentLabel = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.ya?ml$/, '')

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
  /**
   * Kinds this band holds that exist to be BOUND rather than dropped (#473
   * phase 4): a ruling a pattern slot admits is authored by filling the slot,
   * not by dragging it onto the canvas, and there are 48 of them on the
   * ApertureX reference crowding the top of the motivation band.
   *
   * Keyed on constraint LINEAGE and slot admission together, never on "appears
   * as a slot kind" alone: `dataObject` is a slot kind on that same reference
   * and is a first-class thing to draw (review F14).
   */
  readonly boundThroughSlot: readonly VisualKindOption[]
}

/** One pattern document's patterns, as a band of its own. */
export interface PalettePatternGroup {
  readonly document: string
  readonly patterns: readonly VisualPatternOption[]
}

/**
 * The pattern bands, one per DOCUMENT, in document order.
 *
 * Above the layer bands because a pattern is the unit a reader reaches for
 * first: dropping "System API" is one gesture that mints an instance and its
 * parts, where assembling the same thing from the layer bands is five.
 */
export const palettePatternGroups = (
  patterns: readonly VisualPatternOption[] = [],
): readonly PalettePatternGroup[] => {
  const byDocument = new Map<string, VisualPatternOption[]>()
  for (const pattern of patterns) {
    const group = byDocument.get(pattern.document)
    if (group === undefined) byDocument.set(pattern.document, [pattern])
    else group.push(pattern)
  }
  return [...byDocument].map(([document, grouped]) => ({
    document,
    patterns: grouped,
  }))
}

/**
 * Rows grouped by layer, in the profile's own layer order - the same bands the
 * model tree groups subjects by, so the palette and the rail read as one
 * organisation. Within a group the wire's order is kept: the vocabulary
 * arrives sorted and re-sorting it here would be a second opinion.
 */
export const paletteGroups = (
  kinds: readonly VisualKindOption[],
  patterns: readonly VisualPatternOption[] = [],
): readonly PaletteGroup[] => {
  // What a slot will accept, by label. A kind here is reachable by filling a
  // slot, which is the other way to author it.
  const admitted = new Set(
    patterns.flatMap((pattern) =>
      pattern.slots.flatMap((slot) => [...slot.admits]),
    ),
  )
  const boundThroughSlot = (option: VisualKindOption): boolean =>
    option.coreLabel === RULING_CORE_KIND && admitted.has(option.label)

  const byLayer = new Map<string, VisualKindOption[]>()
  const boundByLayer = new Map<string, VisualKindOption[]>()
  for (const option of kinds) {
    const layer = LAYER_OF_CORE_KIND.get(option.coreLabel) ?? UNLAYERED
    const into = boundThroughSlot(option) ? boundByLayer : byLayer
    const group = into.get(layer)
    if (group === undefined) {
      into.set(layer, [option])
    } else {
      group.push(option)
    }
  }
  return [...layers, UNLAYERED].flatMap((layer) => {
    const grouped = byLayer.get(layer)
    const bound = boundByLayer.get(layer)
    return grouped === undefined && bound === undefined
      ? []
      : [
          {
            layer,
            kinds: grouped ?? [],
            boundThroughSlot: bound ?? [],
          },
        ]
  })
}

export const KindPalette = ({
  kinds,
  patterns,
  onPick,
}: {
  readonly kinds: readonly VisualKindOption[]
  /** The patterns this workspace declares, if the frame carried any. */
  readonly patterns?: readonly VisualPatternOption[]
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
      {palettePatternGroups(patterns).map((group) => {
        const isCollapsed = collapsed.has(group.document)
        return (
          <div className="kind-palette-layer" key={`pattern:${group.document}`}>
            <button
              type="button"
              className="kind-palette-layer-name"
              aria-expanded={!isCollapsed}
              title={group.document}
              onClick={() => toggleLayer(group.document)}
            >
              <span className="kind-palette-caret" aria-hidden="true">
                {isCollapsed ? '\u25b8' : '\u25be'}
              </span>
              {`patterns \u00b7 ${documentLabel(group.document)}`}
            </button>
            {isCollapsed ? null : (
              <ul className="kind-palette-rows">
                {group.patterns.map((pattern) => {
                  const required = pattern.slots.filter(
                    (slot) => slot.required,
                  ).length
                  return (
                    <li key={pattern.kind}>
                      <button
                        type="button"
                        className="kind-palette-row kind-palette-pattern"
                        draggable
                        // The KIND label, the same payload every other row
                        // carries: a pattern is dropped as its kind, and the
                        // form that opens is the drop handler's business.
                        data-kind={pattern.label}
                        data-pattern={pattern.kind}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(KIND_MIME, pattern.label)
                          event.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={() => onPick(pattern.label)}
                      >
                        {/* The stacked mark a folded node wears, so the thing
                            that draws as one box reads as one thing here. */}
                        <span
                          className="kind-palette-stack"
                          aria-hidden="true"
                        />
                        <span>{pattern.name ?? pattern.label}</span>
                        <span className="kind-palette-slots">
                          {slotCount(pattern.slots.length, required)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
      {paletteGroups(kinds, patterns).map((group) => {
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
            {isCollapsed || group.boundThroughSlot.length === 0 ? null : (
              <BoundThroughSlot
                layer={group.layer}
                kinds={group.boundThroughSlot}
                onPick={onPick}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The rulings a slot admits, folded away under their own layer band.
 *
 * Its own collapsed section rather than a filter: these kinds are real and a
 * reader may still want one, but they are authored by FILLING A SLOT, and 48
 * of them at the top of the motivation band is what a reader scrolls past to
 * reach the four things they came for.
 */
const BoundThroughSlot = ({
  layer,
  kinds,
  onPick,
}: {
  readonly layer: string
  readonly kinds: readonly VisualKindOption[]
  readonly onPick: (kindLabel: string) => void
}): React.ReactElement => {
  const [open, setOpen] = useState(false)
  return (
    <div className="kind-palette-bound">
      <button
        type="button"
        className="kind-palette-layer-name kind-palette-bound-name"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="kind-palette-caret" aria-hidden="true">
          {open ? '\u25be' : '\u25b8'}
        </span>
        {`${layer} \u00b7 ${kinds.length} kinds bound through a slot`}
      </button>
      {!open ? null : (
        <ul className="kind-palette-rows">
          {kinds.map((option) => (
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
                <span>{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
