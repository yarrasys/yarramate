import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import {
  CORE_CONCEPT_KIND_ORDER,
  type CoreConceptKindId,
} from '../src/archimate-relationships.generated.js'
import {
  sourceKindsPermitting,
  targetKindsPermitting,
} from '../src/relationship-matrix.js'
import type { RelationshipKind } from '../src/profile.js'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const cataloguePath = join(repositoryRoot, 'catalogues/core-enrichment.yaml')

const unenriched = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: exp
    kind: applicationComponent
    name: Experience API
    status: planned
  - id: sys
    kind: applicationComponent
    name: System API
    status: planned
relationships:
  - id: exp-serves-sys
    kind: serving
    from: exp
    to: sys
`

const unenrichedManifest = `format: yarramate/workspace/v1
id: hop-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

// A `missing-relationship` trigger asks its reader to add a relationship. If
// the ArchiMate table permits no counterpart for the (subject kind,
// relationship kind, direction) triple the trigger names, no legitimate model
// can close it: the question reports a gap the standard forbids filling, and
// it stays open forever while reading as the model's fault rather than the
// catalogue's.
//
// Nothing else catches this. YM914 already refuses a question whose kind no
// loaded profile declares, so a question that can never FIRE is a check error;
// a question that can never be CLOSED is invisible to every gate, because an
// open question is exactly what an unenriched model looks like. The check here
// is derived from the same generated table the compiler admits relationships
// against, so the catalogue cannot drift away from it.
//
// Field evidence for the shape: an ApertureX session retired a finding of this
// exact kind on 2026-08-28. It fired on `driver`, one of the seven core kinds
// ArchiMate 3.2 permits nothing to realize, and it had drifted from their own
// catalogue within a day of that fact being written down in two places.
interface RelationshipTrigger {
  readonly condition: string
  readonly kinds?: readonly string[]
  readonly direction?: string
}

interface CatalogueQuestion {
  readonly id: string
  readonly subjects?: { readonly kinds?: readonly string[] }
  readonly trigger?: readonly RelationshipTrigger[]
}

const localKind = (qualified: string): string => qualified.split('#').at(-1) ?? qualified

const unclosableTriples = (
  questions: readonly CatalogueQuestion[],
): readonly string[] => {
  const coreKinds = new Set<string>(CORE_CONCEPT_KIND_ORDER)
  const unclosable: string[] = []
  for (const question of questions) {
    for (const trigger of question.trigger ?? []) {
      if (trigger.condition !== 'missing-relationship') continue
      // `any` closes if either direction admits a counterpart.
      const directions =
        trigger.direction === 'any' ? ['incoming', 'outgoing'] : [trigger.direction]
      for (const subject of (question.subjects?.kinds ?? []).map(localKind)) {
        // An extension kind inherits its core ancestor's row, so a subject
        // kind outside the core table is not a catalogue defect - it is a
        // lookup this check cannot make, and it says so by skipping.
        if (!coreKinds.has(subject)) continue
        for (const relationship of (trigger.kinds ?? []).map(localKind)) {
          const closable = directions.some((direction) =>
            (direction === 'incoming'
              ? sourceKindsPermitting(
                  relationship as RelationshipKind,
                  subject as CoreConceptKindId,
                )
              : targetKindsPermitting(
                  relationship as RelationshipKind,
                  subject as CoreConceptKindId,
                )
            ).size > 0,
          )
          if (!closable) {
            unclosable.push(
              `${question.id}: nothing may hold ${relationship} ` +
                `${trigger.direction} ${subject}`,
            )
          }
        }
      }
    }
  }
  return unclosable
}

describe('a catalogue question against the ArchiMate relationship table', () => {
  it('asks nothing of the shipped catalogue that no model could answer', () => {
    const catalogue = parseYaml(readFileSync(cataloguePath, 'utf8')) as {
      questions: readonly CatalogueQuestion[]
    }
    expect(unclosableTriples(catalogue.questions)).toEqual([])
  })

  it('names the question when a triple has no permitted counterpart', () => {
    // The bug this guards, in the shape ApertureX shipped it: a driver is one
    // of seven core kinds nothing may realize, so "nothing realizes this
    // driver" is a gap no author can close. Without the negative case the
    // assertion above passes just as well against a check that finds nothing.
    expect(
      unclosableTriples([
        {
          id: 'driver-unrealized',
          subjects: { kinds: ['yarramate/core@0.1#driver'] },
          trigger: [
            {
              condition: 'missing-relationship',
              kinds: ['yarramate/core@0.1#realization'],
              direction: 'incoming',
            },
          ],
        },
      ]),
    ).toEqual(['driver-unrealized: nothing may hold realization incoming driver'])
  })

  it('agrees with the table on which kinds nothing may realize', () => {
    // Pinned so a regenerated table that changed this set is visible as a
    // change to this list rather than as a silently weakened check.
    expect(
      CORE_CONCEPT_KIND_ORDER.filter(
        (kind) => sourceKindsPermitting('realization', kind).size === 0,
      ),
    ).toEqual([
      'assessment',
      'driver',
      'gap',
      'implementationEvent',
      'meaning',
      'value',
      'workPackage',
    ])
  })
})

describe('core-enrichment 1.0 interaction wave', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-interaction-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), unenriched, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), unenrichedManifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('authors askPlain on every 0.9 question', () => {
    const catalogue = parseYaml(readFileSync(cataloguePath, 'utf8')) as {
      version: string
      questions: {
        since?: string
        askPlain?: string
        id: string
      }[]
    }
    expect(catalogue.version).toBe('1.3')
    const added = catalogue.questions.filter((question) => question.since === '0.9')
    expect(added.length).toBeGreaterThan(0)
    for (const question of added) {
      expect(question.askPlain?.trim().length, question.id).toBeGreaterThan(0)
    }
  })

  it('serves hop-unrealised before owner-missing on a component hop', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'exp', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: { questionId: string; wave: string }
    }
    expect(payload.step.wave).toBe('interaction')
    expect(payload.step.questionId).toBe('core-enrichment#hop-unrealised')
  })

  it('omits policy questions when yarramate/policy@0.1 is not selected', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const ids = JSON.parse(result.stdout)
      .report.waves.flatMap(
        (wave: { questions: { id: string }[] }) => wave.questions,
      )
      .map((question: { id: string }) => question.id)
    expect(ids).toContain('core-enrichment#hop-unrealised')
    expect(ids).not.toContain('core-enrichment#authn-standard-missing')
    expect(ids).not.toContain('core-enrichment#interaction-trust-unbound')
    expect(ids).not.toContain('core-enrichment#interaction-protocol-unbound')
  })

  it('keeps trust open when only a rate-limit constraint is bound', () => {
    writeFileSync(
      join(workspace, 'architecture/policy.yaml'),
      `format: yarramate/v1
id: policy
profile: yarramate/policy@0.1
concepts:
  - id: rps
    kind: rate-limit-constraint
    name: 100 rps
relationships: []
`,
      'utf8',
    )
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: accept
    kind: applicationProcess
    name: Accept
    status: planned
    constraints:
      - id: capacity
        ref: rps
  - id: user
    kind: businessActor
    name: User
relationships:
  - id: accept-serves-user
    kind: serving
    from: accept
    to: user
`,
      'utf8',
    )
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      `format: yarramate/workspace/v1
id: hop-fixture
documents:
  - architecture/main.yaml
  - architecture/policy.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      'utf8',
    )
    const result = runCli(
      ['ask', 'workspace.yaml', '--open', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const ids = JSON.parse(result.stdout)
      .report.waves.flatMap(
        (wave: { questions: { id: string; open: boolean }[] }) =>
          wave.questions,
      )
      .filter((question: { open: boolean }) => question.open)
      .map((question: { id: string }) => question.id)
    expect(ids).toContain('core-enrichment#interaction-trust-unbound')
    expect(ids).not.toContain('core-enrichment#interaction-capacity-unbound')
  })
})

describe('document-transfer against shipped catalogue 0.9', () => {
  const workspace =
    'test/fixtures/valid/document-transfer.workspace.yaml'

  it('selects yarramate/policy@0.1 with no profile file in the workspace', () => {
    const checked = runCli(['check', workspace, '--json'], repositoryRoot)
    expect(checked.exitCode).toBe(0)
  })

  it('has a quiet interaction wave on the reified hops', () => {
    const result = runCli(
      ['ask', workspace, '--open', '--json'],
      repositoryRoot,
    )
    expect(result.exitCode).toBe(0)
    const interaction = JSON.parse(result.stdout).report.waves.find(
      (wave: { id: string }) => wave.id === 'interaction',
    ) as { questions: { id: string; open: boolean }[] }
    expect(interaction).toBeDefined()
    const open = interaction.questions.filter((question) => question.open)
    expect(open.map((question) => question.id)).toEqual([])
  })

  it('closes authn-standard-missing on a descendant of authentication-constraint', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'yarramate-derived-authn-'))
    try {
      mkdirSync(join(workspaceDir, 'architecture'))
      mkdirSync(join(workspaceDir, 'profiles'))
      writeFileSync(
        join(workspaceDir, 'profiles/org.yaml'),
        `format: yarramate/profile/v1
id: example/org
version: "1.0"
extends: yarramate/policy@0.1
conceptKinds:
  - id: oauth-constraint
    name: OAuth constraint
    parent: yarramate/policy@0.1#authentication-constraint
relationshipKinds: []
`,
        'utf8',
      )
      writeFileSync(
        join(workspaceDir, 'architecture/main.yaml'),
        `format: yarramate/v1
id: main
profile: example/org@1.0
concepts:
  - id: oauth
    kind: oauth-constraint
    name: OAuth
  - id: left
    kind: applicationComponent
    name: Left
    status: planned
  - id: right
    kind: applicationComponent
    name: Right
    status: planned
relationships:
  - id: left-serves-right
    kind: serving
    from: left
    to: right
`,
        'utf8',
      )
      writeFileSync(
        join(workspaceDir, 'workspace.yaml'),
        `format: yarramate/workspace/v1
id: derived
documents:
  - architecture/main.yaml
profiles:
  - profiles/org.yaml
projections: []
adapterMappings: []
evidence: []
`,
        'utf8',
      )
      const result = runCli(
        ['ask', 'workspace.yaml', '--open', '--json'],
        workspaceDir,
      )
      expect(result.exitCode).toBe(0)
      const authn = JSON.parse(result.stdout)
        .report.waves.flatMap(
          (wave: { questions: { id: string; open: boolean }[] }) =>
            wave.questions,
        )
        .find((question: { id: string }) => question.id === 'core-enrichment#authn-standard-missing')
      expect(authn?.open).toBe(false)
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})
