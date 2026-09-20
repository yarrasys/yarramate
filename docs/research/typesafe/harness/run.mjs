#!/usr/bin/env node
// Runner for the judgment experiment. See ../PROTOCOL.md and ../README.md.
//
//   node run.mjs plan  [--dataset self|halcyon|all] [--arm kind-fit|duplicates|drift|ask|all]
//   node run.mjs run   --arm <arm> [--dataset ...] [--repeat 3] [--probe] [--live]
//   node run.mjs score --arm <arm> [--dataset ...]
//
// `plan` builds every request and prints counts and the token estimate; it
// never calls the vendor. `run` without --live does the same and writes the
// planned requests to results/ for review. `run --live` needs TYPESAFE_API_KEY.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATASETS, loadWorkspace } from './datasets.mjs'
import { buildAsk, buildDrift, buildDuplicates, buildEvidenceCitations, buildKindFit, scoreAsk, scoreDrift, scoreDuplicates, scoreEvidenceCitations, scoreKindFit, stateWithRun } from './arms.mjs'
import { readFileSync as readFrozen } from 'node:fs'
import { createClient, estimateTokens } from './typesafe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const RESULTS = resolve(here, '../results')
const CACHE = resolve(here, '../cache')
const PRICE_PER_MTOK = 0.042 // vendor list price, input tokens; output is free

const args = process.argv.slice(2)
const command = args[0] ?? 'plan'
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)

const armNames = flag('arm', 'all') === 'all' ? ['kind-fit', 'kind-fit-defs', 'duplicates', 'drift', 'ask'] : [flag('arm')]

// Arm 5 reads its frozen item set rather than deriving one, so the sample
// cannot drift between the ablation's two halves or between repeats.
const frozenCitations = () =>
  JSON.parse(readFrozen(new URL('../datasets/evidence-citations.self.json', import.meta.url), 'utf8'))
const datasetNames = flag('dataset', 'all') === 'all' ? Object.keys(DATASETS) : [flag('dataset')]
const repeat = Number(flag('repeat', '1'))
const manifestOverride = flag('manifest', null)

mkdirSync(RESULTS, { recursive: true })
const client = createClient({ cacheDir: CACHE, live: has('live'), log: (m) => console.error(m) })

const readQueries = (name) => {
  const path = resolve(here, `../datasets/ask-queries.${name}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
}
const readLabels = (name) => {
  const path = resolve(RESULTS, `duplicates.${name}.labels.json`)
  if (!existsSync(path)) return new Map()
  return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8'))))
}

const build = (arm, ds, name) => {
  switch (arm) {
    case 'kind-fit': {
      const { items, skipped } = buildKindFit(ds)
      return { requests: items.flatMap((i) => [{ key: `blind:${i.edge}`, request: i.blind }, { key: `audit:${i.edge}`, request: i.audit }]), items, meta: { skipped } }
    }
    case 'kind-fit-defs': {
      const { items, skipped } = buildKindFit(ds)
      return { requests: items.map((i) => ({ key: `blind:${i.edge}`, request: i.defined })), items, meta: { skipped, variant: 'definitions' } }
    }
    case 'duplicates': {
      const { items, buckets, subjects } = buildDuplicates(ds)
      return { requests: items.map((i) => ({ key: i.pair, request: i.request })), items, meta: { buckets, subjects, currentRuleFlags: items.filter((i) => i.currentRule).length } }
    }
    case 'drift': {
      const { items } = buildDrift(ds, { probe: has('probe') })
      return { requests: items.map((i) => ({ key: i.subject, request: i.request })), items, meta: { probe: has('probe') } }
    }
    case 'ask': {
      const { items } = buildAsk(ds, readQueries(name))
      return { requests: items.map((i) => ({ key: i.index, request: i.request })), items, meta: { queries: items.length } }
    }
    case 'citations': {
      const { items, meta } = buildEvidenceCitations(frozenCitations(), { withContent: true })
      return { requests: items.map((i) => ({ key: i.id, request: i.request })), items, meta }
    }
    case 'citations-blind': {
      const { items, meta } = buildEvidenceCitations(frozenCitations(), { withContent: false })
      return { requests: items.map((i) => ({ key: i.id, request: i.request })), items, meta }
    }
    default:
      throw new Error(`unknown arm ${arm}`)
  }
}

const score = (arm, name, items, answers) => {
  switch (arm) {
    case 'kind-fit-defs':
    case 'kind-fit': {
      const blind = new Map(), audit = new Map()
      for (const [key, value] of answers) (key.startsWith('blind:') ? blind : audit).set(key.slice(key.indexOf(':') + 1), value)
      return scoreKindFit(items, { blind, audit })
    }
    case 'duplicates': return scoreDuplicates(items, answers, readLabels(name))
    case 'drift': return scoreDrift(items, answers)
    case 'ask': return scoreAsk(items, answers)
    case 'citations':
    case 'citations-blind': return scoreEvidenceCitations(items, answers)
    default: throw new Error(`unknown arm ${arm}`)
  }
}

let grandTokens = 0, grandRequests = 0
for (const name of datasetNames) {
  const manifest = manifestOverride ?? DATASETS[name]?.manifest
  if (manifest === undefined) throw new Error(`unknown dataset ${name}`)
  const ds = loadWorkspace(manifest)
  console.log(`\n== ${name}: ${ds.canvas.nodes.length} subjects, ${ds.canvas.edges.length} relationships`)
  for (const arm of armNames) {
    const { requests, items, meta } = build(arm, ds, name)
    const tokens = requests.reduce((sum, r) => sum + estimateTokens(r.request), 0) * repeat
    grandTokens += tokens
    grandRequests += requests.length * repeat
    console.log(`  ${arm.padEnd(11)} ${String(requests.length * repeat).padStart(5)} requests  ~${String(tokens).padStart(8)} tokens  ~$${(tokens / 1e6 * PRICE_PER_MTOK).toFixed(4)}  ${JSON.stringify(meta)}`)
    if (command === 'plan') continue
    if (command === 'labels') {
      if (arm !== 'duplicates') continue
      // The labelling sheet for arm 2 (PROTOCOL.md): every pair the shipped rule flags,
      // the 60 strongest lexical candidates it does not, and 60 drawn at random from the
      // rest with a fixed seed, so the sample is reproducible and not chosen by eye.
      const flagged = items.filter((i) => i.currentRule)
      const rest = items.filter((i) => !i.currentRule).sort((a, b) => b.lexical - a.lexical)
      const strong = rest.slice(0, 60)
      const pool = rest.slice(60)
      let seed = 20260920
      const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
      const random = [...pool].sort(() => rand() - 0.5).slice(0, 60)
      const nodes = new Map(ds.canvas.nodes.map((n) => [n.id, n]))
      const sheet = [...flagged, ...strong, ...random].map((i) => ({
        pair: i.pair, a: i.aName, aDescription: nodes.get(i.a)?.description ?? null,
        b: i.bName, bDescription: nodes.get(i.b)?.description ?? null,
        lexical: Number(i.lexical.toFixed(3)), currentRule: i.currentRule, label: null,
      }))
      const file = join(RESULTS, `duplicates.${name}.to-label.json`)
      writeFileSync(file, JSON.stringify(sheet, null, 2))
      console.log(`  labelling sheet: ${sheet.length} pairs (${flagged.length} flagged by the shipped rule, ${strong.length} strong, ${random.length} random) -> ${file}`)
      continue
    }

    const answersByRun = []
    for (let run = 0; run < repeat; run += 1) {
      const answers = new Map()
      const results = await Promise.all(requests.map(async ({ key, request }) => {
        const response = await client.call({ ...request, state: stateWithRun(request.state, run) })
        return [key, response]
      }))
      for (const [key, response] of results) answers.set(key, response)
      answersByRun.push(answers)
    }
    const suffix = has('probe') ? '.probe' : ''
    const file = join(RESULTS, `${arm}.${name}${suffix}.json`)
    if (!client.live) {
      writeFileSync(file.replace(/\.json$/, '.planned.json'), JSON.stringify({ arm, dataset: name, meta, requests }, null, 2))
      console.log(`  planned requests written to ${file.replace(/\.json$/, '.planned.json')}`)
      continue
    }
    const scored = score(arm, name, items, answersByRun[0])
    const stability = repeat > 1 ? stabilityOf(answersByRun) : null
    const models = new Set(answersByRun.flatMap((m) => [...m.values()].map((r) => r.model)))
    const out = { arm, dataset: name, meta, model: [...models], repeat, scored, stability, at: new Date().toISOString() }
    writeFileSync(file, JSON.stringify(out, null, 2))
    const { rows, disagreements, ...summary } = scored
    console.log(`  scored -> ${file}`)
    console.log(`  ${JSON.stringify(summary)}`)
    if (stability) console.log(`  stability: ${JSON.stringify(stability)}`)
  }
}
console.log(`\ntotal: ${grandRequests} requests, ~${grandTokens} tokens, ~$${(grandTokens / 1e6 * PRICE_PER_MTOK).toFixed(4)} at $${PRICE_PER_MTOK}/Mtok list price`)

/** Per-question standard deviation of every probability across repeated runs. */
function stabilityOf(runs) {
  const series = new Map()
  for (const answers of runs) {
    for (const [key, response] of answers) {
      for (const [qid, a] of Object.entries(response.answers ?? {})) {
        const values = a.type === 'noul' ? { yes: a.noul } : a.probabilities
        for (const [option, p] of Object.entries(values)) {
          const k = `${key}:${qid}:${option}`
          if (!series.has(k)) series.set(k, [])
          series.get(k).push(p)
        }
      }
    }
  }
  const sds = [...series.values()].filter((xs) => xs.length > 1).map((xs) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
  })
  sds.sort((a, b) => a - b)
  return { series: sds.length, meanSd: sds.reduce((a, b) => a + b, 0) / sds.length, p95Sd: sds[Math.floor(sds.length * 0.95)] ?? null, maxSd: sds[sds.length - 1] ?? null }
}
