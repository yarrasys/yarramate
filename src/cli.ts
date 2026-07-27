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
  diagnosticJson,
  humanDiagnostics,
  resolveCliWorkspaceSources,
  usage,
  type CliResult,
} from './cli-support.js'
import { runCheckCommand } from './check-command.js'
import {
  evaluateEvidence,
  loadEvidence,
} from './evidence.js'
import {
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
} from './projection.js'

export type { CliResult } from './cli-support.js'

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
    const resolved = resolveCliWorkspaceSources(paths, cwd)
    if (!resolved.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(resolved.diagnostics),
        stderr: '',
      }
    }
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
      resolved.paths.map((path) => ({
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

const runEvidence = (
  options: readonly string[],
  cwd: string,
): CliResult => {
  const [evidencePath, ...paths] = options
  if (
    evidencePath === undefined ||
    paths.length === 0 ||
    options.some((option) => option.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  try {
    const resolved = resolveCliWorkspaceSources(paths, cwd)
    if (!resolved.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(resolved.diagnostics),
        stderr: '',
      }
    }
    const loaded = loadEvidence({
      path: evidencePath,
      source: readFileSync(resolve(cwd, evidencePath), 'utf8'),
    })
    if (!loaded.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(loaded.diagnostics),
        stderr: '',
      }
    }
    const compilation = compileWorkspace(
      resolved.paths.map((path) => ({
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
    const evaluation = evaluateEvidence(
      compilation.graph,
      loaded.evidence,
    )
    return evaluation.ok
      ? {
          exitCode: 0,
          stdout: `${JSON.stringify(evaluation.report, null, 2)}\n`,
          stderr: '',
        }
      : {
          exitCode: 1,
          stdout: diagnosticJson(evaluation.diagnostics),
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
  const workspaceRoot = resolve(cwd, target)
  const documentPath = resolve(workspaceRoot, 'architecture/main.yaml')
  const manifestPath = resolve(workspaceRoot, 'yarramate.workspace.yaml')
  const displayPath = relative(cwd, documentPath)
  const displayManifestPath = relative(cwd, manifestPath)
  const existing = [
    ...(existsSync(documentPath) ? [displayPath] : []),
    ...(existsSync(manifestPath) ? [displayManifestPath] : []),
  ]
  if (existing.length > 0) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${existing.join(' and ')} ${existing.length === 1 ? 'already exists' : 'already exist'}; nothing was changed\n`,
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
  writeFileSync(
    manifestPath,
    'format: yarramate/workspace/v1\n' +
      'id: main\n' +
      'documents:\n' +
      '  - architecture/*.yaml\n' +
      'profiles: []\n' +
      'projections: []\n' +
      'adapterMappings: []\n' +
      'evidence: []\n',
    'utf8',
  )
  return {
    exitCode: 0,
    stdout: `Created ${displayPath} and ${displayManifestPath}\n`,
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
    ([flag, values]) =>
      flag !== '--source' &&
      flag !== '--constraint' &&
      values.length !== 1,
  )

const appendBlockItem = (
  document: ReturnType<typeof parseDocument>,
  collection: 'concepts' | 'relationships',
  item: Readonly<Record<string, unknown>>,
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
    '--owner',
    '--constraint',
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
  const constraints = (parsed.flags.get('--constraint') ?? []).map(
    (value) => {
      const separator = value.indexOf('=')
      return separator <= 0 || separator === value.length - 1
        ? undefined
        : {
            id: value.slice(0, separator),
            ref: value.slice(separator + 1),
          }
    },
  )
  if (constraints.some((constraint) => constraint === undefined)) {
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
      ...(oneFlag(parsed.flags, '--owner') === undefined
        ? {}
        : { owner: oneFlag(parsed.flags, '--owner') }),
      ...(constraints.length === 0 ? {} : { constraints }),
    })
    const candidate = document.toString({ lineWidth: 0 })
    const companions = resolveCliWorkspaceSources(
      parsed.flags.get('--source') ?? [],
      cwd,
    )
    if (!companions.ok) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(companions.diagnostics),
        stderr: '',
      }
    }
    const compilation = compileWorkspace([
      { path: parsed.path, source: candidate },
      ...companions.paths
        .filter(
          (path) => resolve(cwd, path) !== resolve(cwd, parsed.path),
        )
        .map((path) => ({
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
    const companions = resolveCliWorkspaceSources(
      parsed.flags.get('--source') ?? [],
      cwd,
    )
    if (!companions.ok) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(companions.diagnostics),
        stderr: '',
      }
    }
    const compilation = compileWorkspace([
      { path: parsed.path, source: candidate },
      ...companions.paths
        .filter(
          (path) => resolve(cwd, path) !== resolve(cwd, parsed.path),
        )
        .map((path) => ({
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
    const resolved = resolveCliWorkspaceSources(options, cwd)
    if (!resolved.ok) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(resolved.diagnostics),
        stderr: '',
      }
    }
    const result = compileWorkspace(
      resolved.paths.map((path) => ({
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
  if (command === 'evidence') {
    return runEvidence(options, cwd)
  }
  if (command === 'check') {
    return runCheckCommand(options, cwd)
  }
  return { exitCode: 2, stdout: '', stderr: usage }
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
