import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { runLikeC4Cli } from '../src/adapters/likec4-cli.js'

const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const askSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-ask-result.schema.json'),
    'utf8',
  ),
) as object
const validateAsk = new Ajv2020({ allErrors: true }).compile(askSchema)

const baseDocument = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
`

const manifest = `format: yarramate/workspace/v1
id: changed-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - user.projection.yaml
adapterMappings: []
evidence: []
`

const userProjection = `format: yarramate/projection/v1
id: user-view
version: "1.0"
query:
  subjects: [main#user]
  relationships: none
presentation:
  title: User view
`

// Review slices derive from git (ADR 0065): the fixture is a real git
// repository with a committed base and uncommitted model changes.
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test',
    },
  })

describe('git-derived review slices', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-changed-'))
    mkdirSync(join(workspace, 'architecture'))
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      baseDocument,
      'utf8',
    )
    writeFileSync(join(workspace, 'workspace.yaml'), manifest, 'utf8')
    writeFileSync(join(workspace, 'user.projection.yaml'), userProjection, 'utf8')
    git(workspace, 'init', '-q')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-q', '-m', 'base')
    // The change under review: a new concept, a new relationship, and an
    // edit inside an existing concept.
    writeFileSync(
      join(workspace, 'architecture/main.yaml'),
      baseDocument
        .replace(
          '    status: planned\n',
          '    status: planned\n    description: Stores and serves todos.\n',
        )
        .replace(
          'relationships:',
          '  - id: todo-store\n' +
            '    kind: dataObject\n' +
            '    name: Todo store\n' +
            'relationships:',
        ) +
        '  - id: service-accesses-store\n' +
        '    kind: access\n' +
        '    from: todo-service\n' +
        '    to: todo-store\n' +
        '    mode: read-write\n',
      'utf8',
    )
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('derives the review slice from a git range with coverage', () => {
    const result = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD', '--json'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      mode: string
      addressing: string
      changed: {
        range: string
        concepts: readonly string[]
        relationships: readonly string[]
      }
      seeds: readonly string[]
      coverage: { projections: number; uncovered: readonly string[] }
    }
    expect(payload.mode).toBe('slice')
    expect(payload.addressing).toBe('changed')
    expect(payload.changed.concepts).toEqual([
      'main#todo-service',
      'main#todo-store',
    ])
    expect(payload.changed.relationships).toEqual([
      'main#service-accesses-store',
    ])
    expect(payload.seeds).toEqual(['main#todo-service', 'main#todo-store'])
    // The authored projection covers only main#user, so every changed
    // subject is review-uncovered — capability 3 of the proposal.
    expect(payload.coverage.projections).toBe(1)
    expect(payload.coverage.uncovered).toEqual([
      'main#todo-service',
      'main#todo-store',
      'main#service-accesses-store',
    ])
    expect(validateAsk(payload), JSON.stringify(validateAsk.errors)).toBe(true)

    const human = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD'],
      workspace,
    )
    expect(human.stdout).toContain('Review slice HEAD — 2 concepts, 1 relationship changed')
    expect(human.stdout).toContain('Todo store')
    expect(human.stdout).toContain(
      '3 of 3 changed subjects appear in no authored projection',
    )
  })

  it('reports an empty review honestly when nothing changed', () => {
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-q', '-m', 'change')
    const result = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD'],
      workspace,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('No model subjects changed in HEAD.\n')
  })

  it('exports the review slice as markdown and a briefs bundle', () => {
    const markdown = runCli(
      ['export', 'markdown', '--changed', 'HEAD', 'workspace.yaml'],
      workspace,
    )
    expect(markdown.exitCode).toBe(0)
    expect(markdown.stdout).toContain('# Review slice HEAD')
    expect(markdown.stdout).toContain('Todo store')

    const briefs = runCli(
      [
        'export',
        'briefs',
        '--changed',
        'HEAD',
        'workspace.yaml',
        '--out',
        'review',
      ],
      workspace,
    )
    expect(briefs.exitCode).toBe(0)
    expect(
      readFileSync(join(workspace, 'review/INDEX.md'), 'utf8'),
    ).toContain('Review slice HEAD')
    expect(
      readFileSync(join(workspace, 'review/main--todo-store.md'), 'utf8'),
    ).toContain('Todo store')
  })

  it('fails loudly outside a git repository', () => {
    rmSync(join(workspace, '.git'), { recursive: true, force: true })
    const result = runCli(
      ['ask', 'workspace.yaml', '--changed', 'HEAD'],
      workspace,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('git repository')
  })

  it('overlays the git range onto the LikeC4 export with a review view', () => {
    writeFileSync(
      join(workspace, 'mapping.yaml'),
      `format: yarramate/adapter-mapping/v1
id: changed-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: main#user
    external: user
    type: concept
  - native: main#todo-service
    external: todoService
    type: concept
  - native: main#todo-store
    external: todoStore
    type: concept
  - native: main#service-serves-user
    external: serviceServesUser
    type: relationship
  - native: main#service-accesses-store
    external: serviceAccessesStore
    type: relationship
`,
      'utf8',
    )
    writeFileSync(
      join(workspace, 'all.projection.yaml'),
      `format: yarramate/projection/v1
id: everything
version: "1.0"
query:
  documents: [main]
presentation:
  title: Everything
`,
      'utf8',
    )
    writeFileSync(
      join(workspace, 'likec4-project.yaml'),
      `format: yarramate/likec4-project/v1
id: changed-fixture
version: "1.0"
title: Changed fixture
mapping: mapping.yaml
views:
  - id: index
    projection: all.projection.yaml
`,
      'utf8',
    )
    const result = runLikeC4Cli(
      [
        'export-project',
        'likec4-project.yaml',
        'viz',
        'workspace.yaml',
        '--changed',
        'HEAD',
      ],
      workspace,
    )
    expect(result.exitCode, result.stdout + result.stderr).toBe(0)
    const model = readFileSync(join(workspace, 'viz/model.likec4'), 'utf8')
    // Metadata classifies new vs changed, derived from git.
    expect(model).toMatch(
      /todoStore[^]*?yarramateGitChange 'new'/,
    )
    expect(model).toMatch(
      /todoService[^]*?yarramateGitChange 'changed'/,
    )
    // Every ordinary view carries the highlight for its own members.
    expect(model).toContain('    style todoStore { color green }')
    expect(model).toContain('    style todoService { color amber }')
    // And the synthetic review view carries the legend.
    expect(model).toContain('view review-changes {')
    expect(model).toContain('Legend: green = new, amber = changed')
    expect(model).toContain(
      "include * -> * where metadata.yarramateId is 'main#service-accesses-store'",
    )
  })

  it('rejects --changed combined with other modes', () => {
    for (const args of [
      ['ask', 'workspace.yaml', '--changed', 'HEAD', 'todo'],
      ['ask', 'workspace.yaml', '--changed', 'HEAD', '--next'],
      ['export', 'graph', '--changed', 'HEAD', 'workspace.yaml'],
    ]) {
      const result = runCli(args, workspace)
      expect(result.exitCode, args.join(' ')).toBe(2)
      expect(result.stderr, args.join(' ')).toContain('Usage:')
    }
  })
})
