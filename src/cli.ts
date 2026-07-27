#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSeq, parseDocument } from 'yaml'
import { compileWorkspace } from './compiler.js'
import { serializeSemanticGraph } from './graph.js'
import {
  loadAdapterMapping,
  validateAdapterMappings,
} from './adapter-mapping.js'
import {
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
} from './projection.js'

export interface CliResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout: string
  readonly stderr: string
}

const usage =
  'Usage:\n  yarramate init <directory>\n  yarramate add <document.yaml> --id <id> --kind <kind> --name <name> [--status <status>] [--description <text>] [--source <source.yaml> ...]\n  yarramate connect <document.yaml> --id <id> --kind <kind> --from <ref> --to <ref> [--name <name>] [--status <status>] [--mode <mode>] [--content <text>] [--source <source.yaml> ...]\n  yarramate check <source.yaml> [source.yaml ...] [--json]\n  yarramate compile <source.yaml> [source.yaml ...]\n  yarramate context <projection.yaml> <source.yaml> [source.yaml ...]\n  yarramate view <projection.yaml> <source.yaml> [source.yaml ...]\n'

const diagnosticJson = (diagnostics: unknown) =>
  `${JSON.stringify({ ok: false, diagnostics }, null, 2)}\n`

const runProjection = (
  options: readonly string[],
  cwd: string,
  output: 'json' | 'markdown',
): CliResult => {
  const [projectionPath, ...paths] = options
  if (
    projectionPath === undefined ||
    paths.length === 0 ||
    options.some((option) => option.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const loaded = loadProjection({
      path: projectionPath,
      source: readFileSync(resolve(cwd, projectionPath), 'utf8'),
    })
    if (!loaded.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(loaded.diagnostics),
        stderr: '',
      }
    }
    const compilation = compileWorkspace(
      paths.map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    if (!compilation.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(compilation.diagnostics),
        stderr: '',
      }
    }
    const result = evaluateProjection(compilation.graph, loaded.projection)
    return {
      exitCode: 0,
      stdout:
        output === 'json'
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderProjectionMarkdown(result),
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const runInit = (options: readonly string[], cwd: string): CliResult => {
  const target = options[0]
  if (
    options.length !== 1 ||
    target === undefined ||
    target.startsWith('-')
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const documentPath = resolve(cwd, target, 'architecture/main.yaml')
  const displayPath = relative(cwd, documentPath)
  if (existsSync(documentPath)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${displayPath} already exists; nothing was changed\n`,
    }
  }
  mkdirSync(dirname(documentPath), { recursive: true })
  writeFileSync(
    documentPath,
    'format: yarramate/v1\n' +
      'id: main\n' +
      'profile: yarramate/core@0.1\n' +
      'concepts: []\n' +
      'relationships: []\n',
    'utf8',
  )
  return {
    exitCode: 0,
    stdout: `Created ${displayPath}\n`,
    stderr: '',
  }
}

const parseFlags = (
  options: readonly string[],
):
  | {
      readonly path: string
      readonly flags: ReadonlyMap<string, readonly string[]>
    }
  | undefined => {
  const [path, ...rest] = options
  if (path === undefined || path.startsWith('-') || rest.length % 2 !== 0) {
    return undefined
  }
  const flags = new Map<string, string[]>()
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith('--') ||
      value.startsWith('--')
    ) {
      return undefined
    }
    flags.set(flag, [...(flags.get(flag) ?? []), value])
  }
  return { path, flags }
}

const oneFlag = (
  flags: ReadonlyMap<string, readonly string[]>,
  flag: string,
) => {
  const values = flags.get(flag)
  return values?.length === 1 ? values[0] : undefined
}

const hasRepeatedSingletonFlag = (
  flags: ReadonlyMap<string, readonly string[]>,
) =>
  [...flags.entries()].some(
    ([flag, values]) => flag !== '--source' && values.length !== 1,
  )

const humanDiagnostics = (
  diagnostics: readonly {
    readonly path: string
    readonly line: number
    readonly column: number
    readonly code: string
    readonly message: string
  }[],
) =>
  diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} error ${diagnostic.code} ${diagnostic.message}\n`,
    )
    .join('')

const sortDiagnostics = <
  T extends {
    readonly path: string
    readonly line: number
    readonly column: number
    readonly code: string
    readonly message: string
  },
>(
  diagnostics: readonly T[],
) =>
  [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )

const appendBlockItem = (
  document: ReturnType<typeof parseDocument>,
  collection: 'concepts' | 'relationships',
  item: Readonly<Record<string, string>>,
) => {
  document.addIn([collection], item)
  const sequence = document.getIn([collection], true)
  if (isSeq(sequence)) {
    sequence.flow = false
  }
}

const runAdd = (options: readonly string[], cwd: string): CliResult => {
  const parsed = parseFlags(options)
  if (parsed === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const allowed = new Set([
    '--id',
    '--kind',
    '--name',
    '--status',
    '--description',
    '--source',
  ])
  if (
    [...parsed.flags.keys()].some((flag) => !allowed.has(flag)) ||
    hasRepeatedSingletonFlag(parsed.flags)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const id = oneFlag(parsed.flags, '--id')
  const kind = oneFlag(parsed.flags, '--kind')
  const name = oneFlag(parsed.flags, '--name')
  if (id === undefined || kind === undefined || name === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const absolutePath = resolve(cwd, parsed.path)
    const document = parseDocument(readFileSync(absolutePath, 'utf8'))
    appendBlockItem(document, 'concepts', {
      id,
      kind,
      name,
      ...(oneFlag(parsed.flags, '--description') === undefined
        ? {}
        : { description: oneFlag(parsed.flags, '--description') }),
      ...(oneFlag(parsed.flags, '--status') === undefined
        ? {}
        : { status: oneFlag(parsed.flags, '--status') }),
    })
    const candidate = document.toString({ lineWidth: 0 })
    const compilation = compileWorkspace([
      { path: parsed.path, source: candidate },
      ...(parsed.flags.get('--source') ?? []).map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    ])
    if (!compilation.ok) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(compilation.diagnostics),
        stderr: '',
      }
    }
    writeFileSync(absolutePath, candidate, 'utf8')
    return {
      exitCode: 0,
      stdout: `Added concept "${id}" to ${parsed.path}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const runConnect = (options: readonly string[], cwd: string): CliResult => {
  const parsed = parseFlags(options)
  if (parsed === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const allowed = new Set([
    '--id',
    '--kind',
    '--from',
    '--to',
    '--name',
    '--status',
    '--mode',
    '--content',
    '--source',
  ])
  if (
    [...parsed.flags.keys()].some((flag) => !allowed.has(flag)) ||
    hasRepeatedSingletonFlag(parsed.flags)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const id = oneFlag(parsed.flags, '--id')
  const kind = oneFlag(parsed.flags, '--kind')
  const from = oneFlag(parsed.flags, '--from')
  const to = oneFlag(parsed.flags, '--to')
  if (
    id === undefined ||
    kind === undefined ||
    from === undefined ||
    to === undefined
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const absolutePath = resolve(cwd, parsed.path)
    const document = parseDocument(readFileSync(absolutePath, 'utf8'))
    appendBlockItem(document, 'relationships', {
      id,
      kind,
      from,
      to,
      ...(oneFlag(parsed.flags, '--name') === undefined
        ? {}
        : { name: oneFlag(parsed.flags, '--name') }),
      ...(oneFlag(parsed.flags, '--status') === undefined
        ? {}
        : { status: oneFlag(parsed.flags, '--status') }),
      ...(oneFlag(parsed.flags, '--mode') === undefined
        ? {}
        : { mode: oneFlag(parsed.flags, '--mode') }),
      ...(oneFlag(parsed.flags, '--content') === undefined
        ? {}
        : { content: oneFlag(parsed.flags, '--content') }),
    })
    const candidate = document.toString({ lineWidth: 0 })
    const compilation = compileWorkspace([
      { path: parsed.path, source: candidate },
      ...(parsed.flags.get('--source') ?? []).map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    ])
    if (!compilation.ok) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(compilation.diagnostics),
        stderr: '',
      }
    }
    writeFileSync(absolutePath, candidate, 'utf8')
    return {
      exitCode: 0,
      stdout: `Added relationship "${id}" to ${parsed.path}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const runCompile = (options: readonly string[], cwd: string): CliResult => {
  if (
    options.length === 0 ||
    options.some((option) => option.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  try {
    const result = compileWorkspace(
      options.map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    return result.ok
      ? {
          exitCode: 0,
          stdout: serializeSemanticGraph(result.graph),
          stderr: '',
        }
      : {
          exitCode: 1,
          stdout: humanDiagnostics(result.diagnostics),
          stderr: '',
        }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

export function runCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  const [command, ...options] = args
  if (command === 'init') {
    return runInit(options, cwd)
  }
  if (command === 'add') {
    return runAdd(options, cwd)
  }
  if (command === 'connect') {
    return runConnect(options, cwd)
  }
  if (command === 'compile') {
    return runCompile(options, cwd)
  }
  if (command === 'context') {
    return runProjection(options, cwd, 'json')
  }
  if (command === 'view') {
    return runProjection(options, cwd, 'markdown')
  }
  if (command !== 'check') {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  const json = options.includes('--json')
  const paths = options.filter((option) => option !== '--json')
  const unknownOption = paths.find((path) => path.startsWith('-'))
  if (unknownOption !== undefined || paths.length === 0) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const sources = paths.map((path) => ({
      path,
      source: readFileSync(resolve(cwd, path), 'utf8'),
    }))
    const mappingSources = sources.filter(
      ({ source }) =>
        parseDocument(source).get('format') ===
        'yarramate/adapter-mapping/v1',
    )
    const coreSources = sources.filter(
      (source) => !mappingSources.includes(source),
    )
    const loadedMappings = mappingSources.map((source) =>
      loadAdapterMapping(source),
    )
    const mappingLoadDiagnostics = sortDiagnostics(
      loadedMappings.flatMap((loaded) =>
        loaded.ok ? [] : loaded.diagnostics,
      ),
    )
    if (mappingLoadDiagnostics.length > 0) {
      const output = json
        ? diagnosticJson(mappingLoadDiagnostics)
        : humanDiagnostics(mappingLoadDiagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }

    const result = compileWorkspace(
      coreSources.map(({ path, source }) => ({
        path,
        source,
      })),
    )
    const mappingValidation = result.ok
      ? validateAdapterMappings(
          result.graph,
          loadedMappings.flatMap((loaded) =>
            loaded.ok ? [loaded.mapping] : [],
          ),
        )
      : undefined
    const mappingDiagnostics =
      mappingValidation === undefined || mappingValidation.ok
        ? []
        : mappingValidation.diagnostics
    const ok = result.ok && mappingDiagnostics.length === 0
    const diagnostics = result.ok ? mappingDiagnostics : result.diagnostics

    if (json) {
      const output = ok
        ? { ok: true, diagnostics: [] }
        : { ok: false, diagnostics }
      return {
        exitCode: ok ? 0 : 1,
        stdout: `${JSON.stringify(output, null, 2)}\n`,
        stderr: '',
      }
    }

    if (ok && result.ok) {
      const documentCount = result.graph.documents.length
      const profileCount = coreSources.length - documentCount
      const mappingCount = mappingSources.length
      const checked = [
        `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`,
        ...(profileCount > 0
          ? [
              `${profileCount} ${profileCount === 1 ? 'profile' : 'profiles'}`,
            ]
          : []),
        ...(mappingCount > 0
          ? [
              `${mappingCount} ${mappingCount === 1 ? 'adapter mapping' : 'adapter mappings'}`,
            ]
          : []),
      ].join(' and ')
      return {
        exitCode: 0,
        stdout: `Checked ${checked}: no errors\n`,
        stderr: '',
      }
    }

    return {
      exitCode: 1,
      stdout: humanDiagnostics(diagnostics),
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const entrypoint = process.argv[1]
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  const result = runCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
