import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspace,
  evaluateEvidence,
  evaluateEvidenceWorkspace,
  loadEvidence,
} from '../src/index.js'

const fixture = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`fixtures/${path}`, import.meta.url)),
    'utf8',
  )
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const Ajv2020 = Ajv2020Module.default

describe('evidence overlays', () => {
  it('serializes identically after semantically irrelevant key reordering', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const first = loadEvidence({
      path: 'first.evidence.yaml',
      source:
        'format: yarramate/evidence/v1\n' +
        'id: reordered\n' +
        'version: "1.0"\n' +
        'provider: repository-audit\n' +
        'observations:\n' +
        '  - subject: checkout#approval-api\n' +
        '    result: confirmed\n' +
        '    evidence:\n' +
        '      uri: repo:src/approval-api.ts\n' +
        '      message: Found implementation\n',
    })
    const second = loadEvidence({
      path: 'second.evidence.yaml',
      source:
        'provider: repository-audit\n' +
        'version: "1.0"\n' +
        'id: reordered\n' +
        'observations:\n' +
        '  - evidence:\n' +
        '      message: Found implementation\n' +
        '      uri: repo:src/approval-api.ts\n' +
        '    result: confirmed\n' +
        '    subject: checkout#approval-api\n' +
        'format: yarramate/evidence/v1\n',
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    const firstReport = evaluateEvidence(compilation.graph, first.evidence)
    const secondReport = evaluateEvidence(compilation.graph, second.evidence)

    expect(JSON.stringify(firstReport)).toBe(JSON.stringify(secondReport))
  })

  it('emits reports conforming to the normative report schema', () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          'schema/yarramate-evidence-report.schema.json',
        ),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadEvidence({
      path: 'repository.evidence.yaml',
      source: fixture('valid/repository-evidence.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const evaluation = evaluateEvidence(
      compilation.graph,
      loaded.evidence,
    )
    expect(evaluation.ok).toBe(true)
    if (!evaluation.ok) return

    expect(
      validate(evaluation.report),
      JSON.stringify(validate.errors ?? []),
    ).toBe(true)
  })

  it('enforces the closed normative evidence schema', () => {
    const loaded = loadEvidence({
      path: 'metadata.evidence.yaml',
      source:
        fixture('valid/repository-evidence.yaml') +
        'metadata: {}\n',
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'YM201',
        message: 'Property "metadata" is not allowed',
        pointer: '/metadata',
      }),
    )
  })

  it('evaluates existing subjects and claims without changing graph v2', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const graphBefore = JSON.stringify(compilation.graph)

    const loaded = loadEvidence({
      path: 'repository.evidence.yaml',
      source: fixture('valid/repository-evidence.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(evaluateEvidence(compilation.graph, loaded.evidence)).toEqual({
      ok: true,
      report: {
        format: 'yarramate/evidence-report/v1',
        evidence: 'checkout-repository@1.0',
        provider: 'repository-audit',
        summary: {
          confirmed: 1,
          contradicted: 1,
          unknown: 0,
          notObserved: 0,
        },
        observations: [
          {
            claim: 'checkout#api-realizes-approval',
            result: 'contradicted',
            evidence: {
              uri: 'repo:src/approval-api.ts',
              message: 'Expected realization marker was not found',
            },
          },
          {
            subject: 'checkout#approval-api',
            result: 'confirmed',
            evidence: { uri: 'repo:src/approval-api.ts' },
          },
        ],
      },
    })
    expect(JSON.stringify(compilation.graph)).toBe(graphBefore)
  })

  it('reports an unknown subject at its authored reference', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadEvidence({
      path: 'invalid.evidence.yaml',
      source: fixture('invalid/evidence-unknown-subject.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(evaluateEvidence(compilation.graph, loaded.evidence)).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM801',
          message: 'Evidence subject "checkout#missing" does not exist',
          path: 'invalid.evidence.yaml',
          pointer: '/observations/0/subject',
          line: 6,
          column: 14,
        },
      ],
    })
  })

  it('reports an unknown claim at its authored reference', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadEvidence({
      path: 'invalid-claim.evidence.yaml',
      source: fixture('invalid/evidence-unknown-claim.yaml'),
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const evaluation = evaluateEvidence(
      compilation.graph,
      loaded.evidence,
    )
    expect(evaluation.ok).toBe(false)
    if (evaluation.ok) return
    expect(evaluation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM802',
      message:
        'Evidence claim "checkout#missing-claim" does not exist',
      path: 'invalid-claim.evidence.yaml',
      pointer: '/observations/0/claim',
      line: 6,
      column: 12,
    })
  })

  it('rejects evaluating the same target more than once', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadEvidence({
      path: 'duplicate.evidence.yaml',
      source:
        'format: yarramate/evidence/v1\n' +
        'id: duplicate\n' +
        'version: "1.0"\n' +
        'provider: repository-audit\n' +
        'observations:\n' +
        '  - subject: checkout#approval-api\n' +
        '    result: confirmed\n' +
        '    evidence:\n' +
        '      uri: repo:first\n' +
        '  - subject: checkout#approval-api\n' +
        '    result: contradicted\n' +
        '    evidence:\n' +
        '      uri: repo:second\n',
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const evaluation = evaluateEvidence(
      compilation.graph,
      loaded.evidence,
    )
    expect(evaluation.ok).toBe(false)
    if (evaluation.ok) return
    expect(evaluation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM803',
      message:
        'Evidence target "checkout#approval-api" is evaluated more than once',
      path: 'duplicate.evidence.yaml',
      pointer: '/observations/1/subject',
      line: 10,
      column: 14,
    })
  })

  it('evaluates the repository overlay and resolves confirmed repo locators', () => {
    const source = (path: string) => ({
      path,
      source: readFileSync(join(repositoryRoot, path), 'utf8'),
    })
    const compilation = compileWorkspace([
      source('.yarramate/profiles/yarramate-development.yaml'),
      source('.yarramate/architecture/product.yaml'),
      source('.yarramate/architecture/engine.yaml'),
      source('.yarramate/architecture/evolution.yaml'),
      source('.yarramate/architecture/repository.yaml'),
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const loaded = loadEvidence(
      source('.yarramate/evidence/repository.yaml'),
    )
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(evaluateEvidence(compilation.graph, loaded.evidence).ok).toBe(
      true,
    )
    expect(
      loaded.evidence.observations.every(
        (observation) =>
          observation.result !== 'confirmed' ||
          (observation.evidence.uri.startsWith('repo:') &&
            existsSync(
              join(
                repositoryRoot,
                observation.evidence.uri.slice('repo:'.length),
              ),
            )),
      ),
    ).toBe(true)
  })

  it('rejects duplicate versioned evidence identities in one workspace', () => {
    const compilation = compileWorkspace([
      {
        path: 'checkout.yaml',
        source: fixture('valid/minimal.yaml'),
      },
    ])
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const first = loadEvidence({
      path: 'first.evidence.yaml',
      source: fixture('valid/repository-evidence.yaml'),
    })
    const second = loadEvidence({
      path: 'second.evidence.yaml',
      source: fixture('valid/repository-evidence.yaml'),
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const evaluation = evaluateEvidenceWorkspace(compilation.graph, [
      first.evidence,
      second.evidence,
    ])
    expect(evaluation.ok).toBe(false)
    if (evaluation.ok) return
    expect(evaluation.diagnostics).toContainEqual({
      severity: 'error',
      code: 'YM804',
      message:
        'Evidence document "checkout-repository@1.0" is declared more than once',
      path: 'second.evidence.yaml',
      pointer: '/id',
      line: 2,
      column: 5,
    })
  })
})
