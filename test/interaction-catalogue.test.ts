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

describe('core-enrichment 0.9 interaction wave', () => {
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
    expect(catalogue.version).toBe('0.9')
    const added = catalogue.questions.filter((question) => question.since === '0.9')
    expect(added.length).toBeGreaterThan(0)
    for (const question of added) {
      expect(question.askPlain?.trim().length, question.id).toBeGreaterThan(0)
    }
  })

  it('serves hop-unrealised before owner-missing on a component hop', () => {
    const result = runCli(
      ['design', 'workspace.yaml', '--subject', 'main#exp', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: { questionId: string; wave: string }
    }
    expect(payload.step.wave).toBe('interaction')
    expect(payload.step.questionId).toBe('hop-unrealised')
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
    expect(ids).toContain('hop-unrealised')
    expect(ids).not.toContain('authn-standard-missing')
    expect(ids).not.toContain('interaction-trust-unbound')
    expect(ids).not.toContain('interaction-protocol-unbound')
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
        ref: policy#rps
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
    expect(ids).toContain('interaction-trust-unbound')
    expect(ids).not.toContain('interaction-capacity-unbound')
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
        .find((question: { id: string }) => question.id === 'authn-standard-missing')
      expect(authn?.open).toBe(false)
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})
