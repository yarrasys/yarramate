import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/index.js'

// A constraint nothing tests is a comment. ADR 0083 made the same argument one
// level down: a kind nothing constrains is a label. These pin that a declared
// rule about the graph is now checked against the graph (ADR 0108).

const profile = 'yarramate/core@0.1'

const document = (forbids: string, extraRelationships = '') =>
  [
    'format: yarramate/v1',
    'id: main',
    `profile: ${profile}`,
    'concepts:',
    '  - id: git-io-through-gitaly',
    '    kind: constraint',
    '    name: Git I/O crosses Gitaly',
    forbids,
    '  - id: gitaly',
    '    kind: applicationComponent',
    '    name: Gitaly',
    '  - id: search-indexer',
    '    kind: applicationComponent',
    '    name: Search indexer',
    '  - id: git-repositories',
    '    kind: artifact',
    '    name: Git repositories',
    'relationships:',
    '  - id: gitaly-accesses-repositories',
    '    kind: access',
    '    from: gitaly',
    '    to: git-repositories',
    '    mode: read-write',
    extraRelationships,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')

const rule = [
  '    forbids:',
  '      - relationship: access',
  '        to: git-repositories',
  '        exceptFrom: ["gitaly"]',
].join('\n')

const violation = [
  '  - id: indexer-accesses-repositories',
  '    kind: access',
  '    from: search-indexer',
  '    to: git-repositories',
  '    mode: read',
].join('\n')

const compile = (source: string) =>
  compileWorkspace([{ path: 'architecture/main.yaml', source }])

describe('a declared constraint is checked against the graph', () => {
  it('passes when only the excepted subject reaches the target', () => {
    const result = compile(document(rule))
    expect(result.ok, JSON.stringify('diagnostics' in result ? result.diagnostics : [])).toBe(true)
  })

  it('fails, naming the rule and the relationship, when another subject does', () => {
    const result = compile(document(rule, violation))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    const forbidden = result.diagnostics.filter(({ code }) => code === 'YM415')
    expect(forbidden).toHaveLength(1)
    expect(forbidden[0]?.message).toContain('search-indexer')
    expect(forbidden[0]?.message).toContain('git-repositories')
    expect(forbidden[0]?.message).toContain('git-io-through-gitaly')
  })

  it('is inert when the model declares no rule, so nothing existing breaks', () => {
    const result = compile(document('    description: A rule with no predicate.', violation))
    expect(result.ok, JSON.stringify('diagnostics' in result ? result.diagnostics : [])).toBe(true)
  })

  it('honours exceptTo as well as exceptFrom', () => {
    const scoped = [
      '    forbids:',
      '      - relationship: access',
      '        from: search-indexer',
      '        exceptTo: ["git-repositories"]',
    ].join('\n')
    const result = compile(document(scoped, violation))
    expect(result.ok, JSON.stringify('diagnostics' in result ? result.diagnostics : [])).toBe(true)
  })
})
