#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  adapterMappingEntryLocation,
  adapterMappingLocation,
  loadAdapterMapping,
  validateAdapterMapping,
} from '../adapter-mapping.js'
import { compileWorkspace } from '../compiler.js'
import {
  diagnosticJson,
  isMainModule,
  resolveCliWorkspaceSources,
  type CliResult,
} from '../cli-support.js'
import {
  observeGraphify,
  type GraphifyGraph,
} from './graphify.js'

const usage =
  'Usage:\n' +
  '  yarramate-graphify observe <graph.json> <mapping.yaml> <workspace-or-source...> --id <evidence-id> --version <major.minor>\n'

const parseOptions = (options: readonly string[]) => {
  const idFlag = options.indexOf('--id')
  const versionFlag = options.indexOf('--version')
  if (
    idFlag < 3 ||
    versionFlag < 3 ||
    options[idFlag + 1] === undefined ||
    options[versionFlag + 1] === undefined
  ) return undefined
  const flagIndexes = [idFlag, versionFlag].sort((left, right) => left - right)
  const firstFlag = flagIndexes[0]
  if (firstFlag === undefined) return undefined
  const paths = options.slice(0, firstFlag)
  const trailing = options.slice(firstFlag)
  if (
    paths.length < 3 ||
    trailing.length !== 4 ||
    new Set([trailing[0], trailing[2]]).size !== 2
  ) return undefined
  return {
    graphPath: paths[0]!,
    mappingPath: paths[1]!,
    sources: paths.slice(2),
    id: options[idFlag + 1]!,
    version: options[versionFlag + 1]!,
  }
}

export function runGraphifyCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  const [command, ...options] = args
  const parsed = command === 'observe' ? parseOptions(options) : undefined
  if (
    parsed === undefined ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(parsed.id) ||
    !/^[0-9]+\.[0-9]+$/.test(parsed.version)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  try {
    const resolved = resolveCliWorkspaceSources(parsed.sources, cwd)
    if (!resolved.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(resolved.diagnostics),
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
    const loadedMapping = loadAdapterMapping({
      path: parsed.mappingPath,
      source: readFileSync(resolve(cwd, parsed.mappingPath), 'utf8'),
    })
    if (!loadedMapping.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(loadedMapping.diagnostics),
        stderr: '',
      }
    }
    const validatedMapping = validateAdapterMapping(
      compilation.graph,
      loadedMapping.mapping,
    )
    if (!validatedMapping.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(validatedMapping.diagnostics),
        stderr: '',
      }
    }
    const graph = JSON.parse(
      readFileSync(resolve(cwd, parsed.graphPath), 'utf8'),
    ) as GraphifyGraph
    if (
      !Array.isArray(graph.nodes) ||
      graph.nodes.some(
        (node) =>
          typeof node !== 'object' ||
          node === null ||
          typeof node.id !== 'string' ||
          node.id.length === 0,
      )
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `${parsed.graphPath} does not contain Graphify nodes with string IDs\n`,
      }
    }
    const observation = observeGraphify(
      graph,
      validatedMapping.mapping,
      { id: parsed.id, version: parsed.version },
    )
    if (!observation.ok) {
      const diagnostics = observation.issues.map((issue) => ({
        severity: 'error' as const,
        code: issue.code,
        message: issue.message,
        ...(issue.mapping === undefined
          ? adapterMappingLocation(loadedMapping.mapping, 'adapter')
          : adapterMappingEntryLocation(
              loadedMapping.mapping,
              issue.mapping,
              'type',
            )),
      }))
      return {
        exitCode: 1,
        stdout: diagnosticJson(diagnostics),
        stderr: '',
      }
    }
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(observation.evidence, null, 2)}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const result = runGraphifyCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
