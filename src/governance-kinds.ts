/**
 * The governance concept kinds (#560, ADR 0160): `yarramate/policy@0.3#risk`
 * and `#assumption`, each a subkind of core `assessment`. A decision is the
 * adopter's trial kind under `courseOfAction` until the trial reports, so
 * it is not here. Review dates are attestations on the shipped topics
 * below. Pure, so the canvas projection, the log builder and the brief read
 * one table.
 */

export const GOVERNANCE_PROFILE = 'yarramate/policy@0.3'

export type GovernanceType = 'risk' | 'assumption'

export const GOVERNANCE_KINDS: Readonly<Record<GovernanceType, string>> = {
  risk: `${GOVERNANCE_PROFILE}#risk`,
  assumption: `${GOVERNANCE_PROFILE}#assumption`,
}

/**
 * The attestation topic that records a review of each type: a risk owner
 * or the client role attests `risk-reviewed` on a risk, and the client
 * confirms an assumption with `assumption-confirmed`. How old is too old is
 * the adopter's threshold, not the engine's.
 */
export const REVIEW_TOPICS: Readonly<Record<GovernanceType, string>> = {
  risk: 'risk-reviewed',
  assumption: 'assumption-confirmed',
}

const TYPE_BY_KIND: Readonly<Record<string, GovernanceType>> = {
  [GOVERNANCE_KINDS.risk]: 'risk',
  [GOVERNANCE_KINDS.assumption]: 'assumption',
}

/**
 * Whether a concept kind is a risk or an assumption, read through its
 * lineage (ancestor-first) so a profile's own subkind counts; null for
 * every other kind.
 */
export const governanceTypeOf = (
  lineage: readonly string[] | undefined,
  kind: string,
): GovernanceType | null => {
  for (const member of lineage ?? [kind]) {
    const type = TYPE_BY_KIND[member]
    if (type !== undefined) return type
  }
  return TYPE_BY_KIND[kind] ?? null
}
