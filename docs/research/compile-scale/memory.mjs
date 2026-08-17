// Retained-vs-transient memory attribution for a compiled workspace.
//
// Usage:
//   pnpm build && node --expose-gc docs/research/compile-scale/memory.mjs [size]
//
// Reports, at one corpus size: peak heap after compile (parse scratch still
// reachable), heap with only the compiled result reachable (what an in-memory
// cache must hold), and the difference (transient scratch a delta path skips).
//
// Retained cost is measured against the pre-compile baseline, not against a
// post-release reading: dropping the last reference and collecting does not
// reliably shrink a multi-hundred-megabyte old space, so the release reading
// understates what is held.

import { compileWorkspaceWithProfileContext } from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const size = Number(process.argv[2] ?? 40000)
const mb = () => Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0))

const collect = () => {
  globalThis.gc?.()
  globalThis.gc?.()
}

collect()
const baseline = mb()

let sources = generateWorkspace(size)
collect()
const withSources = mb()

let result = compileWorkspaceWithProfileContext(sources)
if (!result.ok) throw new Error('corpus invalid')
const afterCompile = mb()

sources = undefined
collect()
const retainedWithGraph = mb()

const counts = {
  subjects: result.graph.subjects.length,
  claims: result.graph.claims.length,
}

console.log(
  JSON.stringify({
    documents: size,
    ...counts,
    baselineMb: baseline,
    sourcesMb: withSources - baseline,
    peakAfterCompileMb: afterCompile,
    retainedResultMb: retainedWithGraph - baseline,
    transientScratchMb: afterCompile - retainedWithGraph,
    bytesPerClaim: Math.round(
      ((retainedWithGraph - baseline) * 1024 * 1024) / counts.claims,
    ),
  }),
)
