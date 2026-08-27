import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { parse } from 'yaml'
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
  - id: reviewer
    kind: stakeholder
    name: Reviewer
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
          recordedBy: agent-under-test
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
      deletedConcepts: 0,
      deletedRelationships: 0,
      addedObservations: 0,
      updatedObservations: 0,
      deletedObservations: 0,
      renamedConcepts: 0,
      renamedRelationships: 0,
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
    // The document YarraMate writes is read by things that are not YarraMate
    // (#378). Under a YAML 1.1 loader - PyYAML's default - a plain `on` key
    // is the boolean true and a plain date is a date, so the attestation an
    // author wrote comes back as `{True: date(2026, 8, 1)}` in anyone's audit
    // script. The written key must survive both loaders as the string it is.
    expect(written).toContain('"on": "2026-08-01"')
    expect(
      (parse(written, { version: '1.1' }) as {
        concepts: readonly {
          id: string
          attestations?: readonly Record<string, unknown>[]
        }[]
      }).concepts.find((concept) => concept.id === 'user')?.attestations,
    ).toEqual([
      {
        topic: 'adequacy',
        by: 'reviewer',
        recordedBy: 'agent-under-test',
        on: '2026-08-01',
      },
    ])

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

  it('refuses a name that is only whitespace', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
      name: "   "
`,
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
    expect(result.stdout).toContain(
      'Operations schema violation: must not be blank',
    )
    expect(result.stdout).toMatch(/^operations\.yaml:\d+:\d+ /)
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(before)
  })

  it('names an operation kind that does not exist, once', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: resurrect-concept
    document: architecture/main.yaml
    concept:
      id: user
      name: Person
`,
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
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(
      'Operations schema violation: unknown "op" value "resurrect-concept"',
    )
    expect(lines[0]).toMatch(/^operations\.yaml:\d+:\d+ /)
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

  it('deletes a concept and its referring relationship in one batch', () => {
    const authored = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: legacy-portal
    kind: applicationService
    name: Legacy portal
    status: retired
relationships:
  - id: portal-serves-user
    kind: serving
    from: legacy-portal
    to: user
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), authored, 'utf8')
    // The concept delete precedes the delete of the relationship that
    // references it: integrity is evaluated against the post-batch
    // state, so in-batch order does not matter.
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: legacy-portal
  - op: delete-relationship
    document: architecture/main.yaml
    relationship:
      id: portal-serves-user
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      applied: Record<string, number>
    }
    expect(payload.applied).toEqual({
      addedConcepts: 0,
      addedRelationships: 0,
      updatedConcepts: 0,
      updatedRelationships: 0,
      deletedConcepts: 1,
      deletedRelationships: 1,
      addedObservations: 0,
      updatedObservations: 0,
      deletedObservations: 0,
      renamedConcepts: 0,
      renamedRelationships: 0,
    })
    const validate = new Ajv2020({ allErrors: true }).compile(resultSchema)
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
    // Untouched bytes stay byte-identical; deleting the last item of a
    // collection leaves an explicit empty collection.
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`)
  })

  it('rejects deleting a concept that is still referenced, locating the operation', () => {
    const authored = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: legacy-portal
    kind: applicationService
    name: Legacy portal
relationships:
  - id: portal-serves-user
    kind: serving
    from: legacy-portal
    to: user
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), authored, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: user
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error YM912')
    expect(result.stdout).toContain(
      'deletes "user", which is still referenced by "portal-serves-user" (to)',
    )
    expect(result.stdout).toMatch(/^operations\.yaml:\d+:\d+ /)
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(authored)
  })

  it('rejects deletes referenced through owner, constraints, and identified references', () => {
    const authored = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: platform-team
    kind: businessActor
    name: Platform team
  - id: australia-only
    kind: constraint
    name: Australia only
  - id: user
    kind: businessActor
    name: User
  - id: checkout
    kind: applicationService
    name: Checkout
    owner: platform-team
    constraints:
      - id: residency
        ref: australia-only
    references:
      - id: served
        ref: checkout-serves-user
relationships:
  - id: checkout-serves-user
    kind: serving
    from: checkout
    to: user
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), authored, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: platform-team
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: australia-only
  - op: delete-relationship
    document: architecture/main.yaml
    relationship:
      id: checkout-serves-user
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(
      'deletes "platform-team", which is still referenced by "checkout" (owner)',
    )
    expect(result.stdout).toContain(
      'deletes "australia-only", which is still referenced by "checkout" (constraints)',
    )
    expect(result.stdout).toContain(
      'deletes "checkout-serves-user", which is still referenced by "checkout" (references)',
    )
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(authored)
  })

  it('deletes a flow-style item wholly, leaving neighbours byte-identical', () => {
    // Whole-item deletion is the intent here, unlike field removal
    // where a line-based delete on a flow item destroyed the item.
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
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: flow-item
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
      flow.replace(
        '  - { id: flow-item, kind: applicationService, name: Flow item }\n',
        '',
      ),
    )
  })

  it('rejects the whole batch when one delete violates integrity', () => {
    const authored = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: portal
    kind: applicationService
    name: Portal
relationships:
  - id: portal-serves-user
    kind: serving
    from: portal
    to: user
  - id: portal-notifies-user
    kind: serving
    from: portal
    to: user
`
    writeFileSync(join(workspace, 'architecture/main.yaml'), authored, 'utf8')
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: delete-relationship
    document: architecture/main.yaml
    relationship:
      id: portal-serves-user
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: user
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    // The remaining referrer is reported; the one deleted in the same
    // batch is not — integrity looks at the post-batch state even when
    // it rejects.
    expect(result.stdout).toContain(
      'deletes "user", which is still referenced by "portal-notifies-user" (to)',
    )
    expect(result.stdout).not.toContain('by "portal-serves-user"')
    // Atomicity: the valid relationship delete must not have landed.
    expect(
      readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
    ).toBe(authored)
  })

  it('locates a delete aimed at a subject that does not exist', () => {
    writeFileSync(
      join(workspace, 'operations.yaml'),
      `format: yarramate/operations/v1
operations:
  - op: delete-concept
    document: architecture/main.yaml
    concept:
      id: nobody
`,
      'utf8',
    )
    const result = runCli(
      ['apply', 'operations.yaml', 'workspace.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error YM912')
    expect(result.stdout).toContain('deletes "nobody", which does not exist')
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

  describe('observation operations', () => {
    const overlay = `format: yarramate/evidence/v1
id: repository-audit
version: "1.0"
provider: repository-audit
observations:
  - subject: user
    result: confirmed
    evidence:
      uri: repo:src/user.ts
  - subject: user
    key: role
    value: operator
    result: confirmed
    evidence:
      uri: repo:src/user.ts
      message: read off the role constant
`

    beforeEach(() => {
      mkdirSync(join(workspace, 'evidence'))
      writeFileSync(join(workspace, 'evidence/repository.yaml'), overlay, 'utf8')
      writeFileSync(
        join(workspace, 'workspace.yaml'),
        `format: yarramate/workspace/v1
id: apply-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence:
  - evidence/repository.yaml
`,
        'utf8',
      )
    })

    const apply = (operations: string) => {
      writeFileSync(join(workspace, 'operations.yaml'), operations, 'utf8')
      return runCli(
        ['apply', 'operations.yaml', 'workspace.yaml', '--json'],
        workspace,
      )
    }
    const overlayNow = () =>
      readFileSync(join(workspace, 'evidence/repository.yaml'), 'utf8')

    it('adds, updates and deletes overlay entries in one batch', () => {
      const result = apply(`format: yarramate/operations/v1
operations:
  - op: add-observation
    document: evidence/repository.yaml
    observation:
      subject: reviewer
      result: not-observed
      evidence:
        uri: repo:src/reviewer.ts
        message: no reviewer wiring found
  - op: update-observation
    document: evidence/repository.yaml
    observation:
      subject: user
      key: role
      value: administrator
      evidence:
        uri: repo:src/roles.ts
  - op: delete-observation
    document: evidence/repository.yaml
    observation:
      subject: user
`)
      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as {
        applied: Record<string, number>
        documents: readonly string[]
      }
      expect(
        new Ajv2020({ allErrors: true }).validate(resultSchema, payload),
      ).toBe(true)
      expect(payload.applied).toMatchObject({
        addedObservations: 1,
        updatedObservations: 1,
        deletedObservations: 1,
      })
      expect(payload.documents).toEqual(['evidence/repository.yaml'])
      const after = overlayNow()
      expect(after).toContain('subject: reviewer')
      expect(after).toContain('message: no reviewer wiring found')
      expect(after).toContain('value: administrator')
      expect(after).toContain('uri: repo:src/roles.ts')
      // The keyless entry is gone; the keyed one it shares a target with
      // survives, untouched apart from the fields the update named.
      expect(after).not.toContain('uri: repo:src/user.ts')
      expect(after).toContain('read off the role constant')
      expect(after).toContain('result: confirmed')
    })

    it('refuses an entry whose target the graph does not carry', () => {
      const result = apply(`format: yarramate/operations/v1
operations:
  - op: add-observation
    document: evidence/repository.yaml
    observation:
      subject: nobody
      result: confirmed
      evidence:
        uri: repo:src/nobody.ts
`)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('YM801')
      expect(overlayNow()).toBe(overlay)
    })

    it('keeps model documents and overlays apart', () => {
      const atModel = apply(`format: yarramate/operations/v1
operations:
  - op: add-observation
    document: architecture/main.yaml
    observation:
      subject: user
      result: confirmed
      evidence:
        uri: repo:src/user.ts
`)
      expect(atModel.exitCode).toBe(1)
      expect(atModel.stdout).toContain('not an evidence document')
      const atOverlay = apply(`format: yarramate/operations/v1
operations:
  - op: add-concept
    document: evidence/repository.yaml
    concept:
      id: intruder
      kind: applicationService
      name: Intruder
`)
      expect(atOverlay.exitCode).toBe(1)
      expect(atOverlay.stdout).toContain('not a document')
      expect(overlayNow()).toBe(overlay)
    })

    it('addresses a keyed entry apart from the keyless one', () => {
      const result = apply(`format: yarramate/operations/v1
operations:
  - op: update-observation
    document: evidence/repository.yaml
    observation:
      subject: user
      result: contradicted
`)
      expect(result.exitCode).toBe(0)
      const after = overlayNow()
      // The keyless entry took the change; the keyed entry kept its own
      // result rather than being swept up by the shared subject.
      expect(after).toContain('result: contradicted')
      expect(after.match(/result: confirmed/g)).toHaveLength(1)
    })

    it('refuses an update or delete of an entry that is not there', () => {
      const missing = apply(`format: yarramate/operations/v1
operations:
  - op: update-observation
    document: evidence/repository.yaml
    observation:
      subject: user
      key: absent
      value: nothing
`)
      expect(missing.exitCode).toBe(1)
      expect(missing.stdout).toContain('does not exist')
      const gone = apply(`format: yarramate/operations/v1
operations:
  - op: delete-observation
    document: evidence/repository.yaml
    observation:
      claim: never-claimed
`)
      expect(gone.exitCode).toBe(1)
      expect(gone.stdout).toContain('does not exist')
      expect(overlayNow()).toBe(overlay)
    })

    it('retracts an evidence message without touching the locator', () => {
      const result = apply(`format: yarramate/operations/v1
operations:
  - op: update-observation
    document: evidence/repository.yaml
    observation:
      subject: user
      key: role
    remove: [message]
`)
      expect(result.exitCode).toBe(0)
      const after = overlayNow()
      expect(after).not.toContain('read off the role constant')
      expect(after).toContain('uri: repo:src/user.ts')
    })

    it('writes nothing when a model edit rides with a bad observation', () => {
      const before = readFileSync(
        join(workspace, 'architecture/main.yaml'),
        'utf8',
      )
      const result = apply(`format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
      description: The person managing todo tasks.
  - op: add-observation
    document: evidence/repository.yaml
    observation:
      subject: user
      result: confirmed
      evidence:
        uri: repo:src/user.ts
`)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('already records')
      expect(
        readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8'),
      ).toBe(before)
      expect(overlayNow()).toBe(overlay)
    })
  })
})

// #215: a block scalar's YAML range ends *after* its terminating newline,
// unlike a plain scalar's. `apply` spliced that range wholesale, swallowing
// the line break and gluing the next field onto the value's line, so every
// `>-` and `|-` field refused with YM101 on a document `check` accepts.
describe('apply over block scalars (#215)', () => {
  let workspace: string

  const blockDocument = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  # This comment must survive a programmatic write.
  - id: folded
    kind: applicationComponent
    name: Folded
    description: >-
      A folded block scalar that wraps onto
      a second line.
    status: current
  - id: literal
    kind: applicationComponent
    name: Literal
    description: |-
      A literal block scalar.
      Its second line.
    status: current
relationships:
  - id: folded-flows
    kind: flow
    from: folded
    to: literal
    content: >-
      Flow content that is itself a folded
      block scalar.
`

  const blockManifest = `format: yarramate/workspace/v1
id: block-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

  const write = (name: string, body: string): void =>
    writeFileSync(join(workspace, name), body, 'utf8')

  const documentNow = (): string =>
    readFileSync(join(workspace, 'architecture/main.yaml'), 'utf8')

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-block-'))
    mkdirSync(join(workspace, 'architecture'))
    write('architecture/main.yaml', blockDocument)
    write('workspace.yaml', blockManifest)
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('replaces a folded description without swallowing the next field', () => {
    write(
      'operations.yaml',
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: folded
      description: Replaced.
`,
    )
    const result = runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)

    const now = documentNow()
    expect(now).toContain('    description: Replaced.\n    status: current\n')
    expect(runCli(['check', 'workspace.yaml'], workspace).exitCode).toBe(0)
  })

  it('replaces a literal description without swallowing the next field', () => {
    write(
      'operations.yaml',
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: literal
      description: Replaced too.
`,
    )
    const result = runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
    expect(documentNow()).toContain(
      '    description: Replaced too.\n    status: current\n',
    )
    expect(runCli(['check', 'workspace.yaml'], workspace).exitCode).toBe(0)
  })

  it("replaces a relationship's block-scalar content", () => {
    write(
      'operations.yaml',
      `format: yarramate/operations/v1
operations:
  - op: update-relationship
    document: architecture/main.yaml
    relationship:
      id: folded-flows
      content: A single line now.
`,
    )
    const result = runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
    expect(result.exitCode).toBe(0)
    expect(documentNow()).toContain('    content: A single line now.\n')
    expect(runCli(['check', 'workspace.yaml'], workspace).exitCode).toBe(0)
  })

  it('leaves untouched block scalars and comments exactly as authored', () => {
    write(
      'operations.yaml',
      `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: folded
      description: Only this one changes.
`,
    )
    expect(
      runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace).exitCode,
    ).toBe(0)

    const now = documentNow()
    expect(now).toContain('  # This comment must survive a programmatic write.')
    expect(now).toContain('    description: |-\n      A literal block scalar.\n')
    expect(now).toContain('    content: >-\n      Flow content that is itself a folded\n')
  })
})

// #216: an operation's `document:` was resolved only against the working
// directory, so the manifest-relative form every author writes was refused
// whenever the manifest did not sit in the working directory - which is the
// standard `.yarramate/` layout - and the same operations document applied
// from one directory and failed from another.
describe('apply document addressing (#216)', () => {
  let root: string

  const nested = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`

  const nestedManifest = `format: yarramate/workspace/v1
id: nested-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`

  const operationsNaming = (path: string): string =>
    `format: yarramate/operations/v1
operations:
  - op: update-concept
    document: ${path}
    concept:
      id: user
      description: Addressed from the repository root.
`

  beforeEach(() => {
    // The manifest lives under `.yarramate/`, as `init` produces and every
    // showcase uses, and commands run from the repository root above it.
    root = mkdtempSync(join(tmpdir(), 'yarramate-nested-'))
    mkdirSync(join(root, '.yarramate/architecture'), { recursive: true })
    writeFileSync(join(root, '.yarramate/architecture/main.yaml'), nested, 'utf8')
    writeFileSync(join(root, '.yarramate/workspace.yaml'), nestedManifest, 'utf8')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const applyNaming = (path: string) => {
    writeFileSync(join(root, 'operations.yaml'), operationsNaming(path), 'utf8')
    return runCli(
      ['apply', 'operations.yaml', '.yarramate/workspace.yaml'],
      root,
    )
  }

  const documentNow = (): string =>
    readFileSync(join(root, '.yarramate/architecture/main.yaml'), 'utf8')

  it('accepts the manifest-relative form from the repository root', () => {
    const result = applyNaming('architecture/main.yaml')
    expect(result.exitCode).toBe(0)
    expect(documentNow()).toContain('Addressed from the repository root.')
  })

  it('still accepts the working-directory-relative form', () => {
    const result = applyNaming('.yarramate/architecture/main.yaml')
    expect(result.exitCode).toBe(0)
    expect(documentNow()).toContain('Addressed from the repository root.')
  })

  it('names the documents it does accept when the address matches none', () => {
    const result = applyNaming('architecture/nowhere.yaml')
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('is not a document of workspace')
    expect(result.stdout).toContain('.yarramate/architecture/main.yaml')
  })
})
