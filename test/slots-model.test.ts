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

describe('#473 phase 4: a staged binding shows on its own row', () => {
  // Found by the ApertureX session looking at 1.23.0: picking a subject for an
  // empty slot staged the operation and the row snapped straight back to
  // "to decide", with the only evidence in another section's count. The
  // properties form already overlays staged edits onto the fields it shows;
  // the slots are the same question asked about `parts`, and were not.
  const bound = (slot: string, member: string) => ({
    member,
    slot,
    instance: 'sys-api',
    pattern: 'acme/p@1.0#api',
    wiring: 'owned' as const,
  })
  const vacant = (slot: string, required = false) => ({
    instance: 'sys-api',
    pattern: 'acme/p@1.0#api',
    slot,
    slotKind: 'yarramate/core@0.1#dataObject',
    required,
  })
  const stage = (slot: string, member: string, id = 'sys-api') => ({
    op: 'update-concept' as const,
    document: 'architecture/main.yaml',
    concept: { id, parts: { [slot]: member } },
  })

  it('turns a vacant row into a bound one, marked staged', () => {
    const section = slotsSectionFor(
      'sys-api',
      [bound('interface', 'sys-interface')],
      [vacant('payload')],
      [stage('payload', 'fresh-payload')],
    )
    const row = section?.rows.find((candidate) => candidate.slot === 'payload')
    expect(row?.member).toBe('fresh-payload')
    expect(row?.staged).toBe(true)
    expect(slotRowLabel(row!)).toBe('fresh-payload (staged)')
  })

  it('counts it in the heading, so the section does not argue with itself', () => {
    const section = slotsSectionFor(
      'sys-api',
      [bound('interface', 'sys-interface')],
      [vacant('payload'), vacant('backend')],
      [stage('payload', 'fresh-payload')],
    )
    expect(section?.boundCount).toBe(2)
    expect(section?.vacantCount).toBe(1)
  })

  it('leaves a slot nothing staged alone', () => {
    const section = slotsSectionFor(
      'sys-api',
      [],
      [vacant('payload'), vacant('backend', true)],
      [stage('payload', 'fresh-payload')],
    )
    const untouched = section?.rows.find(({ slot }) => slot === 'backend')
    expect(untouched?.member).toBeNull()
    expect(slotRowLabel(untouched!)).toBe('to decide — required')
  })

  it('takes the LAST choice when a slot is picked twice', () => {
    // Tray order, the way `apply` replays a batch.
    const section = slotsSectionFor(
      'sys-api',
      [],
      [vacant('payload')],
      [stage('payload', 'first-pick'), stage('payload', 'second-pick')],
    )
    expect(section?.rows[0]?.member).toBe('second-pick')
  })

  it('reads an add-concept that binds parts in the same batch', () => {
    // An instance minted and bound at once, which the instance form stages.
    const section = slotsSectionFor(
      'sys-api',
      [],
      [vacant('payload')],
      [
        {
          op: 'add-concept',
          document: 'architecture/main.yaml',
          concept: { id: 'sys-api', kind: 'api', name: 'System API', parts: { payload: 'minted' } },
        },
      ],
    )
    expect(section?.rows[0]?.member).toBe('minted')
  })

  it('ignores a staged binding on a different instance', () => {
    const section = slotsSectionFor(
      'sys-api',
      [],
      [vacant('payload')],
      [stage('payload', 'not-ours', 'other-api')],
    )
    expect(section?.rows[0]?.member).toBeNull()
  })

  it('matches a qualified subject id against a local operation id', () => {
    // The frame qualifies subject ids and an operation names the local one.
    const section = slotsSectionFor(
      'yarrasys/main#sys-api',
      [],
      [{ ...vacant('payload'), instance: 'yarrasys/main#sys-api' }],
      [stage('payload', 'fresh-payload')],
    )
    expect(section?.rows[0]?.member).toBe('fresh-payload')
  })

  it('shows nothing staged as it did before, when the changeset is empty', () => {
    const section = slotsSectionFor('sys-api', [], [vacant('payload')])
    expect(section?.rows[0]?.staged).toBeUndefined()
    expect(section?.boundCount).toBe(0)
    expect(section?.vacantCount).toBe(1)
  })
})
