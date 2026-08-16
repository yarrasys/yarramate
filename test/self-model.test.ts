import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'
import { compareArchitectureStates } from '../src/architecture-state.js'
import { evaluateProjection, loadProjection } from '../src/projection.js'
import { prepareLikeC4Export } from '../src/adapters/likec4.js'
import { evaluateEvidenceWorkspace, loadEvidence } from '../src/evidence.js'
import { reconcileEvidenceReports } from '../src/reconciliation.js'

const model = (name: string) => ({
  path: `.yarramate/architecture/${name}.yaml`,
  source: readFileSync(
    fileURLToPath(new URL(`../.yarramate/architecture/${name}.yaml`, import.meta.url)),
    'utf8',
  ),
})

const developmentProfile = {
  path: '.yarramate/profiles/yarramate-development.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL(
        '../.yarramate/profiles/yarramate-development.yaml',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
}

const currentEngineProjection = {
  path: '.yarramate/projections/current-engine.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL('../.yarramate/projections/current-engine.yaml', import.meta.url),
    ),
    'utf8',
  ),
}

const stateFoundationProjection = {
  path: '.yarramate/projections/state-foundation.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL('../.yarramate/projections/state-foundation.yaml', import.meta.url),
    ),
    'utf8',
  ),
}

const coreContractProjection = {
  path: '.yarramate/projections/core-contract-foundation.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL(
        '../.yarramate/projections/core-contract-foundation.yaml',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
}

const repositorySource = (path: string) => ({
  path,
  source: readFileSync(
    fileURLToPath(new URL(`../${path}`, import.meta.url)),
    'utf8',
  ),
})

const selfModelSources = [
  developmentProfile,
  model('product'),
  model('engine'),
  model('repository'),
  model('evolution'),
]

describe('YarraMate repository model', () => {
  it('conforms through the native compiler and exposes core architecture claims', () => {
    const result = compileWorkspace(selfModelSources)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.some(
          ({ id }) =>
            id === 'yarramate-engine#compiler-delivers-compilation',
        ),
      ).toBe(true)
      expect(
        result.graph.claims.some(
          ({ id }) =>
            id ===
            'yarramate-repository#contract-realizes-tool-neutral-core',
        ),
      ).toBe(true)
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'yarramate-engine#compiler~kind',
        ),
      ).toMatchObject({
        object: {
          value: 'yarramate/development@1.0#compiler-module',
        },
      })
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'yarramate-engine#compiler~status',
        ),
      ).toMatchObject({
        object: { value: 'current' },
      })
      expect(
        result.graph.claims.find(
          ({ id }) =>
            id === 'yarramate-repository#compiler-source~kind',
        ),
      ).toMatchObject({
        object: {
          value: 'yarramate/development@1.0#repository-file',
        },
      })

      const loaded = loadProjection(currentEngineProjection)
      expect(loaded.ok).toBe(true)
      if (loaded.ok) {
        const context = evaluateProjection(result.graph, loaded.projection)
        expect(
          context.subjects.every(({ id }) =>
            id.startsWith('yarramate-engine#'),
          ),
        ).toBe(true)
        expect(context.subjects.length).toBeGreaterThan(0)
      }

      const stateProjection = loadProjection(stateFoundationProjection)
      expect(stateProjection.ok).toBe(true)
      if (stateProjection.ok) {
        const context = evaluateProjection(
          result.graph,
          stateProjection.projection,
        )
        expect(context.subjects).toContainEqual({
          id: 'yarramate-engine#architecture-state-engine',
          type: 'concept',
        })
        expect(
          context.subjects.some(({ id }) =>
            id.startsWith('yarramate-evolution#'),
          ),
        ).toBe(false)
      }

      const comparison = compareArchitectureStates(
        result.graph,
        'yarramate-evolution#native-foundation',
        'yarramate-evolution#state-foundation',
      )
      expect(comparison.ok).toBe(true)
      if (comparison.ok) {
        expect(comparison.comparison.added).toContainEqual({
          id: 'yarramate-engine#architecture-state-engine',
          type: 'concept',
        })
      }

      const coreContract = loadProjection(coreContractProjection)
      expect(coreContract.ok).toBe(true)
      if (coreContract.ok) {
        const context = evaluateProjection(
          result.graph,
          coreContract.projection,
        )
        expect(context.subjects).toContainEqual({
          id: 'yarramate-engine#core-contract-checker',
          type: 'concept',
        })
      }

      const contractComparison = compareArchitectureStates(
        result.graph,
        'yarramate-evolution#state-foundation',
        'yarramate-evolution#core-contract-foundation',
      )
      expect(contractComparison.ok).toBe(true)
      if (contractComparison.ok) {
        expect(contractComparison.comparison.added).toContainEqual({
          id: 'yarramate-engine#core-contract-checker',
          type: 'concept',
        })
      }
    }
  })

  it('models the recoverable visual conversation path', () => {
    const result = compileWorkspace(selfModelSources)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.graph.subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'yarramate-engine#visual-runtime' }),
        expect.objectContaining({
          id: 'yarramate-engine#visual-session-service',
        }),
        expect.objectContaining({ id: 'yarramate-engine#visual-browser' }),
        expect.objectContaining({
          id: 'yarramate-engine#visual-session-protocol',
        }),
        expect.objectContaining({ id: 'yarramate-engine#visual-handoff' }),
      ]),
    )

    const projection = loadProjection(
      repositorySource('.yarramate/projections/visual-conversation-path.yaml'),
    )
    expect(projection.ok).toBe(true)
    if (!projection.ok) return

    const rendered = evaluateProjection(result.graph, projection.projection)
    expect(rendered.subjects.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'yarramate-engine#visual-runtime',
        'yarramate-engine#visual-browser',
        'yarramate-engine#visual-session-protocol',
        'yarramate-engine#visual-handoff',
        'yarramate-product#agent-harness',
        'yarramate-repository#agent-skill-source',
      ]),
    )
  })

  it('leaves no current concept without an evidence observation', () => {
    const result = compileWorkspace(selfModelSources)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const overlay = loadEvidence(repositorySource('.yarramate/evidence/repository.yaml'))
    expect(overlay.ok).toBe(true)
    if (!overlay.ok) return

    const evaluation = evaluateEvidenceWorkspace(result.graph, [overlay.evidence])
    expect(evaluation.ok).toBe(true)
    if (!evaluation.ok) return

    // Attestation staleness is git-derived, so the reconcile command
    // supplies it and this dogfooding read deliberately does not: coverage
    // is a property of the model and its overlay alone, and asserting it
    // here keeps the honesty gate inside `pnpm test`.
    const report = reconcileEvidenceReports('yarramate', evaluation.reports, result.graph)

    expect(report.summary.subjectsWithoutEvidence).toBe(0)
    expect(report.unobservedSubjects).toBeUndefined()
    expect(report.summary.contradicted).toBe(0)
    expect(report.summary.notObserved).toBe(0)
  })

  it('keeps every modelled repository file in step with the working tree', () => {
    const result = compileWorkspace(selfModelSources)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const stated = (subject: string, predicate: string) => {
      const claim = result.graph.claims.find(
        (candidate) =>
          candidate.subject === subject && candidate.predicate === predicate,
      )
      return claim && 'value' in claim.object ? claim.object.value : undefined
    }

    const repositoryFiles = result.graph.claims.filter(
      (claim) =>
        claim.predicate === 'yarramate/concept/kind' &&
        'value' in claim.object &&
        claim.object.value === 'yarramate/development@1.0#repository-file',
    )

    expect(repositoryFiles.length).toBeGreaterThan(0)

    // A `repository-file` concept names a path in this repository, so the
    // model only stays honest while the path agrees with the status: a
    // `current` file must exist and a `retired` one must not. Deleting a
    // shipped file without retiring its concept - or retiring one that is
    // still on disk - is drift `yarramate check` cannot see, because Core
    // validates the graph, never the working tree.
    const drift = repositoryFiles.flatMap((claim) => {
      const name = stated(claim.subject, 'yarramate/concept/name')
      if (typeof name !== 'string') return []
      const present = existsSync(
        fileURLToPath(new URL(`../${name}`, import.meta.url)),
      )
      if (stated(claim.subject, 'yarramate/lifecycle/status') === 'retired') {
        return present ? [`retired but present: ${name}`] : []
      }
      return present ? [] : [`current but absent: ${name}`]
    })

    expect(drift).toEqual([])
  })

  it('renders its architecture-state change through the optional LikeC4 adapter', () => {
    const result = prepareLikeC4Export({
      sources: selfModelSources,
      projection: repositorySource(
        '.yarramate/projections/state-engine-change.yaml',
      ),
      subjectMapping: repositorySource(
        '.yarramate/integrations/likec4/subject-mapping.yaml',
      ),
      kindMapping: repositorySource(
        '.yarramate/integrations/likec4/kind-mapping.yaml',
      ),
      comparison: {
        from: 'yarramate-evolution#adapter-foundation',
        to: 'yarramate-evolution#state-foundation',
      },
      vocabulary: 'bundled',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toContain(
      `architectureStateEngine = applicationComponent 'Architecture state engine'`,
    )
    expect(result.source).toContain(`yarramateChange 'added'`)
    expect(result.source).toContain(
      `likec4ExportAdapter = applicationComponent 'LikeC4 export adapter'`,
    )
    expect(result.source).toContain(`yarramateChange 'retained'`)
  })
})
