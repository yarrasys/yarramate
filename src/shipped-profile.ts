/**
 * The optional profiles that ship inside the package (ADR 0095; 0.2 per
 * ADR 0159; 0.3 per ADR 0160). The compiler injects one when a document selects it or a
 * profile extends it, and a shipped profile's own parent follows it in, so
 * `extends: yarramate/policy@0.2` brings 0.1 along. A workspace file that
 * declares the same identity wins; the shipped copy is not added beside it.
 *
 * Versions are additive contracts: 0.2 extends 0.1 and adds the three
 * responsibility relationship kinds; 0.3 extends 0.2 and adds the risk and
 * assumption concept kinds. Every earlier identity keeps resolving and
 * every catalogue reference to it keeps matching.
 */
export interface ShippedProfile {
  readonly identity: string
  /** The identity it extends, which may itself be shipped. */
  readonly extends: string
  readonly source: string
}

export const shippedPolicyIdentity = 'yarramate/policy@0.1'

export const shippedPolicySource = `format: yarramate/profile/v1
id: yarramate/policy
version: "0.1"
extends: yarramate/core@0.1
conceptKinds:
  - id: authentication-constraint
    name: Authentication constraint
    parent: yarramate/core@0.1#constraint
  - id: rate-limit-constraint
    name: Rate-limit constraint
    parent: yarramate/core@0.1#constraint
  - id: reliability-constraint
    name: Reliability constraint
    parent: yarramate/core@0.1#constraint
  - id: mechanism-constraint
    name: Mechanism constraint
    parent: yarramate/core@0.1#constraint
relationshipKinds: []
`

export const shippedPolicy02Identity = 'yarramate/policy@0.2'
export const shippedPolicy02Source = `format: yarramate/profile/v1
id: yarramate/policy
version: "0.2"
extends: yarramate/policy@0.1
conceptKinds: []
relationshipKinds:
  - id: responsible
    name: Responsible
    parent: yarramate/core@0.1#association
    sourceAspects: [active-structure, motivation]
  - id: consulted
    name: Consulted
    parent: yarramate/core@0.1#association
    sourceAspects: [active-structure, motivation]
  - id: informed
    name: Informed
    parent: yarramate/core@0.1#association
    sourceAspects: [active-structure, motivation]
`

export const shippedPolicy03Identity = 'yarramate/policy@0.3'
export const shippedPolicy03Source = `format: yarramate/profile/v1
id: yarramate/policy
version: "0.3"
extends: yarramate/policy@0.2
conceptKinds:
  - id: risk
    name: Risk
    parent: yarramate/core@0.1#assessment
  - id: assumption
    name: Assumption
    parent: yarramate/core@0.1#assessment
relationshipKinds: []
`

export const SHIPPED_PROFILES: readonly ShippedProfile[] = [
  {
    identity: shippedPolicyIdentity,
    extends: 'yarramate/core@0.1',
    source: shippedPolicySource,
  },
  {
    identity: shippedPolicy02Identity,
    extends: shippedPolicyIdentity,
    source: shippedPolicy02Source,
  },
  {
    identity: shippedPolicy03Identity,
    extends: shippedPolicy02Identity,
    source: shippedPolicy03Source,
  },
]

export const shippedProfileOf = (identity: string): ShippedProfile | undefined =>
  SHIPPED_PROFILES.find((profile) => profile.identity === identity)
