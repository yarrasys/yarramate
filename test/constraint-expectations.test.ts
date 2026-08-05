import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspace } from '../src/compiler.js'
import { serializeSemanticGraph } from '../src/graph.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const schemaFor = async (name: string) =>
  JSON.parse(
    JSON.stringify(
      await import(`../schema/yarramate-${name}.schema.json`, {
        with: { type: 'json' },
      }).then((module) => module.default),
    ),
  ) as object

const evidenceSchema = await schemaFor('evidence')
const reconciliationSchema = await schemaFor('reconciliation-report')

const workspaceManifest =
  'format: yarramate/workspace/v1\n' +
  'id: shop\n' +
  'documents:\n' +
  '  - architecture/*.yaml\n' +
  'profiles: []\n' +
  'projections: []\n' +
  'adapterMappings: []\n' +
  'evidence:\n' +
  '  - evidence/*.yaml\n'

const architecture =
  'format: yarramate/v1\n' +
  'id: shop\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: australia-only\n' +
  '    kind: constraint\n' +
  '    name: Customer data remains in Australia\n' +
  '  - id: customer-data\n' +
  '    kind: dataObject\n' +
  '    name: Customer data\n' +
  '    status: current\n' +
  '    constraints:\n' +
  '      - id: residency\n' +
  '        ref: australia-only\n' +
  '        expects:\n' +
  '          provider: terraform-scan\n' +
  '          key: region\n' +
  '          value: ap-southeast-2\n' +
  'relationships: []\n'

const observationEvidence = (value: string) =>
  'format: yarramate/evidence/v1\n' +
  'id: shop-terraform\n' +
  'version: "1.0"\n' +
  'provider: terraform-scan\n' +
  'observations:\n' +
  '  - subject: shop#customer-data\n' +
  '    result: confirmed\n' +
  '    key: region\n' +
  `    value: ${value}\n` +
  '    evidence:\n' +
  '      uri: repo:infra/main.tf#L12\n' +
  '      message: aws_s3_bucket.customer_data region\n'

const writeWorkspace = (evidence?: string): string => {
  const parent = mkdtempSync(join(tmpdir(), 'yarramate-expects-'))
  mkdirSync(join(parent, 'architecture'))
  mkdirSync(join(parent, 'evidence'))
  writeFileSync(join(parent, 'workspace.yaml'), workspaceManifest)
  writeFileSync(join(parent, 'architecture', 'shop.yaml'), architecture)
  if (evidence !== undefined) {
    writeFileSync(join(parent, 'evidence', 'terraform.yaml'), evidence)
  }
  return parent
}

const reconcile = (parent: string) => {
  const result = runCli(['reconcile', 'workspace.yaml'], parent)
  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(new Ajv2020({ strict: false }).compile(reconciliationSchema)(report))
    .toBe(true)
  return report as {
    summary: Record<string, number>
    findings: ReadonlyArray<Record<string, unknown>>
    unobservedExpectations?: ReadonlyArray<Record<string, unknown>>
  }
}

describe('constraints that declare an expected observation', () => {
  it('compiles expects into one claim in the existing envelope', () => {
    const compilation = compileWorkspace([
      { path: 'architecture/shop.yaml', source: architecture },
    ])

    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const expectation = compilation.graph.claims.find(
      ({ predicate }) => predicate === 'yarramate/constraint/expects',
    )
    expect(expectation).toEqual({
      id: 'shop#customer-data~expects-residency',
      subject: 'shop#customer-data',
      predicate: 'yarramate/constraint/expects',
      object: { value: 'terraform-scan region ap-southeast-2' },
      origin: 'declared',
      source: {
        document: 'shop',
        path: 'architecture/shop.yaml',
        pointer: '/concepts/1/constraints/0/expects/value',
        line: 18,
        column: 18,
      },
    })
    // The constraint reference itself is untouched by the expectation.
    expect(
      compilation.graph.claims.find(
        ({ id }) => id === 'shop#customer-data~constraint-residency',
      ),
    ).toMatchObject({
      predicate: 'yarramate/constraint/requires',
      object: { ref: 'shop#australia-only' },
    })
  })

  it('round-trips an authored expectation through apply and check', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-expects-apply-'))
    try {
      mkdirSync(join(parent, 'architecture'))
      writeFileSync(
        join(parent, 'workspace.yaml'),
        workspaceManifest.replace('evidence:\n  - evidence/*.yaml\n', 'evidence: []\n'),
      )
      writeFileSync(
        join(parent, 'architecture', 'shop.yaml'),
        'format: yarramate/v1\n' +
          'id: shop\n' +
          'profile: yarramate/core@0.1\n' +
          'concepts:\n' +
          '  - id: australia-only\n' +
          '    kind: constraint\n' +
          '    name: Customer data remains in Australia\n' +
          '  - id: customer-data\n' +
          '    kind: dataObject\n' +
          '    name: Customer data\n' +
          'relationships: []\n',
      )
      writeFileSync(
        join(parent, 'operations.yaml'),
        'format: yarramate/operations/v1\n' +
          'operations:\n' +
          '  - op: update-concept\n' +
          '    document: architecture/shop.yaml\n' +
          '    concept:\n' +
          '      id: customer-data\n' +
          '      constraints:\n' +
          '        - id: residency\n' +
          '          ref: australia-only\n' +
          '          expects:\n' +
          '            provider: terraform-scan\n' +
          '            key: region\n' +
          '            value: ap-southeast-2\n',
      )

      const applied = runCli(
        ['apply', 'operations.yaml', 'workspace.yaml'],
        parent,
      )
      expect(applied.exitCode).toBe(0)

      const written = readFileSync(
        join(parent, 'architecture', 'shop.yaml'),
        'utf8',
      )
      expect(written).toContain('expects:')
      expect(written).toContain('value: ap-southeast-2')

      const checked = runCli(['check', 'workspace.yaml'], parent)
      expect(checked.exitCode).toBe(0)

      const compilation = compileWorkspace([
        { path: 'architecture/shop.yaml', source: written },
      ])
      expect(compilation.ok).toBe(true)
      if (!compilation.ok) return
      expect(
        compilation.graph.claims.find(
          ({ predicate }) => predicate === 'yarramate/constraint/expects',
        )?.object,
      ).toEqual({ value: 'terraform-scan region ap-southeast-2' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('value observations in the evidence overlay', () => {
  const validate = new Ajv2020({ strict: false }).compile(evidenceSchema)

  it('accepts an observation carrying an observed key and value', () => {
    expect(
      validate({
        format: 'yarramate/evidence/v1',
        id: 'shop-terraform',
        version: '1.0',
        provider: 'terraform-scan',
        observations: [
          {
            subject: 'shop#customer-data',
            result: 'confirmed',
            key: 'region',
            value: 'ap-southeast-2',
            evidence: { uri: 'repo:infra/main.tf' },
          },
        ],
      }),
    ).toBe(true)
  })

  it('keeps presence and absence observations valid without a value', () => {
    expect(
      validate({
        format: 'yarramate/evidence/v1',
        id: 'shop-terraform',
        version: '1.0',
        provider: 'terraform-scan',
        observations: [
          {
            claim: 'shop#customer-data~constraint-residency',
            result: 'not-observed',
            evidence: { uri: 'repo:infra/main.tf' },
          },
        ],
      }),
    ).toBe(true)
  })

  it('rejects a key without a value and a value without a key', () => {
    const observation = (extra: Record<string, unknown>) => ({
      format: 'yarramate/evidence/v1',
      id: 'shop-terraform',
      version: '1.0',
      provider: 'terraform-scan',
      observations: [
        {
          subject: 'shop#customer-data',
          result: 'confirmed',
          ...extra,
          evidence: { uri: 'repo:infra/main.tf' },
        },
      ],
    })

    expect(validate(observation({ key: 'region' }))).toBe(false)
    expect(validate(observation({ value: 'ap-southeast-2' }))).toBe(false)
  })

  it('lets one provider report several keys at one target', () => {
    const parent = writeWorkspace(
      'format: yarramate/evidence/v1\n' +
        'id: shop-terraform\n' +
        'version: "1.0"\n' +
        'provider: terraform-scan\n' +
        'observations:\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    key: region\n' +
        '    value: ap-southeast-2\n' +
        '    evidence:\n' +
        '      uri: repo:infra/main.tf\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    key: encryption\n' +
        '    value: aes256\n' +
        '    evidence:\n' +
        '      uri: repo:infra/main.tf\n',
    )
    try {
      expect(runCli(['check', 'workspace.yaml'], parent).exitCode).toBe(0)
      expect(reconcile(parent).summary.observations).toBe(2)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('still rejects the same target and key evaluated twice', () => {
    const parent = writeWorkspace(
      'format: yarramate/evidence/v1\n' +
        'id: shop-terraform\n' +
        'version: "1.0"\n' +
        'provider: terraform-scan\n' +
        'observations:\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    key: region\n' +
        '    value: ap-southeast-2\n' +
        '    evidence:\n' +
        '      uri: repo:infra/main.tf\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    key: region\n' +
        '    value: us-east-1\n' +
        '    evidence:\n' +
        '      uri: repo:infra/other.tf\n',
    )
    try {
      const result = runCli(['check', 'workspace.yaml'], parent)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('YM803')
      expect(result.stdout).toContain('for key "region"')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('reconciling declared expectations against observed values', () => {
  it('contradicts a disagreeing value and renders both sides', () => {
    const parent = writeWorkspace(observationEvidence('us-east-1'))
    try {
      const report = reconcile(parent)

      expect(report.summary.contradicted).toBe(1)
      expect(report.summary.expectationsCompared).toBe(1)
      expect(report.summary.expectationsWithoutObservation).toBe(0)
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0]).toEqual({
        target: {
          type: 'claim',
          id: 'shop#customer-data~expects-residency',
        },
        expectation: {
          provider: 'terraform-scan',
          key: 'region',
          expected: 'ap-southeast-2',
          observed: 'us-east-1',
          declared: {
            document: 'shop',
            path: 'architecture/shop.yaml',
            pointer: '/concepts/1/constraints/0/expects/value',
            line: 18,
            column: 18,
          },
        },
        result: 'contradicted',
        provider: 'terraform-scan',
        evidenceDocument: 'shop-terraform@1.0',
        evidence: {
          uri: 'repo:infra/main.tf#L12',
          message: 'aws_s3_bucket.customer_data region',
        },
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('confirms an agreeing value without raising a finding', () => {
    const parent = writeWorkspace(observationEvidence('ap-southeast-2'))
    try {
      const report = reconcile(parent)

      expect(report.findings).toEqual([])
      expect(report.summary.contradicted).toBe(0)
      expect(report.summary.expectationsCompared).toBe(1)
      expect(report.summary.expectationsWithoutObservation).toBe(0)
      expect(report.unobservedExpectations).toBeUndefined()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports an expectation nobody observed instead of passing it', () => {
    const parent = writeWorkspace(
      'format: yarramate/evidence/v1\n' +
        'id: shop-terraform\n' +
        'version: "1.0"\n' +
        'provider: terraform-scan\n' +
        'observations:\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    evidence:\n' +
        '      uri: repo:infra/main.tf\n',
    )
    try {
      const report = reconcile(parent)

      expect(report.findings).toEqual([])
      expect(report.summary.expectationsCompared).toBe(0)
      expect(report.summary.expectationsWithoutObservation).toBe(1)
      expect(report.unobservedExpectations).toEqual([
        {
          claim: 'shop#customer-data~expects-residency',
          subject: 'shop#customer-data',
          provider: 'terraform-scan',
          key: 'region',
          expected: 'ap-southeast-2',
          declared: {
            document: 'shop',
            path: 'architecture/shop.yaml',
            pointer: '/concepts/1/constraints/0/expects/value',
            line: 18,
            column: 18,
          },
        },
      ])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('treats another provider reading the same key as no observation', () => {
    const parent = writeWorkspace(
      observationEvidence('us-east-1')
        .replace('provider: terraform-scan', 'provider: manifest-scan')
        .replace('id: shop-terraform', 'id: shop-manifest'),
    )
    try {
      const report = reconcile(parent)

      expect(report.findings).toEqual([])
      expect(report.summary.expectationsWithoutObservation).toBe(1)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('is deterministic across repeated runs', () => {
    const parent = writeWorkspace(observationEvidence('us-east-1'))
    try {
      const first = runCli(['reconcile', 'workspace.yaml'], parent)
      const second = runCli(['reconcile', 'workspace.yaml'], parent)

      expect(second.stdout).toBe(first.stdout)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('check --strict over a contradicted expectation', () => {
  it('fails strict with a diagnostic anchored at the declared value', () => {
    const parent = writeWorkspace(observationEvidence('us-east-1'))
    try {
      const strict = runCli(['check', 'workspace.yaml', '--strict'], parent)

      expect(strict.exitCode).toBe(1)
      expect(strict.stdout).toMatch(
        /^architecture\/shop\.yaml:18:18 error YM901/,
      )
      expect(strict.stdout).toContain('expects region to be "ap-southeast-2"')
      expect(strict.stdout).toContain('observed "us-east-1"')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('leaves the default check passing, exactly like other evidence', () => {
    const parent = writeWorkspace(observationEvidence('us-east-1'))
    try {
      const plain = runCli(['check', 'workspace.yaml'], parent)

      expect(plain.exitCode).toBe(0)
      expect(plain.stdout).toContain('no errors')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('passes strict when the observed value agrees', () => {
    const parent = writeWorkspace(observationEvidence('ap-southeast-2'))
    try {
      const strict = runCli(['check', 'workspace.yaml', '--strict'], parent)

      expect(strict.exitCode).toBe(0)
      expect(strict.stdout).toContain('Strict: 1 observation, 0 contradicted')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('does not gate on an expectation nobody observed', () => {
    const parent = writeWorkspace(
      'format: yarramate/evidence/v1\n' +
        'id: shop-terraform\n' +
        'version: "1.0"\n' +
        'provider: terraform-scan\n' +
        'observations:\n' +
        '  - subject: shop#customer-data\n' +
        '    result: confirmed\n' +
        '    evidence:\n' +
        '      uri: repo:infra/main.tf\n',
    )
    try {
      expect(
        runCli(['check', 'workspace.yaml', '--strict'], parent).exitCode,
      ).toBe(0)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('report growth composes with the stale-attestation additions', () => {
  const validate = new Ajv2020({ strict: false }).compile(reconciliationSchema)

  it('still validates a report produced before either change', () => {
    // Neither this change nor ADR 0074 may retire an older report: every
    // counter and array both added is optional.
    expect(
      validate({
        format: 'yarramate/reconciliation-report/v1',
        workspace: 'payments',
        summary: {
          evidenceDocuments: 1,
          observations: 3,
          confirmed: 1,
          findings: 2,
          contradicted: 2,
          unknown: 0,
          notObserved: 0,
          subjectsWithoutEvidence: 0,
        },
        findings: [
          {
            target: { type: 'subject', id: 'payments#billing' },
            result: 'contradicted',
            provider: 'repository-inspection',
            evidenceDocument: 'payments-repository@1.0',
            evidence: { uri: 'repo:src/billing.ts' },
          },
        ],
      }),
    ).toBe(true)
  })

  it('validates a report carrying both additions at once', () => {
    expect(
      validate({
        format: 'yarramate/reconciliation-report/v1',
        workspace: 'shop',
        summary: {
          evidenceDocuments: 1,
          observations: 1,
          confirmed: 1,
          findings: 1,
          contradicted: 0,
          unknown: 0,
          notObserved: 0,
          subjectsWithoutEvidence: 0,
          staleAttestations: 1,
          expectationsCompared: 0,
          expectationsWithoutObservation: 1,
        },
        findings: [
          {
            target: { type: 'subject', id: 'shop#customer-data' },
            result: 'stale-attestation',
            attestation: {
              topic: 'signed-off',
              by: 'Dana Okafor',
              on: '2026-01-15',
            },
            provider: 'git',
            evidence: { uri: 'git:9f2c1ab' },
          },
        ],
        unobservedExpectations: [
          {
            claim: 'shop#customer-data~expects-residency',
            subject: 'shop#customer-data',
            provider: 'terraform-scan',
            key: 'region',
            expected: 'ap-southeast-2',
            declared: {
              document: 'shop',
              path: 'architecture/shop.yaml',
              pointer: '/concepts/1/constraints/0/expects/value',
              line: 18,
              column: 18,
            },
          },
        ],
        notes: ['No git repository was found; staleness was not assessed.'],
      }),
    ).toBe(true)
  })
})

describe('graph v2 for models that declare no expectation', () => {
  it('serializes byte-identically to the pre-change canonical output', () => {
    const path = 'test/fixtures/valid/governed-change.yaml'
    const compilation = compileWorkspace([
      { path, source: readFileSync(join(repositoryRoot, path), 'utf8') },
    ])

    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    expect(serializeSemanticGraph(compilation.graph)).toBe(
      readFileSync(
        join(repositoryRoot, 'test/fixtures/valid/governed-change.graph.v2.json'),
        'utf8',
      ),
    )
  })
})
