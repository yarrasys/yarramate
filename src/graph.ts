import type { GraphClaim, SemanticGraph } from './compiler.js'

const compareText = (left: string, right: string) =>
  left.localeCompare(right)

const canonicalClaim = (claim: GraphClaim): GraphClaim => ({
  id: claim.id,
  subject: claim.subject,
  predicate: claim.predicate,
  object:
    'ref' in claim.object
      ? { ref: claim.object.ref }
      : { value: claim.object.value },
  origin: claim.origin,
  source: {
    document: claim.source.document,
    path: claim.source.path,
    pointer: claim.source.pointer,
    line: claim.source.line,
    column: claim.source.column,
  },
})

export function serializeSemanticGraph(graph: SemanticGraph): string {
  const canonical: SemanticGraph = {
    format: 'yarramate/graph/v2',
    profiles: [...graph.profiles].sort(compareText),
    documents: [...graph.documents]
      .sort(
        (left, right) =>
          compareText(left.id, right.id) ||
          compareText(left.source, right.source),
      )
      .map(({ id, source }) => ({ id, source })),
    subjects: [...graph.subjects]
      .sort(
        (left, right) =>
          compareText(left.id, right.id) ||
          compareText(left.type, right.type),
      )
      .map(({ id, type }) => ({ id, type })),
    claims: [...graph.claims]
      .sort(
        (left, right) =>
          compareText(left.id, right.id) ||
          compareText(left.subject, right.subject) ||
          compareText(left.predicate, right.predicate),
      )
      .map(canonicalClaim),
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
}
