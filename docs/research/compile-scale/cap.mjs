// Does one commit fit inside a Durable Object?
//
// Usage:
//   pnpm build && node --max-old-space-size=448 docs/research/compile-scale/cap.mjs <documents> <cold|warm>
//
// `cold` compiles the whole workspace with no cache, which is what a consumer
// pays on the first request after an eviction. `warm` compiles the previous
// commit first, then appends 40 documents and compiles again with the cache the
// previous call returned - the steady-state per-commit path. Exits non-zero on
// OOM, so the caller can bisect the largest surviving size.

import { compileWorkspaceIncremental } from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const documents = Number(process.argv[2])
const mode = process.argv[3] ?? 'warm'
const appended = 40

const report = (outcome) => {
  const usage = process.memoryUsage()
  console.log(
    JSON.stringify({
      documents,
      mode,
      outcome,
      peakRssMb: Number((usage.rss / 1024 / 1024).toFixed(0)),
      heapUsedMb: Number((usage.heapUsed / 1024 / 1024).toFixed(0)),
      heapTotalMb: Number((usage.heapTotal / 1024 / 1024).toFixed(0)),
    }),
  )
}

if (mode === 'cold') {
  const result = compileWorkspaceIncremental(generateWorkspace(documents))
  if (!result.ok) throw new Error('corpus invalid')
  report('compiled')
} else {
  const previous = compileWorkspaceIncremental(
    generateWorkspace(documents - appended),
  )
  if (!previous.ok) throw new Error('corpus invalid')
  const result = compileWorkspaceIncremental(
    generateWorkspace(documents),
    previous.cache,
  )
  if (!result.ok) throw new Error('corpus invalid')
  if (!result.incremental) throw new Error('cache did not hit')
  report('compiled')
}
