import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const script = join(repositoryRoot, 'scripts/check-changelog.mjs')

/**
 * The guard that reports undocumented changes is itself a thing that can stop
 * working without anyone noticing, which is the failure it exists to prevent.
 * These run it against repositories built for the purpose rather than against
 * this one, whose history would make every expectation a moving target.
 */
describe('check-changelog', () => {
  let repository: string

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' })

  const commit = (subject: string, body = '') => {
    writeFileSync(join(repository, 'source.txt'), `${subject}\n`)
    git('add', '-A')
    git('commit', '-q', '-m', subject, ...(body === '' ? [] : ['-m', body]))
  }

  const writeChangelog = (contents: string) => {
    writeFileSync(join(repository, 'CHANGELOG.md'), contents)
    git('add', '-A')
    git('commit', '-q', '-m', 'docs: changelog')
  }

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: repository,
      encoding: 'utf8',
    })

  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'yarramate-changelog-guard-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(repository, 'CHANGELOG.md'), '# Changelog\n\n## 1.1.0\n')
    commit('chore: first')
    git('tag', 'v1.0.0')
  })

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true })
  })

  it('names a user-visible commit that wrote no entry', () => {
    commit('feat: something a user sees (#42)')

    const result = run('v1.0.0')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing a CHANGELOG entry')
    expect(result.stderr).toContain('feat: something a user sees (#42)')
  })

  it('accepts a commit that wrote its own entry', () => {
    writeChangelog('# Changelog\n\n## 1.1.0\n\n- Something (#42).\n')

    const result = run('v1.0.0')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('has a CHANGELOG entry')
  })

  it('accepts a commit a later catch-up entry cites', () => {
    commit('feat: something a user sees (#42)')
    writeChangelog('# Changelog\n\n## 1.1.0\n\n- Written later (#42).\n')

    const result = run('v1.0.0')

    expect(result.status).toBe(0)
  })

  it('does not accept a citation from an already released section', () => {
    commit('feat: something a user sees (#42)')
    writeChangelog('# Changelog\n\n## 1.1.0\n\n- Unrelated.\n\n## 1.0.0\n\n- Old (#42).\n')

    const result = run('v1.0.0')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('(#42)')
  })

  it('exempts a type that changes nothing a user sees', () => {
    commit('test: cover the thing')
    commit('refactor: move the thing')
    commit('ci: run the thing')

    const result = run('v1.0.0')

    expect(result.status).toBe(0)
  })

  it('honours a Changelog: none trailer on a user-visible commit', () => {
    commit('fix: something internal (#43)', 'Changelog: none')

    const result = run('v1.0.0')

    expect(result.status).toBe(0)
  })

  it('reports a subject nobody can classify', () => {
    commit('made some changes')

    const result = run('v1.0.0')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not conventional-commit form')
    expect(result.stderr).toContain('made some changes')
  })

  it('refuses a reference the repository does not know', () => {
    const result = run('v9.9.9')

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Not a commit this repository knows')
  })

  it('defaults to the most recent tag', () => {
    commit('feat: after the tag (#42)')

    const result = run()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('since v1.0.0')
  })
})
