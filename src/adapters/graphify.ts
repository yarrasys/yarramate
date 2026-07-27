import type {
  AdapterMapping,
  AdapterSubjectMapping,
} from '../adapter-mapping.js'
import type { EvidenceDocument, EvidenceObservation } from '../evidence.js'

export interface GraphifyGraph {
  readonly nodes: readonly {
    readonly id: string
  }[]
}

export interface GraphifyObservationIssue {
  readonly code: 'YMG101' | 'YMG102'
  readonly message: string
  readonly mapping?: AdapterSubjectMapping
}

export type GraphifyObservationResult =
  | { readonly ok: true; readonly evidence: EvidenceDocument }
  | { readonly ok: false; readonly issues: readonly GraphifyObservationIssue[] }

export function observeGraphify(
  graph: GraphifyGraph,
  mapping: AdapterMapping,
  identity: { readonly id: string; readonly version: string },
): GraphifyObservationResult {
  if (mapping.adapter !== 'graphify') {
    return {
      ok: false,
      issues: [{
        code: 'YMG101',
        message: `Adapter mapping "${mapping.id}@${mapping.version}" belongs to "${mapping.adapter}", not "graphify"`,
      }],
    }
  }
  const relationshipMappings = mapping.mappings.filter(
    ({ type }) => type === 'relationship',
  )
  if (relationshipMappings.length > 0) {
    return {
      ok: false,
      issues: relationshipMappings.map((entry) => ({
        code: 'YMG102',
        message: `Graphify node evidence cannot evaluate relationship subject "${entry.native}"`,
        mapping: entry,
      })),
    }
  }
  const nodeIds = new Set(graph.nodes.map(({ id }) => id))
  const observations: EvidenceObservation[] = mapping.mappings.map(
    (entry) =>
      nodeIds.has(entry.external)
        ? {
            subject: entry.native,
            result: 'confirmed',
            evidence: { uri: `graphify:${entry.external}` },
          }
        : {
            subject: entry.native,
            result: 'not-observed',
            evidence: {
              uri: `graphify:${entry.external}`,
              message: `Graphify node "${entry.external}" was not observed`,
            },
          },
  )
  return {
    ok: true,
    evidence: {
      format: 'yarramate/evidence/v1',
      id: identity.id,
      version: identity.version,
      provider: 'graphify',
      observations,
    },
  }
}
