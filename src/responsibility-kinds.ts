/**
 * The three responsibility relationship kinds and the letters they carry
 * (#557, ADR 0159): `yarramate/policy@0.2#responsible`, `#consulted` and
 * `#informed`, each a subkind of core `association` from a person to the
 * subject they answer for. Accountable is not a kind: it is the existing
 * `yarramate/ownership/owner` claim. Pure, so the canvas projection, the
 * matrix builder and the editor read one table.
 */

export const RESPONSIBILITY_PROFILE = 'yarramate/policy@0.2'

export type ResponsibilityLetter = 'R' | 'C' | 'I'

export const RESPONSIBILITY_KINDS: Readonly<
  Record<'responsible' | 'consulted' | 'informed', string>
> = {
  responsible: `${RESPONSIBILITY_PROFILE}#responsible`,
  consulted: `${RESPONSIBILITY_PROFILE}#consulted`,
  informed: `${RESPONSIBILITY_PROFILE}#informed`,
}

export const RESPONSIBILITY_LETTERS: Readonly<Record<string, ResponsibilityLetter>> = {
  [RESPONSIBILITY_KINDS.responsible]: 'R',
  [RESPONSIBILITY_KINDS.consulted]: 'C',
  [RESPONSIBILITY_KINDS.informed]: 'I',
}

export const OWNER_PREDICATE = 'yarramate/ownership/owner'

/** The core kinds a person subject may be, ancestors of any profile's own. */
export const PEOPLE_KINDS: readonly string[] = [
  'yarramate/core@0.1#businessActor',
  'yarramate/core@0.1#businessRole',
  'yarramate/core@0.1#businessCollaboration',
  'yarramate/core@0.1#stakeholder',
]

/**
 * The letter a relationship kind carries, read through its lineage
 * (ancestor-first) so a profile's own subkind of `responsible` is still an
 * R; `null` for every other kind.
 */
export const responsibilityLetterOf = (
  lineage: readonly string[] | undefined,
  kind: string,
): ResponsibilityLetter | null => {
  for (const member of lineage ?? [kind]) {
    const letter = RESPONSIBILITY_LETTERS[member]
    if (letter !== undefined) return letter
  }
  return RESPONSIBILITY_LETTERS[kind] ?? null
}

/** Whether a concept kind is a person, read through its lineage. */
export const isPeopleKind = (lineage: readonly string[] | undefined, kind: string): boolean =>
  (lineage ?? [kind]).some((member) => PEOPLE_KINDS.includes(member)) ||
  PEOPLE_KINDS.includes(kind)
