import {
  ATTESTATION_PREDICATE_PREFIX,
  type GraphClaim,
  type ResolvedProfileContext,
  type SemanticGraph,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
} from './compiler.js'
import { kindLabelOf } from './kind-label.js'
export interface CanvasNode {
  readonly id: string // qualified subject id, e.g. "yarramate-engine#compiler-module"
  readonly localId: string // authored id inside its document, e.g. "compiler-module"
  readonly document: string // manifest-relative path, from the subject's kind claim source
  readonly kind: string // resolved kind identity, e.g. "yarramate/core@0.1#applicationComponent"
  readonly kindLabel: string // local id stripped of profile prefix, e.g. "applicationComponent"
  readonly layer: string | null // from profileContext.conceptKindLayers, null if unresolved
  readonly aspect: string | null // from profileContext.conceptKindAspects, null if unresolved
  readonly name: string
  readonly description: string | null
  readonly aka: readonly string[]
  readonly status: string | null
  readonly owner: string | null // ref
  readonly distinctFrom: readonly string[] // refs
  readonly supersedes: readonly string[] // refs
  readonly constraints: ReadonlyArray<{
    readonly id: string
    readonly ref: string
    readonly expects: { readonly provider: string; readonly key: string; readonly value: string } | null
  }>
  readonly references: ReadonlyArray<{
    readonly id: string
    readonly ref: string
  }>
  readonly presentIn: readonly string[] // refs
  readonly attestations: ReadonlyArray<{
    readonly topic: string
    readonly by: string
    readonly on: string
    readonly recordedBy: string | null
  }>
}

export interface CanvasEdge {
  readonly id: string
  readonly localId: string // authored id inside its document
  readonly document: string // manifest-relative path, from the relationship's kind claim source
  readonly kind: string
  readonly kindLabel: string
  readonly coreKindLabel: string // resolved core-vocabulary kind, from profileContext.relationshipKindLineages[0]
  readonly from: string // node id
  readonly to: string // node id
  readonly name: string | null
  readonly description: string | null
  readonly mode: string | null
  readonly content: string | null
  readonly status: string | null
  readonly references: ReadonlyArray<{
    readonly id: string
    readonly ref: string
  }>
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

// The compiler qualifies every subject id as `<document id>#<authored id>`
// (`qualifyReference` in src/compiler.ts), and a document's authored ids never
// contain `#`. An operation addresses a subject by the id someone wrote in the
// file, not by the qualified identity the compile derived, so the projection
// carries both rather than leaving the browser to re-derive one from the other.
const authoredIdOf = (subjectId: string): string => {
  const boundary = subjectId.indexOf('#')
  return boundary === -1 ? subjectId : subjectId.slice(boundary + 1)
}

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
      let expects: { readonly provider: string; readonly key: string; readonly value: string } | null
      if (expectsClaim === undefined) {
        expects = null
      } else {
        const parsed = parseConstraintExpectsValue(claimValue(expectsClaim))
        if (parsed === undefined) {
          throw new Error(
            `Constraint expects claim "${expectsClaim.id}" on concept "${subjectId}" does not follow the "provider key value" encoding`,
          )
        }
        expects = parsed
      }
      return {
        id: localId,
        ref: claimRef(requiresClaim),
        expects,
      }
    })

  const attestations = claims
    .filter((claim) => claim.predicate.startsWith(ATTESTATION_PREDICATE_PREFIX))
    .map((claim) => {
      const parsed = parseAttestationClaimValue(claimValue(claim))
      if (parsed === undefined) {
        throw new Error(
          `Attestation claim "${claim.id}" on concept "${subjectId}" does not follow the "by on [recordedBy]" encoding`,
        )
      }
      return {
        topic: claim.predicate.slice(ATTESTATION_PREDICATE_PREFIX.length),
        by: parsed.by,
        on: parsed.on,
        recordedBy: parsed.recordedBy ?? null,
      }
    })

  return {
    id: subjectId,
    localId: authoredIdOf(subjectId),
    document: kindClaim.source.path,
    kind,
    kindLabel: kindLabelOf(kind),
    layer: profileContext.conceptKindLayers.get(kind) ?? null,
    aspect: profileContext.conceptKindAspects.get(kind) ?? null,
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
      .map((referencesClaim) => {
        const localId = referencesClaim.id.split('~reference-')[1]
        if (localId === undefined) {
          throw new Error(
            `Reference claim "${referencesClaim.id}" on concept "${subjectId}" does not follow the "<subject>~reference-<id>" id convention`,
          )
        }
        return {
          id: localId,
          ref: claimRef(referencesClaim),
        }
      })
      .sort((left, right) => left.ref.localeCompare(right.ref)),
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
  profileContext: ResolvedProfileContext,
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
    localId: authoredIdOf(relationshipId),
    document: definingClaim.source.path,
    kind,
    kindLabel: kindLabelOf(kind),
    coreKindLabel: kindLabelOf(profileContext.relationshipKindLineages.get(kind)?.[0] ?? kind),
    from: definingClaim.subject,
    to: claimRef(definingClaim),
    name: nameClaim === undefined ? null : claimValue(nameClaim),
    description: descriptionClaim === undefined ? null : claimValue(descriptionClaim),
    mode: modeClaim === undefined ? null : claimValue(modeClaim),
    content: contentClaim === undefined ? null : claimValue(contentClaim),
    status: statusClaim === undefined ? null : claimValue(statusClaim),
    references: ownClaims
      .filter((claim) => claim.predicate === REFERENCE_REFERS_TO_PREDICATE)
      .map((referencesClaim) => {
        const localId = referencesClaim.id.split('~reference-')[1]
        if (localId === undefined) {
          throw new Error(
            `Reference claim "${referencesClaim.id}" on relationship "${relationshipId}" does not follow the "<subject>~reference-<id>" id convention`,
          )
        }
        return {
          id: localId,
          ref: claimRef(referencesClaim),
        }
      })
      .sort((left, right) => left.ref.localeCompare(right.ref)),
    presentIn: ownClaims
      .filter((claim) => claim.predicate === STATE_PRESENT_IN_PREDICATE)
      .map(claimRef)
      .sort(),
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
      edges.push(projectRelationship(subject.id, graph.claims, ownClaims, profileContext))
    }
  }

  nodes.sort(compareById)
  edges.sort(compareById)

  return { nodes, edges }
}
