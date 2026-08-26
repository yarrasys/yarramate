import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

// The 1.2 layer-presence questions (#272, ADR 0120). A subject-driven
// catalogue never asks about a layer with zero subjects, so the GitLab
// discovery closed its interview with the strategy, event, contract, and
// implementation layers silently absent: with nothing declared, nothing
// fired. These questions anchor on the workspace instead of a subject, so
// an absent layer is asked about rather than read as covered.

const bare = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: customer
    kind: businessActor
    name: Customer
  - id: order-api
    kind: applicationComponent
    name: Order API
relationships:
  - id: api-serves-customer
    kind: serving
    from: order-api
    to: customer
`

const manifest = (evidence: readonly string[]) =>
  `format: yarramate/workspace/v1
id: absent-layer-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence:${evidence.length === 0 ? ' []' : ''}
${evidence.map((path) => `  - ${path}`).join('\n')}
`

const openIds = (workspace: string): readonly string[] => {
  const result = runCli(['ask', 'workspace.yaml', '--open', '--json'], workspace)
  expect(result.exitCode, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
    .report.waves.flatMap(
      (wave: { questions: { id: string; open: boolean }[] }) => wave.questions,
    )
    .filter((question: { open: boolean }) => question.open)
    .map((question: { id: string }) => question.id)
}

describe('core-enrichment 1.2 asks about absent layers', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-absent-layer-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), bare, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest([]), 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('opens every absent front on a model with none of the layers', () => {
    const ids = openIds(workspace)
    expect(ids).toContain('no-capability-declared')
    expect(ids).toContain('no-event-declared')
    expect(ids).toContain('no-contract-declared')
    expect(ids).toContain('no-artifact-declared')
    expect(ids).toContain('implementation-path-missing')
  })

  it('closes a presence question the moment the layer has a subject', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: customer
    kind: businessActor
    name: Customer
  - id: order-api
    kind: applicationComponent
    name: Order API
  - id: sell-orders
    kind: capability
    name: Sell orders
    references:
      - id: spec
        ref: order-api
relationships:
  - id: api-serves-customer
    kind: serving
    from: order-api
    to: customer
`,
      'utf8',
    )
    const ids = openIds(workspace)
    expect(ids).not.toContain('no-capability-declared')
    // The citation question is satisfied by the reference; a capability
    // declared without one opens capability-uncited instead.
    expect(ids).not.toContain('capability-uncited')
  })

  it('asks a bare capability for its citation', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: sell-orders
    kind: capability
    name: Sell orders
relationships: []
`,
      'utf8',
    )
    const ids = openIds(workspace)
    expect(ids).toContain('capability-uncited')
  })

  it('keeps no-contract-declared quiet where nothing interacts', () => {
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-record
    kind: dataObject
    name: Order record
relationships: []
`,
      'utf8',
    )
    const ids = openIds(workspace)
    expect(ids).not.toContain('no-contract-declared')
  })
})

describe('evidence-unchallenged reads the evidence overlay (#272)', () => {
  let workspace: string

  const evidence = (observation: string) =>
    `format: yarramate/evidence/v1
id: repository
version: "1.0"
provider: repository-audit
observations:
${observation}`

  const confirmedOnly = `  - subject: order-api
    result: confirmed
    evidence:
      uri: repo:src/order-api.ts
`

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-unchallenged-'))
    mkdirSync(join(workspace, 'architecture'))
    mkdirSync(join(workspace, 'evidence'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), bare, 'utf8')
    writeFileSync(
      join(workspace, 'workspace.yaml'),
      manifest(['evidence/repository.yaml']),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'evidence/repository.yaml'),
      evidence(confirmedOnly),
      'utf8',
    )
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('opens where every observation is a frictionless confirmation', () => {
    expect(openIds(workspace)).toContain('evidence-unchallenged')
  })

  it('stays quiet where the workspace declares no evidence at all', () => {
    writeFileSync(join(workspace, 'workspace.yaml'), manifest([]), 'utf8')
    expect(openIds(workspace)).not.toContain('evidence-unchallenged')
  })

  it('closes on an honest non-confirmation', () => {
    writeFileSync(
      join(workspace, 'evidence/repository.yaml'),
      evidence(
        confirmedOnly +
          `  - subject: customer
    result: not-observed
    searched:
      - grep: Customer
        paths: ["src/"]
    evidence:
      uri: repo:docs/architecture.md
      message: Declared in the docs, absent from the tree.
`,
      ),
      'utf8',
    )
    expect(openIds(workspace)).not.toContain('evidence-unchallenged')
  })

  it('closes on a confirmed negative claim that records its empty search', () => {
    // ADR 0107 made an absence auditable by recording the search that
    // found nothing. A confirmation resting on such a search HAS tested a
    // claim it might fail — the search could have come back non-empty —
    // so it counts as diversity even though the result is confirmed.
    writeFileSync(
      join(workspace, 'evidence/repository.yaml'),
      evidence(
        `  - subject: order-api
    result: confirmed
    searched:
      - grep: "privileged-write"
        paths: ["src/"]
    evidence:
      uri: repo:src/order-api.ts
      message: The API declares no privileged write path; the search that would find one is empty.
`,
      ),
      'utf8',
    )
    expect(openIds(workspace)).not.toContain('evidence-unchallenged')
  })

  it('serves the question through design with its trigger attached', () => {
    // design was subject-blind to evidence before 1.2: the overlay now
    // rides into evaluation, so the interview and ask --open agree.
    const enriched = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: customer
    kind: businessActor
    name: Customer
relationships: []
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), enriched, 'utf8')
    const result = runCli(['design', 'workspace.yaml', '--json'], workspace)
    expect(result.exitCode, result.stderr).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      step: { questionId: string; trigger: readonly { condition: string }[] } | null
      progress: { open: number }
    }
    // The motivation wave outranks hygiene, so the top step is not the
    // evidence question; the report behind the progress count includes it.
    expect(payload.progress.open).toBeGreaterThan(0)
    const open = runCli(['ask', 'workspace.yaml', '--open', '--json'], workspace)
    const question = JSON.parse(open.stdout)
      .report.waves.flatMap((wave: { questions: { id: string }[] }) => wave.questions)
      .find((candidate: { id: string }) => candidate.id === 'evidence-unchallenged') as {
      open: boolean
      trigger: readonly { condition: string }[]
    }
    expect(question.open).toBe(true)
    expect(question.trigger).toEqual([{ condition: 'unchallenged-evidence' }])
  })
})
