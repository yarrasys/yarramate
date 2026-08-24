import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspace } from '../src/compiler.js'

// ADR 0080: a subject that is renamed, split, or merged keeps its history
// through one predicate, authored on the successor and pointing back. The
// shape is cardinality, so these tests pin all three cases against the same
// predicate rather than against three of them.
describe('succession claims', () => {
  const compile = (source: string) =>
    compileWorkspace([{ path: 'main.yaml', source }])

  const successions = (source: string) => {
    const result = compile(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return []
    return result.graph.claims.filter(
      ({ predicate }) => predicate === 'yarramate/lineage/supersedes',
    )
  }

  it('emits one reference claim per predecessor for a rename', () => {
    const claims = successions(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-gateway
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    status: retired
relationships: []
`)
    expect(claims).toHaveLength(1)
    expect(claims[0]?.id).toBe(
      'order-api~supersedes-6f726465722d67617465776179',
    )
    expect(claims[0]?.subject).toBe('order-api')
    expect(claims[0]?.object).toEqual({ ref: 'order-gateway' })
    expect(claims[0]?.origin).toBe('declared')
    expect(claims[0]?.source.pointer).toBe('/concepts/0/supersedes/0')
  })

  it('reads a merge as several predecessors on one successor', () => {
    const claims = successions(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: identity-service
    kind: applicationComponent
    name: Identity Service
    supersedes:
      - auth-service
      - session-service
  - id: auth-service
    kind: applicationComponent
    name: Auth Service
    status: retired
  - id: session-service
    kind: applicationComponent
    name: Session Service
    status: retired
relationships: []
`)
    // Many-to-one: one successor names two predecessors.
    expect(new Set(claims.map(({ subject }) => subject))).toEqual(
      new Set(['identity-service']),
    )
    expect(
      claims.flatMap((claim) =>
        'ref' in claim.object ? [claim.object.ref] : [],
      ).sort(),
    ).toEqual(['auth-service', 'session-service'])
  })

  it('reads a split as one predecessor named by several successors', () => {
    const claims = successions(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: invoicing
    kind: applicationComponent
    name: Invoicing
    supersedes:
      - billing
  - id: payments
    kind: applicationComponent
    name: Payments
    supersedes:
      - billing
  - id: billing
    kind: applicationComponent
    name: Billing
    status: retired
relationships: []
`)
    // One-to-many: the shape is derivable from the objects, with no
    // separate "splitFrom" vocabulary asserting a count no single document
    // can see.
    expect(
      claims.flatMap((claim) =>
        'ref' in claim.object ? [claim.object.ref] : [],
      ),
    ).toEqual(['billing', 'billing'])
    expect(claims.map(({ subject }) => subject).sort()).toEqual([
      'invoicing',
      'payments',
    ])
  })

  it('derives claim ids from the predecessor, not the list position', () => {
    const ordered = successions(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: identity-service
    kind: applicationComponent
    name: Identity Service
    supersedes:
      - auth-service
      - session-service
  - id: auth-service
    kind: applicationComponent
    name: Auth Service
  - id: session-service
    kind: applicationComponent
    name: Session Service
relationships: []
`)
    const reordered = successions(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: identity-service
    kind: applicationComponent
    name: Identity Service
    supersedes:
      - session-service
      - auth-service
  - id: auth-service
    kind: applicationComponent
    name: Auth Service
  - id: session-service
    kind: applicationComponent
    name: Session Service
relationships: []
`)
    expect(reordered.map(({ id }) => id).sort()).toEqual(
      ordered.map(({ id }) => id).sort(),
    )
  })

  it('resolves a predecessor in another document', () => {
    const result = compileWorkspace([
      {
        path: 'new.yaml',
        source: `format: yarramate/v1
id: new
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-gateway
relationships: []
`,
      },
      {
        path: 'legacy.yaml',
        source: `format: yarramate/v1
id: legacy
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    status: retired
relationships: []
`,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const claim = result.graph.claims.find(
      ({ predicate }) => predicate === 'yarramate/lineage/supersedes',
    )
    expect(claim?.object).toEqual({ ref: 'order-gateway' })
  })

  it('does not require a superseded subject to be retired', () => {
    // The transition period is real: a strangler migration runs both for
    // months, and during that window the predecessor is genuinely current.
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    status: current
    supersedes:
      - order-gateway
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    status: current
relationships: []
`)
    expect(result.ok).toBe(true)
  })

  it('rejects an unresolved succession reference with YM312', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - nowhere
relationships: []
`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map(({ code }) => code)).toContain('YM312')
  })

  it('rejects self-succession with YM313 and not also as a cycle', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-api
relationships: []
`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const codes = result.diagnostics.map(({ code }) => code)
    expect(codes).toContain('YM313')
    // Exactly one diagnostic per defect: the cycle walk skips the
    // self-reference that YM313 already owns.
    expect(codes).not.toContain('YM504')
  })

  it('rejects a succession cycle with YM504', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-gateway
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    supersedes:
      - order-api
relationships: []
`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map(({ code }) => code)).toContain('YM504')
  })

  it('accepts a long chain, which is history rather than a cycle', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: third
    kind: applicationComponent
    name: Third
    supersedes:
      - second
  - id: second
    kind: applicationComponent
    name: Second
    supersedes:
      - first
  - id: first
    kind: applicationComponent
    name: First
    status: retired
relationships: []
`)
    expect(result.ok).toBe(true)
  })
})

// The claim is authored on the successor, but "where did this go?" is asked
// of the predecessor, so the brief reads it in both directions.
describe('briefs render lineage from either end', () => {
  const document =
    'format: yarramate/v1\n' +
    'id: main\n' +
    'profile: yarramate/core@0.1\n' +
    'concepts:\n' +
    '  - id: order-api\n' +
    '    kind: applicationComponent\n' +
    '    name: Order API\n' +
    '    status: current\n' +
    '    supersedes:\n' +
    '      - order-gateway\n' +
    '  - id: order-gateway\n' +
    '    kind: applicationComponent\n' +
    '    name: Order Gateway\n' +
    '    status: retired\n' +
    'relationships: []\n'

  const manifest =
    'format: yarramate/workspace/v1\n' +
    'id: succession-fixture\n' +
    'documents:\n' +
    '  - architecture/main.yaml\n' +
    'profiles: []\n' +
    'projections: []\n' +
    'adapterMappings: []\n' +
    'evidence: []\n'

  const projection =
    'format: yarramate/projection/v1\n' +
    'id: orders-slice\n' +
    'version: "1.0"\n' +
    'query:\n' +
    '  documents: [main]\n' +
    'presentation:\n' +
    '  title: Orders slice\n' +
    '  description: The order surface and where it came from.\n'

  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-succession-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'projection.yaml'), projection, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('names the predecessor on the successor and the successor on the predecessor', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', 'projection.yaml'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Succeeds "Order Gateway".')
    expect(result.stdout).toContain('Superseded by "Order API".')
  })

  it('names a successor that the slice itself does not contain', () => {
    // "Where did this go?" is asked by seeding on the dead subject, and
    // nothing connects it to its replacement except the succession claim,
    // which belongs to the replacement. The brief still answers, naming the
    // successor by the id a reader can seed a second slice on, without the
    // slice growing to contain it (ADR 0070, ADR 0080).
    const result = runCli(
      ['ask', 'workspace.yaml', 'order-gateway'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Superseded by')
    expect(result.stdout).toContain('order-api')
    expect(result.stdout).not.toContain('Order API", an application')
  })
})
