#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseDocument } from 'yaml'
import {
  isMainModule,
  packageVersion,
  versionResult,
} from '../cli-support.js'
import { runCli, type CliResult } from '../cli.js'
import { createFileSystemStore } from '../source-store.js'
import { loadWorkspaceManifest } from '../workspace.js'
import {
  LOOP,
  STDIO_PROPERTIES,
  TOOL_CATALOGUE,
  runTool,
  type ToolDefinition,
  type ToolName,
  type ToolOutcome,
} from '../tools/table.js'
import type { ToolWorkspace } from '../tools/workspace.js'

/**
 * The stdio adapter (ADR 0044, amended by ADR 0149 and ADR 0156).
 *
 * The tool table is the package's (`yarramate/tools`), and so is every
 * answer: a call resolves its workspace against the filesystem, then runs
 * the same `runTool` a hosted workspace runs over its own store. The CLI
 * commands are thin over those same functions, so what an agent gets here
 * is what a person gets from the CLI and what a hosted agent gets over the
 * network. The adapter's own work is the filesystem: which manifest, where
 * `out` writes, and `reconcile`, which reads a repository and still runs
 * the CLI.
 */

interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id?: number | string | null
  readonly method: string
  readonly params?: Record<string, unknown>
}

/**
 * Where a tool call resolves its workspace when the call names none
 * (#514). In order: the `--workspace` the server was started with, then the
 * conventional `.yarramate/workspace.yaml` under the working directory. A
 * desktop app starts the server from a directory that is not the repository,
 * so the first is the one that matters there; a terminal agent runs it from
 * the repository, so the second is what it gets for free.
 */
export interface ServerOptions {
  readonly workspace?: string
}

/** What a tool call needs from the server beyond its own arguments. */
export interface ToolContext {
  readonly cwd: string
  readonly workspace: string | undefined
}

/** The sentence the stdio rows add, because only here is there a `workspace` to name. */
const WORKSPACE_SENTENCE =
  'Every tool takes the same optional `workspace`; omit it to use the workspace this server was started with, or .yarramate/workspace.yaml under its working directory.'

const CONVENTIONAL_WORKSPACE = join('.yarramate', 'workspace.yaml')

/** The one refusal that is the server's own rather than the engine's. */
const noWorkspace = (): CliResult => ({
  exitCode: 2,
  stdout: '',
  stderr:
    'No workspace to work on. Pass `workspace` (the path to workspace.yaml) in the call, or start yarramate-mcp with --workspace <path>; a server started inside a repository that holds .yarramate/workspace.yaml needs neither.\n',
})

export const resolveWorkspace = (
  input: Record<string, unknown>,
  context: ToolContext,
): string | undefined => {
  if (typeof input.workspace === 'string' && input.workspace.length > 0) {
    return input.workspace
  }
  if (context.workspace !== undefined) return context.workspace
  return existsSync(resolve(context.cwd, CONVENTIONAL_WORKSPACE))
    ? CONVENTIONAL_WORKSPACE
    : undefined
}

/**
 * The CLI runs inside the repository: a manifest's globs resolve against the
 * manifest, but a record's contracts, coverage and evidence name files by
 * their repository-root path, which is the directory that holds `.yarramate`.
 * A desktop app starts this server anywhere, so a workspace given as a path
 * from elsewhere is run as the CLI would be run by a person standing in that
 * repository: working directory at the root, manifest path relative to it.
 */
export const workingDirectoryFor = (
  workspace: string,
  cwd: string,
): { readonly cwd: string; readonly workspace: string } => {
  const manifest = resolve(cwd, workspace)
  const holder = dirname(manifest)
  const root = basename(holder) === '.yarramate' ? dirname(holder) : holder
  return { cwd: root, workspace: relative(root, manifest) }
}

const refuse = (message: string): CliResult => ({
  exitCode: 2,
  stdout: '',
  stderr: `${message}\n`,
})

/** A tool outcome as the CLI result the transport already speaks. */
const asCliResult = (outcome: ToolOutcome): CliResult =>
  outcome.ok
    ? { exitCode: 0, stdout: outcome.text, stderr: '' }
    : { exitCode: 1, stdout: outcome.text, stderr: '' }

/**
 * The workspace a call runs over: the manifest resolved against the
 * filesystem, a store rooted at the repository, paths relative to it. The
 * same shape `yarramate apply` builds.
 */
const toolWorkspaceFor = (
  workspace: string,
  root: string,
):
  | { readonly ok: true; readonly tool: ToolWorkspace }
  | { readonly ok: false; readonly result: CliResult } => {
  let manifestSource: string
  try {
    manifestSource = readFileSync(resolve(root, workspace), 'utf8')
  } catch (error) {
    return {
      ok: false,
      result: refuse(error instanceof Error ? error.message : String(error)),
    }
  }
  if (parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1') {
    return {
      ok: false,
      result: refuse(
        `${workspace} is not a workspace manifest (yarramate/workspace/v1)`,
      ),
    }
  }
  const loaded = loadWorkspaceManifest(
    { path: workspace, source: manifestSource },
    root,
  )
  if (!loaded.ok) {
    return {
      ok: false,
      result: {
        exitCode: 1,
        stdout: `${JSON.stringify(
          {
            format: 'yarramate/diagnostic-result/v1',
            diagnostics: loaded.diagnostics,
          },
          null,
          2,
        )}\n`,
        stderr: '',
      },
    }
  }
  const manifestDirectory = workspace.includes('/')
    ? workspace.slice(0, workspace.lastIndexOf('/'))
    : ''
  return {
    ok: true,
    tool: {
      store: createFileSystemStore(root),
      workspace: loaded.workspace,
      manifestDirectory: manifestDirectory.split('\\').join('/'),
    },
  }
}

const withWorkspace = (
  input: Record<string, unknown>,
  context: ToolContext,
  run: (tool: ToolWorkspace, root: string, workspace: string) => CliResult,
): CliResult => {
  const named = resolveWorkspace(input, context)
  if (named === undefined) return noWorkspace()
  const { cwd, workspace } = workingDirectoryFor(named, context.cwd)
  const built = toolWorkspaceFor(workspace, cwd)
  if (!built.ok) return built.result
  return run(built.tool, cwd, workspace)
}

/**
 * `out` is the stdio adapter's: the text kinds write their text there when
 * it is given and return it otherwise; the binary and multi-file kinds need
 * it, because a stdio reply carries text and nothing else.
 */
const runExport = (
  input: Record<string, unknown>,
  tool: ToolWorkspace,
  root: string,
): CliResult => {
  const kind = typeof input.kind === 'string' ? input.kind : ''
  const projection =
    typeof input.projection === 'string' ? input.projection : undefined
  const out = typeof input.out === 'string' ? input.out : undefined
  if (kind === 'xlsx' && (projection === undefined || out === undefined)) {
    return refuse(
      'yarramate_export xlsx needs `projection` and `out`: the view to export and the .xlsx path to write; a workbook is binary and cannot come back as text.',
    )
  }
  if (kind === 'likec4') {
    const project = typeof input.project === 'string' ? input.project : undefined
    if (project === undefined || out === undefined) {
      return refuse(
        'yarramate_export likec4 needs `project` (the likec4-project.yaml) and `out` (the directory to write).',
      )
    }
  }
  const outcome = runTool('yarramate_export', input, tool)
  if (!outcome.ok || out === undefined) return asCliResult(outcome)
  const target = resolve(root, out)
  if (outcome.kind === 'files') {
    const directory =
      kind === 'xlsx' ? dirname(target) : target
    mkdirSync(directory, { recursive: true })
    for (const file of outcome.files) {
      const destination = kind === 'xlsx' ? target : join(target, file.path)
      if (file.bytes !== undefined) writeFileSync(destination, file.bytes)
      else writeFileSync(destination, file.text ?? '', 'utf8')
    }
    return {
      exitCode: 0,
      stdout:
        kind === 'xlsx'
          ? `Wrote workbook to ${out}\n`
          : `Wrote ${outcome.files.map(({ path }) => path).join(', ')} to ${out}\n`,
      stderr: '',
    }
  }
  // A text kind under `out`: markdown and graph are one file, rtm and
  // briefs a directory, as the CLI lays them out.
  if (kind === 'markdown' || kind === 'graph') {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, outcome.text, 'utf8')
    return {
      exitCode: 0,
      stdout: `Wrote ${kind} to ${out}\n`,
      stderr: '',
    }
  }
  if (kind === 'rtm') {
    const result = outcome.result as
      | { readonly rtm: unknown; readonly markdown: string }
      | undefined
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'RTM.md'), outcome.text, 'utf8')
    if (result !== undefined) {
      writeFileSync(
        join(target, 'rtm.json'),
        `${JSON.stringify(result.rtm, null, 2)}\n`,
        'utf8',
      )
    }
    return {
      exitCode: 0,
      stdout: `Wrote RTM.md and rtm.json to ${out}\n`,
      stderr: '',
    }
  }
  if (kind === 'briefs') {
    const result = outcome.result as
      | {
          readonly files: readonly {
            readonly path: string
            readonly markdown: string
          }[]
          readonly concepts: number
        }
      | undefined
    mkdirSync(target, { recursive: true })
    for (const file of result?.files ?? []) {
      writeFileSync(join(target, file.path), file.markdown, 'utf8')
    }
    const count = result?.concepts ?? 0
    return {
      exitCode: 0,
      stdout: `Wrote ${count} brief${count === 1 ? '' : 's'} and INDEX.md to ${out}\n`,
      stderr: '',
    }
  }
  return asCliResult(outcome)
}

const runNamed = (
  name: ToolName,
  input: Record<string, unknown>,
  context: ToolContext,
): CliResult => {
  if (name === 'yarramate_reconcile') {
    // Reconciliation reads the repository (git, coverage patterns), which
    // only the CLI does; it stays a CLI invocation.
    const named = resolveWorkspace(input, context)
    if (named === undefined) return noWorkspace()
    const { cwd, workspace } = workingDirectoryFor(named, context.cwd)
    return runCli(['reconcile', workspace], cwd)
  }
  return withWorkspace(input, context, (tool, root) =>
    name === 'yarramate_export'
      ? runExport(input, tool, root)
      : asCliResult(runTool(name, input, tool)),
  )
}

/**
 * The rows this server publishes: the package's, plus the stdio-only
 * argument properties and the sentence about them. Names, schemas and
 * descriptions are otherwise the catalogue's, byte for byte.
 */
const stdioRow = (
  tool: ToolDefinition<ToolName>,
): { name: string; description: string; inputSchema: Record<string, unknown> } => {
  const schema = tool.inputSchema as {
    readonly properties?: Record<string, unknown>
    readonly [key: string]: unknown
  }
  return {
    name: tool.name,
    description: `${tool.description} ${WORKSPACE_SENTENCE}`,
    inputSchema: {
      ...schema,
      properties: {
        workspace: STDIO_PROPERTIES.workspace,
        ...(schema.properties ?? {}),
        ...(tool.name === 'yarramate_export' ? { out: STDIO_PROPERTIES.out } : {}),
      },
    },
  }
}

/** The tool list a client sees; exported so a test can read it without stdio. */
export const toolCatalogue = TOOL_CATALOGUE.map(stdioRow)

const respond = (id: number | string | null, result: unknown): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const respondError = (
  id: number | string | null,
  code: number,
  message: string,
): void => {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`,
  )
}

export const handleRequest = (
  request: JsonRpcRequest,
  context: ToolContext = { cwd: process.cwd(), workspace: undefined },
): void => {
  const id = request.id ?? null
  if (request.method === 'initialize') {
    respond(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'yarramate', version: packageVersion },
      instructions: `The architecture record of a YarraMate workspace. The native documents in the repository are canonical; every read renders them, and yarramate_apply is the one write, the same atomic batch the CLI lands. ${LOOP} ${WORKSPACE_SENTENCE}`,
    })
    return
  }
  if (request.method === 'tools/list') {
    respond(id, { tools: toolCatalogue })
    return
  }
  if (request.method === 'tools/call') {
    const params = request.params ?? {}
    const name = typeof params.name === 'string' ? params.name : ''
    const tool = TOOL_CATALOGUE.find((candidate) => candidate.name === name)
    if (tool === undefined) {
      respondError(id, -32602, `Unknown tool "${name}"`)
      return
    }
    const input =
      typeof params.arguments === 'object' && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {}
    const result = runNamed(tool.name, input, context)
    respond(id, {
      content: [
        {
          type: 'text',
          text:
            result.exitCode === 0
              ? result.stdout
              : result.stdout || result.stderr,
        },
      ],
      isError: result.exitCode !== 0,
    })
    return
  }
  if (request.id !== undefined) {
    respondError(id, -32601, `Method "${request.method}" not found`)
  }
}

export const parseServerOptions = (
  argv: readonly string[],
): ServerOptions | undefined => {
  let workspace: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--workspace') {
      const value = argv[index + 1]
      if (
        value === undefined ||
        value.startsWith('-') ||
        workspace !== undefined
      ) {
        return undefined
      }
      workspace = value
      index += 1
      continue
    }
    return undefined
  }
  return { workspace }
}

export const serverUsage =
  'Usage:\n  yarramate-mcp [--workspace <workspace.yaml>]\n  yarramate-mcp --version\n'

if (isMainModule(import.meta.url, process.argv[1])) {
  if (process.argv[2] === '--version') {
    const result = versionResult('yarramate-mcp')
    process.stdout.write(result.stdout)
    process.exitCode = result.exitCode
  } else {
    const options = parseServerOptions(process.argv.slice(2))
    if (options === undefined) {
      process.stderr.write(serverUsage)
      process.exitCode = 2
    } else {
      const context: ToolContext = {
        cwd: process.cwd(),
        workspace: options.workspace,
      }
      const lines = createInterface({ input: process.stdin })
      lines.on('line', (line) => {
        const text = line.trim()
        if (text.length === 0) return
        let request: JsonRpcRequest
        try {
          request = JSON.parse(text) as JsonRpcRequest
        } catch {
          respondError(null, -32700, 'Parse error')
          return
        }
        try {
          handleRequest(request, context)
        } catch (error) {
          respondError(
            request.id ?? null,
            -32603,
            error instanceof Error ? error.message : String(error),
          )
        }
      })
    }
  }
}
