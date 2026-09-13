import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const packageVersion = (
  JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { version: string }
).version

interface ToolResult {
  readonly result: {
    readonly isError: boolean
    readonly content: readonly { readonly text: string }[]
  }
}

const exchange = (
  requests: readonly Record<string, unknown>[],
  options: { readonly cwd?: string; readonly args?: readonly string[] } = {},
): readonly Record<string, unknown>[] => {
  const stdout = execFileSync(
    process.execPath,
    [join(repositoryRoot, 'dist/adapters/mcp-cli.js'), ...(options.args ?? [])],
    {
      cwd: options.cwd ?? repositoryRoot,
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

const call = (
  id: number,
  name: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
})

const text = (response: Record<string, unknown>): string =>
  (response as unknown as ToolResult).result.content[0]!.text

const isError = (response: Record<string, unknown>): boolean =>
  (response as unknown as ToolResult).result.isError

/** A fresh `yarramate init` in a scratch directory, removed after the test. */
const scratch: string[] = []
const freshWorkspace = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'yarramate-mcp-test-'))
  scratch.push(directory)
  execFileSync(
    process.execPath,
    [join(repositoryRoot, 'dist/cli.js'), 'init', '.', '--no-pointer'],
    { cwd: directory, encoding: 'utf8' },
  )
  return directory
}
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('yarramate-mcp stdio adapter', () => {
  it('initializes, lists the whole loop, and serves orientation without a workspace argument', () => {
    const [init, list, orientation] = exchange([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'yarramate_ask'),
    ])

    expect(init).toMatchObject({
      result: {
        serverInfo: { name: 'yarramate', version: packageVersion },
      },
    })
    const tools = (
      list as {
        result: {
          tools: readonly {
            name: string
            description: string
            inputSchema: { required?: readonly string[] }
          }[]
        }
      }
    ).result.tools
    expect(tools.map(({ name }) => name)).toEqual([
      'yarramate_ask',
      'yarramate_design',
      'yarramate_apply',
      'yarramate_check',
      'yarramate_reconcile',
      'yarramate_export',
    ])
    // #514: `workspace` is optional on every tool, and every description
    // carries the loop, because a desktop-app agent has never read the skill.
    for (const tool of tools) {
      expect(tool.inputSchema.required ?? []).not.toContain('workspace')
      expect(tool.description).toContain('yarramate_apply')
      expect(tool.description).toContain('yarramate_design')
    }
    // The repository holds .yarramate/workspace.yaml, so the call above named none.
    expect(isError(orientation!)).toBe(false)
    expect(JSON.parse(text(orientation!))).toMatchObject({
      format: 'yarramate/ask-result/v1',
      mode: 'orientation',
      workspace: 'yarramate',
    })
  })

  it('takes the workspace from --workspace when the working directory holds none, and says so when neither is given', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'yarramate-mcp-elsewhere-'))
    scratch.push(elsewhere)
    const [orientation] = exchange([call(1, 'yarramate_ask')], {
      cwd: elsewhere,
      args: ['--workspace', join(repositoryRoot, '.yarramate/workspace.yaml')],
    })
    expect(isError(orientation!)).toBe(false)
    expect(JSON.parse(text(orientation!))).toMatchObject({
      mode: 'orientation',
      workspace: 'yarramate',
    })

    const [refused] = exchange([call(1, 'yarramate_ask')], { cwd: elsewhere })
    expect(isError(refused!)).toBe(true)
    expect(text(refused!)).toContain('No workspace to work on')
    expect(text(refused!)).toContain('--workspace')
  })

  it('refuses unknown server options with usage rather than reading stdin', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [join(repositoryRoot, 'dist/adapters/mcp-cli.js'), '--workspace'],
        { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' },
      ),
    ).toThrow(/Usage:\n {2}yarramate-mcp \[--workspace/)
  })

  it('serves budgeted slices and design steps', () => {
    const [slice, design] = exchange([
      call(1, 'yarramate_ask', {
        workspace: '.yarramate/workspace.yaml',
        query: 'cli',
        budget: 300,
      }),
      call(2, 'yarramate_design', { workspace: '.yarramate/workspace.yaml' }),
    ])

    expect(isError(slice!)).toBe(false)
    expect(text(slice!)).toContain('context ask-slice@0.0')
    expect(isError(design!)).toBe(false)
    expect(JSON.parse(text(design!))).toMatchObject({
      format: 'yarramate/design-step/v1',
    })
  })

  it('lands an answer through yarramate_apply as one atomic batch, from YAML text or an object, and refuses a bad one whole', () => {
    const directory = freshWorkspace()
    const document = join(directory, '.yarramate/architecture/main.yaml')
    const before = readFileSync(document, 'utf8')
    expect(before).toContain('concepts: []')

    const [landed, refused, landedObject, step] = exchange(
      [
        call(1, 'yarramate_apply', {
          operations: [
            'format: yarramate/operations/v1',
            'operations:',
            '  - op: add-concept',
            '    document: .yarramate/architecture/main.yaml',
            '    concept:',
            '      id: order-approval',
            '      kind: capability',
            '      name: Order approval',
            '',
          ].join('\n'),
        }),
        call(2, 'yarramate_apply', {
          operations: {
            format: 'yarramate/operations/v1',
            operations: [
              {
                op: 'add-concept',
                document: '.yarramate/architecture/main.yaml',
                concept: { id: 'nothing', kind: 'no-such-kind', name: 'Nothing' },
              },
              {
                op: 'add-concept',
                document: '.yarramate/architecture/main.yaml',
                concept: { id: 'also-fine', kind: 'capability', name: 'Also fine' },
              },
            ],
          },
        }),
        call(3, 'yarramate_apply', {
          operations: {
            format: 'yarramate/operations/v1',
            operations: [
              {
                op: 'add-concept',
                document: '.yarramate/architecture/main.yaml',
                concept: { id: 'approval-api', kind: 'applicationInterface', name: 'Approval API' },
              },
            ],
          },
        }),
        call(4, 'yarramate_design'),
      ],
      { cwd: directory },
    )

    expect(isError(landed!)).toBe(false)
    expect(JSON.parse(text(landed!))).toMatchObject({
      format: 'yarramate/apply-result/v1',
    })
    const afterFirst = readFileSync(document, 'utf8')
    expect(afterFirst).toContain('id: order-approval')

    // A batch with one bad operation lands nothing: not even its good half.
    expect(isError(refused!)).toBe(true)
    expect(text(refused!)).toContain('no-such-kind')
    expect(readFileSync(document, 'utf8')).toBe(afterFirst)
    expect(readFileSync(document, 'utf8')).not.toContain('also-fine')

    expect(isError(landedObject!)).toBe(false)
    expect(readFileSync(document, 'utf8')).toContain('id: approval-api')

    // The interview reads the landed record: the step names what is now there.
    expect(isError(step!)).toBe(false)
    const designStep = JSON.parse(text(step!)) as {
      progress: { open: number }
    }
    expect(designStep.progress.open).toBeGreaterThan(0)
  })

  it('returns text deliverables through yarramate_export and names what the binary kinds need', () => {
    const directory = freshWorkspace()
    const [rtm, noProjection, noOut, noKind] = exchange(
      [
        call(1, 'yarramate_export', { kind: 'rtm' }),
        call(2, 'yarramate_export', { kind: 'markdown' }),
        call(3, 'yarramate_export', {
          kind: 'xlsx',
          projection: 'anything.yaml',
        }),
        call(4, 'yarramate_export', {}),
      ],
      { cwd: directory },
    )

    expect(isError(rtm!)).toBe(false)
    expect(text(rtm!)).toMatch(/^# Requirements traceability matrix/)
    expect(isError(noProjection!)).toBe(true)
    expect(text(noProjection!)).toContain('needs `projection`')
    expect(isError(noOut!)).toBe(true)
    expect(text(noOut!)).toContain('needs `projection` and `out`')
    expect(isError(noKind!)).toBe(true)
    expect(text(noKind!)).toContain('needs `kind`')
  })

  it('renders a projection as markdown for the repository itself', () => {
    const [markdown] = exchange([
      call(1, 'yarramate_export', {
        kind: 'markdown',
        projection: '.yarramate/projections/engine-components.yaml',
      }),
    ])
    expect(isError(markdown!)).toBe(false)
    expect(text(markdown!)).toContain('Engine components')
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
      call(1, 'yarramate_delete_everything'),
      call(2, 'yarramate_check', { workspace: 'does-not-exist.yaml' }),
    ])

    expect(unknown).toMatchObject({
      error: { code: -32602 },
    })
    expect(isError(failing!)).toBe(true)
  })
})
