import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyOperations,
  landOperations,
  posixDirectoryOf,
} from '../src/apply-command.js'
import { createFileSystemStore } from '../src/source-store.js'
import { loadWorkspaceManifest } from '../src/workspace.js'
import type { WorkspaceSource } from '../src/compiler.js'
import type { SourceStore } from '../src/source-store.js'

// Coverage for the programmatic core. `applyOperations` itself is pure and
// reads nothing (ADR 0100), so these drive it through `landOperations`, which
// is the composition both real callers use: read the workspace through a
// store, apply, and write back only what still holds what was read.
// The CLI-shaped behaviour - argv parsing, `--json` formatting, the manifest
// precheck - stays covered by `apply-command.test.ts`, unchanged.
const landBatch = (
  operations: WorkspaceSource,
  workspace: WorkspaceSource,
  cwd: string,
) => {
  const loaded = loadWorkspaceManifest(workspace, cwd)
  if (!loaded.ok) return { ok: false as const, diagnostics: loaded.diagnostics }
  return landOperations(createFileSystemStore(cwd), {
    workspace: loaded.workspace,
    operations,
    manifestDirectory: posixDirectoryOf(workspace.path),
  })
}

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
`

describe('applyOperations is pure, and a batch lands by compare-and-swap', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yarramate-apply-cas-'))
    mkdirSync(join(cwd, 'architecture'))
    writeFileSync(join(cwd, 'architecture/main.yaml'), document, 'utf8')
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  const resolved = () => {
    const loaded = loadWorkspaceManifest(
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics))
    return loaded.workspace
  }

  it('returns the documents it changed and writes none of them', () => {
    const workspace = resolved()
    const before = readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')

    const outcome = applyOperations({
      workspace,
      sources: workspace.documents.map((path) => ({
        path,
        source: readFileSync(join(cwd, path), 'utf8'),
      })),
      operations: { path: 'operations.yaml', source: batch },
      manifestDirectory: '',
    })

    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(outcome.sources.map((source) => source.path)).toEqual([
      'architecture/main.yaml',
    ])
    expect(outcome.sources[0]!.source).not.toBe(before)
    // The whole point: Core produced new bytes and touched no disk.
    expect(readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')).toBe(
      before,
    )
  })

  it('refuses the batch as YM704 when a document moved between read and write', () => {
    // A store that lets another writer land the instant Core has been shown
    // the sources. The revision handed out is the one read before the race,
    // which is exactly the situation a real concurrent writer creates - and
    // the window that used to hold a whole workspace compile.
    const inner = createFileSystemStore(cwd)
    let raced = false
    const racing: SourceStore = {
      list: () => inner.list(),
      read: (path) => {
        const held = inner.read(path)
        if (!raced && held !== undefined) {
          raced = true
          writeFileSync(
            join(cwd, 'architecture/main.yaml'),
            `${document}# landed elsewhere\n`,
            'utf8',
          )
        }
        return held
      },
      writeAll: (writes) => inner.writeAll(writes),
    }

    const outcome = landOperations(racing, {
      workspace: resolved(),
      operations: { path: 'operations.yaml', source: batch },
      manifestDirectory: '',
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'YM704',
    ])
    expect(outcome.diagnostics[0]!.message).toContain(
      'architecture/main.yaml',
    )
    // Refused means refused: the other writer's bytes are still there.
    expect(readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')).toContain(
      '# landed elsewhere',
    )
  })

  it('lands when nothing moved underneath it', () => {
    const outcome = landOperations(createFileSystemStore(cwd), {
      workspace: resolved(),
      operations: { path: 'operations.yaml', source: batch },
      manifestDirectory: '',
    })

    expect(outcome.ok).toBe(true)
    expect(readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')).not.toBe(
      document,
    )
  })
})

describe('applyOperations', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yarramate-apply-operations-'))
    mkdirSync(join(cwd, 'architecture'))
    writeFileSync(join(cwd, 'architecture/main.yaml'), document, 'utf8')
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('applies a batch atomically and returns the apply-result payload', () => {
    const outcome = landBatch(
      { path: 'operations.yaml', source: batch },
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(outcome.result.format).toBe('yarramate/apply-result/v1')
    expect(outcome.result.workspace).toBe('apply-fixture')
    expect(outcome.result.applied).toEqual({
      addedConcepts: 1,
      addedRelationships: 0,
      updatedConcepts: 0,
      updatedRelationships: 0,
      deletedConcepts: 0,
      deletedRelationships: 0,
      addedObservations: 0,
      updatedObservations: 0,
      deletedObservations: 0,
      renamedConcepts: 0,
      renamedRelationships: 0,
    })
    expect(outcome.result.documents).toEqual(['architecture/main.yaml'])

    const written = readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')
    expect(written).toContain('id: todo-service')
    expect(written).toContain('name: Todo service')
  })

  it('rejects a schema-invalid operation, writing nothing', () => {
    const before = readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')
    const invalidBatch = `format: yarramate/operations/v1
operations:
  - op: resurrect-concept
    document: architecture/main.yaml
    concept:
      id: user
`
    const outcome = landBatch(
      { path: 'operations.yaml', source: invalidBatch },
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.diagnostics.length).toBeGreaterThan(0)
    expect(readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')).toBe(
      before,
    )
  })

  it('rejects an operation whose document is not in the workspace manifest', () => {
    const outOfScope = batch.replace(
      'architecture/main.yaml',
      'architecture/other.yaml',
    )
    const outcome = landBatch(
      { path: 'operations.yaml', source: outOfScope },
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.diagnostics[0]?.message).toContain(
      'not a document of workspace "apply-fixture"',
    )
  })

  it('rejects a batch that parses but fails to compile, writing nothing', () => {
    const before = readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')
    const beforeMtime = statSync(join(cwd, 'architecture/main.yaml')).mtimeMs
    const brokenBatch = `format: yarramate/operations/v1
operations:
  - op: add-relationship
    document: architecture/main.yaml
    relationship:
      id: user-serves-nobody
      kind: serving
      from: user
      to: missing-target
`
    const outcome = landBatch(
      { path: 'operations.yaml', source: brokenBatch },
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8')).toBe(
      before,
    )
    expect(statSync(join(cwd, 'architecture/main.yaml')).mtimeMs).toBe(
      beforeMtime,
    )
  })

  it('carries /operations/<i>/... pointers on a rejected operation', () => {
    const outOfScope = batch.replace(
      'architecture/main.yaml',
      'architecture/other.yaml',
    )
    const outcome = landBatch(
      { path: 'operations.yaml', source: outOfScope },
      { path: 'workspace.yaml', source: manifest },
      cwd,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.diagnostics[0]?.pointer).toBe('/operations/0/document')
  })

  it('runs two sequential calls against different workspaces with no state bleed', () => {
    const other = mkdtempSync(join(tmpdir(), 'yarramate-apply-operations-'))
    try {
      mkdirSync(join(other, 'architecture'))
      writeFileSync(join(other, 'architecture/main.yaml'), document, 'utf8')

      const first = landBatch(
        { path: 'operations.yaml', source: batch },
        { path: 'workspace.yaml', source: manifest },
        cwd,
      )
      const second = landBatch(
        { path: 'operations.yaml', source: batch },
        { path: 'workspace.yaml', source: manifest },
        other,
      )
      if (!first.ok) throw new Error(JSON.stringify(first.diagnostics))
      if (!second.ok) throw new Error(JSON.stringify(second.diagnostics))
      expect(first.result.documents).toEqual(['architecture/main.yaml'])
      expect(second.result.documents).toEqual(['architecture/main.yaml'])
      expect(
        readFileSync(join(cwd, 'architecture/main.yaml'), 'utf8'),
      ).toContain('id: todo-service')
      expect(
        readFileSync(join(other, 'architecture/main.yaml'), 'utf8'),
      ).toContain('id: todo-service')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

// A rename is only an identity edit if it is total: the declaration and every
// declarative reference to it move in one batch. References live in four kinds
// of file, so each group below is a separate observable claim - a group the
// walker misses leaves a reference to an id that stopped existing.

const renameDocument = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: platform
    kind: businessActor
    name: Platform
  - id: checkout
    kind: applicationService
    name: Checkout
    owner: platform
    references:
      - id: charter
        ref: "platform"
relationships:
  - id: platform-serves-checkout
    kind: serving
    from: platform
    to: checkout
`

const renameManifest = `format: yarramate/workspace/v1
id: rename-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/actors.projection.yaml
adapterMappings:
  - adapters/likec4.yaml
evidence:
  - evidence/audit.yaml
`

const renameProjection = `format: yarramate/projection/v1
id: actors
version: "1.0"
query:
  subjects:
    - platform
  owners:
    - platform
`

const renameEvidence = `format: yarramate/evidence/v1
id: audit
version: "1.0"
provider: repository-audit
observations:
  - subject: platform
    result: confirmed
    evidence:
      uri: repo:src/platform.ts
  - claim: 'platform~name'
    result: confirmed
    evidence:
      uri: repo:src/platform.ts
`

const renameMapping = `format: yarramate/adapter-mapping/v1
id: likec4-main
version: "1.0"
adapter: likec4
mappings:
  - native: platform
    external: main.platform
    type: concept
`

const renameBatch = (
  from: string,
  to: string,
  op = 'rename-concept',
  collection = 'concept',
) => `format: yarramate/operations/v1
operations:
  - op: ${op}
    document: architecture/main.yaml
    ${collection}:
      id: ${from}
    to: ${to}
`

describe('applyOperations rename', () => {
  let cwd: string
  const read = (path: string) => readFileSync(join(cwd, path), 'utf8')

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yarramate-apply-rename-'))
    for (const directory of [
      'architecture',
      'projections',
      'adapters',
      'evidence',
    ]) {
      mkdirSync(join(cwd, directory))
    }
    writeFileSync(join(cwd, 'architecture/main.yaml'), renameDocument, 'utf8')
    writeFileSync(
      join(cwd, 'projections/actors.projection.yaml'),
      renameProjection,
      'utf8',
    )
    writeFileSync(join(cwd, 'adapters/likec4.yaml'), renameMapping, 'utf8')
    writeFileSync(join(cwd, 'evidence/audit.yaml'), renameEvidence, 'utf8')
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  const apply = (source: string) =>
    landBatch(
      { path: 'operations.yaml', source },
      { path: 'workspace.yaml', source: renameManifest },
      cwd,
    )

  it('moves the declaration and every reference in all four groups', () => {
    const outcome = apply(renameBatch('platform', 'platform-team'))
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(outcome.result.applied.renamedConcepts).toBe(1)
    expect(outcome.result.documents).toEqual([
      'adapters/likec4.yaml',
      'architecture/main.yaml',
      'evidence/audit.yaml',
      'projections/actors.projection.yaml',
    ])

    // Document: declaration, owner, a qualified `ref`, and an endpoint.
    expect(read('architecture/main.yaml')).toBe(
      renameDocument
        .replace('  - id: platform\n', '  - id: platform-team\n')
        .replace('owner: platform', 'owner: platform-team')
        .replace('ref: "platform"', 'ref: "platform-team"')
        .replace('from: platform', 'from: platform-team'),
    )
    // Projection selectors, always qualified.
    expect(read('projections/actors.projection.yaml')).toBe(
      renameProjection.replaceAll('platform', 'platform-team'),
    )
    // Evidence: a bare subject and a claim whose `~aspect` suffix survives.
    expect(read('evidence/audit.yaml')).toBe(
      renameEvidence
        .replace('subject: platform', 'subject: platform-team')
        .replace("'platform~name'", "'platform-team~name'"),
    )
    // Adapter mapping: the native address moves, the external name does not.
    expect(read('adapters/likec4.yaml')).toBe(
      renameMapping.replace('native: platform', 'native: platform-team'),
    )
  })

  it('moves a relationship id and the references that name it', () => {
    const withReference = renameDocument.replace(
      '        ref: "platform"',
      '        ref: platform-serves-checkout',
    )
    writeFileSync(join(cwd, 'architecture/main.yaml'), withReference, 'utf8')
    const outcome = apply(
      renameBatch(
        'platform-serves-checkout',
        'platform-serves-checkout-service',
        'rename-relationship',
        'relationship',
      ),
    )
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(outcome.result.applied.renamedRelationships).toBe(1)
    expect(read('architecture/main.yaml')).toBe(
      withReference.replaceAll(
        'platform-serves-checkout',
        'platform-serves-checkout-service',
      ),
    )
  })

  it('reads the first rename result when a second one follows in the batch', () => {
    const outcome = apply(`format: yarramate/operations/v1
operations:
  - op: rename-concept
    document: architecture/main.yaml
    concept:
      id: platform
    to: platform-team
  - op: rename-concept
    document: architecture/main.yaml
    concept:
      id: platform-team
    to: platform-group
`)
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(outcome.result.applied.renamedConcepts).toBe(2)
    expect(read('architecture/main.yaml')).toContain('owner: platform-group')
    expect(read('projections/actors.projection.yaml')).toContain(
      'platform-group',
    )
  })

  it('refuses a rename whose target id is not declared, writing nothing', () => {
    const before = read('architecture/main.yaml')
    const outcome = apply(renameBatch('absent', 'present'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    expect(outcome.diagnostics[0]?.code).toBe('YM912')
    expect(outcome.diagnostics[0]?.message).toContain(
      'renames "absent", which does not exist',
    )
    expect(read('architecture/main.yaml')).toBe(before)
  })

  it('refuses a rename to the same id rather than reporting residue', () => {
    const before = read('architecture/main.yaml')
    const outcome = apply(renameBatch('platform', 'platform'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    expect(outcome.diagnostics[0]?.code).toBe('YM912')
    expect(outcome.diagnostics[0]?.message).toContain(
      'renames "platform" to itself',
    )
    // The residue walk would otherwise flag every reference to the id, reading
    // as a rewrite fault instead of a batch that asks for nothing.
    expect(
      outcome.diagnostics.some((diagnostic) => diagnostic.code === 'YM913'),
    ).toBe(false)
    expect(read('architecture/main.yaml')).toBe(before)
  })

  it('refuses a rename onto an id the document already declares', () => {
    const before = read('architecture/main.yaml')
    const outcome = apply(renameBatch('platform', 'checkout'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    // The compile gate owns id uniqueness, and it runs before a byte is
    // written, so the duplicate is reported against the document.
    expect(outcome.diagnostics[0]?.code).toBe('YM301')
    expect(outcome.diagnostics[0]?.message).toContain('Duplicate ID')
    expect(read('architecture/main.yaml')).toBe(before)
  })

  it('refuses a rename that would collide with an architecture state id', () => {
    writeFileSync(
      join(cwd, 'architecture/main.yaml'),
      `${renameDocument}states:
  - id: platform-team
    kind: baseline
    name: Current
`,
      'utf8',
    )
    const outcome = apply(renameBatch('platform', 'platform-team'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    expect(outcome.diagnostics[0]?.message).toContain(
      'one address would name two things',
    )
  })

  it('refuses a rename out of a document already ambiguous with a state', () => {
    // The compile gate judges the batch's result, and moving the concept out
    // leaves a result that compiles clean - so nothing but this refusal stops
    // the walker guessing which of the two things a bare reference meant.
    writeFileSync(
      join(cwd, 'architecture/main.yaml'),
      `${renameDocument}states:
  - id: platform
    kind: baseline
    name: Current
`,
      'utf8',
    )
    const outcome = apply(renameBatch('platform', 'moved'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    expect(outcome.diagnostics[0]?.code).toBe('YM912')
    expect(outcome.diagnostics[0]?.message).toContain(
      'one address would name two things',
    )
  })

  it('refuses a rename when a reference position holds a YAML alias', () => {
    writeFileSync(
      join(cwd, 'architecture/main.yaml'),
      renameDocument
        .replace('  - id: platform\n', '  - id: &owner platform\n')
        .replace('owner: platform', 'owner: *owner'),
      'utf8',
    )
    const outcome = apply(renameBatch('platform', 'platform-team'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected refusal')
    expect(outcome.diagnostics[0]?.message).toContain(
      'holds an alias at /concepts/1/owner',
    )
  })

  // Before 1.0 this asserted that `other#platform` survived a rename of
  // `main#platform`. Flattened identity has no such pair - one id is one
  // subject anywhere - so the meaningful version is that a rename touches only
  // the documents that actually mention the subject.
  it('leaves a document that never mentions the subject alone', () => {
    const other = `format: yarramate/v1
id: other
profile: yarramate/core@0.1
concepts:
  - id: billing
    kind: businessActor
    name: Billing
relationships: []
`
    writeFileSync(join(cwd, 'architecture/other.yaml'), other, 'utf8')
    const outcome = landBatch(
      { path: 'operations.yaml', source: renameBatch('platform', 'platform-team') },
      {
        path: 'workspace.yaml',
        source: renameManifest.replace(
          '  - architecture/main.yaml\n',
          '  - architecture/main.yaml\n  - architecture/other.yaml\n',
        ),
      },
      cwd,
    )
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics))
    expect(read('architecture/other.yaml')).toBe(other)
    expect(outcome.result.documents).not.toContain('architecture/other.yaml')
  })
})
