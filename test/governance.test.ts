import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { createFileSystemStore } from '../src/source-store.js'
import {
  buildGovernanceLog,
  exportBriefs,
  GOVERNANCE_KINDS,
  governanceTypeOf,
  renderGovernanceMarkdown,
  resolveWorkspaceFrom,
  runTool,
  type GovernanceLog,
} from '../src/tools-entry.js'
import { RESPONSIBILITY_KINDS } from '../src/responsibility-kinds.js'
import { contextualReading } from '../src/relationship-reading.js'
import { SHIPPED_PROFILES } from '../src/shipped-profile.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/interrogation-entry.js'
import { SHIPPED_CATALOGUE_SOURCE } from '../src/shipped-catalogue.generated.js'
import governanceSchema from '../schema/yarramate-governance.schema.json' with {
  type: 'json',
}

// An adopter profile over policy@0.3 that specialises `risk` once.
const consultingProfile = `format: yarramate/profile/v1
id: acme/delivery
version: "2.0"
extends: yarramate/policy@0.3
conceptKinds:
  - id: delivery-risk
    name: Delivery risk
    parent: yarramate/policy@0.3#risk
relationshipKinds: []
`

// A small RAID log: two live risks (one a subkind), one retired risk, two
// assumptions, a mitigating work package and decision, a severity grouping,
// and review attestations on the ones that have been looked at.
const document = `format: yarramate/v1
id: main
profile: acme/delivery@2.0
concepts:
  - id: pm
    kind: businessRole
    name: Project manager
  - id: g1
    kind: goal
    name: Go live in Q4
  - id: req1
    kind: requirement
    name: Nightly reconciliation
  - id: c1
    kind: constraint
    name: Data stays onshore
  - id: wp1
    kind: workPackage
    name: Vendor onboarding
  - id: d1
    kind: courseOfAction
    name: Dual-source the feed
  - id: sev-high
    kind: grouping
    name: Severity high
  - id: r-vendor
    kind: risk
    name: Vendor slips
    status: current
    owner: pm
    supersedes:
      - r-old
    attestations:
      - topic: risk-reviewed
        by: pm
        on: "2026-09-01"
      - topic: risk-reviewed
        by: pm
        on: "2026-09-10"
  - id: r-data
    kind: delivery-risk
    name: Data residency breach
    status: current
  - id: r-old
    kind: risk
    name: Old risk
    status: retired
  - id: r-idea
    kind: risk
    name: Identified, not yet live
    status: planned
  - id: a-api
    kind: assumption
    name: The vendor API is stable
    status: current
    owner: pm
    attestations:
      - topic: assumption-confirmed
        by: pm
        on: "2026-08-30"
  - id: a-budget
    kind: assumption
    name: Budget holds
    status: planned
relationships:
  - id: e1
    kind: influence
    from: r-vendor
    to: g1
  - id: e2
    kind: influence
    from: wp1
    to: r-vendor
  - id: e3
    kind: association
    from: d1
    to: r-vendor
  - id: e4
    kind: association
    from: a-api
    to: req1
  - id: e5
    kind: influence
    from: r-data
    to: c1
  - id: e6
    kind: influence
    from: d1
    to: g1
  - id: e7
    kind: aggregation
    from: sev-high
    to: r-vendor
  - id: e8
    kind: influence
    from: r-idea
    to: g1
`

const compileFixture = () => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'profiles/acme.yaml', source: consultingProfile },
    { path: 'main.yaml', source: document },
  ])
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ code, message }) => `${code} ${message}`).join('; '))
  }
  return result
}

const validate = () => {
  const Ajv2020 = Ajv2020Module.default
  return new Ajv2020({ allErrors: true }).compile(governanceSchema)
}

const shippedCatalogue = () => {
  const loaded = loadQuestionCatalogue({ path: 'core-enrichment.yaml', source: SHIPPED_CATALOGUE_SOURCE })
  if (!loaded.ok) {
    throw new Error(loaded.diagnostics.map(({ code, message }) => `${code} ${message}`).join('; '))
  }
  return loaded.catalogue
}

const openSubjectsOf = (report: ReturnType<typeof evaluateCatalogue>, id: string): readonly string[] | undefined => {
  const question = report.waves.flatMap(({ questions }) => questions).find((q) => q.id === id)
  if (question === undefined) return undefined
  return question.open ? (question.subjects ?? []).map((s) => s.id) : []
}

describe('yarramate/policy@0.3 (#560, ADR 0160)', () => {
  it('ships beside 0.2 and 0.1, extends 0.2, and carries the two kinds', () => {
    expect(SHIPPED_PROFILES.map(({ identity }) => identity)).toEqual([
      'yarramate/policy@0.1',
      'yarramate/policy@0.2',
      'yarramate/policy@0.3',
    ])
    expect(SHIPPED_PROFILES[2]?.extends).toBe('yarramate/policy@0.2')
    const { profileContext } = compileFixture()
    expect(profileContext.conceptKindLineages.get(GOVERNANCE_KINDS.risk)).toEqual([
      'yarramate/core@0.1#assessment',
      GOVERNANCE_KINDS.risk,
    ])
    expect(profileContext.conceptKindLineages.get('acme/delivery@2.0#delivery-risk')).toEqual([
      'yarramate/core@0.1#assessment',
      GOVERNANCE_KINDS.risk,
      'acme/delivery@2.0#delivery-risk',
    ])
    // The whole chain rode in: 0.2's relationship kinds and 0.1's constraint kinds.
    expect(profileContext.relationshipKindLineages.has(RESPONSIBILITY_KINDS.responsible)).toBe(true)
    expect(profileContext.conceptKindLineages.has('yarramate/policy@0.1#authentication-constraint')).toBe(true)
    expect(governanceTypeOf(profileContext.conceptKindLineages.get('acme/delivery@2.0#delivery-risk'), 'acme/delivery@2.0#delivery-risk')).toBe('risk')
    expect(governanceTypeOf(profileContext.conceptKindLineages.get('yarramate/core@0.1#assessment'), 'yarramate/core@0.1#assessment')).toBeNull()
  })
})

describe('readings the endpoints decide', () => {
  it('resolve through the source and target lineages, source first', () => {
    const risk = ['yarramate/core@0.1#assessment', GOVERNANCE_KINDS.risk]
    const subRisk = [...risk, 'acme/delivery@2.0#delivery-risk']
    const goal = ['yarramate/core@0.1#goal']
    expect(contextualReading(risk, goal, 'influence')).toBe('threatens')
    expect(contextualReading(subRisk, goal, 'influence')).toBe('threatens')
    expect(contextualReading(goal, risk, 'influence')).toBe('mitigates')
    expect(contextualReading(risk, risk, 'influence')).toBe('threatens')
    expect(contextualReading(['yarramate/core@0.1#assessment', GOVERNANCE_KINDS.assumption], goal, 'association')).toBe('bears on')
    expect(contextualReading(goal, goal, 'influence')).toBeUndefined()
    expect(contextualReading(undefined, undefined, 'influence')).toBeUndefined()
    expect(contextualReading(risk, goal, 'association')).toBeUndefined()
  })
  it('ride on the canvas edges', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const reading = (id: string) => canvas.edges.find((edge) => edge.localId === id)!.reading
    expect(reading('e1')).toBe('threatens')
    expect(reading('e2')).toBe('mitigates')
    expect(reading('e3')).toBeUndefined()
    expect(reading('e4')).toBe('bears on')
    expect(reading('e5')).toBe('threatens')
    expect(reading('e6')).toBeUndefined()
    expect(reading('e7')).toBeUndefined()
  })
})

describe('the governance log (yarramate/governance/v1)', () => {
  it('derives every row with its edges, its latest review, its gaps and its groupings', () => {
    const { graph, profileContext } = compileFixture()
    const log = buildGovernanceLog('fixture', graph, profileContext)
    expect(log.format).toBe('yarramate/governance/v1')
    expect(log.rows.map(({ subject }) => subject)).toEqual(['a-api', 'a-budget', 'r-data', 'r-idea', 'r-old', 'r-vendor'])
    const row = (id: string) => log.rows.find(({ subject }) => subject === id)!
    expect(row('r-vendor')).toEqual({
      subject: 'r-vendor',
      name: 'Vendor slips',
      kind: GOVERNANCE_KINDS.risk,
      type: 'risk',
      status: 'current',
      owner: { id: 'pm', name: 'Project manager' },
      threatens: [{ id: 'g1', name: 'Go live in Q4' }],
      bearsOn: [],
      mitigatedBy: [
        { id: 'd1', name: 'Dual-source the feed' },
        { id: 'wp1', name: 'Vendor onboarding' },
      ],
      review: { topic: 'risk-reviewed', on: '2026-09-10', by: 'pm', source: { path: 'main.yaml', line: expect.any(Number) } },
      supersedes: ['r-old'],
      groupedBy: [{ id: 'sev-high', name: 'Severity high' }],
    })
    expect(row('r-data')).toMatchObject({
      kind: 'acme/delivery@2.0#delivery-risk',
      type: 'risk',
      owner: null,
      threatens: [{ id: 'c1', name: 'Data stays onshore' }],
      mitigatedBy: [],
      review: null,
      groupedBy: [],
    })
    expect(row('a-api')).toMatchObject({
      type: 'assumption',
      bearsOn: [{ id: 'req1', name: 'Nightly reconciliation' }],
      threatens: [],
      review: { topic: 'assumption-confirmed', on: '2026-08-30', by: 'pm' },
    })
    expect(row('a-budget')).toMatchObject({ type: 'assumption', status: 'planned', owner: null, bearsOn: [], review: null })
    // A planned risk is identified, not live: unowned and unreviewed, but not yet a mitigation gap.
    expect(log.gaps).toEqual({
      unowned: ['a-budget', 'r-data', 'r-idea', 'r-old'],
      unmitigated: ['r-data'],
      unconfirmed: ['a-budget'],
      unreviewed: ['r-data', 'r-idea', 'r-old'],
    })
    expect(log.summary).toEqual({ rows: 6, risks: 4, assumptions: 2, unowned: 4, unmitigated: 1, unconfirmed: 1, unreviewed: 3 })
    expect(validate()(log)).toBe(true)
    expect(JSON.stringify(buildGovernanceLog('fixture', graph, profileContext))).toBe(JSON.stringify(log))
  })
  it('takes its rows from the caller, dropping what is not a risk or an assumption', () => {
    const { graph, profileContext } = compileFixture()
    const log = buildGovernanceLog('fixture', graph, profileContext, { rows: ['r-vendor', 'g1', 'nowhere'] })
    expect(log.rows.map(({ subject }) => subject)).toEqual(['r-vendor'])
    expect(log.gaps).toEqual({ unowned: [], unmitigated: [], unconfirmed: [], unreviewed: [] })
    expect(validate()(log)).toBe(true)
  })
  it('renders one table with the gaps under it', () => {
    const { graph, profileContext } = compileFixture()
    const markdown = renderGovernanceMarkdown(buildGovernanceLog('fixture', graph, profileContext))
    expect(markdown).toContain('| Subject | Type | Status | Owner | Threatens / bears on | Mitigated by | Review | Grouped by |')
    expect(markdown).toContain(
      '| Vendor slips (`r-vendor`) | risk | current | Project manager | Go live in Q4 | Dual-source the feed, Vendor onboarding | risk-reviewed 2026-09-10 by pm | Severity high |',
    )
    expect(markdown).toContain('| Budget holds (`a-budget`) | assumption | planned |  |  |  |  |  |')
    expect(markdown).toContain('- Unmitigated (current risks): `r-data`')
    expect(markdown).toContain('- Unreviewed risks: `r-data`, `r-idea`, `r-old`')
  })
})

describe('the five governance questions in the shipped catalogue', () => {
  it('open where the log has gaps, on planned and current subjects only', () => {
    const { graph, profileContext } = compileFixture()
    const report = evaluateCatalogue(shippedCatalogue(), graph, profileContext)
    expect(openSubjectsOf(report, 'risk-threatens-nothing')).toEqual([])
    // Only a live risk is asked what mitigates it; the planned one is asked who owns it.
    expect(openSubjectsOf(report, 'risk-unmitigated')).toEqual(['r-data'])
    expect(openSubjectsOf(report, 'risk-unowned')).toEqual(['r-data', 'r-idea'])
    expect(openSubjectsOf(report, 'assumption-unconfirmed')).toEqual(['a-budget'])
    expect(openSubjectsOf(report, 'assumption-bears-on-nothing')).toEqual(['a-budget'])
  })
  it('stay silent on a workspace that never adopted the vocabulary', () => {
    const result = compileWorkspaceWithProfileContext([
      {
        path: 'main.yaml',
        source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: worry
    kind: assessment
    name: A plain assessment
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = evaluateCatalogue(shippedCatalogue(), result.graph, result.profileContext)
    for (const id of ['risk-threatens-nothing', 'risk-unmitigated', 'risk-unowned', 'assumption-unconfirmed', 'assumption-bears-on-nothing']) {
      expect(openSubjectsOf(report, id) ?? []).toEqual([])
    }
  })
})

describe('export governance, on the CLI, as a tool, and in a brief', () => {
  const manifest = `format: yarramate/workspace/v1
id: raid-fixture
documents:
  - main.yaml
profiles:
  - profiles/acme.yaml
projections:
  - risks.yaml
adapterMappings: []
evidence: []
`
  const projection = `format: yarramate/projection/v1
id: risks
version: "1.0"
query:
  subjects:
    - r-vendor
  relationships: connected
presentation:
  title: Risks
`
  let workspace = ''
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-raid-'))
    mkdirSync(join(workspace, 'profiles'))
    writeFileSync(join(workspace, 'profiles/acme.yaml'), consultingProfile, 'utf8')
    writeFileSync(join(workspace, 'main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'risks.yaml'), projection, 'utf8')
  })
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })
  it('writes GOVERNANCE.md and governance.json under --out, and refuses without it', () => {
    const bare = runCli(['export', 'governance', 'workspace.yaml'], workspace)
    expect(bare.exitCode).toBe(2)
    expect(bare.stderr).toContain('yarramate export governance <workspace.yaml> --out <directory>')
    const result = runCli(['export', 'governance', 'workspace.yaml', '--out', 'out'], workspace)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Wrote GOVERNANCE.md and governance.json (6 rows, 9 gaps) to out\n')
    const log = JSON.parse(readFileSync(join(workspace, 'out/governance.json'), 'utf8')) as GovernanceLog
    expect(log.summary.rows).toBe(6)
    expect(readFileSync(join(workspace, 'out/GOVERNANCE.md'), 'utf8')).toContain('# Governance log')
  })
  it('answers yarramate_export governance with the markdown, and a brief speaks the readings', () => {
    const store = createFileSystemStore(workspace)
    const resolved = resolveWorkspaceFrom(
      { path: 'workspace.yaml', source: store.read('workspace.yaml')!.source },
      store.list!(),
    )
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
    const tool = { store, workspace: resolved.workspace }
    const answered = runTool('yarramate_export', { kind: 'governance' }, tool)
    expect(answered.text).toContain('# Governance log')
    expect(answered.ok).toBe(true)
    expect((answered.result as { log: GovernanceLog }).log.summary.risks).toBe(4)
    const briefs = exportBriefs(tool, 'risks.yaml')
    if (!briefs.ok) throw new Error('briefs did not export')
    const brief = briefs.result.files.find(({ path }) => path.includes('r-vendor'))!
    expect(brief.markdown).toContain('threatens')
    expect(brief.markdown).not.toContain('Vendor slips influences')
  })
})
