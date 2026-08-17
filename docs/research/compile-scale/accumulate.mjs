// Accumulated-cost measurement harness.
//
// The consumer's complaint is not one commit's cost: it is that cost
// accumulates quadratically, because commit r recompiles the whole workspace
// that r commits built. This harness replays that history - append APPENDED
// documents, compile, repeat - and sums what the consumer actually pays: once
// with today's whole-workspace entry point, once carrying the incremental cache
// forward from each commit to the next.
//
// Usage:
//   pnpm build && node --max-old-space-size=8192 \
//     docs/research/compile-scale/accumulate.mjs <full|delta> [commits]
//
// Corpus shape: measure.mjs's generator with the target modulus pinned to one
// commit's worth of documents, so every prefix the history passes through is a
// valid workspace and every appended document resolves against documents that
// already existed. Relationship targets therefore concentrate on the first
// commit's concepts. Both modes resolve identical references, so the ratio
// between them is unaffected, and the delta cost at the final commit is
// directly comparable against delta.mjs at the same size - which spreads
// targets across the whole workspace instead, and is the control for whether
// the hub shape matters.
//
// The delta mode holds the growing cache for the whole run, so it carries more
// live memory, and more collection pressure, than the full mode - not less.
// One mode per process, so neither inherits the other's heap.

import {
  compileWorkspaceIncremental,
  compileWorkspaceWithProfileContext,
  serializeSemanticGraph,
} from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const APPENDED = 40

const serialize = (result) =>
  result.ok
    ? serializeSemanticGraph(result.graph)
    : JSON.stringify(result.diagnostics)

const run = (mode, commits) => {
  const documents = generateWorkspace(commits * APPENDED, APPENDED)
  const checkpointEvery = Math.max(1, Math.round(commits / 10))
  const rows = []
  let cumulativeMs = 0
  let cache
  let final
  for (let commit = 1; commit <= commits; commit += 1) {
    const workspace = documents.slice(0, commit * APPENDED)
    const started = process.hrtime.bigint()
    const result =
      mode === 'delta'
        ? compileWorkspaceIncremental(workspace, cache)
        : compileWorkspaceWithProfileContext(workspace)
    const commitMs = Number(process.hrtime.bigint() - started) / 1e6
    if (!result.ok) throw new Error(`commit ${commit} produced an invalid corpus`)
    cumulativeMs += commitMs
    if (mode === 'delta') {
      // Commit 1 has nothing to reuse; every later commit must hit, or the run
      // is measuring repeated full compiles under another name.
      if (commit > 1 && !result.incremental) {
        throw new Error(`commit ${commit} missed the cache`)
      }
      cache = result.cache
    }
    // Only the last result is held past its own commit; a consumer replaces the
    // compiled model on every write.
    final = commit === commits ? result : undefined
    if (commit % checkpointEvery === 0 || commit === commits) {
      rows.push({
        commit,
        documents: workspace.length,
        commitMs: Number(commitMs.toFixed(1)),
        cumulativeMs: Number(cumulativeMs.toFixed(0)),
        // Constant across checkpoints iff accumulation is quadratic in commits.
        msPerCommitSquared: Number((cumulativeMs / commit ** 2).toFixed(3)),
        // What the delta mode must hold to stay warm: the cache is live for the
        // whole history. Sampled at this checkpoint, so it is what the run holds
        // here, not the run's high-water mark.
        rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(0)),
      })
    }
  }
  // Untimed, and the point of the whole run: a cache carried across every
  // commit of a real history must still produce exactly what a cold compile of
  // the final workspace produces.
  const cold = compileWorkspaceWithProfileContext(documents)
  return {
    mode,
    commits,
    appended: APPENDED,
    identicalToColdCompile: serialize(final) === serialize(cold),
    rows,
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const mode = process.argv[2] ?? 'delta'
  if (mode !== 'full' && mode !== 'delta') throw new Error('mode: full | delta')
  const commits = Number(process.argv[3] ?? 250)
  const result = run(mode, commits)
  console.log(
    JSON.stringify({
      mode: result.mode,
      commits: result.commits,
      appended: result.appended,
      identicalToColdCompile: result.identicalToColdCompile,
    }),
  )
  console.log('')
  console.log(
    '| commit | documents | this commit ms | cumulative ms | ms/commit^2 | RSS MB at checkpoint |',
  )
  console.log('|---:|---:|---:|---:|---:|---:|')
  for (const row of result.rows) {
    console.log(
      `| ${row.commit} | ${row.documents.toLocaleString()} | ${row.commitMs} | ${row.cumulativeMs.toLocaleString()} | ${row.msPerCommitSquared} | ${row.rssMb} |`,
    )
  }
}
