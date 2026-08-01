import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const resultSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-apply-result.schema.json'),
    'utf8',
  ),
) as object

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`

const manifest = `format: yarramate/workspace/v1
id: apply-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

const batch = `format: yarramate/operations/v1
operations:
  - op: add-concept
    document: architecture/main.yaml
    concept:
      id: todo-service
      kind: applicationService
      name: Todo service
      status: planned
  - op: add-relationship
    document: architecture/main.yaml
    relationship:
      id: service-serves-user
      kind: serving
      from: todo-service
      to: user
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
      description: The person managing todo tasks.
      attestations:
        - topic: adequacy
          by: reviewer
          on: "2026-08-01"
`

describe('apply command', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-apply-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'operations.yaml'), batch, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('applies a batch atomically and reports a schema-valid result', () => {
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      format: string
      applied: Record<string, number>
      documents: readonly string[]
    }
    expect(payload.format).toBe('yarramate/apply-result/v1')
    expect(payload.applied).toEqual({
      addedConcepts: 1,
      addedRelationships: 1,
      updatedConcepts: 1,
      updatedRelationships: 0,
    })
    const validate = new Ajv2020({ allErrors: true }).compile(resultSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)

    const written = readFileSync(
      join(workspace, 'architecture/main.yaml'),
      'utf8',
    )
    expect(written).toContain('id: todo-service')
    expect(written).toContain('description: The person managing todo tasks.')
    expect(written).toContain('topic: adequacy')

    const check = runCli(['check', 'workspace.yaml'], workspace)
    expect(check.exitCode).toBe(0)
  })

  it('rejects the whole batch when any operation would not compile', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      batch.replace('      to: user\n', '      to: missing-target\n'),
      'utf8',
    )
    const before = readFileSync(
      join(workspace, 'architecture/main.yaml'),
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('YM')
    // Atomicity: the valid first operation must not have landed either.
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(before)
  })

  it('locates an update aimed at a subject that does not exist', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: nobody
      description: Ghost.
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error YM912')
    expect(result.stdout).toContain('"nobody", which does not exist')
    expect(result.stdout).toMatch(/^operations\.yaml:\d+:\d+ /)
  })

  it('rejects an operation aimed outside the workspace', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      batch.replaceAll('architecture/main.yaml', 'architecture/other.yaml'),
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error YM912')
    expect(result.stdout).toContain('not a document of workspace')
  })

  it('requires an explicit workspace manifest', () => {
    const result = runCli(
      ['apply', 'operations.yaml', 'architecture/main.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'apply requires an explicit workspace manifest',
    )
  })

  it('rejects unknown options with usage', () => {
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml', '--force'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })
  it('leaves untouched bytes byte-identical: folded scalars and comments survive', () => {
    // The #114 regression: a status update must not reflow prose the
    // batch never touched.
    const folded = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
# The commerce slice.
concepts:
  - id: catalogue
    kind: applicationService
    name: Catalogue
    description: >-
      Serves the product catalogue to every storefront;
      the authoritative price source, deliberately wrapped
      across three authored lines.
  - id: checkout
    kind: applicationService
    name: Checkout
relationships: []
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), folded, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: checkout
      status: planned
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const after = readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8')
    expect(after).toBe(
      folded.replace(
        '    name: Checkout\n',
        '    name: Checkout\n    status: planned\n',
      ),
    )
  })

  it('retracts a field with remove and restores the exact prior bytes', () => {
    const before = readFileSync(
      join(workspace, 'architecture/main.yaml'),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
      status: current
`,
      'utf8',
    )
    expect(
      runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
        .exitCode,
    ).toBe(0)
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(
      before.replace('    name: User\n', '    name: User\n    status: current\n'),
    )
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
    remove: [status]
`,
      'utf8',
    )
    const retracted = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(retracted.exitCode).toBe(0)
    // Assert -> retract restores the exact prior bytes: the whole loop
    // (apply sets, reconcile catches, apply removes) leaves no residue.
    const after = readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8')
    expect(after).toBe(before)
  })

  it('rejects removing a field that is not set, leaving files untouched', () => {
    const before = readFileSync(
      join(workspace, 'architecture/main.yaml'),
      'utf8',
    )
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
    remove: [owner]
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('removes "owner", which is not set')
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(before)
  })

  it('rejects an operation that both sets and removes one field', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: todo-service
      status: current
    remove: [status]
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('both sets and removes "status"')
  })

  it('rejects removing identity fields at the schema gate', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: todo-service
    remove: [kind]
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('YM201')
  })

  it('converts an empty flow collection when appending the first concept', () => {
    const empty = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts: []
relationships: []
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), empty, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: add-concept
    document: architecture/main.yaml
    concept:
      id: first
      kind: goal
      name: First goal
`,
      'utf8',
    )
    expect(
      runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
        .exitCode,
    ).toBe(0)
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: first
    kind: goal
    name: First goal
relationships: []
`)
  })
  it('rewrites a flow-style item as block when adding fields', () => {
    // Codex dogfood finding: block field lines spliced after a
    // `- { ... }` item corrupt the sequence.
    const flow = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - { id: flow-item, kind: applicationService, name: Flow item }
  - id: neighbour
    kind: businessActor
    name: Neighbour
relationships: []
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), flow, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: flow-item
      status: planned
      description: "Handles ingestion: parsing and storage."
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const after = readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8')
    expect(after).toContain(
      '  - id: flow-item\n' +
        '    kind: applicationService\n' +
        '    name: Flow item\n' +
        '    description: "Handles ingestion: parsing and storage."\n' +
        '    status: planned\n',
    )
    // The neighbouring block item and everything else stay byte-identical.
    expect(after).toContain('  - id: neighbour\n    kind: businessActor\n    name: Neighbour\n')
    expect(after.split('flow-item').length).toBe(2)
  })

  it('removing a field from a flow-style item never deletes the item', () => {
    const flow = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - { id: flow-item, kind: applicationService, name: Flow item, status: planned }
relationships: []
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), flow, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: flow-item
    remove: [status]
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const after = readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8')
    expect(after).toContain('id: flow-item')
    expect(after).toContain('name: Flow item')
    expect(after).not.toContain('status: planned')
  })
})
