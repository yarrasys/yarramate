import {
  type GraphClaim,
  type ResolvedProfileContext,
  type SemanticGraph,
} from './compiler.js'
import {
  type EvidenceObservation,
  type EvidenceReport,
} from './evidence.js'
import { type ProjectionResult } from './projection.js'

interface EvidenceCoverage {
  readonly observations: number
  readonly confirmed: number
  readonly contradicted: number
  readonly unknown: number
  readonly notObserved: number
}

export interface NextSubject {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly dependsOn: readonly string[]
  readonly requiredBy: readonly string[]
  readonly evidence: EvidenceCoverage
  readonly cycle?: true
}

// Which endpoint of a declared relationship must exist before the other,
// read off each core kind's declared intent (ADR 0048). Kinds without a
// build-order reading (association, assignment, influence) contribute no
// ordering edge rather than a guessed one.
const corePrerequisiteEndpoints: ReadonlyMap<string, 'source' | 'target'> =
  new Map([
    ['realization', 'source'],
    ['serving', 'source'],
    ['triggering', 'source'],
    ['flow', 'source'],
    ['composition', 'target'],
    ['aggregation', 'target'],
    ['access', 'target'],
    ['specialization', 'target'],
  ])

const prerequisiteEndpoint = (
  kind: string,
  profileContext: ResolvedProfileContext | undefined,
): 'source' | 'target' | undefined => {
  const candidates = [
    kind,
    ...(profileContext?.relationshipKindLineages.get(kind) ?? []),
  ]
  for (const candidate of candidates) {
    const separator = candidate.indexOf('#')
    if (separator === -1 || !candidate.startsWith('yarramate/core@')) {
      continue
    }
    const orientation = corePrerequisiteEndpoints.get(
      candidate.slice(separator + 1),
    )
    if (orientation !== undefined) return orientation
  }
  return undefined
}

const claimValue = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object ? object.value : undefined
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

export const coverageClause = (coverage: EvidenceCoverage): string => {
  if (coverage.observations === 0) return 'no evidence'
  const parts = [
    ...(coverage.confirmed > 0 ? [`${coverage.confirmed} confirmed`] : []),
    ...(coverage.contradicted > 0
      ? [`${coverage.contradicted} contradicted`]
      : []),
    ...(coverage.unknown > 0 ? [`${coverage.unknown} unknown`] : []),
    ...(coverage.notObserved > 0
      ? [`${coverage.notObserved} not observed`]
      : []),
  ]
  return `${plural(coverage.observations, 'observation')} (${parts.join(', ')})`
}

// The build-ordering core, shared by `next` and `ask`: planned subjects in
// deterministic Kahn order with dependency links and evidence coverage.
export function buildNextSubjects(
  result: ProjectionResult,
  graph: SemanticGraph,
  profileContext: ResolvedProfileContext | undefined,
  reports: readonly EvidenceReport[],
): readonly NextSubject[] {
  const planned = result.subjects
    .filter(
      ({ id, type }) =>
        type === 'concept' &&
        claimValue(result.claims, id, 'yarramate/lifecycle/status') ===
          'planned',
    )
    .map(({ id }) => id)
  const plannedIds = new Set(planned)

  const dependsOn = new Map<string, Set<string>>()
  const requiredBy = new Map<string, Set<string>>()
  for (const subject of result.subjects) {
    if (subject.type !== 'relationship') continue
    const claim = result.claims.find(
      ({ id, object }) => id === subject.id && 'ref' in object,
    )
    if (claim === undefined || !('ref' in claim.object)) continue
    const orientation = prerequisiteEndpoint(claim.predicate, profileContext)
    if (orientation === undefined) continue
    const prerequisite =
      orientation === 'source' ? claim.subject : claim.object.ref
    const dependent =
      orientation === 'source' ? claim.object.ref : claim.subject
    if (
      prerequisite === dependent ||
      !plannedIds.has(prerequisite) ||
      !plannedIds.has(dependent)
    ) {
      continue
    }
    dependsOn.set(
      dependent,
      (dependsOn.get(dependent) ?? new Set()).add(prerequisite),
    )
    requiredBy.set(
      prerequisite,
      (requiredBy.get(prerequisite) ?? new Set()).add(dependent),
    )
  }

  // Deterministic Kahn ordering: everything whose prerequisites are
  // already emitted goes next, lexicographic within a round; a cycle
  // cannot be ordered, so its members are appended sorted and marked.
  const ordered: string[] = []
  const cycles = new Set<string>()
  const emitted = new Set<string>()
  const remaining = new Set([...planned].sort())
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) =>
        [...(dependsOn.get(id) ?? [])].every((dependency) =>
          emitted.has(dependency),
        ),
      )
      .sort()
    if (ready.length === 0) {
      for (const id of [...remaining].sort()) {
        ordered.push(id)
        cycles.add(id)
      }
      break
    }
    for (const id of ready) {
      ordered.push(id)
      emitted.add(id)
      remaining.delete(id)
    }
  }

  const relationshipIds = new Set(
    graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  const relationshipEndpoints = new Map<string, readonly string[]>()
  const claimOwners = new Map<string, string>()
  for (const claim of graph.claims) {
    claimOwners.set(claim.id, claim.subject)
    if (relationshipIds.has(claim.id) && 'ref' in claim.object) {
      relationshipEndpoints.set(claim.id, [claim.subject, claim.object.ref])
    }
  }
  const coverageTargets = (
    observation: EvidenceObservation,
  ): readonly string[] => {
    const target =
      'subject' in observation ? observation.subject : observation.claim
    const endpoints = relationshipEndpoints.get(target)
    if (endpoints !== undefined) return endpoints
    if ('claim' in observation) {
      const owner = claimOwners.get(target)
      if (owner === undefined) return []
      return relationshipEndpoints.get(owner) ?? [owner]
    }
    return [target]
  }
  const coverage = new Map<
    string,
    {
      observations: number
      confirmed: number
      contradicted: number
      unknown: number
      notObserved: number
    }
  >()
  for (const id of planned) {
    coverage.set(id, {
      observations: 0,
      confirmed: 0,
      contradicted: 0,
      unknown: 0,
      notObserved: 0,
    })
  }
  for (const report of reports) {
    for (const observation of report.observations) {
      for (const target of coverageTargets(observation)) {
        const tally = coverage.get(target)
        if (tally === undefined) continue
        tally.observations += 1
        if (observation.result === 'not-observed') {
          tally.notObserved += 1
        } else {
          tally[observation.result] += 1
        }
      }
    }
  }

  return ordered.map((id) => {
    const name = claimValue(result.claims, id, 'yarramate/concept/name')
    return {
      id,
      kind:
        claimValue(result.claims, id, 'yarramate/concept/kind') ?? 'unknown',
      ...(name === undefined ? {} : { name }),
      dependsOn: [...(dependsOn.get(id) ?? [])].sort(),
      requiredBy: [...(requiredBy.get(id) ?? [])].sort(),
      evidence: coverage.get(id)!,
      ...(cycles.has(id) ? { cycle: true as const } : {}),
    }
  })
}

