import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import {
  compileWorkspace,
  compileWorkspaceWithProfileContext,
} from '../src/compiler.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/interrogate-command.js'
import {
  findNearDuplicates,
  headTokens,
  normalizeLabel,
  similarity,
  type IdentitySubject,
} from '../src/subject-identity.js'

const Ajv2020 = Ajv2020Module.default

const askResultSchema = JSON.parse(
  readFileSync(
    join(
      resolve(fileURLToPath(new URL('.', import.meta.url)), '..'),
      'schema/yarramate-ask-result.schema.json',
    ),
    'utf8',
  ),
) as object

const subject = (
  id: string,
  labels: readonly string[],
  extra: Partial<IdentitySubject> = {},
): IdentitySubject => ({
  id,
  kind: 'yarramate/core@0.1#applicationComponent',
  labels,
  neighbours: new Set(),
  distinctFrom: new Set(),
  ...extra,
})

describe('label normalization', () => {
  it('splits case, separators, and singularizes into one token list', () => {
    expect(normalizeLabel('OrderGateway')).toEqual(['order', 'gateway'])
    expect(normalizeLabel('order-gateway')).toEqual(['order', 'gateway'])
    expect(normalizeLabel('order_gateway')).toEqual(['order', 'gateway'])
    expect(normalizeLabel('Order Gateway')).toEqual(['order', 'gateway'])
    expect(normalizeLabel('orders')).toEqual(['order'])
    expect(normalizeLabel('policies')).toEqual(['policy'])
  })

  it('strips type nouns but never empties a label that is only type nouns', () => {
    expect(headTokens(normalizeLabel('orders-service'))).toEqual(['order'])
    expect(headTokens(normalizeLabel('gateway'))).toEqual(['gateway'])
  })

  it('scores edit similarity between 0 and 1', () => {
    expect(similarity('order', 'order')).toBe(1)
    expect(similarity('order', 'payment')).toBeLessThan(0.3)
  })
})

describe('near-duplicate detection', () => {
  it('finds the motivating pair: order-gateway and orders-service', () => {
    const pairs = findNearDuplicates([
      subject('order-gateway', ['order-gateway', 'Order Gateway']),
      subject('orders-service', ['orders-service', 'Orders Service']),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.left).toBe('order-gateway')
    expect(pairs[0]!.right).toBe('orders-service')
    expect(pairs[0]!.corroboration).toBe('lexical')
  })

  it('leaves genuinely different subjects alone', () => {
    expect(
      findNearDuplicates([
        subject('order-gateway', ['order-gateway']),
        subject('payment-gateway', ['payment-gateway']),
        subject('audit-log', ['audit-log']),
      ]),
    ).toEqual([])
  })

  it('never compares subjects of different kinds', () => {
    expect(
      findNearDuplicates([
        subject('orders', ['orders']),
        subject('order', ['order'], {
          kind: 'yarramate/core@0.1#dataObject',
        }),
      ]),
    ).toEqual([])
  })

  it('requires structural corroboration in the moderate band', () => {
    const left = [
      'payment-batch-processor',
      ['payment-batch-processor'],
    ] as const
    const right = [
      'payment-batch-processor-v2',
      ['payment-batch-processor-v2'],
    ] as const
    expect(
      findNearDuplicates([subject(...left), subject(...right)]),
    ).toEqual([])
    const corroborated = findNearDuplicates([
      subject(...left, { owner: 'team' }),
      subject(...right, { owner: 'team' }),
    ])
    expect(corroborated).toHaveLength(1)
    expect(corroborated[0]!.corroboration).toBe('owner')
  })

  it('accepts a shared one-hop neighbour as corroboration', () => {
    const pairs = findNearDuplicates([
      subject('payment-batch-processor', ['payment-batch-processor'], {
        neighbours: new Set(['ledger']),
      }),
      subject('payment-batch-processor-v2', ['payment-batch-processor-v2'], {
        neighbours: new Set(['ledger']),
      }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.corroboration).toBe('neighbourhood')
  })

  it('matches through an alias the preferred names never share', () => {
    expect(
      findNearDuplicates([
        subject('auth', ['auth', 'Authentication']),
        subject('identity-provider', ['identity-provider', 'Identity Provider']),
      ]),
    ).toEqual([])
    expect(
      findNearDuplicates([
        subject('auth', ['auth', 'Authentication']),
        subject('identity-provider', [
          'identity-provider',
          'Identity Provider',
          'auth',
        ]),
      ]),
    ).toHaveLength(1)
  })

  it('is dismissed symmetrically by one recorded judgment', () => {
    const declared = findNearDuplicates([
      subject('order-gateway', ['order-gateway'], {
        distinctFrom: new Set(['orders-service']),
      }),
      subject('orders-service', ['orders-service']),
    ])
    expect(declared).toEqual([])
    const reversed = findNearDuplicates([
      subject('order-gateway', ['order-gateway']),
      subject('orders-service', ['orders-service'], {
        distinctFrom: new Set(['order-gateway']),
      }),
    ])
    expect(reversed).toEqual([])
  })
})

describe('alternative labels and distinctness compile to claims', () => {
  const compile = (source: string) =>
    compileWorkspace([{ path: 'main.yaml', source }])

  it('emits one alias claim per aka entry, ordered by content not position', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    aka:
      - OG
      - the gateway
relationships: []
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const aliases = result.graph.claims.filter(
      ({ predicate }) => predicate === 'yarramate/concept/alias',
    )
    expect(aliases.map((claim) => ('value' in claim.object ? claim.object.value : ''))).toEqual([
      'OG',
      'the gateway',
    ])
    expect(aliases.every(({ subject }) => subject === 'order-gateway')).toBe(true)

    const reordered = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    aka:
      - the gateway
      - OG
relationships: []
`)
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) return
    // Claim ids derive from the alias text, so reordering the YAML leaves
    // the set of claim identities untouched.
    expect(
      reordered.graph.claims
        .filter(({ predicate }) => predicate === 'yarramate/concept/alias')
        .map(({ id }) => id)
        .sort(),
    ).toEqual(aliases.map(({ id }) => id).sort())
  })

  it('emits a distinct-from reference claim', () => {
    const result = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    distinctFrom:
      - orders-service
  - id: orders-service
    kind: applicationComponent
    name: Orders Service
relationships: []
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const claim = result.graph.claims.find(
      ({ predicate }) => predicate === 'yarramate/identity/distinct-from',
    )
    expect(claim?.subject).toBe('order-gateway')
    expect(claim?.object).toEqual({ ref: 'orders-service' })
    expect(claim?.origin).toBe('declared')
  })

  it('rejects an unresolved or self-referential distinctFrom', () => {
    const unresolved = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    distinctFrom:
      - nowhere
relationships: []
`)
    expect(unresolved.ok).toBe(false)
    if (unresolved.ok) return
    expect(unresolved.diagnostics.map(({ code }) => code)).toContain('YM310')

    const itself = compile(`format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    distinctFrom:
      - order-gateway
relationships: []
`)
    expect(itself.ok).toBe(false)
    if (itself.ok) return
    expect(itself.diagnostics.map(({ code }) => code)).toContain('YM311')
  })
})

// ADR 0079's second property says an extension document is never a worse
// neighbour than its core twin. A pairwise condition is the obvious place for
// that to break, so the two safe cases are pinned here; the strictness
// witness lives in test/conservative-extension.test.ts.
describe('near-duplicate detection is conservative over profile extensions', () => {
  const coreOnly = {
    path: 'architecture/core-only.yaml',
    source: `format: yarramate/v1
id: core-only
profile: yarramate/core@0.1
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    description: Fronts ordering.
    status: current
relationships: []
`,
  }

  const extensionProfile = {
    path: 'profiles/delivery.yaml',
    source: `format: yarramate/profile/v1
id: example/delivery
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds:
  - id: implements
    name: Implements
    parent: yarramate/core@0.1#realization
`,
  }

  const bundledCatalogue = (() => {
    const loaded = loadQuestionCatalogue({
      path: 'catalogues/core-enrichment.yaml',
      source: readFileSync(
        join(
          resolve(fileURLToPath(new URL('.', import.meta.url)), '..'),
          'catalogues/core-enrichment.yaml',
        ),
        'utf8',
      ),
    })
    if (!loaded.ok) throw new Error('the bundled catalogue must load')
    return loaded.catalogue
  })()

  const evaluate = (sources: readonly { path: string; source: string }[]) => {
    const compiled = compileWorkspaceWithProfileContext([...sources])
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) throw new Error('fixture must compile')
    const report = evaluateCatalogue(
      bundledCatalogue,
      compiled.graph,
      compiled.profileContext,
    )
    return report.waves
      .flatMap((wave) => wave.questions)
      .find((entry) => entry.id === 'subjects-near-duplicate')!
  }

  it('leaves the evaluation byte-identical when the extension adds no documents', () => {
    expect(JSON.stringify(evaluate([extensionProfile, coreOnly]))).toBe(
      JSON.stringify(evaluate([coreOnly])),
    )
  })

  it('never pairs a core subject with an arrival declared under the extension own kind', () => {
    // Exact-kind bucketing is what makes this safe: the arrival lands in its
    // own bucket, so the pre-existing core subject keeps its verdict even
    // though the two names would otherwise score a match.
    const question = evaluate([
      extensionProfile,
      coreOnly,
      {
        path: 'architecture/delivery.yaml',
        source: `format: yarramate/v1
id: delivery
profile: example/delivery@1.0
concepts:
  - id: orders-service
    kind: microservice
    name: Orders Service
    description: Handles ordering.
    status: current
relationships: []
`,
      },
    ])
    expect(question.open).toBe(false)
  })
})

describe('the near-duplicate question end to end', () => {
  let workspace: string

  const manifest =
    'format: yarramate/workspace/v1\n' +
    'id: identity-fixture\n' +
    'documents:\n' +
    '  - architecture/main.yaml\n' +
    'profiles: []\n' +
    'projections: []\n' +
    'adapterMappings: []\n' +
    'evidence: []\n'

  const documentWith = (extra: string): string =>
    'format: yarramate/v1\n' +
    'id: main\n' +
    'profile: yarramate/core@0.1\n' +
    'concepts:\n' +
    '  - id: order-gateway\n' +
    '    kind: applicationComponent\n' +
    '    name: Order Gateway\n' +
    '    description: Fronts ordering.\n' +
    '    status: current\n' +
    extra +
    '  - id: orders-service\n' +
    '    kind: applicationComponent\n' +
    '    name: Orders Service\n' +
    '    description: Handles ordering.\n' +
    '    status: current\n' +
    'relationships: []\n'

  const write = (extra: string) => {
    writeFileSync(join(workspace, 'architecture/main.yaml'), documentWith(extra), 'utf8')
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-identity-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('opens on both members and names the counterpart by qualified id', () => {
    write('')
    const result = runCli(['ask', 'workspace.yaml', '--open', '--json'], workspace)
    const report = JSON.parse(result.stdout).report
    const question = report.waves
      .flatMap((wave: { questions: unknown[] }) => wave.questions)
      .find((entry: { id: string }) => entry.id === 'subjects-near-duplicate')
    expect(question.open).toBe(true)
    expect(question.subjects).toHaveLength(2)
    expect(question.subjects[0].question).toContain('orders-service')
    expect(question.subjects[1].question).toContain('order-gateway')
  })

  it('closes permanently once one side records the distinctness judgment', () => {
    write('    distinctFrom:\n      - orders-service\n')
    const result = runCli(['ask', 'workspace.yaml', '--open', '--json'], workspace)
    const report = JSON.parse(result.stdout).report
    const question = report.waves
      .flatMap((wave: { questions: unknown[] }) => wave.questions)
      .find((entry: { id: string }) => entry.id === 'subjects-near-duplicate')
    expect(question.open).toBe(false)
    expect(question.subjects).toBeUndefined()
  })

  it('seeds a free-text slice through an alias the name never mentions', () => {
    write('    aka:\n      - OG\n')
    const bare = runCli(['ask', 'workspace.yaml', 'OG', '--json'], workspace)
    const seeded = JSON.parse(bare.stdout)
    expect(seeded.mode).toBe('slice')
    expect(seeded.seeds).toContain('order-gateway')
  })

  it('carries aliases through the roster within the ask-result contract', () => {
    write('    aka:\n      - OG\n')
    const result = runCli(['ask', 'workspace.yaml', '--subjects', '--json'], workspace)
    const parsed = JSON.parse(result.stdout)
    expect(
      parsed.subjects.find((entry: { id: string }) => entry.id === 'order-gateway')
        .aka,
    ).toEqual(['OG'])
    const validate = new Ajv2020({ allErrors: true }).compile(askResultSchema)
    expect(validate(parsed)).toBe(true)
  })
})
