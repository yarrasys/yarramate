#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import {
  isMainModule,
  packageVersion,
  versionResult,
} from '../cli-support.js'
import { runCli, type CliResult } from '../cli.js'

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

interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  /**
   * Runs the tool. Most tools are one CLI invocation; `apply` and `export`
   * lend the CLI a scratch file around one, because the CLI reads and writes
   * paths and an MCP call carries text. Nothing here has semantics of its
   * own (ADR 0044, amended by ADR 0149): the answer is what the CLI printed.
   */
  readonly run: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => CliResult
}

/**
 * The loop, in two sentences, on every tool. A desktop-app agent connecting
 * for the first time has never seen the skill file; the tool list is the only
 * place it learns that design asks, apply lands, and design asks again.
 */
export const LOOP =
  'The loop: call yarramate_design for the top open question, answer it with the person, land the answer with yarramate_apply, then call yarramate_design again. Every tool takes the same optional `workspace`; omit it to use the workspace this server was started with, or .yarramate/workspace.yaml under its working directory.'

const workspaceProperty = {
  workspace: {
    type: 'string',
    description:
      "Path to the workspace manifest, for example .yarramate/workspace.yaml. Optional: defaults to the server's --workspace, then to .yarramate/workspace.yaml under the working directory. Desktop apps start the server outside the repository, so give the full path there.",
  },
} as const

const CONVENTIONAL_WORKSPACE = join('.yarramate', 'workspace.yaml')

/** The one refusal that is the server's own rather than the CLI's. */
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

const withWorkspace = (
  input: Record<string, unknown>,
  context: ToolContext,
  run: (workspace: string, cwd: string) => CliResult,
): CliResult => {
  const named = resolveWorkspace(input, context)
  if (named === undefined) return noWorkspace()
  const { cwd, workspace } = workingDirectoryFor(named, context.cwd)
  return run(workspace, cwd)
}

/**
 * A scratch directory for one call, removed before the answer goes back.
 * `apply` reads its operations from a path and `export` writes some kinds only
 * to a directory; an MCP call carries neither, so the adapter lends both a
 * place on disk for the duration of the call and nothing longer.
 */
const withScratch = <T>(use: (directory: string) => T): T => {
  const directory = mkdtempSync(join(tmpdir(), 'yarramate-mcp-'))
  try {
    return use(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const operationsText = (operations: unknown): string | undefined => {
  if (typeof operations === 'string') return operations
  if (typeof operations === 'object' && operations !== null) {
    // JSON is YAML; the CLI's parser reads it unchanged.
    return JSON.stringify(operations, null, 2)
  }
  return undefined
}

const refuse = (message: string): CliResult => ({
  exitCode: 2,
  stdout: '',
  stderr: `${message}\n`,
})

const tools: readonly ToolDefinition[] = [
  {
    name: 'yarramate_ask',
    description: `The consumed-now read surface. Without a query: orientation — check verdict, drift summary, open-question count, and the backlog in dependency order. With a query: free text matches concept ids, names, and descriptions and returns the connected slice; exact subject ids (document-id#local-id) and projection paths address precisely. Set mode for the roster (subjects), declarable vocabulary (kinds), build order (next), or the full open-questions report (open). ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...workspaceProperty,
        query: {
          type: 'string',
          description:
            'Free text, a globally qualified subject id, or a projection path',
        },
        mode: {
          type: 'string',
          enum: ['subjects', 'kinds', 'next', 'open'],
          description:
            'Optional flag mode instead of a query: the filterable roster, the declarable kind vocabulary, dependency-ordered planned work, or the open-questions report',
        },
        budget: {
          type: 'integer',
          minimum: 1,
          description:
            'Approximate token budget for the compact slice rendering (query form only)',
        },
      },
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) => {
        if (typeof input.mode === 'string') {
          return runCli(
            ['ask', workspace, `--${input.mode}`, '--json'],
            cwd,
          )
        }
        if (typeof input.query === 'string' && input.query.length > 0) {
          const budget =
            typeof input.budget === 'number'
              ? ['--budget', String(input.budget)]
              : ['--json']
          return runCli(['ask', workspace, input.query, ...budget], cwd)
        }
        return runCli(['ask', workspace, '--json'], cwd)
      }),
  },
  {
    name: 'yarramate_design',
    description: `The design interview, one stateless step: the top open question with its subject slice, materiality, progress, and the operations skeleton that would answer it. Ask the person, land their answer with yarramate_apply, then call this again; the next question is computed from the record, never remembered. A question whose authority is human is for the person to decide, not the agent. ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...workspaceProperty,
        subject: {
          type: 'string',
          description:
            'Optional globally qualified subject id to narrow the interview',
        },
      },
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) =>
        runCli(
          [
            'design',
            workspace,
            ...(typeof input.subject === 'string'
              ? ['--subject', input.subject]
              : []),
            '--json',
          ],
          cwd,
        ),
      ),
  },
  {
    name: 'yarramate_apply',
    description: `Lands answers in the record: one yarramate/operations/v1 document, applied as an atomic batch by the same CLI command a person runs. Any invalid operation refuses the whole batch and nothing is written; the result names each diagnostic with its source location. Writes are spliced into the native documents, never re-serialized, so the diff is exactly the answer. ${LOOP}`,
    inputSchema: {
      type: 'object',
      required: ['operations'],
      properties: {
        ...workspaceProperty,
        operations: {
          description:
            'The operations document: `format: yarramate/operations/v1` with an `operations` list. Each operation names its `op` and its `document` (the native document path, for example .yarramate/architecture/main.yaml) and nests the record under the key its op names: add-concept carries `concept: { id, kind, name, description?, status?, ... }`, add-relationship carries `relationship: { id, kind, from, to, description? }`, update-concept and update-relationship carry the same key with only the fields that change, delete-* and rename-* carry the id (and `to` for a rename). Shape, as JSON: {"format":"yarramate/operations/v1","operations":[{"op":"add-concept","document":".yarramate/architecture/main.yaml","concept":{"id":"ops-portal","kind":"applicationComponent","name":"Operations portal"}}]}. YAML or JSON text, or the equivalent JSON object.',
          oneOf: [{ type: 'string' }, { type: 'object' }],
        },
      },
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) => {
        const text = operationsText(input.operations)
        if (text === undefined) {
          return refuse(
            'yarramate_apply needs `operations`: a yarramate/operations/v1 document as YAML or JSON text, or as an object.',
          )
        }
        return withScratch((directory) => {
          const path = join(directory, 'operations.yaml')
          writeFileSync(path, text, 'utf8')
          return runCli(['apply', path, workspace, '--json'], cwd)
        })
      }),
  },
  {
    name: 'yarramate_check',
    description: `Deterministic correctness check of a workspace; returns the machine-readable check result. Never a quality or completeness judgement. Run it after every apply. ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: workspaceProperty,
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) =>
        runCli(['check', workspace, '--json'], cwd),
      ),
  },
  {
    name: 'yarramate_reconcile',
    description: `Compare declared architecture with evaluated evidence; returns the reconciliation report with contradicted, unknown, and not-observed findings. ${LOOP}`,
    inputSchema: {
      type: 'object',
      properties: workspaceProperty,
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) =>
        runCli(['reconcile', workspace], cwd),
      ),
  },
  {
    name: 'yarramate_export',
    description: `Derives a deliverable from the record and returns it as text: markdown (a projection rendered as prose; needs projection), rtm (the requirements traceability matrix), graph (the compiled semantic graph as JSON), briefs (one brief per subject of a projection; needs projection). xlsx and likec4 write binary or multi-file output, so they need out (and likec4 needs project) and return what was written. ${LOOP}`,
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: {
        ...workspaceProperty,
        kind: {
          type: 'string',
          enum: ['markdown', 'rtm', 'graph', 'briefs', 'xlsx', 'likec4'],
        },
        projection: {
          type: 'string',
          description:
            'Projection path, relative to the repository root unless absolute; required for markdown, briefs and xlsx',
        },
        out: {
          type: 'string',
          description:
            'Where to write, relative to the repository root (the directory that holds .yarramate) unless absolute: a file for markdown, graph and xlsx; a directory for rtm, briefs and likec4. Optional for the text kinds, which then return the text instead.',
        },
        project: {
          type: 'string',
          description: 'The likec4-project.yaml, required for likec4',
        },
        budget: {
          type: 'integer',
          minimum: 1,
          description: 'Approximate token budget per brief (briefs only)',
        },
      },
    },
    run: (input, context) =>
      withWorkspace(input, context, (workspace, cwd) => {
        const kind = typeof input.kind === 'string' ? input.kind : ''
        const projection =
          typeof input.projection === 'string' ? input.projection : undefined
        const out = typeof input.out === 'string' ? input.out : undefined
        const budget =
          typeof input.budget === 'number'
            ? ['--budget', String(input.budget)]
            : []
        if (kind === 'markdown' || kind === 'graph') {
          if (kind === 'markdown' && projection === undefined) {
            return refuse(
              'yarramate_export markdown needs `projection`: the path of the view to render.',
            )
          }
          return runCli(
            [
              'export',
              kind,
              ...(projection === undefined ? [] : [projection]),
              workspace,
              ...(out === undefined ? [] : ['--out', out]),
            ],
            cwd,
          )
        }
        if (kind === 'rtm') {
          if (out !== undefined) {
            return runCli(
              ['export', 'rtm', workspace, '--out', out],
              cwd,
            )
          }
          return withScratch((directory) => {
            const result = runCli(
              ['export', 'rtm', workspace, '--out', directory],
              cwd,
            )
            if (result.exitCode !== 0) return result
            return {
              exitCode: 0,
              stdout: readFileSync(join(directory, 'RTM.md'), 'utf8'),
              stderr: '',
            }
          })
        }
        if (kind === 'briefs') {
          if (projection === undefined) {
            return refuse(
              'yarramate_export briefs needs `projection`: the path of the view whose subjects get a brief each.',
            )
          }
          if (out !== undefined) {
            return runCli(
              [
                'export',
                'briefs',
                projection,
                workspace,
                '--out',
                out,
                ...budget,
              ],
              cwd,
            )
          }
          return withScratch((directory) => {
            const result = runCli(
              [
                'export',
                'briefs',
                projection,
                workspace,
                '--out',
                directory,
                ...budget,
              ],
              cwd,
            )
            if (result.exitCode !== 0) return result
            const files = readdirSync(directory).sort()
            return {
              exitCode: 0,
              stdout: files
                .map(
                  (file) =>
                    `<!-- ${file} -->\n${readFileSync(join(directory, file), 'utf8')}`,
                )
                .join('\n'),
              stderr: '',
            }
          })
        }
        if (kind === 'xlsx') {
          if (projection === undefined || out === undefined) {
            return refuse(
              'yarramate_export xlsx needs `projection` and `out`: the view to export and the .xlsx path to write; a workbook is binary and cannot come back as text.',
            )
          }
          return runCli(
            ['export', 'xlsx', projection, workspace, '--out', out],
            cwd,
          )
        }
        if (kind === 'likec4') {
          const project =
            typeof input.project === 'string' ? input.project : undefined
          if (project === undefined || out === undefined) {
            return refuse(
              'yarramate_export likec4 needs `project` (the likec4-project.yaml) and `out` (the directory to write).',
            )
          }
          return runCli(
            ['export', 'likec4', project, out, workspace],
            cwd,
          )
        }
        return refuse(
          'yarramate_export needs `kind`: one of markdown, rtm, graph, briefs, xlsx, likec4.',
        )
      }),
  },
]

/** The tool list a client sees; exported so a test can read it without stdio. */
export const toolCatalogue = tools.map(
  ({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }),
)

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
      instructions: `The architecture record of a YarraMate workspace. The native documents in the repository are canonical; every read renders them, and yarramate_apply is the one write, the same atomic batch the CLI lands. ${LOOP}`,
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
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) {
      respondError(id, -32602, `Unknown tool "${name}"`)
      return
    }
    const input =
      typeof params.arguments === 'object' && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {}
    const result = tool.run(input, context)
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

/** `yarramate-mcp [--workspace <path>]`; anything else is refused with usage. */
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
