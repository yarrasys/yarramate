import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import {
  composeCatalogues,
  evaluateCatalogue,
  qualifiedQuestionId,
} from '../src/interrogate-command.js'

/**
 * A workspace carries its own questions (#345, ADR 0129). Catalogues compose
 * as a RESOLVED SET, additive to the base, and a question id is qualified as
 * `catalogue#question` on the way out.
 */

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`

const domain = `format: yarramate/question-catalogue/v1
id: domain
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: assurance
    name: Assurance
questions:
  - id: shared-id
    wave: assurance
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#goal
    question: Domain phrasing?
    materiality: Domain materiality.
    resolution: Domain resolution.
    authority: human
`

/** Declares no wave of its own: it joins the one the domain catalogue declared. */
const project = `format: yarramate/question-catalogue/v1
id: project
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: engagement
    name: Engagement
questions:
  - id: shared-id
    wave: assurance
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#goal
    question: Project phrasing?
    materiality: Project materiality.
    resolution: Project resolution.
    authority: human
`

const sourceOf = (path: string, source: string) => ({ path, source })

describe('composing catalogues', () => {
  it('qualifies a question id with the catalogue that asked it', () => {
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('project.yaml', project),
    ])
    if (!composed.ok) throw new Error(JSON.stringify(composed.diagnostics))
    expect(composed.composed.catalogue.questions.map(({ id }) => id)).toEqual([
      'domain#shared-id',
      'project#shared-id',
    ])
  })

  it('accepts a catalogue that declares NO wave and only contributes', () => {
    // The ordinary shape of a project catalogue, and the schema forbade it
    // until this feature: `waves` had `minItems: 1`, so a catalogue wanting
    // only to add "one more Assurance question for this client" had to declare
    // a wave it did not want - which is then refused as a duplicate the moment
    // a second catalogue does the same. Found by a barrel test, not by design.
    const contributor = project
      .replace('waves:\n  - id: engagement\n    name: Engagement\n', 'waves: []\n')
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('contributor.yaml', contributor),
    ])
    if (!composed.ok) throw new Error(JSON.stringify(composed.diagnostics))
    expect(composed.composed.catalogue.waves.map(({ id }) => id)).toEqual(['assurance'])
    expect(composed.composed.catalogue.questions.map(({ id }) => id)).toEqual([
      'domain#shared-id',
      'project#shared-id',
    ])
  })

  it('still refuses a wave-less catalogue evaluated ALONE, since nothing declares it', () => {
    const contributor = project
      .replace('waves:\n  - id: engagement\n    name: Engagement\n', 'waves: []\n')
    const composed = composeCatalogues([sourceOf('contributor.yaml', contributor)])
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics[0]).toMatchObject({ code: 'YM911' })
  })

  it('lets a catalogue contribute to a wave it did not declare', () => {
    // The case the whole feature exists for: "one more Assurance question for
    // this client". Checking each file against only its own waves would have
    // refused exactly this with YM911.
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('project.yaml', project),
    ])
    if (!composed.ok) throw new Error(JSON.stringify(composed.diagnostics))
    const joined = composed.composed.catalogue.questions.find(
      ({ id }) => id === 'project#shared-id',
    )
    expect(joined?.wave).toBe('assurance')
  })

  it('keeps the base first, so its wave order is untouched and new waves append', () => {
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('project.yaml', project),
    ])
    if (!composed.ok) throw new Error(JSON.stringify(composed.diagnostics))
    expect(composed.composed.catalogue.waves.map(({ id }) => id)).toEqual([
      'assurance',
      'engagement',
    ])
    expect(composed.composed.catalogue.id).toBe('domain')
    expect(composed.composed.catalogues).toEqual(['domain@1.0', 'project@0.1'])
  })

  it('refuses a wave declared twice, naming who declared it first', () => {
    // Refused rather than merged: the two carry independent `opensWhen` gates
    // (ADR 0125) and silently picking one would decide when a wave opens by
    // file order.
    const rival = project.replace('id: engagement\n    name: Engagement', 'id: assurance\n    name: Rival Assurance')
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('rival.yaml', rival),
    ])
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics[0]).toMatchObject({
      code: 'YM915',
      path: 'rival.yaml',
    })
    expect(composed.diagnostics[0]?.message).toContain('domain')
  })

  it('still refuses a wave nothing in the set declares', () => {
    const orphan = project.replace('wave: assurance', 'wave: nowhere')
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('orphan.yaml', orphan),
    ])
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics[0]).toMatchObject({ code: 'YM911' })
  })

  it('carries no version in an id, so a catalogue bump strands nothing', () => {
    // The decision this design turns on. core-enrichment went 1.0 to 1.3 in a
    // single day renaming nothing; a versioned identity would have stranded
    // every stored dismissal three times that day.
    const bumped = project.replace('version: "0.1"', 'version: "9.9"')
    const before = composeCatalogues([sourceOf('d.yaml', domain), sourceOf('p.yaml', project)])
    const after = composeCatalogues([sourceOf('d.yaml', domain), sourceOf('p.yaml', bumped)])
    if (!before.ok || !after.ok) throw new Error('fixtures do not compose')
    expect(after.composed.catalogue.questions.map(({ id }) => id)).toEqual(
      before.composed.catalogue.questions.map(({ id }) => id),
    )
    // The version moved, and it moved where it belongs: beside the identity.
    expect(after.composed.catalogues).toEqual(['domain@1.0', 'project@9.9'])
    expect(qualifiedQuestionId('project', 'shared-id')).toBe('project#shared-id')
  })

  it('reports both same-named questions as distinct, rather than merging them', () => {
    const compiled = compileWorkspaceWithProfileContext([
      { path: 'main.yaml', source: document },
    ])
    if (!compiled.ok) throw new Error('fixture does not compile')
    const composed = composeCatalogues([
      sourceOf('domain.yaml', domain),
      sourceOf('project.yaml', project),
    ])
    if (!composed.ok) throw new Error('fixtures do not compose')
    const report = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      undefined,
      composed.composed.catalogues,
    )
    const assurance = report.waves.find(({ id }) => id === 'assurance')
    expect(assurance?.questions.map(({ id }) => id)).toEqual([
      'domain#shared-id',
      'project#shared-id',
    ])
    expect(report.catalogue).toBe('domain@1.0')
    expect(report.catalogues).toEqual(['domain@1.0', 'project@0.1'])
  })

  it('omits `catalogues` when only one contributed, so a lone report is unchanged', () => {
    const compiled = compileWorkspaceWithProfileContext([
      { path: 'main.yaml', source: document },
    ])
    if (!compiled.ok) throw new Error('fixture does not compile')
    const composed = composeCatalogues([sourceOf('domain.yaml', domain)])
    if (!composed.ok) throw new Error('fixture does not compose')
    const report = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      undefined,
      composed.composed.catalogues,
    )
    expect(report.catalogues).toBeUndefined()
    // But the id is qualified ANYWAY. Qualifying only when composed would mean
    // adding one project question silently re-identifies every question in the
    // base, stranding every dismissal keyed on them.
    expect(report.waves[0]?.questions[0]?.id).toBe('domain#shared-id')
  })
})

/**
 * A driver is one of seven core kinds ArchiMate 3.2 permits NOTHING to
 * realize, so "nothing realizes this driver" is a question no model could
 * ever close (ADR 0133). It reads perfectly and opens on every driver
 * forever.
 */
const unclosable = `format: yarramate/question-catalogue/v1
id: unclosable
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: motivation
    name: Motivation
questions:
  - id: driver-unrealized
    wave: motivation
    scope: subject
    subjects:
      kinds:
        - yarramate/core@0.1#driver
    trigger:
      - condition: missing-relationship
        kinds:
          - yarramate/core@0.1#realization
        direction: incoming
    question: What realizes {subject.name}?
    materiality: Unrealized drivers steer nothing.
    resolution: Add a realization.
    authority: human
`

/**
 * A closable question with ONE dead offer, which is the shape both defects in
 * the reporting consumer's catalogue had. Into an `applicationComponent`, the
 * table permits `realization` and `serving` from a `node`, and `assignment`
 * from none of the four counterpart kinds named. The question is answerable
 * two ways out of three, so it reads perfectly; a reader who takes the third
 * authors a relationship the compiler then refuses (they lost a 54-operation
 * batch to exactly that).
 */
const deadOffer = `format: yarramate/question-catalogue/v1
id: dead-offer
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: structure
    name: Structure
questions:
  - id: component-unhosted
    wave: structure
    scope: subject
    subjects:
      kinds:
        - yarramate/core@0.1#applicationComponent
    trigger:
      - condition: missing-linkage
        kinds:
          - yarramate/core@0.1#realization
          - yarramate/core@0.1#serving
          - yarramate/core@0.1#assignment
        direction: incoming
        counterpartKinds:
          - yarramate/core@0.1#node
          - yarramate/core@0.1#device
          - yarramate/core@0.1#systemSoftware
          - yarramate/core@0.1#technologyService
    question: What hosts {subject.name}?
    materiality: An unhosted component runs nowhere.
    resolution: Add a realization from the node.
    authority: agent
`

const profileContextOf = () => {
  const compiled = compileWorkspaceWithProfileContext([
    { path: 'main.yaml', source: document },
  ])
  if (!compiled.ok) throw new Error('fixture does not compile')
  return compiled.profileContext
}

describe('a question no model could close', () => {
  // Two call sites evaluate this, and an unthreaded one fails SILENTLY: the
  // catalogue composes clean and the question opens forever, which is exactly
  // the defect. One test per call site, therefore, not one per feature.
  it('refuses it while composing a set', () => {
    const composed = composeCatalogues(
      [sourceOf('domain.yaml', domain), sourceOf('unclosable.yaml', unclosable)],
      profileContextOf(),
    )
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics.map(({ code }) => code)).toEqual(['YM916'])
    const [diagnostic] = composed.diagnostics
    expect(diagnostic!.message).toContain('driver-unrealized')
    expect(diagnostic!.message).toContain('no model could author it')
    expect(diagnostic!.message).toContain('permits from no kind at all')
    // Located on the offending kind, not on the catalogue as a whole.
    expect(diagnostic!.path).toBe('unclosable.yaml')
    expect(diagnostic!.pointer).toBe('/questions/0/trigger/0/kinds/0')
  })

  it('refuses it when the catalogue stands alone', () => {
    const composed = composeCatalogues(
      [sourceOf('unclosable.yaml', unclosable)],
      profileContextOf(),
    )
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics.map(({ code }) => code)).toEqual(['YM916'])
  })

  it('says nothing without a profile context, as YM914 does not', () => {
    // No compiled workspace means no lineage to resolve an extension kind
    // through, and guessing is the false positive the narrowness avoids.
    expect(composeCatalogues([sourceOf('unclosable.yaml', unclosable)]).ok).toBe(
      true,
    )
  })

  it('leaves a triple the table permits alone', () => {
    // The check that decides whether this check survives. A goal CAN be
    // realized, so the same question shape on a goal is ordinary content and
    // must compose clean.
    const composed = composeCatalogues(
      [
        sourceOf(
          'closable.yaml',
          unclosable
            .replace('yarramate/core@0.1#driver', 'yarramate/core@0.1#goal')
            .replace('id: driver-unrealized', 'id: goal-unrealized'),
        ),
      ],
      profileContextOf(),
    )
    expect(composed.ok).toBe(true)
  })

  it('refuses a dead offer inside an otherwise answerable question', () => {
    // The unit is the OFFER, not the question. Two of the three kinds here are
    // authorable, so a question-level check would call this clean and leave
    // the third to be discovered by a reader whose write gets refused.
    const composed = composeCatalogues(
      [sourceOf('dead-offer.yaml', deadOffer)],
      profileContextOf(),
    )
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics.map(({ code }) => code)).toEqual(['YM916'])
    const [diagnostic] = composed.diagnostics
    expect(diagnostic!.message).toContain('"yarramate/core@0.1#assignment"')
    expect(diagnostic!.message).toContain('none of the counterpart kinds it names')
    // Located on the dead kind itself - the third of three - so an editor can
    // point at the offer rather than at the question.
    expect(diagnostic!.pointer).toBe('/questions/0/trigger/0/kinds/2')
  })

  it('leaves the same linkage alone once the dead offer is dropped', () => {
    // The no-false-positive half: `realization` and `serving` from those four
    // counterparts are permitted, so the question composes clean without
    // `assignment`.
    const composed = composeCatalogues(
      [
        sourceOf(
          'live-offer.yaml',
          deadOffer.replace('          - yarramate/core@0.1#assignment\n', ''),
        ),
      ],
      profileContextOf(),
    )
    expect(composed.ok).toBe(true)
  })

  it('reads the counterpart kinds, not only the relationship kind', () => {
    // The offer a wide check cannot see. `serving` INTO an applicationComponent
    // is permitted from 37 kinds, so asking "does the table allow this at all"
    // says yes; it is permitted from no motivation kind, so this particular
    // offer is dead. This is why `missing-linkage` is the MORE checkable
    // condition rather than the less, and it is the half a relationship-only
    // check misses entirely.
    const composed = composeCatalogues(
      [
        sourceOf(
          'motivation.yaml',
          deadOffer
            .replace('          - yarramate/core@0.1#realization\n', '')
            .replace('          - yarramate/core@0.1#assignment\n', '')
            .replace(
              '          - yarramate/core@0.1#node\n' +
                '          - yarramate/core@0.1#device\n' +
                '          - yarramate/core@0.1#systemSoftware\n' +
                '          - yarramate/core@0.1#technologyService\n',
              '          - yarramate/core@0.1#goal\n' +
                '          - yarramate/core@0.1#driver\n',
            ),
        ),
      ],
      profileContextOf(),
    )
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.diagnostics.map(({ code }) => code)).toEqual(['YM916'])
    expect(composed.diagnostics[0]!.message).toContain(
      '"yarramate/core@0.1#serving"',
    )
  })

  it('closes on either direction when the trigger says any', () => {
    // A driver may be the SOURCE of an association even though nothing may
    // associate into... in fact both directions are permitted for
    // association, so `any` must not fire. The rule is that `any` is
    // unclosable only when both directions are empty.
    const composed = composeCatalogues(
      [
        sourceOf(
          'any.yaml',
          unclosable
            .replace('yarramate/core@0.1#realization', 'yarramate/core@0.1#association')
            .replace('direction: incoming', 'direction: any'),
        ),
      ],
      profileContextOf(),
    )
    expect(composed.ok).toBe(true)
  })
})

describe('a workspace that carries its own questions', () => {
  let workspace = ''
  const write = (relative: string, source: string) =>
    writeFileSync(join(workspace, relative), source, 'utf8')

  /** A glob matching no files is YM702, as it is for every other category. */
  const manifest = (carriesQuestions: boolean) => `format: yarramate/workspace/v1
id: engagement
documents:
  - architecture/*.yaml
profiles: []
projections: []
${carriesQuestions ? 'questions:\n  - questions/*.yaml\n' : ''}adapterMappings: []
evidence: []
`

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-questions-'))
    mkdirSync(join(workspace, '.yarramate/architecture'), { recursive: true })
    mkdirSync(join(workspace, '.yarramate/questions'), { recursive: true })
    write('.yarramate/workspace.yaml', manifest(false))
    write('.yarramate/architecture/main.yaml', document)
  })

  afterEach(() => rmSync(workspace, { recursive: true, force: true }))

  const engagementQuestion = `format: yarramate/question-catalogue/v1
id: engagement
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: engagement
    name: Engagement
questions:
  - id: regulator-signoff
    wave: engagement
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#goal
    question: Has the regulator signed off the retention rule?
    materiality: Cutover cannot proceed without it.
    resolution: Record the ruling.
    authority: human
`

  it('adds the workspace question to the shipped interview', () => {
    write('.yarramate/workspace.yaml', manifest(true))
    write('.yarramate/questions/engagement.yaml', engagementQuestion)
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { report } = JSON.parse(result.stdout) as {
      report: {
        catalogue: string
        catalogues?: string[]
        waves: { id: string; questions: { id: string }[] }[]
      }
    }
    // Additive: the shipped catalogue is still the base and still asks.
    expect(report.catalogue).toContain('core-enrichment@')
    expect(report.catalogues?.[1]).toBe('engagement@0.1')
    const engagement = report.waves.find(({ id }) => id === 'engagement')
    expect(engagement?.questions.map(({ id }) => id)).toEqual([
      'engagement#regulator-signoff',
    ])
  })

  it('refuses at check when a workspace catalogue is broken', () => {
    // A catalogue in the manifest is workspace content, and `check` refuses
    // broken workspace content.
    write('.yarramate/workspace.yaml', manifest(true))
    write('.yarramate/questions/engagement.yaml', 'format: yarramate/question-catalogue/v1\nid: broken\n')
    const result = runCli(['check', '.yarramate/workspace.yaml'], workspace)
    expect(result.exitCode).toBe(1)
  })

  it('behaves exactly as before when the workspace carries none', () => {
    const result = runCli(
      ['ask', '.yarramate/workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const { report } = JSON.parse(result.stdout) as {
      report: { catalogue: string; catalogues?: string[] }
    }
    expect(report.catalogues).toBeUndefined()
    expect(report.catalogue).toContain('core-enrichment@')
  })
})
