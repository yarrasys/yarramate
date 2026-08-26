// Pure badge-generation helpers for the cytoscape canvas: lifecycle/evidence
// chip SVGs (as inline `data:` URIs) and the owner-initials string Task 6's
// ownership chip will render. No cytoscape/DOM dependency here - `STYLESHEET`
// in `graph-canvas.tsx` is the only caller, so this stays testable as plain
// string-in/string-out functions.

// The three values `CanvasNode.status` carries in practice (schema/
// yarramate-document.schema.json's lifecycle enum). Any other value
// (including `null`) gets no lifecycle badge - this module never invents a
// colour/shape for a status the schema doesn't define.
export type LifecycleStatus = 'planned' | 'current' | 'retired'

export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return value === 'planned' || value === 'current' || value === 'retired'
}

// An SVG `data:` URI can't read `var(--token)` or evaluate `color-mix()`, so
// every badge colour below is one of `styles.css`'s `:root` custom properties
// (`src/visual-app/styles.css:11-21`), resolved once to its literal rendered
// hex - named beside each constant. No invented palette: these are the same
// four tokens the design names for lifecycle/evidence (`--ink`, `--eucalyptus`,
// `--failure`, `--quiet`), one token per badge variant, none reused across
// variants within this module. (The ownership palette below is a separate
// concern with its own reuse rule - see its comment.)
const INK = '#182228' // --ink (styles.css:12) - evidence chip
const EUCALYPTUS = '#416f65' // --eucalyptus (styles.css:13) - lifecycle: current
const FAILURE = '#a3403a' // --failure (styles.css:16) - lifecycle: retired
// --quiet (styles.css:21) is itself `color-mix(in oklab, var(--ink) 62%,
// var(--paper))`, not a literal - resolved once (oklab mix of #182228 62% /
// #e8eef0 38%) to the sRGB hex a browser would actually paint.
const QUIET = '#5f686d' // --quiet - lifecycle: planned

// Task 6's ownership-chip palette: the four hue-bearing tokens in
// `styles.css`'s `:root` (`src/visual-app/styles.css:11-16`) that carry a
// distinct hue, in declaration order. `--eucalyptus` and `--ink` are
// literal-value reuses of the `EUCALYPTUS`/`INK` constants above - same hex,
// a different badge purpose (painting an owner's initials, not a
// lifecycle/evidence state) - so unlike the lifecycle/evidence set this
// palette does reuse tokens across variants. `--failure` (`#a3403a`) is a
// fifth hue-bearing token in `:root` but is deliberately excluded: Task 5
// already spends it on lifecycle `retired`, and a red ownership chip would
// misread as "this concept is in trouble" when it only means "this person
// owns it".
const OCHRE = '#8c4d18' // --ochre (styles.css:14)
const COBALT = '#2457a6' // --cobalt (styles.css:15)
const OWNER_PALETTE: readonly string[] = [EUCALYPTUS, OCHRE, COBALT, INK]

// 12px: legible at the small size a corner badge on a 170x50 node box can
// occupy without crowding the label text it sits beside.
const BADGE_SIZE = 12

function toDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_SIZE}" height="${BADGE_SIZE}" viewBox="0 0 12 12">${body}</svg>`
}

// Shape, not just colour, carries meaning: planned is a hollow ring (nothing
// real yet), current/retired are filled dots distinguished only by colour
// (green vs red) since both already exist.
const LIFECYCLE_SVG: Record<LifecycleStatus, string> = {
  planned: svg(`<circle cx="6" cy="6" r="4" fill="none" stroke="${QUIET}" stroke-width="2"/>`),
  current: svg(`<circle cx="6" cy="6" r="5" fill="${EUCALYPTUS}"/>`),
  retired: svg(`<circle cx="6" cy="6" r="5" fill="${FAILURE}"/>`),
}

// Exported directly (not through a one-line accessor function) - callers
// index it by the status they already have in hand, same as `EVIDENCE_BADGE_URI`
// below.
export const LIFECYCLE_BADGE_URI: Record<LifecycleStatus, string> = {
  planned: toDataUri(LIFECYCLE_SVG.planned),
  current: toDataUri(LIFECYCLE_SVG.current),
  retired: toDataUri(LIFECYCLE_SVG.retired),
}

// Evidence is binary presence (`attestations.length > 0`), never a status
// with variants, so there is exactly one glyph: a checkmark-in-circle.
const EVIDENCE_SVG = svg(
  `<circle cx="6" cy="6" r="5" fill="${INK}"/>` +
    `<path d="M3.2 6.2 L5.2 8.2 L8.8 4.2" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
)

export const EVIDENCE_BADGE_URI = toDataUri(EVIDENCE_SVG)


// FNV-1a 32-bit hash of a ref string, modulo palette length, selecting a
// stable colour across reloads and machines. Task 3's `seedToInt32` in
// graph-canvas.tsx does the same algorithm for layout seeding; we keep this
// local to badges.ts to preserve this module's pure-string/no-imports status
// - a testable 5-line FNV-1a function is cleaner than an avoidable
// cross-module dependency for the same 32-line operation.
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5 // FNV-1a 32-bit offset basis
  const prime = 0x01000193 // FNV-1a 32-bit prime
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), prime)
  }
  return hash
}

// Hash the owner ref string onto the ownership palette (0..3). FNV-1a is
// stable across machines and reloads. `null` in, `null` out - a node with no
// owner's chip builder never gets called (Task 6's badgeLayersFor gate).
export function ownerColorOf(owner: string | null): string | null {
  if (owner === null) return null
  const hash = fnv1aHash(owner)
  // Derive a non-negative palette index. Math.abs is lossy for -2^31, but
  // that corner case hashes to the same modulo class as -2^31 % 4 anyway.
  const index = Math.abs(hash) % OWNER_PALETTE.length
  return OWNER_PALETTE[index]!
}

// Build an SVG data URI for the ownership chip: a filled circle carrying the
// owner's initials (two uppercase letters). `owner` and `initials` must both
// be non-null (the caller, badgeLayersFor in graph-canvas.tsx, only calls
// this when both exist). Initials are unsanitized - they come from
// ownerInitialsOf, which only emits uppercase ASCII letters, never markup.
function ownerBadgeSvg(owner: string, initials: string): string {
  const color = ownerColorOf(owner)!
  return svg(
    `<circle cx="6" cy="6" r="5" fill="${color}"/>` +
      `<text x="6" y="7.5" font-size="8" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text>`,
  )
}

export function ownerBadgeUri(owner: string, initials: string): string {
  return toDataUri(ownerBadgeSvg(owner, initials))
}

// The open-questions chip: a quiet circle carrying the subject's open count
// (#292). Deliberately `--quiet`, never `--failure`: an open question is the
// catalogue deepening honestly (ADR 0063), not a defect, and a freshly drawn
// subject legitimately sprouts several. Counts past nine render as "9+" so
// the glyph stays legible at BADGE_SIZE; the caller never invokes this at
// zero (badgeLayersFor gates on count > 0 - no chip is how "nothing open"
// is drawn).
function openQuestionsBadgeSvg(count: number): string {
  const glyph = count > 9 ? '9+' : String(count)
  const fontSize = glyph.length > 1 ? 6.5 : 8
  return svg(
    `<circle cx="6" cy="6" r="5" fill="${QUIET}"/>` +
      `<text x="6" y="7.5" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${glyph}</text>`,
  )
}

export function openQuestionsBadgeUri(count: number): string {
  return toDataUri(openQuestionsBadgeSvg(count))
}

// `owner` is a qualified ref (`document#localId`, e.g.
// "yarramate-product#yarramate-maintainers" - the one owner this repo's own
// graph declares, per the plan's Task 6 grounding). Initials come from the
// hyphen/underscore/space-separated words of the local id, not the document
// prefix, since the document is a filing detail and the local id is the
// human-chosen name. `null` in, `null` out: a badge with no owner draws
// nothing (Task 6's job), it never falls back to a placeholder glyph.
export function ownerInitialsOf(owner: string | null): string | null {
  if (owner === null) return null
  const localId = owner.includes('#') ? owner.slice(owner.indexOf('#') + 1) : owner
  const words = localId.split(/[-_\s]+/).filter((word) => word.length > 0)
  if (words.length === 0) return null
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
  return initials.length > 0 ? initials : null
}
