import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCliWorkspaceSources } from '../src/cli-support.js'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  type WorkspaceSource,
} from '../src/index.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/interrogate-command.js'

// The contact-update journey is the model the compound-container rendering bug
// was found on: four `applicationComponent` subjects, each composing the
// `applicationInterface` it exposes, which is what cytoscape renders as
// compound nesting.
//
// It is fixture data, so nothing executes it the way a unit test executes
// source. That is exactly why it needs this: the fixture was taken from 34
// open questions down to 9 by answering the engine's own interrogation, and
// without a test that effort decays silently the first time the catalogue
// deepens or a profile changes.
//
// Deliberately not pinned: the open-question count. It moves with the
// catalogue version, so asserting it would fail on every catalogue bump for
// reasons that have nothing to do with this fixture. The two properties below
// are the ones that carry meaning.

const fixture = (name: string): WorkspaceSource => ({
  path: `architecture/${name}`,
  source: readFileSync(
    fileURLToPath(
      new URL(
        `./fixtures/journeys/contact-update/.yarramate/architecture/${name}`,
        import.meta.url,
      ),
    ),
    'utf8',
  ),
})

const catalogue = (() => {
  const loaded = loadQuestionCatalogue({
    path: 'catalogues/core-enrichment.yaml',
    source: readFileSync(
      fileURLToPath(
        new URL('../catalogues/core-enrichment.yaml', import.meta.url),
      ),
      'utf8',
    ),
  })
  if (!loaded.ok) throw new Error('the bundled catalogue must load')
  return loaded.catalogue
})()

// The api-led profile is a workspace source like the documents: the
// fixture's api groupings are kinded against it (yarrasys/api-led@1.0#api
// extends grouping), so compiling without it is YM403.
const profileFixture = (name: string): WorkspaceSource => ({
  path: `profiles/${name}`,
  source: readFileSync(
    fileURLToPath(
      new URL(
        `./fixtures/journeys/contact-update/.yarramate/profiles/${name}`,
        import.meta.url,
      ),
    ),
    'utf8',
  ),
})

// The api-led PATTERN is a workspace source too (#268 phase 1, ADR 0123): it
// is what mints the wiring the four `api` instances no longer author by hand.
const patternFixture = (name: string): WorkspaceSource => ({
  path: `patterns/${name}`,
  source: readFileSync(
    fileURLToPath(
      new URL(
        `./fixtures/journeys/contact-update/.yarramate/patterns/${name}`,
        import.meta.url,
      ),
    ),
    'utf8',
  ),
})

const result = compileWorkspaceWithProfileContext([
  fixture('contact-update.yaml'),
  fixture('contact-update.policy.yaml'),
  profileFixture('api-led.yaml'),
  patternFixture('api-led.yaml'),
])

// Narrowed once, so the three tests below read the graph without each
// re-proving the compile succeeded. A fixture that stops compiling fails here
// first, with the diagnostic that explains why.
const compiled = (() => {
  if (!result.ok) {
    throw new Error(
      `the contact-update fixture must compile: ${result.diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
        .join('; ')}`,
    )
  }
  return result
})()

describe('the contact-update journey fixture', () => {
  it('compiles clean', () => {
    expect(result.ok).toBe(true)
  })

  it('exercises compound nesting, which is what makes it this bug\'s fixture', () => {
    // Composition is the one relationship the canvas consumes into cytoscape's
    // compound `parent` field instead of drawing as an edge, so a container is
    // only rendered where a composition claim exists. Asserted through the
    // projector the app itself uses: if this fixture ever stopped declaring
    // them, the rendering fix beside it would lose the model it was found on.
    const canvas = projectGraphForCanvas(compiled.graph, compiled.profileContext)
    const compositions = canvas.edges.filter(
      (edge) => edge.kind === 'yarramate/core@0.1#composition',
    )

    expect(compositions.length).toBe(4)
  })

  it('leaves nothing open that an agent could have answered', () => {
    // The load-bearing invariant, and the one that keeps the fixture honest
    // without pinning a number. Every question this model still leaves open is
    // `authority: human` - two attestations wanting a reviewer's acceptance,
    // which a fixture must never fabricate, and whether architecture states
    // are worth declaring, which is a modelling judgement. If a future
    // catalogue adds an agent-answerable question this model cannot close,
    // that is a real gap in the fixture and this should fail.
    const report = evaluateCatalogue(
      catalogue,
      compiled.graph,
      compiled.profileContext,
    )
    const openByAgent = report.waves
      .flatMap((wave) => wave.questions)
      .filter((question) => question.open && question.authority !== 'human')
      .map((question) => question.id)

    expect(openByAgent).toEqual([])
  })

  it('answers every interaction question, which is what an integration model is for', () => {
    // The hop is the load-bearing unit of an integration: protocol, trust,
    // reliability, capacity, the contract each hop touches, and what actually
    // flows. A model of an API estate that cannot answer these is not
    // describing an integration, whatever it compiles to.
    const report = evaluateCatalogue(
      catalogue,
      compiled.graph,
      compiled.profileContext,
    )
    const interaction = report.waves.find((wave) => wave.id === 'interaction')

    expect(interaction).toBeDefined()
    expect(interaction?.questions.length).toBeGreaterThan(0)
    expect(
      interaction?.questions.filter((question) => question.open).map((q) => q.id),
    ).toEqual([])
  })
})

// The journey fixture is meant to represent a REAL workspace, and nothing
// resolved its manifest until this. Every other test here hands the compiler
// an explicit source list, which is why `patterns` being declared in the
// manifest and never passed to the compiler was invisible: the fixture failed
// YM419 on all four api instances through its own manifest while every test
// passed. The check that passes was not the check that mattered (#268).
describe('the fixture compiles through its own manifest', () => {
  it('resolves and checks clean, patterns included', () => {
    const root = fileURLToPath(
      new URL('./fixtures/journeys/contact-update/', import.meta.url),
    )
    const resolved = resolveCliWorkspaceSources(
      ['.yarramate/workspace.yaml'],
      root,
      { includeAdapterMappings: true },
    )
    expect(resolved.ok, JSON.stringify(resolved)).toBe(true)
    if (!resolved.ok) return

    // Declared AND handed over are two different things; only the first was
    // true.
    expect(resolved.patterns).toEqual(['.yarramate/patterns/api-led.yaml'])
    expect(resolved.paths).toContain('.yarramate/patterns/api-led.yaml')

    const compiled = compileWorkspaceWithProfileContext(
      resolved.paths.map((path) => ({
        path,
        source: readFileSync(join(root, path), 'utf8'),
      })),
    )
    expect(
      compiled.ok,
      compiled.ok
        ? ''
        : compiled.diagnostics
            .map(({ code, message }) => `${code} ${message}`)
            .join('; '),
    ).toBe(true)
  })
})
