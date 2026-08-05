import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import type { RequirementsTraceabilityMatrix } from '../src/rtm.js'
import rtmSchema from '../schema/yarramate-rtm.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateRtm = new Ajv2020({ allErrors: true }).compile(rtmSchema)

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: fast-answers
    kind: driver
    name: Fast answers
    description: Users leave when responses lag.
  - id: reliable-todos
    kind: goal
    name: Reliable todos
    description: Every captured todo survives and is served.
  - id: durable-storage
    kind: requirement
    name: Durable storage
    description: Todos persist across restarts.
    status: current
    attestations:
      - topic: adequacy
        by: reviewer one
        on: "2026-08-01"
  - id: unrealized-need
    kind: requirement
    name: Unrealized need
    description: Nothing in the model realizes this yet.
  - id: retired-need
    kind: requirement
    name: Retired need
    description: Multi-tenant sharing is out of scope for this product.
    status: retired
  - id: lifted-rule
    kind: constraint
    name: Lifted rule
    description: The one-region rule no longer applies after the DR review.
    status: retired
  - id: single-region
    kind: constraint
    name: Single region
    description: Data stays in one region.
  - id: todo-store
    kind: applicationComponent
    name: Todo store
    status: current
    description: Persists todo items.
  - id: region-guard
    kind: applicationFunction
    name: Region guard
    status: retired
    description: Once pinned deployments to one region.
relationships:
  - id: storage-supports-reliable-todos
    kind: influence
    from: durable-storage
    to: reliable-todos
  - id: speed-drives-storage
    kind: influence
    from: fast-answers
    to: durable-storage
  - id: store-realizes-storage
    kind: realization
    from: todo-store
    to: durable-storage
  - id: guard-realizes-region
    kind: realization
    from: region-guard
    to: single-region
`

const manifest = `format: yarramate/workspace/v1
id: rtm-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence:
  - evidence/build.yaml
`

const evidence = `format: yarramate/evidence/v1
id: build-evidence
version: "1.0"
provider: fixture
observations:
  - subject: main#todo-store
    result: confirmed
    evidence:
      uri: repo:src/todo-store.ts
  - claim: main#store-realizes-storage
    result: confirmed
    evidence:
      uri: repo:src/todo-store.ts#save
`

describe('export rtm', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-rtm-'))
    mkdirSync(join(workspace, 'architecture'))
    mkdirSync(join(workspace, 'evidence'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'evidence/build.yaml'), evidence, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  const exportRtm = (out: string): RequirementsTraceabilityMatrix => {
    const result = runCli(
      ['export', 'rtm', 'workspace.yaml', '--out', out],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    return JSON.parse(
      readFileSync(join(workspace, out, 'rtm.json'), 'utf8'),
    ) as RequirementsTraceabilityMatrix
  }

  it('writes a bundle whose JSON validates against yarramate/rtm/v1', () => {
    const result = runCli(
      ['export', 'rtm', 'workspace.yaml', '--out', 'out'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'Wrote RTM.md and rtm.json (3 rows, 2 gaps) to out\n',
    )
    expect(existsSync(join(workspace, 'out/RTM.md'))).toBe(true)
    const rtm = JSON.parse(
      readFileSync(join(workspace, 'out/rtm.json'), 'utf8'),
    ) as RequirementsTraceabilityMatrix
    expect(validateRtm(rtm)).toBe(true)
    expect(validateRtm.errors ?? []).toEqual([])
    expect(rtm.format).toBe('yarramate/rtm/v1')
    expect(rtm.workspace).toBe('rtm-fixture')
    expect(rtm.summary).toEqual({
      rows: 3,
      requirements: 2,
      constraints: 1,
      covered: 1,
      gaps: 2,
      descoped: 2,
      realizers: 2,
      realizersWithEvidence: 1,
      attestedRows: 1,
    })
  })

  it('traces lineage, realizers, evidence verdicts, and attestations', () => {
    const rtm = exportRtm('out')
    const storage = rtm.rows.find(
      ({ subject }) => subject === 'main#durable-storage',
    )!
    expect(storage.gap).toBe(false)
    expect(storage.status).toBe('current')
    expect(storage.lineage).toEqual([
      expect.objectContaining({
        role: 'influenced-by',
        subject: 'main#fast-answers',
        kind: 'driver',
        name: 'Fast answers',
      }),
      expect.objectContaining({
        role: 'influences',
        subject: 'main#reliable-todos',
        kind: 'goal',
        name: 'Reliable todos',
      }),
    ])
    expect(storage.realizers).toHaveLength(1)
    const realizer = storage.realizers[0]!
    expect(realizer.subject).toBe('main#todo-store')
    expect(realizer.status).toBe('current')
    expect(realizer.relationship).toBe('main#store-realizes-storage')
    // Verdicts order by provider, evidence document, then locator, so the
    // subject-level observation precedes the narrower claim-level one.
    expect(realizer.evidence).toEqual([
      expect.objectContaining({
        target: 'subject',
        result: 'confirmed',
        provider: 'fixture',
        evidenceDocument: 'build-evidence@1.0',
        uri: 'repo:src/todo-store.ts',
      }),
      expect.objectContaining({
        target: 'claim',
        result: 'confirmed',
        provider: 'fixture',
        evidenceDocument: 'build-evidence@1.0',
        uri: 'repo:src/todo-store.ts#save',
      }),
    ])
    expect(storage.attestations).toEqual([
      expect.objectContaining({
        topic: 'adequacy',
        by: 'reviewer one',
        on: '2026-08-01',
      }),
    ])
    const markdown = readFileSync(join(workspace, 'out/RTM.md'), 'utf8')
    expect(markdown).toContain('influenced by driver "Fast answers"')
    expect(markdown).toContain('adequacy: reviewer one on 2026-08-01')
    expect(markdown).toContain('"Todo store": confirmed (fixture)')
  })

  it('keeps unrealized requirements as explicit gap rows', () => {
    const rtm = exportRtm('out')
    const unrealized = rtm.rows.find(
      ({ subject }) => subject === 'main#unrealized-need',
    )!
    expect(unrealized.gap).toBe(true)
    expect(unrealized.realizers).toEqual([])
    // A constraint realized only by a retired subject is a gap too:
    // the retired realizer stays listed but never counts as coverage.
    const region = rtm.rows.find(
      ({ subject }) => subject === 'main#single-region',
    )!
    expect(region.coreKind).toBe('constraint')
    expect(region.gap).toBe(true)
    expect(region.realizers).toEqual([
      expect.objectContaining({
        subject: 'main#region-guard',
        status: 'retired',
      }),
    ])
    const markdown = readFileSync(join(workspace, 'out/RTM.md'), 'utf8')
    expect(markdown).toContain('**NONE (gap)**')
    expect(markdown).toContain('**NONE current (gap)**')
    expect(markdown).toContain(
      '`main#unrealized-need` "Unrealized need"',
    )
  })

  it('descopes retired rows, labelling non-goals apart from lifted rules', () => {
    const rtm = exportRtm('out')
    expect(rtm.rows.map(({ subject }) => subject)).not.toContain(
      'main#retired-need',
    )
    expect(rtm.rows.map(({ subject }) => subject)).not.toContain(
      'main#lifted-rule',
    )
    // A retired requirement is a declared non-goal (ADR 0073); a retired
    // constraint is deliberately outside that set because retiring one
    // lifts a rule. Both leave the coverage arithmetic.
    expect(rtm.descoped).toEqual([
      expect.objectContaining({
        subject: 'main#lifted-rule',
        name: 'Lifted rule',
        reason: 'lifted-constraint',
        rationale: 'The one-region rule no longer applies after the DR review.',
      }),
      expect.objectContaining({
        subject: 'main#retired-need',
        name: 'Retired need',
        reason: 'non-goal',
        rationale: 'Multi-tenant sharing is out of scope for this product.',
      }),
    ])
    const markdown = readFileSync(join(workspace, 'out/RTM.md'), 'utf8')
    expect(markdown).toContain('is a declared non-goal.')
    expect(markdown).toContain('is a lifted constraint.')
    expect(rtm.motivationContext.map(({ subject }) => subject)).toEqual([
      'main#fast-answers',
      'main#reliable-todos',
    ])
  })

  it('cites the authored source location on every cell that has one', () => {
    const rtm = exportRtm('out')
    const authored = readFileSync(
      join(workspace, 'architecture/main.yaml'),
      'utf8',
    ).split('\n')
    const storage = rtm.rows.find(
      ({ subject }) => subject === 'main#durable-storage',
    )!
    expect(storage.source.path).toBe('architecture/main.yaml')
    expect(authored[storage.source.line - 1]).toContain('kind: requirement')
    const realizer = storage.realizers[0]!
    expect(authored[realizer.source.line - 1]).toContain(
      'store-realizes-storage',
    )
    const attestation = storage.attestations[0]!
    expect(authored[attestation.source.line - 1]).toContain(
      'topic: adequacy',
    )
    for (const entry of storage.lineage) {
      expect(authored[entry.source.line - 1]).toContain(
        entry.relationship.slice('main#'.length),
      )
    }
  })

  it('is byte-identical across runs on identical inputs', () => {
    exportRtm('first')
    exportRtm('second')
    for (const file of ['RTM.md', 'rtm.json']) {
      expect(readFileSync(join(workspace, 'first', file), 'utf8')).toBe(
        readFileSync(join(workspace, 'second', file), 'utf8'),
      )
    }
  })

  it('registers the format in the core contract and package exports', () => {
    const contract = readFileSync(
      join(repositoryRoot, '.yarramate/contracts/yarramate-core-0.1.yaml'),
      'utf8',
    )
    expect(contract).toContain('id: yarramate/rtm/v1')
    expect(contract).toContain('schema: schema/yarramate-rtm.schema.json')
    const packageManifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, string> }
    expect(packageManifest.exports['./schema/rtm']).toBe(
      './schema/yarramate-rtm.schema.json',
    )
    expect(
      (rtmSchema as { properties: { format: { const: string } } }).properties
        .format.const,
    ).toBe('yarramate/rtm/v1')
  })

  it('rejects rtm without --out and with foreign flags', () => {
    expect(
      runCli(['export', 'rtm', 'workspace.yaml'], workspace).exitCode,
    ).toBe(2)
    expect(
      runCli(
        ['export', 'rtm', 'workspace.yaml', '--out', 'out', '--json'],
        workspace,
      ).exitCode,
    ).toBe(2)
    expect(
      runCli(
        ['export', 'rtm', 'workspace.yaml', '--out', 'out', '--budget', '100'],
        workspace,
      ).exitCode,
    ).toBe(2)
    expect(
      runCli(
        [
          'export',
          'rtm',
          'workspace.yaml',
          '--out',
          'out',
          '--changed',
          'HEAD~1..HEAD',
        ],
        workspace,
      ).exitCode,
    ).toBe(2)
  })
})
