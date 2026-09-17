import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { createFileSystemStore } from '../src/source-store.js'
import { resolveWorkspaceFrom, runTool } from '../src/tools-entry.js'
import {
  buildResponsibilityMatrix,
  renderResponsibilityMarkdown,
  type ResponsibilityMatrix,
} from '../src/responsibility.js'
import responsibilitySchema from '../schema/yarramate-responsibility.schema.json' with {
  type: 'json',
}
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import {
  EXTENSION_READING,
  readingKindOf,
  relationshipReading,
} from '../src/relationship-reading.js'
import {
  RESPONSIBILITY_KINDS,
  isPeopleKind,
  responsibilityLetterOf,
} from '../src/responsibility-kinds.js'
import { SHIPPED_PROFILES, shippedProfileOf } from '../src/shipped-profile.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/interrogation-entry.js'
import { SHIPPED_CATALOGUE_SOURCE } from '../src/shipped-catalogue.generated.js'

// A consulting profile that extends the shipped policy@0.2 and specialises
// `responsible` once, the way an adopter would.
const consultingProfile = `format: yarramate/profile/v1
id: acme/delivery
version: "1.0"
extends: yarramate/policy@0.2
conceptKinds: []
relationshipKinds:
  - id: delivery-lead
    name: Delivery lead
    parent: yarramate/policy@0.2#responsible
`

// Eight facts a project manager would write down: a PM responsible for the
// portal and (as delivery lead) for the API, a vendor consulted on the
// portal, a patron informed of it and served by it, an auditor with nothing,
// an API with an owner and nobody responsible, and one security attestation
// by the vendor.
const document = `format: yarramate/v1
id: main
profile: acme/delivery@1.0
concepts:
  - id: pm
    kind: businessRole
    name: Project manager
  - id: vendor
    kind: businessActor
    name: Vendor
  - id: patron
    kind: businessActor
    name: Patron
  - id: auditor
    kind: businessRole
    name: Auditor
  - id: portal
    kind: applicationComponent
    name: Portal
    owner: pm
    attestations:
      - topic: security
        by: vendor
        on: "2026-09-01"
  - id: api
    kind: applicationComponent
    name: API
    owner: pm
  - id: billing
    kind: applicationComponent
    name: Billing
    owner: pm
  - id: guest
    kind: businessActor
    name: Guest
  - id: catalogue
    kind: dataObject
    name: Catalogue
relationships:
  - id: r1
    kind: responsible
    from: pm
    to: portal
  - id: r2
    kind: consulted
    from: vendor
    to: portal
  - id: r3
    kind: informed
    from: patron
    to: portal
  - id: r4
    kind: delivery-lead
    from: pm
    to: api
  - id: s1
    kind: serving
    from: portal
    to: patron
  - id: s2
    kind: serving
    from: portal
    to: guest
`

const compileFixture = (extra: string = '') => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'profiles/acme.yaml', source: consultingProfile },
    { path: 'main.yaml', source: document + extra },
  ])
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ code, message }) => `${code} ${message}`).join('; '))
  }
  return result
}

const shippedCatalogue = () => {
  const loaded = loadQuestionCatalogue({ path: 'core-enrichment.yaml', source: SHIPPED_CATALOGUE_SOURCE })
  if (!loaded.ok) {
    throw new Error(`shipped catalogue did not load: ${loaded.diagnostics.map(({ code, message, pointer }) => `${code} ${pointer ?? ''} ${message}`).join('; ')}`)
  }
  return loaded.catalogue
}

const openSubjectsOf = (
  report: ReturnType<typeof evaluateCatalogue>,
  id: string,
): readonly string[] | undefined => {
  const question = report.waves.flatMap(({ questions }) => questions).find((q) => q.id === id)
  if (question === undefined) return undefined
  return question.open ? (question.subjects ?? []).map((s) => s.id) : []
}

describe('yarramate/policy@0.2 (#557, ADR 0159)', () => {
  it('ships beside 0.1, extends it, and carries the three kinds', () => {
    expect(SHIPPED_PROFILES.map(({ identity }) => identity)).toEqual([
      'yarramate/policy@0.1',
      'yarramate/policy@0.2',
      'yarramate/policy@0.3',
    ])
    expect(shippedProfileOf('yarramate/policy@0.2')?.extends).toBe('yarramate/policy@0.1')
    expect(shippedProfileOf('yarramate/policy@0.1')?.extends).toBe('yarramate/core@0.1')
    expect(shippedProfileOf('yarramate/policy@0.4')).toBeUndefined()
  })
  it('loads through an adopter profile and keeps every 0.1 identity', () => {
    const { profileContext } = compileFixture()
    const lineages = profileContext.relationshipKindLineages
    expect(lineages.get(RESPONSIBILITY_KINDS.responsible)).toEqual([
      'yarramate/core@0.1#association',
      RESPONSIBILITY_KINDS.responsible,
    ])
    expect(lineages.get('acme/delivery@1.0#delivery-lead')).toEqual([
      'yarramate/core@0.1#association',
      RESPONSIBILITY_KINDS.responsible,
      'acme/delivery@1.0#delivery-lead',
    ])
    // 0.1 rode in behind 0.2, so the constraint kinds resolve under their own identity.
    expect(profileContext.conceptKindLineages.has('yarramate/policy@0.1#authentication-constraint')).toBe(true)
  })
  it('loads when a document selects 0.2 directly, with 0.1 behind it', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'policy.yaml',
        source: `format: yarramate/v1
id: policy
profile: yarramate/policy@0.2
concepts:
  - id: oauth
    kind: authentication-constraint
    name: OAuth
  - id: ops
    kind: businessRole
    name: Operations
  - id: gateway
    kind: applicationComponent
    name: Gateway
relationships:
  - id: r1
    kind: responsible
    from: ops
    to: gateway
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profileContext.relationshipKindLineages.has(RESPONSIBILITY_KINDS.informed)).toBe(true)
    expect(result.profileContext.conceptKindLineages.has('yarramate/policy@0.1#authentication-constraint')).toBe(true)
  })
  it('refuses a responsibility edge whose source is not a person-capable aspect', () => {
    const result = compileWorkspaceWithProfileContext([
      { path: 'profiles/acme.yaml', source: consultingProfile },
      {
        path: 'main.yaml',
        source: document + `  - id: r5
    kind: responsible
    from: catalogue
    to: pm
`,
      },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some(({ message }) => message.includes('r5') || message.includes('responsible'))).toBe(true)
  })
})

describe('responsibility letters and readings', () => {
  it('reads the letter through the lineage and nothing else', () => {
    const { profileContext } = compileFixture()
    const lineage = (kind: string) => profileContext.relationshipKindLineages.get(kind)
    expect(responsibilityLetterOf(lineage(RESPONSIBILITY_KINDS.responsible), RESPONSIBILITY_KINDS.responsible)).toBe('R')
    expect(responsibilityLetterOf(lineage('acme/delivery@1.0#delivery-lead'), 'acme/delivery@1.0#delivery-lead')).toBe('R')
    expect(responsibilityLetterOf(lineage(RESPONSIBILITY_KINDS.consulted), RESPONSIBILITY_KINDS.consulted)).toBe('C')
    expect(responsibilityLetterOf(lineage(RESPONSIBILITY_KINDS.informed), RESPONSIBILITY_KINDS.informed)).toBe('I')
    expect(responsibilityLetterOf(lineage('yarramate/core@0.1#serving'), 'yarramate/core@0.1#serving')).toBeNull()
    expect(responsibilityLetterOf(undefined, 'yarramate/core@0.1#association')).toBeNull()
    expect(isPeopleKind(profileContext.conceptKindLineages.get('yarramate/core@0.1#businessRole'), 'yarramate/core@0.1#businessRole')).toBe(true)
    expect(isPeopleKind(undefined, 'yarramate/core@0.1#applicationComponent')).toBe(false)
  })
  it('speaks the three readings from the source, through the lineage', () => {
    expect(relationshipReading(RESPONSIBILITY_KINDS.responsible)).toBe('is responsible for')
    expect(relationshipReading(RESPONSIBILITY_KINDS.consulted)).toBe('is consulted on')
    expect(relationshipReading(RESPONSIBILITY_KINDS.informed)).toBe('is informed of')
    expect(relationshipReading('serving')).toBe('serves')
    expect(readingKindOf(['yarramate/core@0.1#association', RESPONSIBILITY_KINDS.responsible, 'acme/delivery@1.0#delivery-lead'], 'association')).toBe(RESPONSIBILITY_KINDS.responsible)
    expect(readingKindOf(['yarramate/core@0.1#serving'], 'serving')).toBe('serving')
    expect(readingKindOf(undefined, 'access')).toBe('access')
    expect(Object.keys(EXTENSION_READING)).toEqual(Object.values(RESPONSIBILITY_KINDS))
  })
  it('projects the letter and the reading onto canvas edges', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const edge = (id: string) => canvas.edges.find((candidate) => candidate.localId === id)!
    expect(edge('r1').responsibility).toBe('R')
    expect(edge('r2').responsibility).toBe('C')
    expect(edge('r3').responsibility).toBe('I')
    expect(edge('r4').responsibility).toBe('R')
    expect(edge('s1').responsibility).toBeNull()
    expect(edge('r1').readingKind).toBe(RESPONSIBILITY_KINDS.responsible)
    expect(edge('r4').readingKind).toBe(RESPONSIBILITY_KINDS.responsible)
    expect(edge('r4').coreKindLabel).toBe('association')
    expect(edge('s1').readingKind).toBe('serving')
  })
})

describe('responsible-missing and role-idle in the shipped catalogue', () => {
  it('open where the letters are missing, close where they are held, and never ask a served actor', () => {
    const { graph, profileContext } = compileFixture()
    const report = evaluateCatalogue(shippedCatalogue(), graph, profileContext)
    // Portal has r1 and the API has r4, a subkind of responsible; billing has an owner and nobody responsible.
    expect(openSubjectsOf(report, 'responsible-missing')).toEqual(['billing'])
    // The auditor holds nothing; the guest holds nothing either but is served, so is a consumer, not asked.
    expect(openSubjectsOf(report, 'role-idle')).toEqual(['auditor'])
  })
  it('close once the auditor takes responsibility for billing', () => {
    const { graph, profileContext } = compileFixture(`  - id: r6
    kind: responsible
    from: auditor
    to: billing
`)
    const report = evaluateCatalogue(shippedCatalogue(), graph, profileContext)
    expect(openSubjectsOf(report, 'role-idle')).toEqual([])
    expect(openSubjectsOf(report, 'responsible-missing')).toEqual([])
  })
  it('stay silent on a workspace that never adopted the vocabulary', () => {
    // Both questions name yarramate/policy@0.2 kinds, and a question is
    // applicable only where every kind it names belongs to a loaded profile
    // (`questionIsApplicable`), so a core-only workspace is never asked.
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: ops
    kind: businessRole
    name: Operations
  - id: gateway
    kind: applicationComponent
    name: Gateway
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = evaluateCatalogue(shippedCatalogue(), result.graph, result.profileContext)
    expect(openSubjectsOf(report, 'responsible-missing') ?? []).toEqual([])
    expect(openSubjectsOf(report, 'role-idle') ?? []).toEqual([])
  })
})

describe('the responsibility matrix (yarramate/responsibility/v1)', () => {
  const validate = () => {
    const Ajv2020 = Ajv2020Module.default
    return new Ajv2020({ allErrors: true }).compile(responsibilitySchema)
  }
  it('derives every letter with its source, the gaps and the idle people', () => {
    const { graph, profileContext } = compileFixture()
    const matrix = buildResponsibilityMatrix('fixture', graph, profileContext)
    expect(matrix.format).toBe('yarramate/responsibility/v1')
    expect(matrix.people.map(({ id }) => id)).toEqual(['auditor', 'guest', 'patron', 'pm', 'vendor'])
    expect(matrix.rows.map(({ subject }) => subject)).toEqual(['api', 'billing', 'catalogue', 'portal'])
    const portal = matrix.rows.find(({ subject }) => subject === 'portal')!
    expect(portal.cells.pm!.letters).toEqual(['A', 'R'])
    expect(portal.cells.pm!.sources.map(({ kind }) => kind)).toEqual(['owner', 'relationship'])
    expect(portal.cells.vendor!.letters).toEqual(['C'])
    expect(portal.cells.vendor!.sources).toEqual([
      expect.objectContaining({ kind: 'relationship', relationship: 'r2', relationshipKind: RESPONSIBILITY_KINDS.consulted }),
      expect.objectContaining({ kind: 'attestation', topic: 'security', on: '2026-09-01' }),
    ])
    expect(portal.cells.patron!.letters).toEqual(['I'])
    const api = matrix.rows.find(({ subject }) => subject === 'api')!
    expect(api.cells.pm!.letters).toEqual(['A', 'R'])
    expect(api.cells.pm!.sources[1]).toMatchObject({ kind: 'relationship', relationship: 'r4', relationshipKind: 'acme/delivery@1.0#delivery-lead' })
    expect(matrix.rows.find(({ subject }) => subject === 'billing')!.cells).toEqual({
      pm: { letters: ['A'], sources: [{ kind: 'owner', source: { path: 'main.yaml', line: expect.any(Number) } }] },
    })
    expect(matrix.rows.find(({ subject }) => subject === 'catalogue')!.cells).toEqual({})
    expect(matrix.gaps).toEqual({ noAccountable: ['catalogue'], noResponsible: ['billing', 'catalogue'] })
    expect(matrix.idle).toEqual([
      { id: 'auditor', name: 'Auditor', kind: 'yarramate/core@0.1#businessRole', served: false },
      { id: 'guest', name: 'Guest', kind: 'yarramate/core@0.1#businessActor', served: true },
    ])
    expect(matrix.people.find(({ id }) => id === 'patron')?.served).toBe(true)
    expect(matrix.summary).toEqual({ rows: 4, people: 5, cells: 5, noAccountable: 1, noResponsible: 2, idle: 2 })
    expect(validate()(matrix)).toBe(true)
    expect(JSON.stringify(buildResponsibilityMatrix('fixture', graph, profileContext))).toBe(JSON.stringify(matrix))
  })
  it('takes its rows from the caller, dropping people and strangers, and names the projection', () => {
    const { graph, profileContext } = compileFixture()
    const matrix = buildResponsibilityMatrix('fixture', graph, profileContext, {
      rows: ['portal', 'pm', 'nowhere'],
      projection: 'delivery@1.0',
    })
    expect(matrix.projection).toBe('delivery@1.0')
    expect(matrix.rows.map(({ subject }) => subject)).toEqual(['portal'])
    expect(matrix.idle.map(({ id }) => id)).toEqual(['auditor', 'guest'])
    expect(matrix.summary.idle).toBe(2)
    expect(validate()(matrix)).toBe(true)
  })
  it('marks a consulted-by-attestation cell apart and counts it toward no gap', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/policy@0.2
concepts:
  - id: sec
    kind: businessRole
    name: IT Security
  - id: gateway
    kind: applicationComponent
    name: Gateway
    attestations:
      - topic: security
        by: sec
        on: "2026-08-30"
relationships: []
`,
      },
    ])
    if (!result.ok) throw new Error('fixture')
    const matrix = buildResponsibilityMatrix('fixture', result.graph, result.profileContext)
    expect(matrix.rows[0]!.cells.sec).toEqual({
      letters: ['C'],
      sources: [{ kind: 'attestation', topic: 'security', on: '2026-08-30', source: { path: 'main.yaml', line: expect.any(Number) } }],
    })
    expect(matrix.gaps).toEqual({ noAccountable: ['gateway'], noResponsible: ['gateway'] })
    expect(matrix.idle).toEqual([])
    const markdown = renderResponsibilityMarkdown(matrix)
    expect(markdown).toContain('| Gateway (`gateway`) | applicationComponent | C* |')
    expect(markdown).toContain('consulted by attestation')
    expect(validate()(matrix)).toBe(true)
  })
  it('renders one table a person reads, in id order, with the gaps and the idle under it', () => {
    const { graph, profileContext } = compileFixture()
    const markdown = renderResponsibilityMarkdown(buildResponsibilityMatrix('fixture', graph, profileContext))
    expect(markdown).toContain('| Subject | Kind | Auditor | Guest | Patron | Project manager | Vendor |')
    expect(markdown).toContain('| Portal (`portal`) | applicationComponent |  |  | I | A R | C |')
    expect(markdown).toContain('| Billing (`billing`) | applicationComponent |  |  |  | A |  |')
    expect(markdown).toContain('- No accountable: `catalogue`')
    expect(markdown).toContain('- No responsible: `billing`, `catalogue`')
    expect(markdown).toContain('- Auditor (`auditor`)\n- Guest (`guest`), served')
    expect(markdown).not.toContain('consulted by attestation')
  })
})

describe('export responsibility, on the CLI and as a tool', () => {
  const manifest = `format: yarramate/workspace/v1
id: raci-fixture
documents:
  - main.yaml
profiles:
  - profiles/acme.yaml
projections:
  - solution.yaml
adapterMappings: []
evidence: []
`
  const projection = `format: yarramate/projection/v1
id: solution
version: "1.0"
query:
  kinds:
    - yarramate/core@0.1#applicationComponent
presentation:
  title: Solution
`
  let workspace = ''
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-raci-'))
    mkdirSync(join(workspace, 'profiles'))
    writeFileSync(join(workspace, 'profiles/acme.yaml'), consultingProfile, 'utf8')
    writeFileSync(join(workspace, 'main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'solution.yaml'), projection, 'utf8')
  })
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })
  it('writes RESPONSIBILITY.md and responsibility.json under --out, and refuses without it', () => {
    const bare = runCli(['export', 'responsibility', 'solution.yaml', 'workspace.yaml'], workspace)
    expect(bare.exitCode).toBe(2)
    expect(bare.stderr).toContain('yarramate export responsibility <projection.yaml> <workspace.yaml> --out <directory>')
    const result = runCli(['export', 'responsibility', 'solution.yaml', 'workspace.yaml', '--out', 'out'], workspace)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Wrote RESPONSIBILITY.md and responsibility.json (3 rows, 1 gap) to out\n')
    const matrix = JSON.parse(readFileSync(join(workspace, 'out/responsibility.json'), 'utf8')) as ResponsibilityMatrix
    expect(matrix.projection).toBe('solution@1.0')
    expect(matrix.rows.map(({ subject }) => subject)).toEqual(['api', 'billing', 'portal'])
    expect(matrix.gaps).toEqual({ noAccountable: [], noResponsible: ['billing'] })
    expect(readFileSync(join(workspace, 'out/RESPONSIBILITY.md'), 'utf8')).toContain('projection `solution@1.0`')
  })
  it('answers yarramate_export responsibility with the markdown and names what it needs', () => {
    const store = createFileSystemStore(workspace)
    const resolved = resolveWorkspaceFrom(
      { path: 'workspace.yaml', source: store.read('workspace.yaml')!.source },
      store.list!(),
    )
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
    const tool = { store, workspace: resolved.workspace }
    const answered = runTool('yarramate_export', { kind: 'responsibility', projection: 'solution.yaml' }, tool)
    expect(answered.text).toContain('# Responsibility matrix')
    expect(answered.ok).toBe(true)
    expect((answered.result as { matrix: ResponsibilityMatrix }).matrix.summary.rows).toBe(3)
    expect(runTool('yarramate_export', { kind: 'responsibility' }, tool).text).toBe(
      'yarramate_export responsibility needs `projection`: the view whose subjects are the rows.\n',
    )
  })
})
