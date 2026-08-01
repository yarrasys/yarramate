import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const fixture = (journey: 'discovery' | 'design', path: string) =>
  join('test/fixtures/journeys', journey, path)

describe('agent journeys through the stable CLI', () => {
  it('checks, evaluates evidence for, and renders an existing-project discovery proposal', () => {
    const workspace = fixture('discovery', '.yarramate/workspace.yaml')
    const check = runCli(['check', workspace, '--json'], repositoryRoot)
    const context = runCli(
      [
        'ask',
        workspace,
        fixture('discovery', '.yarramate/projections/project-context.yaml'),
        '--json',
      ],
      repositoryRoot,
    )
    const reconciliation = runCli(
      ['reconcile', workspace],
      repositoryRoot,
    )

    expect(JSON.parse(check.stdout)).toEqual({
      format: 'yarramate/check-result/v1',
      ok: true,
      diagnostics: [],
      counted: {
        documents: 1,
        concepts: 4,
        relationships: 3,
        states: 0,
      },
    })
    expect(JSON.parse(reconciliation.stdout).summary).toMatchObject({
      observations: 4,
      confirmed: 3,
      contradicted: 1,
      unknown: 0,
      notObserved: 0,
    })
    expect(JSON.parse(context.stdout).result.subjects).toEqual([
      { id: 'orders-project#customer', type: 'concept' },
      { id: 'orders-project#order-api', type: 'concept' },
      { id: 'orders-project#order-api-accesses-order-record', type: 'relationship' },
      { id: 'orders-project#order-api-realizes-order-service', type: 'relationship' },
      { id: 'orders-project#order-record', type: 'concept' },
      { id: 'orders-project#order-service', type: 'concept' },
      { id: 'orders-project#order-service-serves-customer', type: 'relationship' },
    ])
    expect(JSON.parse(reconciliation.stdout).findings).toEqual([
      expect.objectContaining({
        target: {
          type: 'subject',
          id: 'orders-project#customer',
        },
        result: 'contradicted',
      }),
    ])
  })

  it('checks alternatives and emits bounded target context before implementation', () => {
    const workspace = fixture('design', '.yarramate/workspace.yaml')
    const check = runCli(['check', workspace, '--json'], repositoryRoot)
    const alternatives = runCli(
      [
        'ask',
        workspace,
        fixture('design', '.yarramate/projections/alternatives.yaml'),
        '--json',
      ],
      repositoryRoot,
    )
    const target = runCli(
      [
        'ask',
        workspace,
        fixture('design', '.yarramate/projections/target-solution.yaml'),
        '--json',
      ],
      repositoryRoot,
    )
    const comparison = runCli(
      [
        'ask',
        workspace,
        '--compare',
        'delivery-design#empty-baseline',
        'delivery-design#target',
        '--json',
      ],
      repositoryRoot,
    )

    expect(JSON.parse(check.stdout).ok).toBe(true)
    expect(JSON.parse(alternatives.stdout).result.subjects).toEqual(
      expect.arrayContaining([
        { id: 'delivery-design#modular-monolith', type: 'concept' },
        { id: 'delivery-design#microservices', type: 'concept' },
      ]),
    )
    expect(JSON.parse(target.stdout).result.subjects).toEqual([
      { id: 'delivery-design#api-realizes-service', type: 'relationship' },
      { id: 'delivery-design#delivery-api', type: 'concept' },
      { id: 'delivery-design#delivery-data', type: 'concept' },
      { id: 'delivery-design#delivery-service', type: 'concept' },
      { id: 'delivery-design#modular-monolith', type: 'concept' },
      { id: 'delivery-design#modular-monolith-realizes-delivery', type: 'relationship' },
      { id: 'delivery-design#monolith-contains-api', type: 'relationship' },
      { id: 'delivery-design#monolith-contains-data', type: 'relationship' },
      { id: 'delivery-design#reliable-delivery', type: 'concept' },
    ])
    expect(JSON.parse(comparison.stdout).comparison.added).toHaveLength(6)
  })

  it('ships one portable skill for both journeys', () => {
    const skill = readFileSync(
      join(repositoryRoot, 'skills/yarramate-architecture/SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('## Discover an existing project')
    expect(skill).toContain('## Design a new solution')
    expect(skill).toContain('## Maintain an existing model')
    expect(skill).toContain('yarramate check')
    expect(skill).toContain('yarramate ask')
    expect(skill).toContain('yarramate apply')
    expect(skill).toContain('yarramate design')
    expect(skill.match(/yarramate export graph/g)).toHaveLength(2)
    for (const removed of [
      'yarramate status',
      'yarramate context',
      'yarramate compile',
      'yarramate view',
      'yarramate add',
      'yarramate connect',
      'yarramate interrogate',
      'yarramate evidence',
    ]) {
      expect(skill, removed).not.toContain(removed)
    }
    expect(skill.match(/yarramate-likec4 map --sync/g)).toHaveLength(3)
    expect(skill.match(/yarramate-likec4 export-project/g)).toHaveLength(3)
    expect(skill).toContain('Which concepts appear in no projection?')
    expect(skill).toContain(
      'Which ordered relationship chains have no dynamic view?',
    )
    expect(skill).toContain(
      'Which projections are absent from the LikeC4 project?',
    )
    expect(skill).toContain('views produced')
    for (const section of [
      skill.slice(
        skill.indexOf('## Discover an existing project'),
        skill.indexOf('## Design a new solution'),
      ),
      skill.slice(
        skill.indexOf('## Design a new solution'),
        skill.indexOf('## Maintain an existing model'),
      ),
      skill.slice(
        skill.indexOf('## Maintain an existing model'),
        skill.indexOf('## Correctness and authority'),
      ),
    ]) {
      expect(section).toMatch(
        /yarramate-likec4 check[\s\S]*yarramate-likec4 map --sync/,
      )
    }
    expect(skill).toContain(
      'A repair command cannot serve as verification.',
    )
    expect(skill).toContain(
      'The maintained model must pass before handoff.',
    )
    expect(skill).toContain(
      'Discover the repository’s authored paths instead of assuming these examples.',
    )
    expect(skill).toMatch(
      /Never promote evidence into declared intent\s+automatically\./,
    )
  })
})
