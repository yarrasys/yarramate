// The four arms of the judgment experiment (PROTOCOL.md). Each arm builds its
// requests from a compiled workspace, sends them through the client, and
// scores the answers. Every question and every threshold lives in this file,
// on purpose: it is the part a reviewer reads.

import { describe, identitySubjects, legalKinds, lexical, nodeById, readingOf } from './datasets.mjs'
import { top } from './typesafe.mjs'

// ---------------------------------------------------------------------------
// Thresholds, pre-registered. Change them only with a PROTOCOL.md amendment.
// ---------------------------------------------------------------------------
export const CUTS = {
  kindFitConfident: 0.6, // a Choice below this confidence is "unsure", reported separately
  duplicateFloor: 0.6, // lexical score that admits a pair as a candidate
  driftSuggest: 0.7, // a drift Noul at or above this proposes an edge
  askAnswers: 0.35, // the "anything answers this" Noul below this is an honest empty
  askCandidate: 0.5, // a candidate Noul at or above this becomes a seed
  askShortlist: 30, // substring candidates handed to the rerank
}

const stateWithRun = (state, run) => (run === 0 ? state : { ...state, run_marker: `repeat-${run}` })

// ---------------------------------------------------------------------------
// Arm 1: does the authored relationship kind fit the meaning?
// ---------------------------------------------------------------------------
export const buildKindFit = (ds) => {
  const nodes = nodeById(ds.canvas)
  const items = []
  const skipped = { noCoreEndpoint: 0, onlyAssociation: 0, authoredNotLegal: 0, responsibility: 0 }
  for (const edge of ds.canvas.edges) {
    if ((edge.responsibility ?? null) !== null) { skipped.responsibility += 1; continue }
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    const legal = legalKinds(ds.canvas, edge.from, edge.to)
    if (legal.length === 0) { skipped.noCoreEndpoint += 1; continue }
    if (legal.length === 1) { skipped.onlyAssociation += 1; continue }
    if (!legal.includes(edge.coreKindLabel)) { skipped.authoredNotLegal += 1; continue }
    const state = {
      source: describe(from),
      target: describe(to),
      ...(edge.name === null ? {} : { relationship_name: edge.name }),
      ...(edge.description === null ? {} : { relationship_description: edge.description }),
    }
    const criteria = Object.fromEntries(legal.map((kind) => [
      kind,
      kind === 'association'
        ? `${from.name} is related to ${to.name} in a way none of the other readings describes`
        : `${from.name} ${readingOf(kind)} ${to.name}`,
    ]))
    const blind = {
      state,
      questions: {
        kind: {
          type: 'choice',
          instructions: {
            question: 'Which reading states what `source` does with `target`, according to their descriptions?',
            focus: 'Choose the reading whose meaning the descriptions support. Use the association reading only when no specific reading fits.',
          },
          criteria,
        },
      },
    }
    const audit = {
      state: { ...state, authored_reading: `${from.name} ${readingOf(edge.coreKindLabel)} ${to.name}` },
      questions: {
        fits: {
          type: 'noul',
          instructions: 'Does `authored_reading` correctly state what `source` does with `target`, according to their descriptions?',
          criteria: {
            true: 'The descriptions support that reading',
            false: 'The descriptions describe a different relationship, or no relationship, between the two',
          },
        },
      },
    }
    items.push({ edge: edge.id, from: from.name, to: to.name, authored: edge.coreKindLabel, legal, blind, audit })
  }
  return { items, skipped }
}

export const scoreKindFit = (items, answers) => {
  const rows = items.map((item) => {
    const blind = answers.blind.get(item.edge)
    const audit = answers.audit.get(item.edge)
    const choice = blind?.answers?.kind
    const [chosen, p] = choice ? top(choice.probabilities) : [null, null]
    return {
      edge: item.edge, from: item.from, to: item.to, authored: item.authored,
      chosen, p, confidence: choice?.confidence ?? null,
      agrees: chosen === item.authored,
      fits: audit?.answers?.fits?.noul ?? null,
      pAuthored: choice ? choice.probabilities[item.authored] ?? 0 : null,
      probabilities: choice?.probabilities ?? null,
    }
  })
  const answered = rows.filter((r) => r.chosen !== null)
  const confident = answered.filter((r) => r.confidence >= CUTS.kindFitConfident)
  const rate = (xs) => (xs.length === 0 ? null : xs.filter((r) => r.agrees).length / xs.length)
  return {
    n: rows.length, answered: answered.length,
    agreementAll: rate(answered), confident: confident.length, agreementConfident: rate(confident),
    agreementByCut: Object.fromEntries([0.5, 0.6, 0.7, 0.8, 0.9].map((c) => {
      const xs = answered.filter((r) => r.confidence >= c)
      return [c, { n: xs.length, agreement: rate(xs) }]
    })),
    auditMeanOnAgree: mean(answered.filter((r) => r.agrees && r.fits !== null).map((r) => r.fits)),
    auditMeanOnDisagree: mean(answered.filter((r) => !r.agrees && r.fits !== null).map((r) => r.fits)),
    disagreements: answered.filter((r) => !r.agrees).sort((a, b) => b.confidence - a.confidence),
    rows,
  }
}

// ---------------------------------------------------------------------------
// Arm 2: is this the same subject twice?
// ---------------------------------------------------------------------------
export const buildDuplicates = (ds) => {
  const subjects = identitySubjects(ds.canvas)
  const nodes = nodeById(ds.canvas)
  const byKind = new Map()
  for (const s of subjects) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, [])
    byKind.get(s.kind).push(s)
  }
  const candidates = []
  for (const bucket of byKind.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i], b = bucket[j]
        if (a.distinctFrom.has(b.id) || b.distinctFrom.has(a.id)) continue
        const score = lexical.lexicalScore(a, b)
        if (score >= CUTS.duplicateFloor) candidates.push({ a: a.id, b: b.id, lexical: score })
      }
    }
  }
  // What the shipped rule says today, for the comparison column.
  const current = new Set(lexical.findNearDuplicates(subjects).map((p) => [p.left, p.right].sort().join('|')))
  const nameOf = (id) => nodes.get(id)?.name ?? id
  const items = candidates.map(({ a, b, lexical: score }) => {
    const A = nodes.get(a), B = nodes.get(b)
    const side = (n, s) => ({
      name: n.name, aliases: n.aka, kind: n.coreKindLabel,
      ...(n.description === null ? {} : { description: n.description }),
      ...(n.owner === null ? {} : { owner: nameOf(n.owner) }),
      neighbours: [...s.neighbours].map(nameOf).slice(0, 12),
    })
    const sa = subjects.find((s) => s.id === a), sb = subjects.find((s) => s.id === b)
    return {
      pair: [a, b].sort().join('|'), a, b, aName: A.name, bName: B.name, lexical: score,
      currentRule: current.has([a, b].sort().join('|')),
      request: {
        state: { a: side(A, sa), b: side(B, sb) },
        questions: {
          same: {
            type: 'score',
            instructions: {
              question: 'Are `a` and `b` the same architectural subject recorded twice?',
              focus: 'Judge what each one is and does, not how similar the names look.',
            },
            criteria: [
              { what: 'Different things', signals: ['Different responsibilities, users or data', 'Similar names by coincidence or shared vocabulary'] },
              { what: 'Related, and a person should decide', signals: ['One contains, specialises, precedes or replaces the other', 'Overlapping scope without being identical', 'Too little description to tell'] },
              { what: 'The same thing recorded twice', signals: ['Same responsibility described in different words', 'One is a renaming or alias of the other'] },
            ],
          },
        },
      },
    }
  })
  return { items, buckets: byKind.size, subjects: subjects.length }
}

export const scoreDuplicates = (items, answers, labels = new Map()) => {
  const rows = items.map((item) => {
    const a = answers.get(item.pair)?.answers?.same
    const level = a ? Math.round(a.score) : null
    return {
      ...item, request: undefined,
      score: a?.score ?? null, confidence: a?.confidence ?? null,
      level: level === null ? null : ['different', 'related', 'same'][level],
      label: labels.get(item.pair) ?? null,
    }
  })
  const labelled = rows.filter((r) => r.label !== null && r.level !== null)
  const prf = (pred, truth) => {
    const tp = labelled.filter((r) => pred(r) && truth(r)).length
    const fp = labelled.filter((r) => pred(r) && !truth(r)).length
    const fn = labelled.filter((r) => !pred(r) && truth(r)).length
    const precision = tp + fp === 0 ? null : tp / (tp + fp)
    const recall = tp + fn === 0 ? null : tp / (tp + fn)
    return { tp, fp, fn, precision, recall }
  }
  return {
    candidates: rows.length, labelled: labelled.length,
    byLevel: count(rows.map((r) => r.level)),
    byLabel: count(rows.map((r) => r.label)),
    judgmentSame: prf((r) => r.level === 'same', (r) => r.label === 'same'),
    currentRule: prf((r) => r.currentRule, (r) => r.label === 'same'),
    relatedBand: count(rows.filter((r) => r.level === 'related').map((r) => r.label)),
    rows,
  }
}

// ---------------------------------------------------------------------------
// Arm 3: does the prose say more than the structure holds?
// ---------------------------------------------------------------------------
const KIND_FAMILIES = {
  data: (n) => n.aspect === 'passive-structure',
  served: (n) => n.aspect === 'active-structure' || n.aspect === 'behavior',
  trigger: (n) => n.aspect === 'behavior',
}

export const buildDrift = (ds, { probe = false } = {}) => {
  const nodes = nodeById(ds.canvas)
  const edgesOf = new Map()
  for (const edge of ds.canvas.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!edgesOf.has(end)) edgesOf.set(end, [])
      edgesOf.get(end).push(edge)
    }
  }
  const readingLine = (edge, selfId) => {
    const other = nodes.get(edge.from === selfId ? edge.to : edge.from)
    const phrase = edge.reading ?? readingOf(edge.coreKindLabel)
    return edge.from === selfId ? `${phrase} ${other.name} (${other.coreKindLabel})` : `${other.name} (${other.coreKindLabel}) ${phrase} this`
  }
  const items = []
  for (const node of ds.canvas.nodes) {
    if (node.description === null || node.description.length < 40) continue
    let edges = edgesOf.get(node.id) ?? []
    let removed = null
    if (probe) {
      // Recall probe: hide one edge whose counterpart the description names, and see if it is found again.
      const named = edges.find((e) => {
        const other = nodes.get(e.from === node.id ? e.to : e.from)
        return other && node.description.toLowerCase().includes(other.name.toLowerCase())
      })
      if (named === undefined) continue
      removed = named
      edges = edges.filter((e) => e !== named)
    }
    const state = {
      subject: describe(node),
      recorded_relationships: edges.map((e) => readingLine(e, node.id)),
    }
    items.push({
      subject: node.id, name: node.name,
      removed: removed === null ? null : { edge: removed.id, kind: removed.coreKindLabel, other: nodes.get(removed.from === node.id ? removed.to : removed.from).name },
      request: {
        state,
        questions: {
          data: { type: 'noul', instructions: 'Does `subject.description` name data, records or documents that `subject` reads, writes or stores, which `recorded_relationships` does not already list as accessed?' },
          served: { type: 'noul', instructions: 'Does `subject.description` name a person, role, system or process that `subject` serves or provides something to, which `recorded_relationships` does not already list?' },
          trigger: { type: 'noul', instructions: 'Does `subject.description` name an event, process or system that starts `subject` or that `subject` starts, which `recorded_relationships` does not already list?' },
        },
      },
    })
  }
  return { items }
}

export const scoreDrift = (items, answers) => {
  const rows = items.map((item) => {
    const a = answers.get(item.subject)?.answers ?? {}
    const nouls = { data: a.data?.noul ?? null, served: a.served?.noul ?? null, trigger: a.trigger?.noul ?? null }
    const flagged = Object.entries(nouls).filter(([, v]) => v !== null && v >= CUTS.driftSuggest).map(([k]) => k)
    return { subject: item.subject, name: item.name, removed: item.removed, nouls, flagged }
  })
  const probes = rows.filter((r) => r.removed !== null)
  const family = (kind) => (['access'].includes(kind) ? 'data' : ['triggering', 'flow'].includes(kind) ? 'trigger' : 'served')
  const recovered = probes.filter((r) => r.flagged.includes(family(r.removed.kind)))
  return {
    n: rows.length, flaggedSubjects: rows.filter((r) => r.flagged.length > 0).length,
    flaggedByQuestion: count(rows.flatMap((r) => r.flagged)),
    probe: probes.length === 0 ? null : { n: probes.length, recovered: recovered.length, recall: recovered.length / probes.length },
    rows,
  }
}

// ---------------------------------------------------------------------------
// Arm 4: does free-text ask find what was meant?
// ---------------------------------------------------------------------------
export const substringCandidates = (canvas, query, limit = CUTS.askShortlist) => {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1)
  return canvas.nodes
    .map((node) => {
      const hay = [node.localId, node.name, ...node.aka, node.description ?? ''].join(' ').toLowerCase()
      const score = new Set(terms.filter((t) => hay.includes(t))).size
      return { id: node.id, name: node.name, score }
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export const buildAsk = (ds, queries) => {
  const nodes = nodeById(ds.canvas)
  const items = queries.map((q, index) => {
    const candidates = substringCandidates(ds.canvas, q.query)
    const questions = { any: { type: 'noul', instructions: 'Does at least one of the `candidates` answer `question`?' } }
    for (const c of candidates) {
      const n = nodes.get(c.id)
      questions[`c_${c.id}`] = {
        type: 'noul',
        instructions: `Does the candidate named "${n.name}" (${n.coreKindLabel}) answer \`question\`, given its description under \`candidates\`?`,
      }
    }
    return {
      index, query: q.query, intended: q.intended ?? [], source: q.source ?? 'unknown',
      substringTop5: candidates.slice(0, 5).map((c) => c.id),
      candidates: candidates.map((c) => c.id),
      request: {
        state: {
          question: q.query,
          candidates: candidates.map((c) => ({ id: c.id, ...describe(nodes.get(c.id)) })),
        },
        questions,
      },
    }
  })
  return { items }
}

export const scoreAsk = (items, answers) => {
  const rows = items.map((item) => {
    const a = answers.get(item.index)?.answers ?? {}
    const any = a.any?.noul ?? null
    const ranked = item.candidates
      .map((id) => ({ id, noul: a[`c_${id}`]?.noul ?? null }))
      .filter((c) => c.noul !== null)
      .sort((x, y) => y.noul - x.noul)
    const reranked = ranked.filter((c) => c.noul >= CUTS.askCandidate).map((c) => c.id)
    const hit = (list, k) => item.intended.length > 0 && list.slice(0, k).some((id) => item.intended.includes(id))
    return {
      query: item.query, source: item.source, intended: item.intended, any,
      substringTop1: hit(item.substringTop5, 1), substringTop5: hit(item.substringTop5, 5),
      rerankTop1: hit(reranked, 1), rerankTop5: hit(reranked, 5),
      honestEmpty: item.intended.length === 0 ? (any !== null && any < CUTS.askAnswers) : null,
      reranked: reranked.slice(0, 5),
    }
  })
  const withIntent = rows.filter((r) => r.intended.length > 0)
  const noAnswer = rows.filter((r) => r.intended.length === 0)
  const rate = (xs, key) => (xs.length === 0 ? null : xs.filter((r) => r[key]).length / xs.length)
  return {
    n: rows.length, withIntent: withIntent.length, noAnswer: noAnswer.length,
    substringTop1: rate(withIntent, 'substringTop1'), substringTop5: rate(withIntent, 'substringTop5'),
    rerankTop1: rate(withIntent, 'rerankTop1'), rerankTop5: rate(withIntent, 'rerankTop5'),
    honestEmpty: rate(noAnswer, 'honestEmpty'),
    rows,
  }
}

// ---------------------------------------------------------------------------
const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)
const count = (xs) => xs.reduce((acc, x) => ({ ...acc, [x ?? 'null']: (acc[x ?? 'null'] ?? 0) + 1 }), {})
export { stateWithRun }
