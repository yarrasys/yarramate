import { describe, expect, it } from 'vitest'
import { slotsSectionFor, slotRowLabel } from '../src/visual-app/slots-model.js'
import type { PatternMembership, PatternVacancy } from '../src/compiler.js'

// #473 item 1.8: what a pattern instance holds, as the properties column shows
// it. READ-ONLY by decision, not by phase: binding a part is a model edit
// `apply` already performs through `update-concept` with `parts` (#448), and a
// second way in would be a second spelling of one operation.

const bind = (
  slot: string,
  member: string,
  instance: string,
  wiring?: PatternMembership['wiring'],
): PatternMembership => ({
  member,
  slot,
  instance,
  pattern: 'acme/p@1.0#api',
  ...(wiring === undefined ? {} : { wiring }),
})

const vacancy = (slot: string, instance: string, required = false): PatternVacancy => ({
  instance,
  pattern: 'acme/p@1.0#api',
  slot,
  slotKind: 'yarramate/core@0.1#applicationService',
  required,
})

describe('#473: the Slots section', () => {
  it('draws nothing at all for a subject that is not an instance', () => {
    // An empty "Slots" heading would claim "this has no parts", which is a
    // different and wrong thing to say.
    expect(slotsSectionFor('plain', [bind('a', 'x', 'other')], [])).toBeNull()
  })

  it('lists bound slots first, then what is still to decide', () => {
    // A reader opening the panel is usually checking what IS there; the
    // vacancies read as a to-do list under it, which is what they are.
    const section = slotsSectionFor(
      'app',
      [bind('interface', 'iface', 'app', 'owned')],
      [vacancy('service', 'app'), vacancy('backend', 'app')],
    )
    expect(section!.rows.map((row) => row.slot)).toEqual([
      'interface',
      'backend',
      'service',
    ])
    expect(section!.boundCount).toBe(1)
    expect(section!.vacantCount).toBe(2)
  })

  it('marks a CONTEXT slot, the one bound row that does not fold inside', () => {
    const section = slotsSectionFor(
      'app',
      [bind('upstream', 'other-api', 'app', 'context')],
      [],
    )
    expect(slotRowLabel(section!.rows[0]!)).toBe('other-api (context)')
  })

  it('leaves an owned slot unmarked', () => {
    const section = slotsSectionFor('app', [bind('interface', 'iface', 'app', 'owned')], [])
    expect(slotRowLabel(section!.rows[0]!)).toBe('iface')
  })

  it('says a part is shared, and with how many', () => {
    // Sharing is a fact about the SUBJECT, so it is counted over every
    // membership rather than this instance's - the point of the marker is
    // that somebody else holds it too.
    const memberships = [
      bind('mapping', 'map-x', 'app', 'owned'),
      bind('mapping', 'map-x', 'other', 'owned'),
      bind('mapping', 'map-x', 'third', 'owned'),
    ]
    const section = slotsSectionFor('app', memberships, [])
    expect(slotRowLabel(section!.rows[0]!)).toBe('map-x (shared with 2 others)')
  })

  it('says "1 other" rather than "1 others"', () => {
    const section = slotsSectionFor(
      'app',
      [bind('mapping', 'map-x', 'app'), bind('mapping', 'map-x', 'other')],
      [],
    )
    expect(slotRowLabel(section!.rows[0]!)).toBe('map-x (shared with 1 other)')
  })

  it('says a required vacancy differently from an optional one', () => {
    // "to decide" and "this model does not stand up without it" are different
    // questions to put to a person (ADR 0140).
    const section = slotsSectionFor(
      'app',
      [],
      [vacancy('service', 'app'), vacancy('interface', 'app', true)],
    )
    const labels = new Map(section!.rows.map((row) => [row.slot, slotRowLabel(row)]))
    expect(labels.get('service')).toBe('to decide')
    expect(labels.get('interface')).toBe('to decide — required')
  })

  it('ignores slots belonging to other instances', () => {
    const section = slotsSectionFor(
      'app',
      [bind('interface', 'iface', 'app'), bind('interface', 'other-iface', 'other')],
      [vacancy('service', 'other')],
    )
    expect(section!.rows).toHaveLength(1)
    expect(section!.rows[0]!.member).toBe('iface')
  })
})
