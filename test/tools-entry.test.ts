import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { runLikeC4Cli } from '../src/adapters/likec4-cli.js'
import type { WriteConflict } from '../src/source-store.js'
import {
  TOOL_CATALOGUE,
  applyBatch,
  askKinds,
  askNext,
  askOpen,
  askOrientation,
  askRoster,
  askSlice,
  checkWorkspace,
  designStep,
  exportBriefs,
  exportGraph,
  exportLikeC4,
  exportMarkdown,
  exportRtm,
  exportWorkbook,
  resolveWorkspaceFrom,
  runTool,
  sha256Hex,
  type PendingWrite,
  type SourceStore,
  type ToolWorkspace,
  type WriteOutcome,
} from '../src/tools-entry.js'

/**
 * The path-free entry against the CLI (ADR 0156). Every function here is
 * what the CLI runs, so the two are compared on the repository's own
 * record: the same JSON, byte for byte, from a store that holds the files
 * in memory and from the CLI reading them from disk.
 */

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const walk = (root: string, directory: string, into: Map<string, string>) => {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) walk(root, absolute, into)
    else {
      into.set(
        relative(root, absolute).split(sep).join('/'),
        readFileSync(absolute, 'utf8'),
      )
    }
  }
}

/** An in-memory store rooted at the repository: `.yarramate/**` plus what a contract names. */
const memoryStore = (files: Map<string, string>): SourceStore => {
  const revisions = new Map<string, string>()
  const revisionOf = (path: string) => {
    const held = revisions.get(path)
    if (held !== undefined) return held
    const digest = sha256Hex(files.get(path) ?? '')
    revisions.set(path, digest)
    return digest
  }
  return {
    list: () => [...files.keys()].sort(),
    read: (path) => {
      const source = files.get(path)
      return source === undefined ? undefined : { source, revision: revisionOf(path) }
    },
    writeAll: (writes: readonly PendingWrite[]): WriteOutcome => {
      const conflicts: WriteConflict[] = []
      for (const write of writes) {
        const current = files.has(write.path) ? revisionOf(write.path) : null
        if (write.expected === null && current !== null) {
          conflicts.push({ path: write.path, reason: 'exists' })
        } else if (write.expected !== null && current === null) {
          conflicts.push({ path: write.path, reason: 'missing' })
        } else if (write.expected !== null && current !== write.expected) {
          conflicts.push({ path: write.path, reason: 'changed' })
        }
      }
      if (conflicts.length > 0) return { ok: false, conflicts }
      const landed = new Map<string, string>()
      for (const write of writes) {
        if (write.source === null) {
          files.delete(write.path)
          revisions.delete(write.path)
          continue
        }
        files.set(write.path, write.source)
        revisions.delete(write.path)
        landed.set(write.path, revisionOf(write.path))
      }
      return { ok: true, revisions: landed }
    },
  }
}

const repositoryFiles = (): Map<string, string> => {
  const files = new Map<string, string>()
  walk(repositoryRoot, resolve(repositoryRoot, '.yarramate'), files)
  // What the Core contract names by repository-root path.
  files.set('package.json', readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
  walk(repositoryRoot, resolve(repositoryRoot, 'schema'), files)
  return files
}

const repositoryWorkspace = (): ToolWorkspace => {
  const files = repositoryFiles()
  const manifest = {
    path: '.yarramate/workspace.yaml',
    source: files.get('.yarramate/workspace.yaml')!,
  }
  const resolved = resolveWorkspaceFrom(manifest, [...files.keys()])
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
  return {
    store: memoryStore(files),
    workspace: resolved.workspace,
    manifestDirectory: '.yarramate',
  }
}

const cliJson = (args: readonly string[]): unknown => {
  const result = runCli([...args], repositoryRoot)
  expect(result.exitCode, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

const WORKSPACE = '.yarramate/workspace.yaml'

describe('yarramate/tools answers what the CLI answers', () => {
  const tool = repositoryWorkspace()

  it('design', () => {
    const stepped = designStep(tool)
    expect(stepped.ok).toBe(true)
    if (stepped.ok) {
      expect(stepped.result).toEqual(cliJson(['design', WORKSPACE, '--json']))
    }
    const unknown = designStep(tool, { subject: 'nowhere#nothing' })
    expect(unknown).toMatchObject({ ok: false, reason: 'refused' })
  })

  it('check', () => {
    expect(checkWorkspace(tool)).toEqual(cliJson(['check', WORKSPACE, '--json']))
    expect(checkWorkspace(tool, { strict: true })).toEqual(
      cliJson(['check', WORKSPACE, '--json', '--strict']),
    )
    // A failing check is the normal answer: ok false, the diagnostics, and no
    // counts, exactly the shape `check --json` prints for one. The model
    // still compiles here; a projection naming a subject nobody declares is
    // what fails, so the counts exist and must still be withheld.
    const files = repositoryFiles()
    const dangling = '.yarramate/projections/dangling-probe.yaml'
    files.set(
      dangling,
      'format: yarramate/projection/v1\nid: dangling-probe\nversion: "0.0"\nquery:\n  subjects:\n    - nowhere-nothing\n',
    )
    const broken = checkWorkspace({
      store: memoryStore(files),
      workspace: {
        ...tool.workspace,
        projections: [...tool.workspace.projections, dangling],
      },
      manifestDirectory: '.yarramate',
    })
    expect(broken.ok).toBe(false)
    expect(broken.diagnostics.map(({ path }) => path)).toContain(dangling)
    expect(broken).not.toHaveProperty('counted')
  })

  it('ask, every mode', () => {
    const oriented = askOrientation(tool)
    expect(oriented.ok).toBe(true)
    if (oriented.ok) {
      expect(oriented.result).toEqual(cliJson(['ask', WORKSPACE, '--json']))
    }
    const roster = askRoster(tool, { kind: 'compiler', status: 'current' })
    expect(roster.ok).toBe(true)
    if (roster.ok) {
      expect(roster.result).toEqual(
        cliJson(['ask', WORKSPACE, '--subjects', '--kind', 'compiler', '--status', 'current', '--json']),
      )
    }
    const kinds = askKinds(tool)
    expect(kinds.ok).toBe(true)
    if (kinds.ok) {
      expect(kinds.result).toEqual(cliJson(['ask', WORKSPACE, '--kinds', '--json']))
    }
    const next = askNext(tool)
    expect(next.ok).toBe(true)
    if (next.ok) {
      expect(next.result).toEqual(cliJson(['ask', WORKSPACE, '--next', '--json']))
    }
    const open = askOpen(tool)
    expect(open.ok).toBe(true)
    if (open.ok) {
      expect(open.result).toEqual(cliJson(['ask', WORKSPACE, '--open', '--json']))
    }
  })

  it('ask slices by text, by subject and by projection, and carries the rendered text', () => {
    const byText = askSlice(tool, { text: 'compiler' })
    expect(byText.ok).toBe(true)
    if (byText.ok) {
      const { rendered, ...document } = byText.result
      expect(document).toEqual(cliJson(['ask', WORKSPACE, 'compiler', '--json']))
      // The CLI's human form is the header (free text only), the brief, and
      // the neighbourhood line; `rendered` is the brief.
      expect(runCli(['ask', WORKSPACE, 'compiler'], repositoryRoot).stdout).toContain(
        rendered!.trimEnd(),
      )
    }
    const seed = byText.ok ? byText.result.seeds![0]! : ''
    const bySubject = askSlice(tool, { subjects: [seed] }, { neighbours: 0 })
    expect(bySubject.ok).toBe(true)
    if (bySubject.ok) {
      expect(bySubject.result.addressing).toBe('subjects')
      const { rendered, ...document } = bySubject.result
      expect(document).toEqual(
        cliJson(['ask', WORKSPACE, seed, '--neighbours', '0', '--json']),
      )
      expect(rendered).toBe(runCli(['ask', WORKSPACE, seed, '--neighbours', '0'], repositoryRoot).stdout)
    }
    const projection = tool.workspace.projections[0]!
    const byProjection = askSlice(tool, { projection })
    expect(byProjection.ok).toBe(true)
    if (byProjection.ok) {
      const { rendered, ...document } = byProjection.result
      expect(document).toEqual(cliJson(['ask', WORKSPACE, projection, '--json']))
      expect(rendered).toBe(runCli(['ask', WORKSPACE, projection], repositoryRoot).stdout)
    }
    expect(askSlice(tool, { projection }, { neighbours: 3 })).toMatchObject({
      ok: false,
      reason: 'refused',
    })
    expect(askSlice(tool, { text: 'zzzz-nothing-matches-this' })).toMatchObject({
      ok: false,
      reason: 'refused',
    })
  })

  it('export, every text kind', () => {
    const projection = tool.workspace.projections[0]!
    const markdown = exportMarkdown(tool, projection)
    expect(markdown.ok).toBe(true)
    if (markdown.ok) {
      expect(markdown.result.markdown).toBe(
        runCli(['export', 'markdown', projection, WORKSPACE], repositoryRoot).stdout,
      )
    }
    const graph = exportGraph(tool)
    expect(graph.ok).toBe(true)
    if (graph.ok) {
      expect(graph.result.json).toBe(
        runCli(['export', 'graph', WORKSPACE], repositoryRoot).stdout,
      )
    }
    const rtm = exportRtm(tool)
    expect(rtm.ok).toBe(true)
    if (rtm.ok) {
      expect(rtm.result.markdown).toMatch(/^# Requirements traceability matrix/)
      expect(rtm.result.rtm.summary.rows).toBeGreaterThan(0)
    }
    const briefs = exportBriefs(tool, projection, { budget: 400 })
    expect(briefs.ok).toBe(true)
    if (briefs.ok) {
      expect(briefs.result.files[0]?.path).toBe('INDEX.md')
      expect(briefs.result.files.length).toBe(briefs.result.concepts + 1)
    }
  })

  it('export xlsx and likec4 answer bytes and files with the same digests the CLI writes', () => {
    const projection = tool.workspace.projections[0]!
    const workbook = exportWorkbook(tool, projection)
    expect(workbook.ok).toBe(true)
    if (workbook.ok) {
      // A zip container: the local file header signature.
      expect([...workbook.result.bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
      expect(workbook.result.filename).toMatch(/\.xlsx$/)
    }
    const likec4 = exportLikeC4(tool, '.yarramate/likec4-project.yaml')
    expect(likec4.ok).toBe(true)
    if (likec4.ok) {
      const paths = likec4.result.files.map(({ path }) => path)
      expect(paths).toEqual([
        'likec4.config.json',
        'model.likec4',
        'specification.likec4',
        'yarramate.generated.json',
      ])
      const marker = JSON.parse(
        likec4.result.files.find(({ path }) => path === 'yarramate.generated.json')!.source,
      ) as { readonly digests: Record<string, string>; readonly inputDigests: Record<string, string> }
      const model = likec4.result.files.find(({ path }) => path === 'model.likec4')!.source
      expect(marker.digests['model.likec4']).toBe(sha256Hex(model))
      // The CLI writes the same four files from the same record; every one
      // of them, the marker with its digests included, is byte-identical.
      const scratch = mkdtempSync(join(tmpdir(), 'yarramate-tools-likec4-'))
      // The CLI creates its output directory itself and refuses one that
      // already exists without a marker, so it gets a path that is not there.
      const out = join(scratch, 'project')
      try {
        const written = runLikeC4Cli(
          ['export-project', '.yarramate/likec4-project.yaml', out, WORKSPACE],
          repositoryRoot,
        )
        expect(written.exitCode, written.stderr).toBe(0)
        for (const file of likec4.result.files) {
          expect(readFileSync(join(out, file.path), 'utf8'), file.path).toBe(
            file.source,
          )
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  })

  it('apply lands one atomic batch through the store and refuses a bad one whole', () => {
    const files = repositoryFiles()
    const manifest = { path: WORKSPACE, source: files.get(WORKSPACE)! }
    const resolved = resolveWorkspaceFrom(manifest, [...files.keys()])
    if (!resolved.ok) throw new Error('manifest')
    const store = memoryStore(files)
    const scratch: ToolWorkspace = {
      store,
      workspace: resolved.workspace,
      manifestDirectory: '.yarramate',
    }
    const document = resolved.workspace.documents[0]!
    const before = store.read(document)!.revision
    const landed = applyBatch(scratch, {
      document: {
        format: 'yarramate/operations/v1',
        operations: [
          {
            op: 'add-concept',
            document,
            concept: {
              id: 'tools-entry-probe',
              kind: 'applicationComponent',
              name: 'Tools entry probe',
              description: 'Added by the tools entry test.',
              status: 'planned',
            },
          },
        ],
      },
    })
    expect(landed.ok).toBe(true)
    if (landed.ok) {
      expect(landed.result.applied.addedConcepts).toBe(1)
      expect(landed.result.documents).toEqual([document])
    }
    expect(store.read(document)!.revision).not.toBe(before)
    expect(store.read(document)!.source).toContain('tools-entry-probe')

    const refused = applyBatch(scratch, 'format: yarramate/operations/v1\noperations:\n  - op: add-concept\n    document: nowhere.yaml\n    concept:\n      id: x\n      kind: goal\n      name: X\n')
    expect(refused).toMatchObject({ ok: false, reason: 'diagnostics' })
    expect(applyBatch(scratch, {} as never)).toMatchObject({ ok: false })
  })
})

describe('runTool and the table', () => {
  const tool = repositoryWorkspace()

  it('serves every row but reconcile, and says why not', () => {
    expect(TOOL_CATALOGUE.map(({ name }) => name)).toEqual([
      'yarramate_ask',
      'yarramate_design',
      'yarramate_apply',
      'yarramate_check',
      'yarramate_reconcile',
      'yarramate_export',
    ])
    for (const row of TOOL_CATALOGUE) {
      expect(row.description).toContain('yarramate_apply')
      expect(row.description).toContain('yarramate_design')
      expect(JSON.stringify(row.inputSchema)).not.toContain('"workspace"')
      expect(JSON.stringify(row.inputSchema)).not.toContain('"out"')
    }
    const reconcile = runTool('yarramate_reconcile', {}, tool)
    expect(reconcile.ok).toBe(false)
    expect(reconcile.text).toContain('not served here')
  })

  it('answers the JSON documents as text and the binary kinds as files', () => {
    const oriented = runTool('yarramate_ask', {}, tool)
    expect(oriented.ok).toBe(true)
    expect(JSON.parse(oriented.text)).toMatchObject({ mode: 'orientation' })
    const design = runTool('yarramate_design', {}, tool)
    expect(JSON.parse(design.text)).toMatchObject({ format: 'yarramate/design-step/v1' })
    const check = runTool('yarramate_check', {}, tool)
    expect(JSON.parse(check.text)).toMatchObject({ format: 'yarramate/check-result/v1', ok: true })
    // Every ask mode routes to its own function: the row's `mode` enum, one by one.
    for (const [mode, direct] of [
      ['subjects', askRoster],
      ['kinds', askKinds],
      ['next', askNext],
      ['open', askOpen],
    ] as const) {
      const routed = runTool('yarramate_ask', { mode }, tool)
      const expected = direct(tool)
      expect(routed.ok, mode).toBe(true)
      expect(expected.ok).toBe(true)
      if (expected.ok) expect(JSON.parse(routed.text), mode).toEqual(expected.result)
    }
    // A budget asks for the CLI's human form, exactly as `--budget` prints it.
    const budgeted = runTool('yarramate_ask', { query: 'compiler', budget: 200 }, tool)
    expect(budgeted.ok).toBe(true)
    expect(budgeted.text).toBe(
      runCli(['ask', WORKSPACE, 'compiler', '--budget', '200'], repositoryRoot).stdout,
    )
    const projection = tool.workspace.projections[0]!
    const workbook = runTool('yarramate_export', { kind: 'xlsx', projection }, tool)
    expect(workbook.kind).toBe('files')
    if (workbook.kind === 'files') {
      expect(workbook.files[0]?.bytes?.byteLength).toBeGreaterThan(0)
      expect(workbook.files[0]?.contentType).toContain('spreadsheet')
    }
    const likec4 = runTool(
      'yarramate_export',
      { kind: 'likec4', project: '.yarramate/likec4-project.yaml' },
      tool,
    )
    expect(likec4.kind).toBe('files')
    expect(runTool('yarramate_export', { kind: 'markdown' }, tool).text).toContain('needs `projection`')
    expect(runTool('yarramate_export', {}, tool).text).toContain('needs `kind`')
    expect(runTool('yarramate_apply', {}, tool).text).toContain('needs `operations`')
  })
})
