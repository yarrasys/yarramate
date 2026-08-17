// Retained cost of holding a parse cache between commits.
//
// A per-commit consumer keeps the cache alive between calls, so the honest
// question is not peak heap during one compile but what stays held: the
// compiled result plus the cache the next call needs. Reported against the
// pre-compile baseline, because dropping a reference does not reliably shrink
// a multi-hundred-megabyte old space.
//
// Usage:
//   pnpm build && node --expose-gc docs/research/compile-scale/cache-memory.mjs [sizes...]

import { compileWorkspaceIncremental } from '../../../dist/index.js'
import { generateWorkspace } from './measure.mjs'

const mb = () =>
  Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0))

const collect = () => {
  globalThis.gc?.()
  globalThis.gc?.()
}

const sizes = process.argv.slice(2).map(Number)
const rows = []

for (const size of sizes) {
  collect()
  const baseline = mb()

  let sources = generateWorkspace(size)
  // A second commit, so the cache measured is one that has already been reused
  // rather than a first-call cache.
  let out = compileWorkspaceIncremental(sources)
  out = compileWorkspaceIncremental(sources, out.cache)
  if (!out.ok) throw new Error('corpus invalid')

  sources = undefined
  collect()
  const heldBoth = mb()

  const claims = out.graph.claims.length
  const cacheEntries = out.cache.sources.size
  let positions = 0
  for (const entry of out.cache.sources.values()) {
    positions += entry.positions.size
  }

  const graph = out.graph
  out = undefined
  collect()
  const heldGraphOnly = mb()

  rows.push({
    documents: size,
    claims,
    cacheEntries,
    positions,
    resultAndCacheMb: heldBoth - baseline,
    resultOnlyMb: heldGraphOnly - baseline,
    cacheMb: heldBoth - heldGraphOnly,
    subjects: graph.subjects.length,
  })
  console.log(JSON.stringify(rows.at(-1)))
}

console.log('')
console.log('| documents | claims | result+cache MB | result only MB | cache MB |')
console.log('|---:|---:|---:|---:|---:|')
for (const row of rows) {
  console.log(
    `| ${row.documents.toLocaleString()} | ${row.claims.toLocaleString()} | ${row.resultAndCacheMb} | ${row.resultOnlyMb} | ${row.cacheMb} |`,
  )
}
