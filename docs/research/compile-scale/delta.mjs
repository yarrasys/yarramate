// Delta-compile measurement harness.
//
// Measures what a per-commit consumer actually pays with the incremental entry
// point: the same target workspace compiled from scratch, versus compiled with
// the parse cache the previous commit returned.
//
// Usage:
//   pnpm build && node --expose-gc docs/research/compile-scale/delta.mjs [sizes...]
//
// Commit shape: the consumer's real one - append `APPENDED` documents to a
// workspace of the stated size. The prefix is byte-identical across the two
// states, so every unchanged source is a cache hit and only the appended tail
// is parsed.
//
// Both timed paths run with the same heap resident - the cache and nothing
// else - and each timed result is released and collected before the next path
// runs. Timing a compile while an earlier graph is still reachable charges it
// a collection cost the other path does not pay, which is worth about 2x at
// 40,000 documents. Run one size per process to keep sizes independent too.

import {
  compileWorkspaceIncremental,
  compileWorkspaceWithProfileContext,
  serializeSemanticGraph,
} from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const APPENDED = 40

// The value is dropped before returning, so one timed path's result is
// collectible before the next is timed.
const timeReleasing = (work) => {
  const started = process.hrtime.bigint()
  work()
  return Number(process.hrtime.bigint() - started) / 1e6
}

const serialize = (result) =>
  result.ok
    ? serializeSemanticGraph(result.graph)
    : JSON.stringify(result.diagnostics)

const measure = (documentCount) => {
  const after = generateWorkspace(documentCount + APPENDED, documentCount)
  const before = after.slice(0, documentCount)

  // A per-commit consumer holds the previous call's cache; the previous graph
  // is replaced on every commit. Release the seed result so the cache alone is
  // resident for both timings.
  let seed = compileWorkspaceIncremental(before)
  if (!seed.ok) throw new Error('corpus invalid')
  const cache = seed.cache
  seed = undefined
  globalThis.gc?.()

  // Correctness first and untimed: both paths must produce the same bytes at
  // every size, or the timings measure two different computations. A cache is
  // never mutated by the call it is passed to, so the timed call below reuses
  // exactly what this one did.
  {
    const probe = compileWorkspaceIncremental(after, cache)
    if (!probe.incremental) throw new Error('cache did not hit')
    if (serialize(probe) !== serialize(compileWorkspaceWithProfileContext(after))) {
      throw new Error('output diverged')
    }
  }
  globalThis.gc?.()

  const fullMs = timeReleasing(() => compileWorkspaceWithProfileContext(after))
  globalThis.gc?.()
  const deltaMs = timeReleasing(() => compileWorkspaceIncremental(after, cache))

  return {
    documents: documentCount,
    appended: APPENDED,
    fullMs: Number(fullMs.toFixed(1)),
    deltaMs: Number(deltaMs.toFixed(1)),
    deltaShare: Number((deltaMs / fullMs).toFixed(3)),
    // What a change-proportional compile would cost if cost tracked the change:
    // the full compile scaled by the changed fraction of the workspace.
    proportionalMs: Number(
      ((fullMs * APPENDED) / (documentCount + APPENDED)).toFixed(1),
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
