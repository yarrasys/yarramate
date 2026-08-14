import {
  ATTESTATION_PREDICATE_PREFIX,
  type GraphClaim,
  type ResolvedProfileContext,
  type SemanticGraph,
} from './compiler.js'

export interface CanvasNode {
  readonly id: string // subject id, e.g. "yarramate-engine#compiler-module"
  readonly kind: string // resolved kind identity, e.g. "yarramate/core@0.1#applicationComponent"
  readonly kindLabel: string // local id stripped of profile prefix, e.g. "applicationComponent"
  readonly layer: string | null // from profileContext.conceptKindLayers, null if unresolved
  readonly name: string
  readonly description: string | null
  readonly aka: readonly string[]
  readonly status: string | null
  readonly owner: string | null // ref
  readonly distinctFrom: readonly string[] // refs
  readonly supersedes: readonly string[] // refs
  readonly constraints: ReadonlyArray<{
    readonly ref: string
    readonly expects: string | null
  }>
  readonly references: readonly string[] // refs
  readonly presentIn: readonly string[] // refs
  readonly attestations: ReadonlyArray<{
    readonly topic: string
    readonly value: string
  }>
}

export interface CanvasEdge {
  readonly id: string
  readonly kind: string
  readonly kindLabel: string
  readonly from: string // node id
  readonly to: string // node id
  readonly name: string | null
  readonly description: string | null
  readonly mode: string | null
  readonly content: string | null
  readonly status: string | null
  readonly references: readonly string[]
  readonly presentIn: readonly string[]
}

export interface CanvasGraph {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

const CONCEPT_KIND_PREDICATE = 'yarramate/concept/kind'
const CONCEPT_NAME_PREDICATE = 'yarramate/concept/name'
const CONCEPT_DESCRIPTION_PREDICATE = 'yarramate/concept/description'
const CONCEPT_ALIAS_PREDICATE = 'yarramate/concept/alias'
const LIFECYCLE_STATUS_PREDICATE = 'yarramate/lifecycle/status'
const IDENTITY_DISTINCT_FROM_PREDICATE = 'yarramate/identity/distinct-from'
const LINEAGE_SUPERSEDES_PREDICATE = 'yarramate/lineage/supersedes'
const OWNERSHIP_OWNER_PREDICATE = 'yarramate/ownership/owner'
const CONSTRAINT_REQUIRES_PREDICATE = 'yarramate/constraint/requires'
const REFERENCE_REFERS_TO_PREDICATE = 'yarramate/reference/refers-to'
const STATE_PRESENT_IN_PREDICATE = 'yarramate/state/present-in'

const RELATIONSHIP_NAME_PREDICATE = 'yarramate/relationship/name'
const RELATIONSHIP_DESCRIPTION_PREDICATE = 'yarramate/relationship/description'
const ACCESS_MODE_PREDICATE = 'yarramate/access/mode'
const FLOW_CONTENT_PREDICATE = 'yarramate/flow/content'

// This is compiler-internal data: every claim's object narrows deterministically
// by predicate. A mismatch means a real bug upstream in src/compiler.ts, not
// malformed input this function should tolerate — so it throws rather than
// silently coercing to an empty string.
const claimValue = (claim: GraphClaim): string => {
  if ('value' in claim.object) {
    return claim.object.value
  }
  throw new Error(
    `Expected a value-typed object for claim "${claim.id}" (subject "${claim.subject}", predicate "${claim.predicate}"), got a ref-typed object`,
  )
}

const claimRef = (claim: GraphClaim): string => {
  if ('ref' in claim.object) {
    return claim.object.ref
  }
  throw new Error(
    `Expected a ref-typed object for claim "${claim.id}" (subject "${claim.subject}", predicate "${claim.predicate}"), got a value-typed object`,
  )
}

const kindLabelOf = (kind: string): string => kind.slice(kind.lastIndexOf('#') + 1)

const compareById = <T extends { readonly id: string }>(left: T, right: T) =>
  left.id.localeCompare(right.id)

const groupClaimsBySubject = (
  claims: readonly GraphClaim[],
): Map<string, GraphClaim[]> => {
  const groups = new Map<string, GraphClaim[]>()
  for (const claim of claims) {
    const group = groups.get(claim.subject)
    if (group === undefined) {
      groups.set(claim.subject, [claim])
    } else {
      group.push(claim)
    }
  }
  return groups
}

const projectConcept = (
  subjectId: string,
  claims: readonly GraphClaim[],
  profileContext: ResolvedProfileContext,
): CanvasNode => {
  const kindClaim = claims.find((claim) => claim.predicate === CONCEPT_KIND_PREDICATE)
  if (kindClaim === undefined) {
    throw new Error(
      `Concept "${subjectId}" is missing its required yarramate/concept/kind claim`,
    )
  }
  const kind = claimValue(kindClaim)

  const nameClaim = claims.find((claim) => claim.predicate === CONCEPT_NAME_PREDICATE)
  if (nameClaim === undefined) {
    throw new Error(
      `Concept "${subjectId}" is missing its required yarramate/concept/name claim`,
    )
  }

  const descriptionClaim = claims.find(
    (claim) => claim.predicate === CONCEPT_DESCRIPTION_PREDICATE,
  )
  const statusClaim = claims.find((claim) => claim.predicate === LIFECYCLE_STATUS_PREDICATE)
  const ownerClaim = claims.find((claim) => claim.predicate === OWNERSHIP_OWNER_PREDICATE)

  const constraints = claims
    .filter((claim) => claim.predicate === CONSTRAINT_REQUIRES_PREDICATE)
    .map((requiresClaim) => {
      // The constraint's local id lives between the `~constraint-` marker
      // and the end of the requires claim's own id; the paired expects
      // claim (if the constraint declared one) reuses that same local id
      // under a `~expects-` marker in the same claim group.
      const localId = requiresClaim.id.split('~constraint-')[1]
      if (localId === undefined) {
        throw new Error(
          `Constraint claim "${requiresClaim.id}" on concept "${subjectId}" does not follow the "<subject>~constraint-<id>" id convention`,
        )
      }
      const expectsClaim = claims.find(
        (claim) => claim.id === `${subjectId}~expects-${localId}`,
      )
      return {
        ref: claimRef(requiresClaim),
        expects: expectsClaim === undefined ? null : claimValue(expectsClaim),
      }
    })

  const attestations = claims
    .filter((claim) => claim.predicate.startsWith(ATTESTATION_PREDICATE_PREFIX))
    .map((claim) => ({
      topic: claim.predicate.slice(ATTESTATION_PREDICATE_PREFIX.length),
      value: claimValue(claim),
    }))

  return {
    id: subjectId,
    kind,
    kindLabel: kindLabelOf(kind),
    layer: profileContext.conceptKindLayers.get(kind) ?? null,
    name: claimValue(nameClaim),
    description: descriptionClaim === undefined ? null : claimValue(descriptionClaim),
    aka: claims
      .filter((claim) => claim.predicate === CONCEPT_ALIAS_PREDICATE)
      .map(claimValue)
      .sort(),
    status: statusClaim === undefined ? null : claimValue(statusClaim),
    owner: ownerClaim === undefined ? null : claimRef(ownerClaim),
    distinctFrom: claims
      .filter((claim) => claim.predicate === IDENTITY_DISTINCT_FROM_PREDICATE)
      .map(claimRef)
      .sort(),
    supersedes: claims
      .filter((claim) => claim.predicate === LINEAGE_SUPERSEDES_PREDICATE)
      .map(claimRef)
      .sort(),
    constraints,
    references: claims
      .filter((claim) => claim.predicate === REFERENCE_REFERS_TO_PREDICATE)
      .map(claimRef)
      .sort(),
    presentIn: claims
      .filter((claim) => claim.predicate === STATE_PRESENT_IN_PREDICATE)
      .map(claimRef)
      .sort(),
    attestations,
  }
}

const projectRelationship = (
  relationshipId: string,
  allClaims: readonly GraphClaim[],
  ownClaims: readonly GraphClaim[],
): CanvasEdge => {
  // A relationship's defining claim is asymmetric: its id is the
  // relationship's subject id, but its own `subject` field is the
  // from-concept, so it lives in the from-concept's claim group, not this
  // relationship's — it has to be found by scanning every claim.
  const definingClaim = allClaims.find((claim) => claim.id === relationshipId)
  if (definingClaim === undefined) {
    throw new Error(`Relationship "${relationshipId}" is missing its defining claim`)
  }
  const kind = definingClaim.predicate

  const nameClaim = ownClaims.find((claim) => claim.predicate === RELATIONSHIP_NAME_PREDICATE)
  const descriptionClaim = ownClaims.find(
    (claim) => claim.predicate === RELATIONSHIP_DESCRIPTION_PREDICATE,
  )
  const modeClaim = ownClaims.find((claim) => claim.predicate === ACCESS_MODE_PREDICATE)
  const contentClaim = ownClaims.find((claim) => claim.predicate === FLOW_CONTENT_PREDICATE)
  const statusClaim = ownClaims.find((claim) => claim.predicate === LIFECYCLE_STATUS_PREDICATE)

  return {
    id: relationshipId,
    kind,
    kindLabel: kindLabelOf(kind),
    from: definingClaim.subject,
    to: claimRef(definingClaim),
    name: nameClaim === undefined ? null : claimValue(nameClaim),
    description: descriptionClaim === undefined ? null : claimValue(descriptionClaim),
    mode: modeClaim === undefined ? null : claimValue(modeClaim),
    content: contentClaim === undefined ? null : claimValue(contentClaim),
    status: statusClaim === undefined ? null : claimValue(statusClaim),
    references: ownClaims
      .filter((claim) => claim.predicate === REFERENCE_REFERS_TO_PREDICATE)
      .map(claimRef),
    presentIn: ownClaims
      .filter((claim) => claim.predicate === STATE_PRESENT_IN_PREDICATE)
      .map(claimRef),
  }
}

export function projectGraphForCanvas(
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext,
): CanvasGraph {
  const claimsBySubject = groupClaimsBySubject(graph.claims)

  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []

  for (const subject of graph.subjects) {
    const ownClaims = claimsBySubject.get(subject.id) ?? []
    if (subject.type === 'concept') {
      nodes.push(projectConcept(subject.id, ownClaims, profileContext))
    } else {
      edges.push(projectRelationship(subject.id, graph.claims, ownClaims))
    }
  }

  nodes.sort(compareById)
  edges.sort(compareById)

  return { nodes, edges }
}
