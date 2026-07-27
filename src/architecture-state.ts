import type { SemanticGraph } from './compiler.js'

export interface StateComparison {
  readonly format: 'yarramate/state-comparison/v1'
  readonly from: string
  readonly to: string
  readonly added: SemanticGraph['subjects']
  readonly removed: SemanticGraph['subjects']
  readonly retained: SemanticGraph['subjects']
}

export interface StateComparisonIssue {
  readonly code: 'YMS101'
  readonly message: string
  readonly state: string
}

export type StateComparisonResult =
  | { readonly ok: true; readonly comparison: StateComparison }
  | {
      readonly ok: false
      readonly issues: readonly StateComparisonIssue[]
    }

const references = (
  graph: SemanticGraph,
  subject: string,
  predicate: string,
) =>
  graph.claims.flatMap((claim) =>
    claim.subject === subject &&
    claim.predicate === predicate &&
    'ref' in claim.object
      ? [claim.object.ref]
      : [],
  )

export function compareArchitectureStates(
  graph: SemanticGraph,
  from: string,
  to: string,
): StateComparisonResult {
  const architectureStates = new Set(
    graph.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  const issues = [...new Set([from, to])]
    .filter((state) => !architectureStates.has(state))
    .map((state) => ({
      code: 'YMS101' as const,
      message: `Architecture state "${state}" does not exist`,
      state,
    }))
  if (issues.length > 0) return { ok: false, issues }

  const subjectsIn = (state: string) => {
    const concepts = new Set(
      graph.subjects
        .filter(
          ({ id, type }) =>
            type === 'concept' && !architectureStates.has(id),
        )
        .filter(({ id }) => {
          const presence = references(
            graph,
            id,
            'yarramate/state/present-in',
          )
          return presence.length === 0 || presence.includes(state)
        })
        .map(({ id }) => id),
    )
    const relationships = graph.subjects
      .filter(({ type }) => type === 'relationship')
      .filter(({ id }) => {
        const structural = graph.claims.find(
          (claim) => claim.id === id && 'ref' in claim.object,
        )
        if (structural === undefined || !('ref' in structural.object)) {
          return false
        }
        const presence = references(
          graph,
          id,
          'yarramate/state/present-in',
        )
        return (
          (presence.length === 0 || presence.includes(state)) &&
          concepts.has(structural.subject) &&
          concepts.has(structural.object.ref)
        )
      })
      .map(({ id }) => id)
    return new Set([...concepts, ...relationships])
  }
  const fromSubjects = subjectsIn(from)
  const toSubjects = subjectsIn(to)
  const classify = (
    predicate: (inFrom: boolean, inTo: boolean) => boolean,
  ) =>
    [...graph.subjects]
      .sort(
        (left, right) =>
          left.id.localeCompare(right.id) ||
          left.type.localeCompare(right.type),
      )
      .filter(({ id }) => {
        if (architectureStates.has(id)) return false
        return predicate(fromSubjects.has(id), toSubjects.has(id))
      })

  return {
    ok: true,
    comparison: {
      format: 'yarramate/state-comparison/v1',
      from,
      to,
      added: classify((inFrom, inTo) => !inFrom && inTo),
      removed: classify((inFrom, inTo) => inFrom && !inTo),
      retained: classify((inFrom, inTo) => inFrom && inTo),
    },
  }
}
