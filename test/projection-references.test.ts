import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import {
  evaluateProjection,
  loadProjection,
  projectionReferenceDiagnostics,
  unmatchedSelectors,
} from '../src/projection.js'

/**
 * A projection query holds references the same way a relationship does, and
 * until #359 nothing checked them. The symptom is silent: a state that does
 * not exist selects no state, which selects no subject, which exports a clean
 * empty artifact and exits 0. Someone hands that to a client.
 */

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
states:
  - id: today
    kind: baseline
    name: Today
  - id: tomorrow
    kind: target
    name: Tomorrow
    after: today
concepts:
  - id: platform-team
    kind: businessActor
    name: Platform team
  - id: user
    kind: businessActor
    name: User
    owner: platform-team
    presentIn:
      - today
  - id: store
    kind: dataObject
    name: Store
    presentIn:
      - tomorrow
relationships: []
`

const compiled = () => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'main.yaml', source: document },
  ])
  if (!result.ok) throw new Error('fixture does not compile')
  return result
}

const queryOf = (query: Record<string, unknown>) => ({
  format: 'yarramate/projection/v1' as const,
  id: 'q',
  version: '1.0',
  query: query as never,
})

describe('a query that names something the model does not have', () => {
  it('reports the facet and the value, and suggests the near miss', () => {
    const { graph, profileContext } = compiled()
    const found = unmatchedSelectors(
      graph,
      queryOf({ states: ['tomorow'] }),
      profileContext,
    )
    expect(found).toEqual([
      { facet: 'states', value: 'tomorow', nearest: 'tomorrow' },
    ])
  })

  it('says nothing about a query whose every name resolves', () => {
    const { graph, profileContext } = compiled()
    expect(
      unmatchedSelectors(
        graph,
        queryOf({ states: ['tomorrow'], subjects: ['store'] }),
        profileContext,
      ),
    ).toEqual([])
  })

  /**
   * The distinction the whole check rests on. Nothing is broken about asking
   * for a state nobody has populated yet, and the honest answer is an empty
   * one. Refusing it would break a legitimate workflow to catch a typo.
   */
  it('does NOT report a query that resolves and simply selects nothing', () => {
    const { graph, profileContext } = compiled()
    // Every name is real and the intersection is genuinely EMPTY: `store` is
    // the only subject named and it is a dataObject, not a businessActor.
    // Asserted rather than assumed, because a fixture that quietly selects
    // something makes this test pass without ever reaching the branch it
    // exists to protect - which is how the first version of it was written.
    const projection = queryOf({
      subjects: ['store'],
      kinds: ['yarramate/core@0.1#businessActor'],
    })
    expect(
      evaluateProjection(graph, projection, profileContext).subjects,
    ).toEqual([])
    expect(unmatchedSelectors(graph, projection, profileContext)).toEqual([])
  })

  it('checks owners and constraints too, because both are refs to concepts', () => {
    const { graph, profileContext } = compiled()
    // Not free text: the compiler refuses an unresolved owner with YM304, so
    // the namespace is the subject list.
    expect(
      unmatchedSelectors(
        graph,
        queryOf({ owners: ['nobody-at-all'], constraints: ['no-such-constraint'] }),
        profileContext,
      ).map(({ facet }) => facet),
    ).toEqual(['owners', 'constraints'])
  })

  it('accepts an owner that exists but owns nothing yet', () => {
    const { graph, profileContext } = compiled()
    // The reason owners are checked against SUBJECTS rather than against
    // owners in use. `store` owns nothing; asking for what it owns is a real
    // question whose honest answer is nothing.
    expect(
      unmatchedSelectors(graph, queryOf({ owners: ['store'] }), profileContext),
    ).toEqual([])
  })

  it('leaves a status alone, since the schema already refused a bad one', () => {
    const { graph, profileContext } = compiled()
    expect(
      unmatchedSelectors(
        graph,
        queryOf({ statuses: ['current'], excludeStatuses: ['retired'] }),
        profileContext,
      ),
    ).toEqual([])
  })

  it('treats a kind as dormant when no profile is loaded, not as wrong', () => {
    const { graph } = compiled()
    // Same distinction #351 drew for question catalogues: without the profile
    // there is nothing to be absent FROM.
    expect(
      unmatchedSelectors(graph, queryOf({ kinds: ['made-up-kind'] })),
    ).toEqual([])
    expect(
      unmatchedSelectors(graph, queryOf({ kinds: ['made-up-kind'] }), compiled().profileContext),
    ).toHaveLength(1)
  })

  it('points at the line the value is on, so the diagnostic is clickable', () => {
    const { graph, profileContext } = compiled()
    const source = {
      path: 'q.yaml',
      source: `format: yarramate/projection/v1
id: q
version: "1.0"
query:
  states:
    - tomorow
`,
    }
    const loaded = loadProjection(source)
    if (!loaded.ok) throw new Error('fixture projection does not load')
    const [diagnostic] = projectionReferenceDiagnostics(
      source,
      loaded.projection,
      graph,
      profileContext,
    )
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'YM921',
      path: 'q.yaml',
      pointer: '/query/states',
      line: 6,
    })
    expect(diagnostic?.message).toContain('Did you mean "tomorrow"?')
  })
})

describe('check refuses the projection, not the export', () => {
  let workspace = ''

  const write = (relative: string, source: string): void => {
    writeFileSync(join(workspace, relative), source, 'utf8')
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-projection-refs-'))
    mkdirSync(join(workspace, '.yarramate/architecture'), { recursive: true })
    mkdirSync(join(workspace, '.yarramate/projections'), { recursive: true })
    write(
      '.yarramate/workspace.yaml',
      `format: yarramate/workspace/v1
id: refs
documents:
  - architecture/*.yaml
profiles: []
projections:
  - projections/*.yaml
adapterMappings: []
evidence: []
`,
    )
    write('.yarramate/architecture/main.yaml', document)
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  const projection = (query: string) =>
    `format: yarramate/projection/v1
id: slice
version: "1.0"
query:
${query}
presentation:
  title: Slice
`

  it('fails the check, so CI catches the typo before a client does', () => {
    write('.yarramate/projections/slice.yaml', projection('  states:\n    - tomorow'))
    const result = runCli(['check', '.yarramate/workspace.yaml'], workspace)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('YM921')
    expect(result.stdout).toContain('Did you mean "tomorrow"?')
  })

  const emptyButValid =
    '  subjects:\n    - store\n  kinds:\n    - yarramate/core@0.1#businessActor'

  it('passes a projection whose names resolve but which selects nothing', () => {
    // The legitimate empty. `store` exists and businessActor exists; the
    // intersection is empty, and that is a real answer to a real question.
    // Refusing it would break asking about a state nobody has populated yet.
    write('.yarramate/projections/slice.yaml', projection(emptyButValid))
    const result = runCli(['check', '.yarramate/workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
  })

  /**
   * The boundary the check has to respect. `docs/PROJECTIONS.md` records that
   * selectors are portable by default so a projection can be reused across
   * repositories and against partial models. Declaring one in the manifest is
   * the act that says "this is ours"; handing one to a verb as a path is not.
   */
  it('leaves a projection the manifest does not declare portable', () => {
    // A declared projection so the manifest glob still matches, plus the same
    // typo in a file that lives OUTSIDE `projections/*.yaml`.
    write('.yarramate/projections/slice.yaml', projection('  states:\n    - tomorrow'))
    writeFileSync(
      join(workspace, 'foreign.yaml'),
      projection('  states:\n    - tomorow'),
      'utf8',
    )
    expect(runCli(['check', '.yarramate/workspace.yaml'], workspace).exitCode).toBe(0)
    const exported = runCli(
      ['export', 'xlsx', 'foreign.yaml', '.yarramate/workspace.yaml', '--out', 'f.xlsx'],
      workspace,
    )
    // No matches rather than an error, which is what makes a projection
    // written for another repository usable here at all.
    expect(exported.exitCode).toBe(0)
  })

  it('still exports that empty slice without complaint', () => {
    write('.yarramate/projections/slice.yaml', projection(emptyButValid))
    const result = runCli(
      [
        'export',
        'xlsx',
        '.yarramate/projections/slice.yaml',
        '.yarramate/workspace.yaml',
        '--out',
        'slice.xlsx',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
  })
})
