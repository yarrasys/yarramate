import type { ProjectionQuery } from '../projection.js'

/**
 * A one-line gloss for a `ProjectionQuery`, for the reviewer to read back
 * before they decide whether to keep or discard it — not a restatement of
 * the wire shape, just the fields that actually narrowed something. Lives
 * in visual-app rather than `projection.ts`: this is chat-pill and
 * filter-panel display text, not a projection-evaluation concern.
 */
export function describeQuery(query: ProjectionQuery): string {
  // "Connected to X" / "between X and Y" reads better as the whole label
  // than as one more clause among the field-by-field ones below.
  if (
    (query.relationships === 'connected' || query.relationships === 'between') &&
    query.subjects !== undefined &&
    query.subjects.length > 0
  ) {
    const verb = query.relationships === 'connected' ? 'connected to' : 'between'
    return `${verb} ${query.subjects.join(', ')}`
  }

  const parts: string[] = []
  const list = (label: string, values: readonly string[] | undefined): void => {
    if (values !== undefined && values.length > 0) {
      parts.push(`${label}: ${values.join(', ')}`)
    }
  }

  list('subjects', query.subjects)
  list('documents', query.documents)
  list('layers', query.layers)
  list(
    query.kindMatching === 'descendants' ? 'kinds (and descendants)' : 'kinds',
    query.kinds,
  )
  list('statuses', query.statuses)
  list('excluding statuses', query.excludeStatuses)
  list('states', query.states)
  list('owners', query.owners)
  list('constraints', query.constraints)
  list('relationship kinds', query.relationshipKinds)

  if (query.isolatedConcepts === 'exclude') parts.push('connected concepts only')
  if (query.isolatedConcepts === 'include') parts.push('including isolated concepts')

  return parts.length > 0 ? parts.join(' · ') : 'all'
}
