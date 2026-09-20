// Builds arm 5's frozen item set: authored (subject, cited file) citations
// from the self-model's evidence document, and one hard negative per positive.
// Nothing here calls a model. Run once; the output is committed and the arm
// reads it, so the sample cannot drift between runs.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { DATASETS, loadWorkspace, nodeById } from './datasets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')

// Deterministic sampling: a seeded LCG, so the frozen set is reproducible from
// the seed alone and nobody has to trust a shuffle.
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const pick = (list, random) => list[Math.floor(random() * list.length)]

// The whole cited file, capped. The arm's premise is that the answer is in the
// material handed over, so a sixty-line window of a two-thousand-line file
// would test something else: 107 of the 118 cited files fit under this cap
// whole, and the eleven that do not are marked and reported separately.
const FILE_CHARS = 40000

const contentOf = (path) => {
  const text = readFileSync(join(repoRoot, path), 'utf8')
  return text.length > FILE_CHARS
    ? { text: `${text.slice(0, FILE_CHARS)}\n... [truncated]`, truncated: true }
    : { text, truncated: false }
}

const exists = (path) => {
  try {
    return statSync(join(repoRoot, path)).isFile()
  } catch {
    return false
  }
}

const siblingsOf = (path) => {
  const dir = dirname(path)
  try {
    return readdirSync(join(repoRoot, dir))
      .map((f) => join(dir, f))
      .filter((p) => p !== path && exists(p) && /\.(ts|tsx|mjs|js|md|json|yaml|xml)$/.test(p))
  } catch {
    return []
  }
}

const ds = loadWorkspace(DATASETS.self.manifest)
const nodes = nodeById(ds.canvas)

// Every authored observation that names a repository file which still exists.
const evidenceDoc = parse(
  readFileSync(join(repoRoot, '.yarramate/evidence/repository.yaml'), 'utf8'),
)
const observations = (evidenceDoc.observations ?? [])
  .map((o) => ({ subject: o.subject, path: (o.evidence?.uri ?? '').replace(/^repo:/, '') }))
  .filter((o) => o.path !== '' && exists(o.path))

// What each subject is legitimately evidenced by, so a negative can never be a
// file that genuinely serves it.
const citedFor = new Map()
for (const o of observations) {
  if (!citedFor.has(o.subject)) citedFor.set(o.subject, new Set())
  citedFor.get(o.subject).add(o.path)
}

const random = rng(20260920)
const positives = []
const negatives = []
for (const o of observations) {
  const node = nodes.get(o.subject)
  // A subject with no description gives the model nothing to judge against,
  // and the claim would be untestable rather than hard.
  if (node === undefined || node.description === null || node.description === undefined) continue
  const subject = {
    name: node.name,
    kind: node.coreKindLabel,
    description: node.description,
  }
  positives.push({ id: `${o.subject}|${o.path}`, subject: o.subject, claim: subject, path: o.path, label: 'supported' })

  const candidates = siblingsOf(o.path).filter((p) => !citedFor.get(o.subject).has(p))
  if (candidates.length === 0) continue
  const wrong = pick(candidates, random)
  negatives.push({ id: `${o.subject}|${wrong}`, subject: o.subject, claim: subject, path: wrong, label: 'fabricated' })
}

// Balanced, capped, and drawn with the same seed so the two halves are
// comparable and the whole set is reproducible.
const CAP = 60
const shuffle = (list) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
const chosenPositives = shuffle(positives).slice(0, CAP)
const chosenSubjects = new Set(chosenPositives.map((p) => p.subject))
// Negatives drawn from the same subjects, so the two classes differ only in
// which file is cited and not in which subjects are being asked about.
const chosenNegatives = shuffle(negatives.filter((n) => chosenSubjects.has(n.subject))).slice(0, CAP)

const items = [...chosenPositives, ...chosenNegatives].map((item) => {
  const { text, truncated } = contentOf(item.path)
  return { ...item, content: text, truncated }
})

const out = {
  dataset: 'self',
  frozenAt: 'worktree research/typesafe-judgments, engine 1.35.0',
  seed: 20260920,
  fileCap: FILE_CHARS,
  counts: {
    observations: observations.length,
    positivesAvailable: positives.length,
    negativesAvailable: negatives.length,
    supported: chosenPositives.length,
    fabricated: chosenNegatives.length,
    truncated: 0,
  },
  items,
}
out.counts.truncated = items.filter((i) => i.truncated).length
const target = resolve(here, '../datasets/evidence-citations.self.json')
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
console.log(JSON.stringify(out.counts, null, 2))
console.log('subjects covered:', chosenSubjects.size)
console.log('written:', target)
