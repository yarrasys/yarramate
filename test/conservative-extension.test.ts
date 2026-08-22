import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspace,
  compileWorkspaceWithProfileContext,
  evaluateProjection,
  type ProjectionDefinition,
  type WorkspaceSource,
} from '../src/index.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/interrogate-command.js'

// The two safety properties profile extension rests on (ADR 0079):
//
//   A vocabulary nobody selects changes nothing.
//   An extension document is never a worse neighbour than its core twin.
//
// The first is exactly testable through its degenerate case: a profile that
// no document selects adds no subjects, so "changes nothing" collapses to
// output identity. The fifth case covers what the naive phrasing gets wrong,
// where descendant matching legitimately widens an answer.
//
// The second has no degenerate case, so it is measured by control: the same
// arrival is run through an extension kind and through the nearest core kind
// it specializes, and the verdict changes about pre-existing subjects are
// compared. See the second describe block.

const coreOnly: WorkspaceSource = {
  path: 'architecture/core-only.yaml',
  source: `format: yarramate/v1
id: core-only
profile: yarramate/core@0.1
concepts:
  - id: checkout
    kind: applicationComponent
    name: Checkout
    status: current
  - id: settle
    kind: applicationService
    name: Settlement
    status: current
  - id: fast-settlement
    kind: goal
    name: Fast settlement
    status: current
relationships:
  - id: checkout-realizes-settle
    kind: realization
    from: checkout
    to: settle
    status: current
`,
}

// Unrelated in the strongest sense available: it specializes core kinds the
// core-only workspace uses, and no document selects it.
const unrelatedExtension: WorkspaceSource = {
  path: 'profiles/delivery.yaml',
  source: `format: yarramate/profile/v1
id: example/delivery
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds:
  - id: implements
    name: Implements
    parent: yarramate/core@0.1#realization
`,
}

const extensionDocument: WorkspaceSource = {
  path: 'architecture/delivery.yaml',
  source: `format: yarramate/v1
id: delivery
profile: example/delivery@1.0
concepts:
  - id: orders
    kind: microservice
    name: Orders
    status: current
  - id: dispatch
    kind: applicationService
    name: Dispatch
    status: current
relationships:
  - id: orders-implements-dispatch
    kind: implements
    from: orders
    to: dispatch
    status: current
`,
}

const componentsProjection: ProjectionDefinition = {
  format: 'yarramate/projection/v1',
  id: 'components',
  version: '1.0',
  query: {
    kinds: ['yarramate/core@0.1#applicationComponent'],
    kindMatching: 'descendants',
    relationships: 'connected',
  },
}

const catalogueSource: WorkspaceSource = {
  path: 'catalogues/core-enrichment.yaml',
  source: readFileSync(
    fileURLToPath(new URL('../catalogues/core-enrichment.yaml', import.meta.url)),
    'utf8',
  ),
}

const catalogue = (() => {
  const loaded = loadQuestionCatalogue(catalogueSource)
  if (!loaded.ok) throw new Error('the bundled catalogue must load')
  return loaded.catalogue
})()

describe('a profile extension is conservative over the workspace it joins', () => {
  it('changes no compiled graph for a workspace that instantiates only core kinds', () => {
    const without = compileWorkspace([coreOnly])
    const withExtension = compileWorkspace([unrelatedExtension, coreOnly])

    expect(withExtension.ok).toBe(true)
    expect(JSON.stringify(withExtension)).toBe(JSON.stringify(without))
  })

  it('changes no diagnostic, including the ones about core kinds it specializes', () => {
    const broken: WorkspaceSource = {
      path: 'architecture/broken.yaml',
      source: `format: yarramate/v1
id: broken
profile: yarramate/core@0.1
concepts:
  - id: settle
    kind: applicationService
    name: Settlement
  - id: fast
    kind: goal
    name: Fast
relationships:
  - id: settle-assigns-fast
    kind: assignment
    from: settle
    to: fast
`,
    }
    const without = compileWorkspace([broken])
    const withExtension = compileWorkspace([unrelatedExtension, broken])

    expect(without.ok).toBe(false)
    if (without.ok) return
    expect(without.diagnostics.map(({ code }) => code)).toEqual(['YM404'])
    // The YM404 message enumerates the relationship kinds that would have
    // worked. That list is the likeliest place for an extension to leak into
    // an answer about core, so the comparison below is load-bearing.
    expect(without.diagnostics[0]?.message).toContain('ArchiMate 3.2 permits:')
    expect(without.diagnostics[0]?.message).not.toContain('implements')
    expect(JSON.stringify(withExtension)).toBe(JSON.stringify(without))
  })

  it('changes no catalogue evaluation', () => {
    const without = compileWorkspaceWithProfileContext([coreOnly])
    const withExtension = compileWorkspaceWithProfileContext([
      unrelatedExtension,
      coreOnly,
    ])
    expect(without.ok && withExtension.ok).toBe(true)
    if (!without.ok || !withExtension.ok) return

    const report = evaluateCatalogue(
      catalogue,
      without.graph,
      without.profileContext,
    )
    const reportWithExtension = evaluateCatalogue(
      catalogue,
      withExtension.graph,
      withExtension.profileContext,
    )

    expect(report.summary.openQuestions).toBeGreaterThan(0)
    expect(JSON.stringify(reportWithExtension)).toBe(JSON.stringify(report))
  })

  it('changes no projection result, including one that opts into descendants', () => {
    const without = compileWorkspaceWithProfileContext([coreOnly])
    const withExtension = compileWorkspaceWithProfileContext([
      unrelatedExtension,
      coreOnly,
    ])
    expect(without.ok && withExtension.ok).toBe(true)
    if (!without.ok || !withExtension.ok) return

    const result = evaluateProjection(
      without.graph,
      componentsProjection,
      without.profileContext,
    )
    const resultWithExtension = evaluateProjection(
      withExtension.graph,
      componentsProjection,
      withExtension.profileContext,
    )

    expect(result.subjects.map(({ id }) => id)).toContain('core-only#checkout')
    expect(JSON.stringify(resultWithExtension)).toBe(JSON.stringify(result))
  })

  it('permits descendant matching to widen an answer, because the arrivals are subjects the extension introduced', () => {
    const without = compileWorkspaceWithProfileContext([coreOnly])
    const withExtension = compileWorkspaceWithProfileContext([
      unrelatedExtension,
      coreOnly,
      extensionDocument,
    ])
    expect(without.ok && withExtension.ok).toBe(true)
    if (!without.ok || !withExtension.ok) return

    const result = evaluateProjection(
      without.graph,
      componentsProjection,
      without.profileContext,
    )
    const widened = evaluateProjection(
      withExtension.graph,
      componentsProjection,
      withExtension.profileContext,
    )

    // The answer grows, and this is intended behaviour (ADR 0029), not a
    // breach: the arrivals are subjects the extension document introduced.
    const arrivals = widened.subjects
      .map(({ id }) => id)
      .filter((id) => !result.subjects.some((subject) => subject.id === id))
    expect(arrivals).toContain('delivery#orders')
    expect(arrivals.every((id) => id.startsWith('delivery#'))).toBe(true)

    // Nothing that was already in the answer left it, and every claim about a
    // subject that existed before is byte-identical.
    for (const subject of result.subjects) {
      expect(widened.subjects).toContainEqual(subject)
    }
    const preexisting = (claims: typeof result.claims) =>
      JSON.stringify(
        claims.filter(({ subject }) => subject.startsWith('core-only#')),
      )
    expect(preexisting(widened.claims)).toBe(preexisting(result.claims))
  })
})

// The second property (ADR 0079): an extension document is never a worse
// neighbour than its core twin - the same subjects declared under the nearest
// core ancestor of each kind. Adding any document changes what a
// workspace-scoped catalogue asks about the subjects already there, so parity
// is measured against the core twin rather than against the empty change.

const neighbourDocument: WorkspaceSource = {
  path: 'architecture/delivery.yaml',
  source: `format: yarramate/v1
id: delivery
profile: example/delivery@1.0
concepts:
  - id: orders
    kind: microservice
    name: Orders
    status: current
relationships:
  - id: orders-implements-fast
    kind: implements
    from: orders
    to: core-only#fast-settlement
    status: current
`,
}

const neighbourCoreTwin: WorkspaceSource = {
  path: 'architecture/delivery.yaml',
  source: `format: yarramate/v1
id: delivery
profile: yarramate/core@0.1
concepts:
  - id: orders
    kind: applicationComponent
    name: Orders
    status: current
relationships:
  - id: orders-implements-fast
    kind: realization
    from: orders
    to: core-only#fast-settlement
    status: current
`,
}

const openBySubject = (sources: readonly WorkspaceSource[]) => {
  const compiled = compileWorkspaceWithProfileContext([...sources])
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const report = evaluateCatalogue(
    catalogue,
    compiled.graph,
    compiled.profileContext,
  )
  const rows: string[] = []
  for (const wave of report.waves)
    for (const question of wave.questions)
      for (const subject of question.subjects ?? [])
        rows.push(`${subject.id} :: ${question.id}`)
  return rows.sort()
}

// Verdict changes about subjects that were already there, in both directions:
// questions that closed and questions that opened.
const changesAboutCoreOnly = (
  before: readonly string[],
  after: readonly string[],
) =>
  [
    ...before.filter((row) => !after.includes(row)).map((row) => `- ${row}`),
    ...after.filter((row) => !before.includes(row)).map((row) => `+ ${row}`),
  ]
    .filter((row) => row.includes('core-only#'))
    .sort()

describe('an extension document is never a worse neighbour than its core twin', () => {
  it('changes the same verdicts about pre-existing subjects as its core twin', () => {
    const without = openBySubject([coreOnly])
    const viaExtension = openBySubject([
      unrelatedExtension,
      coreOnly,
      neighbourDocument,
    ])
    const viaCoreTwin = openBySubject([coreOnly, neighbourCoreTwin])

    const byExtension = changesAboutCoreOnly(without, viaExtension)
    const byCoreTwin = changesAboutCoreOnly(without, viaCoreTwin)

    // Not vacuous: routing a document through an extension profile does move a
    // verdict about a subject that was already there. The realization resolves
    // the pre-existing goal's `goal-unrealized` question.
    expect(byExtension).toContain('- core-only#fast-settlement :: goal-unrealized')

    // Every change the extension route caused, the plain-core route caused too.
    for (const change of byExtension) expect(byCoreTwin).toContain(change)
  })

  it('leaves a near-duplicate question closed where its core twin opens one', () => {
    const base: WorkspaceSource = {
      path: 'architecture/nd-core.yaml',
      source: `format: yarramate/v1
id: nd-core
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    description: Fronts ordering.
    status: current
relationships: []
`,
    }
    const arrival = (profile: string, kind: string): WorkspaceSource => ({
      path: 'architecture/nd-arrival.yaml',
      source: `format: yarramate/v1
id: nd-arrival
profile: ${profile}
concepts:
  - id: orders-gateway
    kind: ${kind}
    name: Orders Gateway
    description: Handles ordering.
    status: current
relationships: []
`,
    })

    const nearDuplicates = (sources: readonly WorkspaceSource[]) =>
      openBySubject(sources).filter((row) =>
        row.endsWith(':: subjects-near-duplicate'),
      )

    // Near-duplicate detection buckets by exact kind (ADR 0077), so the
    // extension kind does not pair with the core kind it specializes.
    expect(
      nearDuplicates([
        unrelatedExtension,
        base,
        arrival('example/delivery@1.0', 'microservice'),
      ]),
    ).toEqual([])

    // The same arrival declared in plain core does pair, and the question it
    // opens is about the subject that was already there.
    expect(
      nearDuplicates([base, arrival('yarramate/core@0.1', 'applicationComponent')]),
    ).toContain('nd-core#order-gateway :: subjects-near-duplicate')
  })
})
