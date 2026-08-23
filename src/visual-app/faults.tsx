import type React from 'react'
import type { CanvasGraph } from '../graph-projection.js'
import type { VisualDiagnostic } from '../adapters/visual/protocol-contract.js'

/**
 * What failed, and where to look for it.
 *
 * The rule this exists to keep: the summary never reads clean while anything
 * is open. A diagnostic whose subject is on the canvas can be marked there; one
 * that belongs to no subject - a parse failure, a manifest, a projection's own
 * definition - has nothing to mark, and reporting a failure with nothing on
 * screen changed is how a reviewer stops believing the tool. So the two are
 * counted separately and both are named.
 *
 * Absence of `subjects` is meaningful rather than missing: Core populates it
 * wherever a diagnostic's pointer identifies a subject, so an empty list means
 * this one belongs somewhere other than the canvas.
 */
export interface FaultSummary {
  readonly total: number
  /** Marked on the diagram, because their subject is drawn there. */
  readonly onCanvas: number
  /** Real, and not markable: they belong to no drawn subject. */
  readonly elsewhere: number
}

export const summarise = (
  diagnostics: readonly VisualDiagnostic[],
  graph: CanvasGraph,
): FaultSummary => {
  const drawn = new Set(graph.nodes.map((node) => node.id))
  for (const edge of graph.edges) drawn.add(edge.id)
  let onCanvas = 0
  for (const diagnostic of diagnostics) {
    if ((diagnostic.subjects ?? []).some((id) => drawn.has(id))) onCanvas += 1
  }
  return {
    total: diagnostics.length,
    onCanvas,
    // Anything not markable is counted here, including a diagnostic whose
    // subject exists in the model but is filtered out of this view: it is real,
    // and this view cannot show it, which the reviewer has to be told.
    elsewhere: diagnostics.length - onCanvas,
  }
}

/** The subject ids any diagnostic names, for the canvas to mark. */
export const faultedSubjects = (
  diagnostics: readonly VisualDiagnostic[],
): ReadonlySet<string> => {
  const ids = new Set<string>()
  for (const diagnostic of diagnostics) {
    for (const id of diagnostic.subjects ?? []) ids.add(id)
  }
  return ids
}

const Line = ({
  diagnostic,
}: {
  readonly diagnostic: VisualDiagnostic
}): React.ReactElement => (
  <li>
    <span className="code">{diagnostic.code}</span> {diagnostic.message}
    <span className="where">
      {diagnostic.path}:{diagnostic.line}
    </span>
  </li>
)

export const Faults = ({
  diagnostics,
  graph,
}: {
  readonly diagnostics: readonly VisualDiagnostic[]
  readonly graph: CanvasGraph
}): React.ReactElement | null => {
  if (diagnostics.length === 0) return null
  const drawn = new Set(graph.nodes.map((node) => node.id))
  for (const edge of graph.edges) drawn.add(edge.id)
  const marked = diagnostics.filter((diagnostic) =>
    (diagnostic.subjects ?? []).some((id) => drawn.has(id)),
  )
  const unmarked = diagnostics.filter(
    (diagnostic) => !(diagnostic.subjects ?? []).some((id) => drawn.has(id)),
  )
  const summary = summarise(diagnostics, graph)

  return (
    <div className="faults" role="alert">
      <p className="faults-title">
        The last change did not compile. The diagram still shows the model that
        did.
      </p>
      <p className="faults-summary">
        {summary.total} problem{summary.total === 1 ? '' : 's'}:{' '}
        {summary.onCanvas} marked on the diagram, {summary.elsewhere} not on it.
      </p>

      {marked.length === 0 ? null : (
        <>
          <p className="faults-lane">On the diagram</p>
          <ul>
            {marked.map((diagnostic) => (
              <Line
                key={`${diagnostic.code}-${diagnostic.path}-${diagnostic.pointer}`}
                diagnostic={diagnostic}
              />
            ))}
          </ul>
        </>
      )}

      {unmarked.length === 0 ? null : (
        <>
          <p className="faults-lane">
            Not on the diagram, so nothing above is marked for these
          </p>
          <ul>
            {unmarked.map((diagnostic) => (
              <Line
                key={`${diagnostic.code}-${diagnostic.path}-${diagnostic.pointer}`}
                diagnostic={diagnostic}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
