// Delta-compile measurement harness.
//
// Measures what a per-commit consumer actually pays with the incremental entry
// point: the same target workspace compiled from scratch, versus compiled with
// the parse cache the previous commit returned.
//
// Usage:
//   pnpm build && node docs/research/compile-scale/delta.mjs [sizes...]
//
// Commit shape: the consumer's real one - append `APPENDED` documents to a
// workspace of the stated size. The prefix is byte-identical across the two
// states, so every unchanged source is a cache hit and only the appended tail
// is parsed. Each state is compiled in a fresh process by the caller loop, so
// no measurement inherits another's heap.

import {
  compileWorkspaceIncremental,
  compileWorkspaceWithProfileContext,
  serializeSemanticGraph,
} from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const APPENDED = 40

const time = (work) => {
  const started = process.hrtime.bigint()
  const value = work()
  return { elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, value }
}

// Both paths must produce the same bytes at every size, or the timing below is
// measuring two different computations.
const identical = (left, right) =>
  left.ok && right.ok
    ? serializeSemanticGraph(left.graph) === serializeSemanticGraph(right.graph)
    : left.ok === right.ok

const measure = (documentCount) => {
  const after = generateWorkspace(documentCount + APPENDED, documentCount)
  const before = after.slice(0, documentCount)

  const seed = compileWorkspaceIncremental(before)
  if (!seed.ok) throw new Error('corpus invalid')

  const full = time(() => compileWorkspaceWithProfileContext(after))
  const delta = time(() => compileWorkspaceIncremental(after, seed.cache))
  if (!delta.value.incremental) throw new Error('cache did not hit')
  if (!identical(full.value, delta.value)) throw new Error('output diverged')

  return {
    documents: documentCount,
    appended: APPENDED,
    fullMs: Number(full.elapsedMs.toFixed(1)),
    deltaMs: Number(delta.elapsedMs.toFixed(1)),
    deltaShare: Number((delta.elapsedMs / full.elapsedMs).toFixed(3)),
    // What a change-proportional compile would cost if cost tracked the change:
    // the full compile scaled by the changed fraction of the workspace.
    proportionalMs: Number(
      ((full.elapsedMs * APPENDED) / (documentCount + APPENDED)).toFixed(1),
    ),
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const sizes = process.argv.slice(2).length
    ? process.argv.slice(2).map(Number)
    : [1000, 5000, 10000, 20000, 40000]
  const rows = sizes.map(measure)
  for (const row of rows) console.log(JSON.stringify(row))
  console.log('')
  console.log(
    '| documents | appended | full ms | delta ms | delta share | proportional ms |',
  )
  console.log(
    '|---:|---:|---:|---:|---:|---:|',
  )
  for (const row of rows) {
    console.log(
      `| ${row.documents.toLocaleString()} | ${row.appended} | ${row.fullMs} | ${row.deltaMs} | ${row.deltaShare} | ${row.proportionalMs} |`,
    )
  }
}
