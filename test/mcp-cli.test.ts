import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const packageVersion = (
  JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { version: string }
).version

const exchange = (
  requests: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] => {
  const stdout = execFileSync(
    process.execPath,
    ['dist/adapters/mcp-cli.js'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: requests
        .map((request) => `${JSON.stringify(request)}\n`)
        .join(''),
    },
  )
  return stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('yarramate-mcp stdio adapter', () => {
  it('initializes, lists read-only tools, and serves status', () => {
    const [init, list, status] = exchange([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'yarramate_status',
          arguments: { workspace: '.yarramate/workspace.yaml' },
        },
      },
    ])

    expect(init).toMatchObject({
      result: {
        serverInfo: { name: 'yarramate', version: packageVersion },
      },
    })
    const tools = (
      list as { result: { tools: readonly { name: string }[] } }
    ).result.tools.map(({ name }) => name)
    expect(tools).toEqual([
      'yarramate_status',
      'yarramate_check',
      'yarramate_reconcile',
      'yarramate_context',
    ])
    const call = status as {
      result: {
        isError: boolean
        content: readonly { text: string }[]
      }
    }
    expect(call.result.isError).toBe(false)
    expect(JSON.parse(call.result.content[0]!.text)).toMatchObject({
      format: 'yarramate/status-result/v1',
      workspace: 'yarramate',
    })
  })

  it('serves budgeted ad-hoc context through the context tool', () => {
    const [call] = exchange([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'yarramate_context',
          arguments: {
            workspace: 'test/fixtures/valid/minimal.yaml',
            subjects: ['checkout#approval-api'],
            budget: 300,
          },
        },
      },
    ])

    const result = (
      call as {
        result: {
          isError: boolean
          content: readonly { text: string }[]
        }
      }
    ).result
    expect(result.isError).toBe(false)
    expect(result.content[0]!.text).toContain(
      'context ad-hoc-context@0.0',
    )
  })

  it('prints the package version for --version without reading stdin', () => {
    const stdout = execFileSync(
      process.execPath,
      ['dist/adapters/mcp-cli.js', '--version'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    expect(stdout).toBe(`yarramate-mcp ${packageVersion}\n`)
  })

  it('reports unknown tools and failed commands distinctly', () => {
    const [unknown, failing] = exchange([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'yarramate_delete_everything', arguments: {} },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'yarramate_check',
          arguments: { workspace: 'does-not-exist.yaml' },
        },
      },
    ])

    expect(unknown).toMatchObject({
      error: { code: -32602 },
    })
    expect(
      (failing as { result: { isError: boolean } }).result.isError,
    ).toBe(true)
  })
})
