import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const document =
  'format: yarramate/v1\n' +
  'id: main\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: fav-once\n' +
  '    kind: requirement\n' +
  '    name: Favourite once\n' +
  '    description: >-\n' +
  '      A signed-in reader may favourite an article at most once; responses\n' +
  '      never include the reader\'s email.\n' +
  '  - id: web-ui\n' +
  '    kind: applicationComponent\n' +
  '    name: Web UI\n' +
  '    status: current\n' +
  '  - id: rate-limiter\n' +
  '    kind: applicationComponent\n' +
  '    name: Rate limiter\n' +
  '    status: current\n' +
  '  - id: articles-store\n' +
  '    kind: dataObject\n' +
  '    name: Articles store\n' +
  '    status: current\n' +
  '  - id: favourites-store\n' +
  '    kind: dataObject\n' +
  '    name: Favourites store\n' +
  '    status: current\n' +
  '    description: One row per (reader, article); uniqueness enforced here.\n' +
  '  - id: favourites-api\n' +
  '    kind: applicationService\n' +
  '    name: Favourites API\n' +
  '    status: planned\n' +
  'relationships:\n' +
  '  - id: api-serves-ui\n' +
  '    kind: serving\n' +
  '    from: favourites-api\n' +
  '    to: web-ui\n' +
  '    description: favourite, unfavourite, count\n' +
  '  - id: api-writes-favourites\n' +
  '    kind: access\n' +
  '    from: favourites-api\n' +
  '    to: favourites-store\n' +
  '    mode: read-write\n' +
  '  - id: api-reads-articles\n' +
  '    kind: access\n' +
  '    from: favourites-api\n' +
  '    to: articles-store\n' +
  '    mode: read\n' +
  '  - id: api-realizes-fav-once\n' +
  '    kind: realization\n' +
  '    from: favourites-api\n' +
  '    to: fav-once\n' +
  '  - id: limiter-fronts-api\n' +
  '    kind: serving\n' +
  '    from: rate-limiter\n' +
  '    to: favourites-api\n' +
  '    description: fronts every mutating endpoint\n'

const projection =
  'format: yarramate/projection/v1\n' +
  'id: favourites-slice\n' +
  'version: "1.0"\n' +
  'query:\n' +
  '  documents: [main]\n' +
  'presentation:\n' +
  '  title: Favourites slice\n' +
  '  description: The favourites feature and its neighbours.\n'

const expectedBrief = `# Favourites slice

The favourites feature and its neighbours.

## Why this exists

Requirement "Favourite once": "A signed-in reader may favourite an article at most once; responses never include the reader's email."

## The pieces

You are building "Favourites API", an application service. It reads "Articles store". It realizes "Favourite once". It reads and writes "Favourites store". It serves "Web UI" (favourite, unfavourite, count).

"Articles store", a data object, already exists.

"Favourites store", a data object, already exists. One row per (reader, article); uniqueness enforced here.

"Rate limiter", an application component, already exists. It serves "Favourites API" (fronts every mutating endpoint).

"Web UI", an application component, already exists.
`

describe('context --brief', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-brief-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(join(workspace, 'architecture/main.yaml'), document, 'utf8')
    writeFileSync(join(workspace, 'projection.yaml'), projection, 'utf8')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('renders the slice as readable prose, byte-identically', () => {
    const first = runCli(
      ['context', 'projection.yaml', 'architecture/main.yaml', '--brief'],
      workspace,
    )
    const second = runCli(
      ['context', 'projection.yaml', 'architecture/main.yaml', '--brief'],
      workspace,
    )
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toBe(expectedBrief)
    expect(second.stdout).toBe(first.stdout)
  })

  it('announces paragraphs dropped under a budget instead of truncating', () => {
    const result = runCli(
      [
        'context',
        'projection.yaml',
        'architecture/main.yaml',
        '--brief',
        '--budget',
        '60',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Favourites slice')
    expect(result.stdout).toMatch(
      /\[budget 60: \d+ of 6 paragraphs omitted — raise --budget or drop --brief for the digest\]/,
    )
    const budgeted = runCli(
      [
        'context',
        'projection.yaml',
        'architecture/main.yaml',
        '--brief',
        '--budget',
        '10000',
      ],
      workspace,
    )
    expect(budgeted.stdout).toBe(expectedBrief)
  })

  it('renders an ad-hoc subject neighbourhood as a brief', () => {
    const result = runCli(
      [
        'context',
        '--subject',
        'main#favourites-api',
        'architecture/main.yaml',
        '--brief',
      ],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# Ad-hoc context')
    expect(result.stdout).toContain(
      'You are building "Favourites API", an application service.',
    )
    expect(result.stdout).toContain(
      'It serves "Web UI" (favourite, unfavourite, count).',
    )
  })

  it('keeps the digest and JSON modes untouched', () => {
    const json = runCli(
      ['context', 'projection.yaml', 'architecture/main.yaml'],
      workspace,
    )
    expect(json.exitCode).toBe(0)
    expect(JSON.parse(json.stdout).format).toBe(
      'yarramate/projection-result/v1',
    )
    const digest = runCli(
      [
        'context',
        'projection.yaml',
        'architecture/main.yaml',
        '--budget',
        '10000',
      ],
      workspace,
    )
    expect(digest.stdout).toContain('- main#favourites-api [applicationService]')
    expect(digest.stdout).not.toContain('You are building')
  })

  it('rejects --brief on view', () => {
    const result = runCli(
      ['view', 'projection.yaml', 'architecture/main.yaml', '--brief'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })

  it('renders the repository self-model briefs deterministically', () => {
    const args = [
      'context',
      '.yarramate/projections/product-context.yaml',
      '.yarramate/workspace.yaml',
      '--brief',
    ]
    const first = runCli(args, repositoryRoot)
    const second = runCli(args, repositoryRoot)
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toBe(second.stdout)
    expect(first.stdout).toContain('## The pieces')
  })
})
