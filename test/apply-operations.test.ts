import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyOperations } from '../src/apply-command.js'

// Coverage for the programmatic core: every test here calls `applyOperations`
// directly with in-memory sources, the way the visual session server calls it.
// The CLI-shaped behaviour — argv parsing, `--json` formatting, the manifest
// precheck — stays covered by `apply-command.test.ts`, unchanged.

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
    const outcome = applyOperations(
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
  - op: rename-concept
    document: architecture/main.yaml
    concept:
      id: user
`
    const outcome = applyOperations(
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
    const outcome = applyOperations(
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
    const outcome = applyOperations(
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
    const outcome = applyOperations(
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

      const first = applyOperations(
        { path: 'operations.yaml', source: batch },
        { path: 'workspace.yaml', source: manifest },
        cwd,
      )
      const second = applyOperations(
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
