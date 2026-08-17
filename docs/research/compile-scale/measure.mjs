// Compile-scale measurement harness.
//
// Generates a synthetic workspace at a stated size, then measures the three
// costs a per-commit consumer pays today: whole-workspace compile, canonical
// serialization, and the revision digest over that serialization.
//
// Usage:
//   pnpm build && node docs/research/compile-scale/measure.mjs [sizes...]
//
// Corpus shape: one document per subject, each document declaring one concept
// and three relationships that point at other documents' concepts, so that
// cross-document reference resolution is exercised at every size.

import { createHash } from 'node:crypto'
import {
  compileWorkspaceWithProfileContext,
  serializeSemanticGraph,
} from '../../../dist/index.js'

const DESCRIPTION =
  'Synthetic subject used to measure compile cost at scale; the description ' +
  'carries enough text that claim values are realistic rather than empty.'

export function generateWorkspace(documentCount) {
  const sources = []
  for (let index = 0; index < documentCount; index += 1) {
    const id = `syn-${index}`
    const relationships = [1, 2, 3]
      .map((step) => {
        const target = `syn-${(index + step * 7 + 1) % documentCount}`
        return [
          `  - id: rel-${step}`,
          '    kind: association',
          '    from: component',
          `    to: ${target}#component`,
          `    description: ${DESCRIPTION}`,
        ].join('\n')
      })
      .join('\n')
    sources.push({
      path: `architecture/${id}.yaml`,
      source: [
        'format: yarramate/v1',
        `id: ${id}`,
        'profile: yarramate/core@0.1',
        'concepts:',
        '  - id: component',
        '    kind: applicationComponent',
        `    name: Synthetic component ${index}`,
        `    description: ${DESCRIPTION}`,
        'relationships:',
        relationships,
        '',
      ].join('\n'),
    })
  }
  return sources
}

const time = (label, work) => {
  const started = process.hrtime.bigint()
  const value = work()
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  return { label, elapsedMs, value }
}

const measure = (documentCount) => {
  const sources = generateWorkspace(documentCount)
  const compile = time('compile', () =>
    compileWorkspaceWithProfileContext(sources),
  )
  if (!compile.value.ok) {
    throw new Error(
      `corpus invalid at ${documentCount}: ${JSON.stringify(
        compile.value.diagnostics.slice(0, 3),
        null,
        2,
      )}`,
    )
  }
  const graph = compile.value.graph
  const heapAfterCompile = process.memoryUsage().heapUsed
  const serialize = time('serialize', () => serializeSemanticGraph(graph))
  const digest = time('digest', () =>
    createHash('sha256').update(serialize.value).digest('hex'),
  )
  const heapAfterSerialize = process.memoryUsage().heapUsed
  return {
    documents: documentCount,
    subjects: graph.subjects.length,
    claims: graph.claims.length,
    compileMs: Number(compile.elapsedMs.toFixed(1)),
    perDocumentUs: Number(((compile.elapsedMs * 1000) / documentCount).toFixed(1)),
    serializeMs: Number(serialize.elapsedMs.toFixed(1)),
    serializedBytes: serialize.value.length,
    digestMs: Number(digest.elapsedMs.toFixed(1)),
    commitMs: Number(
      (compile.elapsedMs + serialize.elapsedMs + digest.elapsedMs).toFixed(1),
    ),
    heapAfterCompileMb: Number((heapAfterCompile / 1024 / 1024).toFixed(0)),
    heapAfterSerializeMb: Number((heapAfterSerialize / 1024 / 1024).toFixed(0)),
    peakRssMb: Number((process.memoryUsage.rss() / 1024 / 1024).toFixed(0)),
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const sizes = process.argv.slice(2).length
    ? process.argv.slice(2).map(Number)
    : [1000, 5000, 10000, 20000, 40000]

  const rows = []
  for (const size of sizes) {
    const row = measure(size)
    rows.push(row)
    console.log(JSON.stringify(row))
    globalThis.gc?.()
  }

  console.log('')
  console.log(
    '| documents | subjects | claims | compile ms | µs/doc | serialize ms | serialized MB | digest ms | commit ms | heap after compile MB | peak RSS MB |',
  )
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const row of rows) {
    console.log(
      `| ${row.documents.toLocaleString()} | ${row.subjects.toLocaleString()} | ${row.claims.toLocaleString()} | ${row.compileMs} | ${row.perDocumentUs} | ${row.serializeMs} | ${(row.serializedBytes / 1024 / 1024).toFixed(1)} | ${row.digestMs} | ${row.commitMs} | ${row.heapAfterCompileMb} | ${row.peakRssMb} |`,
    )
  }
}
