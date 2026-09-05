/**
 * What a pattern instance holds, as the properties column shows it (#473).
 *
 * READ-ONLY, and that is a decision rather than a phase boundary. Binding a
 * part is a model edit that `apply` already performs through `update-concept`
 * with `parts` (#448); a second way in, through a panel, would be a second
 * spelling of one operation. This says what the instance holds and what it has
 * not decided, and leaves the deciding to the surface that already does it.
 *
 * A pure model over plain data, tested without a DOM. The component around it
 * renders these rows and nothing else.
 */

import type { PatternMembership, PatternVacancy } from '../compiler.js'

/** One slot of one instance, bound or not. */
export interface SlotRow {
  readonly slot: string
  /**
   * The subject bound into it, or `null` where nothing is. A null row is a
   * decision nobody has taken, which is exactly what the interview asks about
   * (ADR 0140) — the properties column and the question are two views of one
   * fact, so they must not be able to disagree.
   */
  readonly member: string | null
  /**
   * `context` slots name what the instance USES rather than what it holds, so
   * a reader looking at a box needs them marked: they are the only rows here
   * that do NOT fold inside it.
   */
  readonly wiring: PatternMembership['wiring']
  /** For an unbound slot, whether the model does not stand up without it. */
  readonly required: boolean
  /** How many OTHER instances bind the same subject, for a shared part. */
  readonly sharedWith: number
}

export interface SlotsSection {
  readonly pattern: string
  readonly rows: readonly SlotRow[]
  /** Bound slots, and slots still to decide. Cheap for a heading. */
  readonly boundCount: number
  readonly vacantCount: number
}

/**
 * The slots of one instance, bound rows first and vacancies after, each group
 * in slot-name order.
 *
 * Bound first because a reader opening the panel is usually checking what IS
 * there; the vacancies read as a to-do list under it, which is what they are.
 *
 * Returns `null` for a subject that is not a pattern instance at all — a panel
 * with an empty Slots heading says "this has no parts", which is a different
 * and wrong claim.
 */
export function slotsSectionFor(
  subjectId: string,
  memberships: readonly PatternMembership[] = [],
  vacancies: readonly PatternVacancy[] = [],
): SlotsSection | null {
  const bound = memberships.filter(({ instance }) => instance === subjectId)
  const vacant = vacancies.filter(({ instance }) => instance === subjectId)
  if (bound.length === 0 && vacant.length === 0) return null

  // How many instances bind each subject, so a shared part can say so. Counted
  // over EVERY membership, not just this instance's: sharing is a fact about
  // the subject, and the point of the marker is that somebody else holds it too.
  const instancesOf = new Map<string, Set<string>>()
  for (const membership of memberships) {
    const held = instancesOf.get(membership.member)
    if (held === undefined)
      instancesOf.set(membership.member, new Set([membership.instance]))
    else held.add(membership.instance)
  }

  const byName = (left: { slot: string }, right: { slot: string }) =>
    left.slot.localeCompare(right.slot)

  const rows: SlotRow[] = [
    ...[...bound].sort(byName).map(
      (membership): SlotRow => ({
        slot: membership.slot,
        member: membership.member,
        wiring: membership.wiring,
        required: false,
        sharedWith: (instancesOf.get(membership.member)?.size ?? 1) - 1,
      }),
    ),
    ...[...vacant].sort(byName).map(
      (vacancy): SlotRow => ({
        slot: vacancy.slot,
        member: null,
        wiring: undefined,
        required: vacancy.required,
        sharedWith: 0,
      }),
    ),
  ]

  return {
    pattern:
      bound[0]?.pattern ?? vacant[0]?.pattern ?? '',
    rows,
    boundCount: bound.length,
    vacantCount: vacant.length,
  }
}

/**
 * What one row says, in words, so the component renders a string it did not
 * compose and a test can assert the wording without a DOM.
 */
export function slotRowLabel(row: SlotRow): string {
  if (row.member === null) {
    return row.required ? 'to decide — required' : 'to decide'
  }
  const marks: string[] = []
  // Marked because it is the one kind of bound slot that does NOT draw inside
  // the box when the instance is folded.
  if (row.wiring === 'context') marks.push('context')
  if (row.sharedWith > 0) {
    marks.push(
      row.sharedWith === 1 ? 'shared with 1 other' : `shared with ${row.sharedWith} others`,
    )
  }
  return marks.length === 0 ? row.member : `${row.member} (${marks.join(', ')})`
}
