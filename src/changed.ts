import { spawnSync } from 'node:child_process'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml'

// Review slices derive from git (ADR 0065): a subject is "changed" over a
// ref range when any changed line of its document intersects the lines its
// declaration occupies today. Git stays authoritative for what changed;
// the engine only maps lines back to semantic identities.

export interface ChangedSubjects {
  readonly range: string
  readonly concepts: readonly string[]
  readonly relationships: readonly string[]
}

export type ChangedResult =
  | { readonly ok: true; readonly changed: ChangedSubjects }
  | { readonly ok: false; readonly message: string }

interface ItemSpan {
  readonly id: string
  readonly collection: 'concepts' | 'relationships' | 'states'
  readonly startLine: number
  readonly endLine: number
}

const lineOfOffset = (lineStarts: readonly number[], offset: number): number => {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

const itemSpans = (source: string): readonly ItemSpan[] => {
  const lineStarts: number[] = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }
  const document = parseDocument(source)
  const root = document.contents
  if (!isMap(root)) return []
  const spans: ItemSpan[] = []
  for (const collection of ['concepts', 'relationships', 'states'] as const) {
    const pair = root.items.find(
      (candidate) =>
        isScalar(candidate.key) && candidate.key.value === collection,
    )
    if (pair === undefined || !isSeq(pair.value)) continue
    for (const item of pair.value.items) {
      if (!isMap(item)) continue
      const idPair = (item as YAMLMap).items.find(
        (field) => isScalar(field.key) && field.key.value === 'id',
      )
      if (
        idPair === undefined ||
        !isScalar(idPair.value) ||
        typeof idPair.value.value !== 'string'
      ) {
        continue
      }
      const range = (item as { range?: readonly [number, number, number] })
        .range
      if (range === undefined) continue
      spans.push({
        id: idPair.value.value,
        collection,
        startLine: lineOfOffset(lineStarts, range[0]),
        // range[1] can extend past the trailing newline; anchor the end
        // on the last content character instead.
        endLine: lineOfOffset(lineStarts, Math.max(range[0], range[1] - 1)),
      })
    }
  }
  return spans
}

// New-side line ranges from `git diff --unified=0`. A pure deletion has a
// zero count; it still touches the position it collapsed onto.
const changedLineRanges = (
  diff: string,
): ReadonlyArray<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = []
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    ranges.push(
      count === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + count - 1],
    )
  }
  return ranges
}

export function deriveChangedSubjects(
  cwd: string,
  range: string,
  documents: ReadonlyArray<{
    readonly path: string
    readonly source: string
    readonly documentId: string
  }>,
): ChangedResult {
  const probe = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-dir'], {
    encoding: 'utf8',
  })
  if (probe.status !== 0) {
    return {
      ok: false,
      message:
        '--changed requires the workspace to live in a git repository',
    }
  }
  const concepts = new Set<string>()
  const relationships = new Set<string>()
  for (const document of documents) {
    const diffed = spawnSync(
      'git',
      ['-C', cwd, 'diff', '--unified=0', range, '--', document.path],
      { encoding: 'utf8' },
    )
    if (diffed.status !== 0) {
      return {
        ok: false,
        message: `git diff failed for range "${range}": ${(diffed.stderr ?? '').trim()}`,
      }
    }
    const ranges = changedLineRanges(diffed.stdout ?? '')
    if (ranges.length === 0) continue
    const spans = itemSpans(document.source)
    for (const span of spans) {
      if (span.collection === 'states') continue
      const touched = ranges.some(
        ([from, to]) => from <= span.endLine && to >= span.startLine,
      )
      if (!touched) continue
      const qualified = `${document.documentId}#${span.id}`
      if (span.collection === 'concepts') concepts.add(qualified)
      else relationships.add(qualified)
    }
  }
  return {
    ok: true,
    changed: {
      range,
      concepts: [...concepts].sort(),
      relationships: [...relationships].sort(),
    },
  }
}
