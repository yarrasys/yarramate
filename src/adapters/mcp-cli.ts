#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { isMainModule } from '../cli-support.js'
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
    name: 'yarramate_status',
    description:
      'One-call workspace orientation: check verdict, reconciliation summary, and a titled inventory of documents, states, projections, evidence, and contracts.',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
      properties: workspaceProperty,
    },
    arguments: (input) => ['status', String(input.workspace), '--json'],
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
  {
    name: 'yarramate_context',
    description:
      'Bounded architecture context. Provide either a projection path or one or more globally qualified subjects (document-id#local-id) for an ad-hoc connected neighbourhood. Optional token budget switches to a compact ranked rendering.',
    inputSchema: {
      type: 'object',
      required: ['workspace'],
      properties: {
        ...workspaceProperty,
        projection: {
          type: 'string',
          description: 'Path to an authored projection definition',
        },
        subjects: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Globally qualified subject identities for ad-hoc context',
        },
        budget: {
          type: 'integer',
          minimum: 1,
          description:
            'Approximate token budget for the compact rendering',
        },
      },
    },
    arguments: (input) => {
      const budget =
        typeof input.budget === 'number'
          ? ['--budget', String(input.budget)]
          : []
      if (typeof input.projection === 'string') {
        return [
          'context',
          input.projection,
          String(input.workspace),
          ...budget,
        ]
      }
      const subjects = Array.isArray(input.subjects)
        ? input.subjects.flatMap((subject) => [
            '--subject',
            String(subject),
          ])
        : []
      return ['context', ...subjects, String(input.workspace), ...budget]
    },
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
      serverInfo: { name: 'yarramate', version: '0.1' },
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
