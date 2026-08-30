import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// Re-gating `application` and `technology` (#405, ADR 0136), against the
// SHIPPED catalogue rather than a fixture, because the claim is about what
// adopters actually run.

const catalogue = (() => {
  const loaded = loadQuestionCatalogue({
    path: 'catalogues/core-enrichment.yaml',
    source: readFileSync('catalogues/core-enrichment.yaml', 'utf8'),
  })
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics))
  return loaded.catalogue
})()

const workspaceOf = (concepts: string) => {
  const result = compileWorkspaceWithProfileContext([
    {
      path: 'architecture/main.yaml',
      source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:${concepts}
relationships: []
`,
    },
  ])
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

const opened = (concepts: string) => {
  const compiled = workspaceOf(concepts)
  return new Map(
    evaluateCatalogue(
      catalogue,
      compiled.graph,
      compiled.profileContext,
    ).waves.map((wave) => [wave.id, wave.opened]),
  )
}

const ACTOR = `
  - id: teller
    kind: businessActor
    name: Teller`
const SERVICE = `
  - id: ordering
    kind: applicationService
    name: Ordering`
const COMPONENT = `
  - id: order-api
    kind: applicationComponent
    name: Order API`

describe('the shipped interview performs the order it draws', () => {
  it('opens neither layered wave on a model with only an actor', () => {
    const waves = opened(ACTOR)
    expect(waves.get('application')).toBe(false)
    expect(waves.get('technology')).toBe(false)
  })

  it('opens application once a service is declared', () => {
    const waves = opened(ACTOR + SERVICE)
    expect(waves.get('application')).toBe(true)
    expect(waves.get('technology')).toBe(false)
  })

  it('opens technology once a component is declared', () => {
    const waves = opened(ACTOR + COMPONENT)
    expect(waves.get('technology')).toBe(true)
  })

  it('leaves the ungated waves open from the first concept', () => {
    // Only two waves moved. `motivation` has no gate at all, and the rest
    // still open on `has-any-subject`, which is what #405 scoped.
    const waves = opened(ACTOR)
    for (const id of ['motivation', 'interaction', 'business', 'hygiene']) {
      expect(waves.get(id), id).toBe(true)
    }
  })

  it('keeps implementation ungated, deliberately', () => {
    // Every candidate gate names something the wave exists to elicit, and a
    // declared state compiles to a plateau, which closes the wave's own lead
    // question `implementation-path-missing`. ADR 0136 records both traps;
    // this pins the resulting behaviour so a later "tidy-up" has to argue
    // with a failing test rather than a comment.
    expect(opened(ACTOR).get('implementation')).toBe(true)
  })
})

describe('every gate is satisfiable from an earlier wave', () => {
  // The rule a gate must pass: it must never name a subject its own wave
  // exists to elicit, or the wave goes silent for exactly the model that
  // needed it. Checked here against the shipped catalogue rather than
  // asserted in prose, because the catalogue is what changes.
  const questionsOfWave = (wave: string) =>
    catalogue.questions.filter((question) => question.wave === wave)

  const gatedKinds = (wave: string) =>
    (catalogue.waves.find(({ id }) => id === wave)?.opensWhen ?? []).flatMap(
      (condition) => ('kinds' in condition ? condition.kinds : []),
    )

  it('no gated wave names a kind its own subject selectors elicit', () => {
    for (const wave of ['application', 'technology']) {
      const kinds = new Set(gatedKinds(wave))
      expect(kinds.size, wave).toBeGreaterThan(0)
      for (const question of questionsOfWave(wave)) {
        // A workspace-scope `no-subject-of-kind` on the gated kind would be
        // the pure trap: the wave would open only once its own eliciting
        // question had been answered.
        for (const condition of question.trigger) {
          if (condition.condition !== 'no-subject-of-kind') continue
          for (const kind of condition.kinds) {
            expect(kinds.has(kind), `${wave}/${question.id}`).toBe(false)
          }
        }
      }
    }
  })
})
