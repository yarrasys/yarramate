#!/usr/bin/env node

import { createInterface } from 'node:readline'
import {
  isMainModule,
  packageVersion,
  versionResult,
} from '../cli-support.js'
import { runCli } from '../cli.js'

interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id?: number | string | null
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly arguments: (input: Record<string, unknown>) => readonly string[]
}

const workspaceProperty = {
  workspace: {
    type: 'string',
    description:
      'Path to the explicit workspace manifest, for example .yarramate/workspace.yaml',
  },
} as const

const tools: readonly ToolDefinition[] = [
  {
    name: 'yarramate_ask',
    description:
      'The consumed-now read surface. Without a query: orientation — check verdict, drift summary, open-question count, and the backlog in dependency order. With a query: free text matches concept ids, names, and descriptions and returns the connected slice; exact subject ids (document-id#local-id) and projection paths address precisely. Set mode for the roster (subjects), declarable vocabulary (kinds), build order (next), or the full open-questions report (open).',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
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
    arguments: (input) => {
      const workspace = String(input.workspace)
      if (typeof input.mode === 'string') {
        return ['ask', workspace, `--${input.mode}`, '--json']
      }
      if (typeof input.query === 'string' && input.query.length > 0) {
        const budget =
          typeof input.budget === 'number'
            ? ['--budget', String(input.budget)]
            : ['--json']
        return ['ask', workspace, input.query, ...budget]
      }
      return ['ask', workspace, '--json']
    },
  },
  {
    name: 'yarramate_design',
    description:
      'The design interview, one stateless step: the top open question with its subject slice, materiality, and progress. Read-only — answers land through the CLI apply command in the repository, not through this server.',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
      properties: {
        ...workspaceProperty,
        subject: {
          type: 'string',
          description:
            'Optional globally qualified subject id to narrow the interview',
        },
      },
    },
    arguments: (input) => [
      'design',
      String(input.workspace),
      ...(typeof input.subject === 'string'
        ? ['--subject', input.subject]
        : []),
      '--json',
    ],
  },
  {
    name: 'yarramate_check',
    description:
      'Deterministic correctness check of a workspace; returns the machine-readable check result. Never a quality or completeness judgement.',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
      properties: workspaceProperty,
    },
    arguments: (input) => ['check', String(input.workspace), '--json'],
  },
  {
    name: 'yarramate_reconcile',
    description:
      'Compare declared architecture with evaluated evidence; returns the reconciliation report with contradicted, unknown, and not-observed findings.',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
      properties: workspaceProperty,
    },
    arguments: (input) => ['reconcile', String(input.workspace)],
  },
]

const respond = (id: number | string | null, result: unknown): void => {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`,
  )
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

export const handleRequest = (request: JsonRpcRequest): void => {
  const id = request.id ?? null
  if (request.method === 'initialize') {
    respond(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'yarramate', version: packageVersion },
      instructions:
        'Read-only architecture context for YarraMate workspaces. The native documents in the repository remain canonical; this server never mutates them.',
    })
    return
  }
  if (request.method === 'tools/list') {
    respond(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    })
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
    const result = runCli([...tool.arguments(input)], process.cwd())
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

if (isMainModule(import.meta.url, process.argv[1])) {
  if (process.argv[2] === '--version') {
    const result = versionResult('yarramate-mcp')
    process.stdout.write(result.stdout)
    process.exitCode = result.exitCode
  } else {
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
        handleRequest(request)
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
