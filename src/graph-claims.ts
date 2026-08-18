export const ATTESTATION_PREDICATE_PREFIX = 'yarramate/attestation/'

// An attestation claim packs the authority, the date it was given, and
// the recorder when a machine held the pen. A reference carries no
// spaces and the date is fixed width, so the three parse back out of one
// value unambiguously wherever a reader needs them.
export const attestationClaimValue = (attestation: {
  readonly by: string
  readonly on: string
  readonly recordedBy?: string
}): string =>
  attestation.recordedBy === undefined
    ? `${attestation.by} ${attestation.on}`
    : `${attestation.by} ${attestation.on} ${attestation.recordedBy}`

export interface AttestationClaimParts {
  readonly by: string
  readonly on: string
  readonly recordedBy?: string
}

export const parseAttestationClaimValue = (
  value: string,
): AttestationClaimParts | undefined => {
  const match = /^(\S+) ([0-9]{4}-[0-9]{2}-[0-9]{2})(?: (.+))?$/.exec(value)
  if (match === null) return undefined
  const recordedBy = match[3]
  return {
    by: match[1]!,
    on: match[2]!,
    ...(recordedBy === undefined ? {} : { recordedBy }),
  }
}

export interface ConstraintExpectsParts {
  readonly provider: string
  readonly key: string
  readonly value: string
}

// Mirrors the compiler's own write-side encoding (ADR 0075): provider and
// key admit no whitespace, so the first two spaces delimit them and
// everything after the second space is the expected value verbatim, spaces
// included. This is the sole authority for decoding the value written at
// the constraint's `expects` claim — reconciliation.ts delegates here
// rather than mirroring the regex itself.
export const parseConstraintExpectsValue = (
  value: string,
): ConstraintExpectsParts | undefined => {
  const match = /^(\S+) (\S+) ([\s\S]+)$/.exec(value)
  if (match === null) return undefined
  return {
    provider: match[1]!,
    key: match[2]!,
    value: match[3]!,
  }
}
