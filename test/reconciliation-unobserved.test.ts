import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const reconciliationSchema = JSON.parse(
  JSON.stringify(
    await import('../schema/yarramate-reconciliation-report.schema.json', {
      with: { type: 'json' },
    }).then((module) => module.default),
  ),
) as object

const writeFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), 'yarramate-unobserved-'))
  mkdirSync(join(parent, 'architecture'))
  mkdirSync(join(parent, 'evidence'))
  writeFileSync(
    join(parent, 'workspace.yaml'),
    'format: yarramate/workspace/v1\n' +
      'id: shop\n' +
      'documents:\n' +
      '  - architecture/*.yaml\n' +
      'profiles: []\n' +
      'projections: []\n' +
      'adapterMappings: []\n' +
      'evidence:\n' +
      '  - evidence/*.yaml\n',
  )
  writeFileSync(
    join(parent, 'architecture', 'shop.yaml'),
    'format: yarramate/v1\n' +
      'id: shop\n' +
      'profile: yarramate/core@0.1\n' +
      'concepts:\n' +
      '  - id: zeta-service\n' +
      '    kind: applicationService\n' +
      '    name: Zeta\n' +
      '    status: current\n' +
      '  - id: checkout\n' +
      '    kind: applicationService\n' +
      '    name: Checkout\n' +
      '    status: current\n' +
      '  - id: basket\n' +
      '    kind: dataObject\n' +
      '    name: Basket\n' +
      '    status: current\n' +
      '  - id: alpha-service\n' +
      '    kind: applicationService\n' +
      '    name: Alpha\n' +
      '    status: current\n' +
      '  - id: catalog\n' +
      '    kind: applicationService\n' +
      '    name: Catalog\n' +
      '    status: current\n' +
      '  - id: search\n' +
      '    kind: applicationService\n' +
      '    name: Search\n' +
      '    status: planned\n' +
      '  - id: legacy-cart\n' +
      '    kind: applicationService\n' +
      '    name: Legacy cart\n' +
      '    status: retired\n' +
      'relationships:\n' +
      '  - id: checkout-accesses-basket\n' +
      '    kind: access\n' +
      '    from: checkout\n' +
      '    to: basket\n' +
      '    mode: write\n' +
      '  - id: catalog-accesses-basket\n' +
      '    kind: access\n' +
      '    from: catalog\n' +
      '    to: basket\n' +
      '    mode: read\n' +
      '    status: current\n',
  )
  writeFileSync(
    join(parent, 'evidence', 'repository.yaml'),
    'format: yarramate/evidence/v1\n' +
      'id: shop-repository\n' +
      'version: "1.0"\n' +
      'provider: repository-inspection\n' +
      'observations:\n' +
      '  - claim: shop#checkout-accesses-basket\n' +
      '    result: confirmed\n' +
      '    evidence:\n' +
      '      uri: repo:src/checkout.ts\n',
  )
  return parent
}

describe('reconciliation of current subjects without evidence', () => {
  it('lists and counts current concepts that no observation touches', () => {
    const parent = writeFixture()
    try {
      const result = runCli(['reconcile', 'workspace.yaml'], parent)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout)
      expect(report.summary.subjectsWithoutEvidence).toBe(3)
      expect(report.unobservedSubjects).toEqual([
        'shop#alpha-service',
        'shop#catalog',
        'shop#zeta-service',
      ])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('skips planned and retired concepts and relationship subjects', () => {
    const parent = writeFixture()
    try {
      const report = JSON.parse(
        runCli(['reconcile', 'workspace.yaml'], parent).stdout,
      )
      expect(report.unobservedSubjects).not.toContain('shop#search')
      expect(report.unobservedSubjects).not.toContain('shop#legacy-cart')
      expect(report.unobservedSubjects).not.toContain(
        'shop#catalog-accesses-basket',
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('treats relationship-claim endpoints as observed', () => {
    const parent = writeFixture()
    try {
      const report = JSON.parse(
        runCli(['reconcile', 'workspace.yaml'], parent).stdout,
      )
      expect(report.unobservedSubjects).not.toContain('shop#checkout')
      expect(report.unobservedSubjects).not.toContain('shop#basket')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('emits the same sorted report on repeated runs', () => {
    const parent = writeFixture()
    try {
      const first = runCli(['reconcile', 'workspace.yaml'], parent)
      const second = runCli(['reconcile', 'workspace.yaml'], parent)
      expect(first.stdout).toBe(second.stdout)
      const report = JSON.parse(first.stdout)
      expect(report.unobservedSubjects).toEqual(
        [...report.unobservedSubjects].sort((left: string, right: string) =>
          left.localeCompare(right),
        ),
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('remains valid against the normative reconciliation schema', () => {
    const parent = writeFixture()
    try {
      const report = JSON.parse(
        runCli(['reconcile', 'workspace.yaml'], parent).stdout,
      )
      const validate = new Ajv2020({ allErrors: true }).compile(
        reconciliationSchema,
      )
      expect(validate(report), JSON.stringify(validate.errors)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('surfaces the count on the ask orientation line', () => {
    const parent = writeFixture()
    try {
      const result = runCli(['ask', 'workspace.yaml'], parent)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(
        '3 current subjects without evidence',
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('omits unobservedSubjects when nothing current lacks evidence', () => {
    const result = runCli(
      ['reconcile', 'test/fixtures/valid/payments.workspace.yaml'],
      repositoryRoot,
    )
    const report = JSON.parse(result.stdout)
    expect(report.summary.subjectsWithoutEvidence).toBe(0)
    expect('unobservedSubjects' in report).toBe(false)
  })
})
