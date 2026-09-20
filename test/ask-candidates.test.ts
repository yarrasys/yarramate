import { describe, expect, it } from 'vitest'
import Ajv2020Module from 'ajv/dist/2020.js'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import {
  askSlice,
  candidateLimit,
  conceptEntries,
  resolveSeeds,
} from '../src/tools/ask.js'
import { resolveWorkspaceFrom } from '../src/tools-entry.js'
import type { SourceStore } from '../src/source-store.js'
import askResultSchema from '../schema/yarramate-ask-result.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default

// #569: the term count finds the right subject and ranks it fourth. The engine
// cannot decide which term-matching concept actually answers a question - that
// is a judgment and this is a deterministic CLI (ADR 0059) - so it hands the
// ranked list over and a caller with a judgment reorders it.

const source = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: field-crew
    kind: businessActor
    name: Field crew
    description: Walks the routes and takes the meter reads by hand.
  - id: meter-read
    kind: dataObject
    name: Meter read
    description: One reading taken from one meter at one time.
  - id: reads-api
    kind: applicationService
    name: Reads API
    description: Accepts meter reads from the field and hands them to billing.
  - id: billing
    kind: applicationComponent
    name: Billing system
    description: Produces a bill for each connection from the reads it holds.
  - id: ingestion
    kind: applicationFunction
    name: Read ingestion
    description: Validates each meter read and writes it to the store.
  - id: read-store
    kind: dataObject
    name: Read store
    description: Holds every meter read the system has accepted.
  - id: meter
    kind: node
    name: Water meter
    description: The device in the ground that a read is taken from.
  - id: read-audit
    kind: applicationFunction
    name: Audit a read
    description: Re-checks a suspicious meter read against the previous one.
  - id: route-sheet
    kind: businessObject
    name: Route sheet
    description: The day's list of meters to read, in walking order.
  - id: read-report
    kind: artifact
    name: Read exception report
    description: Lists every meter read that failed validation.
relationships: []
`

const manifest = `format: yarramate/workspace/v1
id: main
documents:
  - main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

const graph = () => {
  const compiled = compileWorkspaceWithProfileContext([
    { path: 'main.yaml', source },
  ])
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.graph
}

describe('the ranked candidates behind a free-text ask (#569)', () => {
  const entries = () => conceptEntries(graph())

  it('hands back everything a term touched, not only the five that seeded', () => {
    // "meter read" touches four of the five concepts: the actor who takes one,
    // the data object, the function that writes one, and the service that
    // accepts them. The seeds are the first few; the candidates are all four.
    const resolution = resolveSeeds(['meter read'], entries())
    expect(resolution.addressing).toBe('free-text')
    // More concepts match than seed the slice: that gap is the whole point.
    expect(resolution.seeds.length).toBe(5)
    expect(resolution.matched).toBeGreaterThan(5)
    expect(resolution.candidates.length).toBe(resolution.matched)
    expect(resolution.candidates.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['meter-read', 'ingestion', 'read-store', 'read-audit']),
    )
  })

  it('ranks them the way it ranks seeds, and the seeds are their head', () => {
    const resolution = resolveSeeds(['meter read'], entries())
    const ranked = resolution.candidates
    // Descending by term count: the ordering the seeds already used, now
    // visible rather than implied.
    for (let index = 1; index < ranked.length; index += 1) {
      expect(ranked[index]!.terms).toBeLessThanOrEqual(ranked[index - 1]!.terms)
    }
    expect(ranked.slice(0, resolution.seeds.length).map(({ id }) => id)).toEqual(
      resolution.seeds,
    )
    for (const candidate of ranked) expect(candidate.terms).toBeGreaterThan(0)
  })

  it('caps the list, and lets a caller raise the cap', () => {
    expect(candidateLimit).toBe(30)
    const wide = resolveSeeds(['meter read'], entries())
    expect(wide.candidates.length).toBeGreaterThan(5)

    // A caller may ask for fewer, and gets fewer.
    const narrow = resolveSeeds(['meter read'], entries(), { candidates: 6 })
    expect(narrow.candidates.length).toBe(6)
    expect(narrow.candidates.length).toBeLessThan(wide.candidates.length)

    // Never below the seeds themselves: a caller asking for two must still be
    // told what the slice was actually seeded from.
    const tiny = resolveSeeds(['meter read'], entries(), { candidates: 2 })
    expect(tiny.candidates.length).toBe(tiny.seeds.length)
    expect(tiny.seeds).toEqual(wide.seeds)
  })

  it('treats precise addressing as its own candidate list', () => {
    // Nothing was ranked, so the candidates are the named subjects. A caller
    // reranking whatever it is handed never has to ask which addressing it got.
    const resolution = resolveSeeds(['billing'], entries())
    expect(resolution.addressing).toBe('subjects')
    expect(resolution.candidates.map(({ id }) => id)).toEqual(['billing'])
  })

  it('answers nothing for a query no term touches', () => {
    const resolution = resolveSeeds(['zzzznothing'], entries())
    expect(resolution.seeds).toEqual([])
    expect(resolution.candidates).toEqual([])
    expect(resolution.matched).toBe(0)
  })

  it('carries a reranked order straight back through subjects addressing', () => {
    // The two-call loop the issue describes, with the judgment stubbed: ask
    // once, reorder the candidates by whatever you know, ask again by id. The
    // second call needs nothing new, because precise addressing already exists.
    const first = resolveSeeds(['meter read'], entries())
    const judged = [...first.candidates]
      .sort((left, right) => (left.id === 'field-crew' ? -1 : right.id === 'field-crew' ? 1 : 0))
      .map(({ id }) => id)
    const second = resolveSeeds(judged, entries())
    expect(second.addressing).toBe('subjects')
    expect(second.seeds[0]).toBe('field-crew')
  })

  it('rides on the slice both the tools entry and the CLI emit', () => {
    // The field exists so an AGENT can rerank; an agent reads the document,
    // not `resolveSeeds`. M6 of the mutation pass survived until this existed.
    const files = new Map([
      ['workspace.yaml', manifest],
      ['main.yaml', source],
    ])
    const store: SourceStore = {
      list: () => [...files.keys()].sort(),
      read: (path: string) =>
        files.has(path) ? { source: files.get(path)!, revision: `r-${path}` } : undefined,
      writeAll: () => ({ ok: true as const, revisions: new Map() }),
    }
    const resolved = resolveWorkspaceFrom(
      { path: 'workspace.yaml', source: manifest },
      [...files.keys()],
    )
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
    const answer = askSlice({ store, workspace: resolved.workspace }, { text: 'meter read' })
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.result.candidates).toBeDefined()
    expect(answer.result.candidates!.length).toBeGreaterThan(answer.result.seeds!.length)
    expect(answer.result.candidates!.slice(0, answer.result.seeds!.length).map(({ id }) => id)).toEqual(
      answer.result.seeds,
    )
    // Precise addressing ranked nothing, so the slice says nothing.
    const precise = askSlice({ store, workspace: resolved.workspace }, { subjects: ['billing'] })
    expect(precise.ok).toBe(true)
    if (precise.ok) expect(precise.result.candidates).toBeUndefined()
  })

  it('is additive to the published ask-result document', () => {
    const ajv = new Ajv2020({ strict: false })
    const validate = ajv.compile(askResultSchema)
    const base = {
      format: 'yarramate/ask-result/v1',
      workspace: 'main',
      mode: 'slice',
      addressing: 'free-text',
      topic: 'meter read',
      seeds: ['meter-read'],
      matched: 4,
      result: {
        format: 'yarramate/projection-result/v1',
        projection: 'ask-slice@0.0',
        subjects: [],
        claims: [],
        documents: [],
      },
    }
    // Valid without the field, which is what an older reader sees.
    expect(validate(base), JSON.stringify(validate.errors)).toBe(true)
    expect(
      validate({
        ...base,
        candidates: [
          { id: 'meter-read', terms: 2 },
          { id: 'ingestion', terms: 2 },
        ],
      }),
      JSON.stringify(validate.errors),
    ).toBe(true)
    // And still refuses a shape nobody declared.
    expect(validate({ ...base, candidates: [{ id: 'meter-read' }] })).toBe(false)
    expect(validate({ ...base, candidates: [{ id: 'x', terms: 0 }] })).toBe(false)
  })
})
