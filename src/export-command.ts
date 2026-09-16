import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { deriveChangedSubjects } from './changed.js'
import {
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import type { Diagnostic } from './compiler.js'
import { evaluateProjection, renderProjectionMarkdown } from './projection.js'
import { createFileSystemStore } from './source-store.js'
import { posixDirectoryOf } from './apply-command.js'
import {
  briefsFromResult,
  exportBriefs,
  exportGraph,
  exportMarkdown,
  exportRtm,
  exportWorkbook,
} from './tools/export.js'
import {
  compileOf,
  readSource,
  type ToolFailure,
  type ToolWorkspace,
} from './tools/workspace.js'
import { loadWorkspaceManifest } from './workspace.js'

// Every kind is derived in `tools/export.ts` (ADR 0156): this command
// parses arguments, resolves the manifest against the filesystem, and
// writes what the core hands back where `--out` says. The git-derived
// review slice (`--changed`) is the CLI's own and reuses the same pieces;
// the LikeC4 kind delegates to the `yarramate-likec4` binary, as before.

const here = dirname(fileURLToPath(import.meta.url))
const likec4AdapterEntry = join(here, 'adapters', 'likec4-cli.js')

interface ParsedExport {
  readonly positionals: readonly string[]
  readonly out?: string
  readonly budget?: number
  readonly changed?: string
  readonly json: boolean
}

const parseExportOptions = (
  options: readonly string[],
): ParsedExport | undefined => {
  const positionals: string[] = []
  let out: string | undefined
  let budget: number | undefined
  let changed: string | undefined
  let json = false
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--json') {
      json = true
      continue
    }
    if (
      option === '--out' ||
      option === '--budget' ||
      option === '--changed'
    ) {
      const value = options[index + 1]
      if (value === undefined || value.startsWith('-')) return undefined
      if (option === '--out') {
        if (out !== undefined) return undefined
        out = value
      } else if (option === '--changed') {
        if (changed !== undefined) return undefined
        changed = value
      } else {
        if (budget !== undefined || !/^[1-9][0-9]*$/.test(value)) {
          return undefined
        }
        budget = Number(value)
      }
      index += 1
      continue
    }
    if (option === undefined || option.startsWith('-')) return undefined
    positionals.push(option)
  }
  return {
    positionals,
    ...(out === undefined ? {} : { out }),
    ...(budget === undefined ? {} : { budget }),
    ...(changed === undefined ? {} : { changed }),
    json,
  }
}

export function runExportCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const [kind, ...rest] = options
  if (
    kind === undefined ||
    !['graph', 'markdown', 'briefs', 'rtm', 'likec4', 'xlsx'].includes(kind)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const parsed = parseExportOptions(rest)
  if (parsed === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  if (kind === 'likec4') {
    const [projectDefinition, outputDirectory, workspacePath] =
      parsed.positionals
    if (
      parsed.positionals.length !== 3 ||
      projectDefinition === undefined ||
      outputDirectory === undefined ||
      workspacePath === undefined ||
      parsed.out !== undefined ||
      parsed.budget !== undefined ||
      parsed.json
    ) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    const changedArguments =
      parsed.changed === undefined ? [] : ['--changed', parsed.changed]
    if (!existsSync(likec4AdapterEntry)) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          `LikeC4 adapter entry not found at ${likec4AdapterEntry}; ` +
          'run from the installed package or use the yarramate-likec4 binary directly\n',
      }
    }
    const delegated = spawnSync(
      process.execPath,
      [
        likec4AdapterEntry,
        'export-project',
        projectDefinition,
        outputDirectory,
        workspacePath,
        ...changedArguments,
      ],
      { cwd, encoding: 'utf8' },
    )
    const exitCode = delegated.status === 0 ? 0 : delegated.status === 1 ? 1 : 2
    return {
      exitCode,
      stdout: delegated.stdout ?? '',
      stderr: delegated.stderr ?? '',
    }
  }

  const usesChanged = parsed.changed !== undefined
  const expectedPositionals =
    kind === 'graph' || kind === 'rtm' || usesChanged ? 1 : 2
  const workspacePath = parsed.positionals[expectedPositionals - 1]
  const projectionPath =
    kind === 'graph' || kind === 'rtm' || usesChanged
      ? undefined
      : parsed.positionals[0]
  if (
    parsed.positionals.length !== expectedPositionals ||
    workspacePath === undefined ||
    parsed.json ||
    (usesChanged && (kind === 'graph' || kind === 'rtm')) ||
    (parsed.budget !== undefined && kind !== 'briefs') ||
    ((kind === 'briefs' || kind === 'rtm' || kind === 'xlsx') &&
      parsed.out === undefined)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(resolve(cwd, workspacePath), 'utf8')
    if (
      parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'export requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: humanDiagnostics(diagnostics),
      stderr: '',
    })
    const failedTool = (failure: ToolFailure): CliResult =>
      failure.reason === 'diagnostics'
        ? failed(failure.diagnostics)
        : { exitCode: 2, stdout: '', stderr: `${failure.message}\n` }
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace
    const tool: ToolWorkspace = {
      store: createFileSystemStore(cwd),
      workspace,
      manifestDirectory: posixDirectoryOf(workspacePath),
    }
    const writeText = (path: string, text: string): void => {
      const outPath = resolve(cwd, path)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, text, 'utf8')
    }

    if (kind === 'rtm') {
      const exported = exportRtm(tool)
      if (!exported.ok) return failedTool(exported)
      const { markdown, rtm } = exported.result
      writeText(join(parsed.out!, 'RTM.md'), markdown)
      writeText(join(parsed.out!, 'rtm.json'), `${JSON.stringify(rtm, null, 2)}\n`)
      return {
        exitCode: 0,
        stdout:
          `Wrote RTM.md and rtm.json (${rtm.summary.rows} row${
            rtm.summary.rows === 1 ? '' : 's'
          }, ${rtm.summary.gaps} gap${
            rtm.summary.gaps === 1 ? '' : 's'
          }) to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'graph') {
      const exported = exportGraph(tool)
      if (!exported.ok) return failedTool(exported)
      if (parsed.out === undefined) {
        return { exitCode: 0, stdout: exported.result.json, stderr: '' }
      }
      writeText(parsed.out, exported.result.json)
      return {
        exitCode: 0,
        stdout: `Wrote graph to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'xlsx') {
      const exported = exportWorkbook(tool, projectionPath!)
      if (!exported.ok) return failedTool(exported)
      const outPath = resolve(cwd, parsed.out!)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, exported.result.bytes)
      return {
        exitCode: 0,
        stdout: `Wrote workbook to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'markdown' && parsed.changed === undefined) {
      const exported = exportMarkdown(tool, projectionPath!)
      if (!exported.ok) return failedTool(exported)
      if (parsed.out === undefined) {
        return { exitCode: 0, stdout: exported.result.markdown, stderr: '' }
      }
      writeText(parsed.out, exported.result.markdown)
      return {
        exitCode: 0,
        stdout: `Wrote markdown to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'briefs' && parsed.changed === undefined) {
      const exported = exportBriefs(
        tool,
        projectionPath!,
        parsed.budget === undefined ? {} : { budget: parsed.budget },
      )
      if (!exported.ok) return failedTool(exported)
      for (const { path, markdown } of exported.result.files) {
        writeText(join(parsed.out!, path), markdown)
      }
      const count = exported.result.concepts
      return {
        exitCode: 0,
        stdout: `Wrote ${count} brief${count === 1 ? '' : 's'} and INDEX.md to ${parsed.out}\n`,
        stderr: '',
      }
    }

    // --changed: the review slice, seeded by what git says moved (ADR
    // 0065). The CLI's own, because it needs a repository; it renders and
    // writes through the same pieces the store-backed kinds use.
    const compilation = compileOf(tool)
    if (!compilation.ok) return failedTool(compilation)
    const { compiled } = compilation
    const documentIdByPath = new Map(
      compiled.graph.documents.map(({ id, source }) => [source, id]),
    )
    const derived = deriveChangedSubjects(
      cwd,
      parsed.changed!,
      workspace.documents.map((path) => ({
        ...readSource(tool, path),
        documentId: documentIdByPath.get(path) ?? path,
      })),
    )
    if (!derived.ok) {
      return { exitCode: 2, stdout: '', stderr: `${derived.message}\n` }
    }
    const endpoints = new Set<string>()
    for (const relationshipId of derived.changed.relationships) {
      const claim = compiled.graph.claims.find(
        (candidate) =>
          candidate.id === relationshipId && 'ref' in candidate.object,
      )
      if (claim !== undefined && 'ref' in claim.object) {
        endpoints.add(claim.subject)
        endpoints.add(claim.object.ref)
      }
    }
    const seeds = [
      ...new Set([...derived.changed.concepts, ...endpoints]),
    ].sort()
    const result = evaluateProjection(
      compiled.graph,
      {
        format: 'yarramate/projection/v1',
        id: 'review-slice',
        version: '0.0',
        query: { subjects: seeds, relationships: 'connected' },
        presentation: {
          title: `Review slice ${parsed.changed}`,
          description:
            `Connected neighbourhood of the subjects changed in ` +
            `${parsed.changed}.`,
        },
      },
      compiled.profileContext,
    )

    if (kind === 'markdown') {
      const rendered = renderProjectionMarkdown(result, compiled.profileContext)
      if (parsed.out === undefined) {
        return { exitCode: 0, stdout: rendered, stderr: '' }
      }
      writeText(parsed.out, rendered)
      return {
        exitCode: 0,
        stdout: `Wrote markdown to ${parsed.out}\n`,
        stderr: '',
      }
    }

    const briefs = briefsFromResult(
      compiled,
      result,
      parsed.budget === undefined ? {} : { budget: parsed.budget },
    )
    for (const { path, markdown } of briefs.files) {
      writeText(join(parsed.out!, path), markdown)
    }
    return {
      exitCode: 0,
      stdout: `Wrote ${briefs.concepts} brief${briefs.concepts === 1 ? '' : 's'} and INDEX.md to ${parsed.out}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
