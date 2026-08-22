import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceIncremental,
  compileWorkspaceWithProfileContext,
  type CompilationCache,
  type ResolvedProfileContext,
  type WorkspaceSource,
} from '../src/compiler.js'
import { serializeSemanticGraph } from '../src/graph.js'

// Deterministic PRNG: a failing sequence is reproducible from its seed alone.
const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state)
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296
  }
}

const profileSource = (extraKind: boolean): string => `format: yarramate/profile/v1
id: example/incremental
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: service
    name: Service
    parent: yarramate/core@0.1#applicationComponent
${extraKind ? '  - id: gateway\n    name: Gateway\n    parent: yarramate/core@0.1#applicationComponent\n' : ''}relationshipKinds: []
`

// Each document owns two concepts and points one relationship at its successor,
// so a rename or a deletion breaks references the neighbour holds - the paths
// where a parse cache is most likely to leak a stale value.
const documentSource = (index: number, name: string, target: number): string =>
  `format: yarramate/v1
id: doc-${index}
profile: example/incremental@1.0
concepts:
  - id: service-a
    kind: service
    name: ${name}
    description: Owned by document ${index}
  - id: service-b
    kind: service
    name: ${name} secondary
relationships:
  - id: uses-neighbour
    kind: association
    from: doc-${index}#service-a
    to: doc-${target}#service-b
    name: Serves doc-${target}
`

const documentCount = 6

const baseWorkspace = (): WorkspaceSource[] => [
  { path: 'profile.yaml', source: profileSource(false) },
  ...Array.from({ length: documentCount }, (_, index) => ({
    path: `doc-${index}.yaml`,
    source: documentSource(index, `Service ${index}`, (index + 1) % documentCount),
  })),
]

const canonical = (result: ReturnType<typeof compileWorkspaceWithProfileContext>) =>
  result.ok
    ? serializeSemanticGraph(result.graph)
    : JSON.stringify(result.diagnostics)

// `profileContext` maps are frozen facades of bound functions, so structural
// equality on the objects compares closures. Compare their contents instead.
const canonicalProfileContext = (
  context: ResolvedProfileContext,
): string =>
  JSON.stringify(
    Object.fromEntries(
      (
        [
          'conceptKindLineages',
          'relationshipKindLineages',
          'conceptKindLayers',
          'conceptKindAspects',
          'relationshipKindEndpointAspects',
          'conceptKindCoreAncestors',
          'relationshipKindCoreAncestors',
        ] as const
      ).map((field) => [
        field,
        [...context[field]].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ]),
    ),
  )

describe('compileWorkspaceIncremental', () => {
  it('reuses parses and returns the full compile byte for byte', () => {
    const sources = baseWorkspace()
    const first = compileWorkspaceIncremental(sources)
    expect(first.ok).toBe(true)
    expect(first.incremental).toBe(false)

    const second = compileWorkspaceIncremental(sources, first.cache)
    expect(second.incremental).toBe(true)
    expect(canonical(second)).toBe(canonical(compileWorkspaceWithProfileContext(sources)))
    if (!second.ok || !first.ok) return
    expect(serializeSemanticGraph(second.graph)).toBe(
      serializeSemanticGraph(first.graph),
    )
    expect(canonicalProfileContext(second.profileContext)).toBe(
      canonicalProfileContext(first.profileContext),
    )
  })

  it('holds byte identity across random change sequences', () => {
    const outcomes = { ok: 0, failed: 0 }
    for (let seed = 1; seed <= 24; seed += 1) {
      const next = random(seed)
      let sources = baseWorkspace()
      let cache: CompilationCache | undefined
      let added = 0
      const trail: string[] = []

      for (let step = 0; step < 12; step += 1) {
        const operation = Math.floor(next() * 7)
        const pick = Math.floor(next() * documentCount)
        switch (operation) {
          case 0:
            trail.push(`edit doc-${pick}`)
            sources = sources.map((source) =>
              source.path === `doc-${pick}.yaml`
                ? {
                    path: source.path,
                    source: documentSource(
                      pick,
                      `Renamed ${step}`,
                      (pick + 1) % documentCount,
                    ),
                  }
                : source,
            )
            break
          case 1:
            trail.push(`delete doc-${pick}`)
            sources = sources.filter(
              (source) => source.path !== `doc-${pick}.yaml`,
            )
            break
          case 2:
            added += 1
            trail.push(`add extra-${added}`)
            sources = [
              ...sources,
              {
                path: `extra-${added}.yaml`,
                source: documentSource(
                  100 + added,
                  `Extra ${added}`,
                  pick % documentCount,
                ),
              },
            ]
            break
          case 3:
            // Retarget a relationship at a document ID that may not exist:
            // exercises the failure path with a warm cache.
            trail.push(`dangle doc-${pick}`)
            sources = sources.map((source) =>
              source.path === `doc-${pick}.yaml`
                ? {
                    path: source.path,
                    source: documentSource(pick, `Service ${pick}`, 900),
                  }
                : source,
            )
            break
          case 4:
            trail.push('toggle profile')
            sources = sources.map((source) =>
              source.path === 'profile.yaml'
                ? {
                    path: source.path,
                    source: profileSource(!source.source.includes('gateway')),
                  }
                : source,
            )
            break
          case 5:
            trail.push('reorder')
            sources = [...sources].reverse()
            break
          default:
            trail.push('drop cache')
            cache = undefined
            break
        }

        const incremental = compileWorkspaceIncremental(sources, cache)
        const full = compileWorkspaceWithProfileContext(sources)
        const context = `seed ${seed} step ${step}: ${trail.join(' | ')}`

        outcomes[full.ok ? 'ok' : 'failed'] += 1
        expect(incremental.ok, context).toBe(full.ok)
        expect(canonical(incremental), context).toBe(canonical(full))
        if (incremental.ok && full.ok) {
          expect(
            canonicalProfileContext(incremental.profileContext),
            context,
          ).toBe(canonicalProfileContext(full.profileContext))
        }
        // A cache that never hits would satisfy identity vacuously.
        expect(incremental.incremental, context).toBe(
          cache !== undefined && sources.length > 0,
        )
        cache = incremental.cache
      }
    }
    // Identity would be cheap to satisfy if every sequence failed to compile,
    // or if none did. Both paths must be exercised.
    expect(outcomes.ok).toBeGreaterThan(0)
    expect(outcomes.failed).toBeGreaterThan(0)
  })

  it('drops departed sources from the cache it returns', () => {
    const sources = baseWorkspace()
    const first = compileWorkspaceIncremental(sources)
    const shrunk = sources.filter((source) => source.path !== 'doc-3.yaml')
    const second = compileWorkspaceIncremental(shrunk, first.cache)

    expect([...second.cache.sources.keys()].sort()).toEqual(
      [...shrunk].map((source) => source.path).sort(),
    )
    expect(second.cache.sources.has('doc-3.yaml')).toBe(false)
  })

  it('ignores a cache entry whose source text moved on', () => {
    const sources = baseWorkspace()
    const warm = compileWorkspaceIncremental(sources)
    const forged: CompilationCache = {
      sources: new Map(
        [...warm.cache.sources].map(([path, entry]) => [
          path,
          { ...entry, source: `${entry.source}# drifted\n` },
        ]),
      ),
    }

    const result = compileWorkspaceIncremental(sources, forged)
    expect(result.incremental).toBe(false)
    expect(canonical(result)).toBe(
      canonical(compileWorkspaceWithProfileContext(sources)),
    )
  })
})
