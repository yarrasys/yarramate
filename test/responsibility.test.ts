import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas, type CanvasNode } from '../src/graph-projection.js'
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
import { edgeLabelText } from '../src/visual-app/elk-layout.js'
import { graphToElements } from '../src/visual-app/graph-canvas.js'
import { responsibilityFacts } from '../src/visual-app/subject-form.js'
import type { VisualRenderedModel } from '../src/adapters/visual/wire.js'
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
    ])
    expect(shippedProfileOf('yarramate/policy@0.2')?.extends).toBe('yarramate/policy@0.1')
    expect(shippedProfileOf('yarramate/policy@0.1')?.extends).toBe('yarramate/core@0.1')
    expect(shippedProfileOf('yarramate/policy@0.3')).toBeUndefined()
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
    expect(edgeLabelText(edge('r1'), 'layered', true)).toBe('is responsible for')
    expect(edgeLabelText(edge('r4'), 'served-by', true)).toBe('is responsible for')
    expect(edgeLabelText(edge('r1'), 'layered', false)).toBe('')
    expect(edgeLabelText(edge('s1'), 'served-by', true)).toBe('served by')
  })
  it('keeps responsibility edges off the canvas until the view asks', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const ids = (elements: ReturnType<typeof graphToElements>) =>
      elements.filter((el) => el.group === 'edges').map((el) => String(el.data.id))
    const hidden = ids(graphToElements(canvas, [], new Map(), { folded: new Set() }))
    expect(hidden.some((id) => id.endsWith('s1'))).toBe(true)
    expect(hidden.some((id) => id.endsWith('r1') || id.endsWith('r4'))).toBe(false)
    const shown = ids(graphToElements(canvas, [], new Map(), { folded: new Set(), showResponsibility: true }))
    expect(['r1', 'r2', 'r3', 'r4', 's1'].every((local) => shown.some((id) => id.endsWith(local)))).toBe(true)
  })
  it('reads the letters in the properties whether or not the canvas draws them', () => {
    const { graph, profileContext } = compileFixture()
    const canvas = projectGraphForCanvas(graph, profileContext)
    const model = { graph: canvas } as unknown as VisualRenderedModel
    const node = (local: string): CanvasNode => canvas.nodes.find((candidate) => candidate.localId === local)!
    const rows = (local: string) =>
      responsibilityFacts(node(local), model).filter(({ value }) => value !== '')
    expect(rows('portal')).toEqual([
      { label: 'Responsible', value: 'Project manager' },
      { label: 'Consulted', value: 'Vendor' },
      { label: 'Informed', value: 'Patron' },
    ])
    expect(rows('pm')).toEqual([{ label: 'Responsible for', value: 'Portal, API' }])
    expect(rows('catalogue')).toEqual([])
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
