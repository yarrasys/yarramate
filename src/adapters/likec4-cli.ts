#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  loadAdapterMapping,
  validateAdapterMapping,
} from '../adapter-mapping.js'
import { resolveCliWorkspaceSources, type CliResult } from '../cli-support.js'
import { compileWorkspace, type Diagnostic } from '../compiler.js'
import { evaluateProjection, loadProjection } from '../projection.js'
import { exportLikeC4 } from './likec4-export.js'

const usage =
  'Usage:\n' +
  '  yarramate-likec4 export <projection.yaml> <mapping.yaml> <workspace-or-source...>\n' +
  '  yarramate-likec4 export-project <projection.yaml> <mapping.yaml> <output-dir> <workspace-or-source...>\n'

const diagnosticJson = (
  diagnostics: readonly (Diagnostic | {
    readonly code: string
    readonly message: string
    readonly subject?: string
  })[],
): string =>
  `${JSON.stringify(
    {
      format: 'yarramate/likec4-diagnostic-result/v1',
      diagnostics,
    },
    null,
    2,
  )}\n`

export function runLikeC4Cli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  const [command, projectionPath, mappingPath, ...options] = args
  const outputDirectory =
    command === 'export-project' ? options[0] : undefined
  const sourcePaths =
    command === 'export-project' ? options.slice(1) : options
  if (
    (command !== 'export' && command !== 'export-project') ||
    projectionPath === undefined ||
    mappingPath === undefined ||
    (command === 'export-project' && outputDirectory === undefined) ||
    sourcePaths.length === 0 ||
    args.some((argument) => argument.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const resolved = resolveCliWorkspaceSources(sourcePaths, cwd)
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
    const projection = loadProjection({
      path: projectionPath,
      source: readFileSync(resolve(cwd, projectionPath), 'utf8'),
    })
    if (!projection.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(projection.diagnostics),
        stderr: '',
      }
    }
    const mapping = loadAdapterMapping({
      path: mappingPath,
      source: readFileSync(resolve(cwd, mappingPath), 'utf8'),
    })
    if (!mapping.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(mapping.diagnostics),
        stderr: '',
      }
    }
    const mappingValidation = validateAdapterMapping(
      compilation.graph,
      mapping.mapping,
    )
    if (!mappingValidation.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(mappingValidation.diagnostics),
        stderr: '',
      }
    }
    const exported = exportLikeC4(
      evaluateProjection(compilation.graph, projection.projection),
      mapping.mapping,
    )
    if (!exported.ok) {
      return {
          exitCode: 1,
          stdout: diagnosticJson(exported.diagnostics),
          stderr: '',
        }
    }
    if (command === 'export') {
      return { exitCode: 0, stdout: exported.source, stderr: '' }
    }

    const projectPath = resolve(cwd, outputDirectory!)
    const projectionIdentity = `${projection.projection.id}@${projection.projection.version}`
    const mappingIdentity = `${mapping.mapping.id}@${mapping.mapping.version}`
    const markerPath = resolve(projectPath, 'yarramate.generated.json')
    const updating = existsSync(projectPath)
    if (updating) {
      let marker: unknown
      try {
        marker = JSON.parse(readFileSync(markerPath, 'utf8'))
      } catch {
        marker = undefined
      }
      if (
        typeof marker !== 'object' ||
        marker === null ||
        !('format' in marker) ||
        marker.format !== 'yarramate/likec4-generated-project/v1' ||
        !('projection' in marker) ||
        marker.projection !== projectionIdentity ||
        !('mapping' in marker) ||
        marker.mapping !== mappingIdentity
      ) {
        return {
          exitCode: 2,
          stdout: '',
          stderr: `Output directory already exists: ${projectPath}\n`,
        }
      }
    } else {
      mkdirSync(projectPath)
    }
    const projectName = [
      'yarramate',
      projection.projection.id,
      projection.projection.version,
    ]
      .join('-')
      .replaceAll(/[^A-Za-z0-9_-]/g, '-')
    writeFileSync(resolve(projectPath, 'model.likec4'), exported.source)
    writeFileSync(
      resolve(projectPath, 'specification.likec4'),
      readFileSync(
        fileURLToPath(
          new URL('../../profile/specification.likec4', import.meta.url),
        ),
      ),
    )
    writeFileSync(
      resolve(projectPath, 'likec4.config.json'),
      `${JSON.stringify(
        {
          $schema: 'https://likec4.dev/schemas/config.json',
          name: projectName,
          title:
            projection.projection.presentation?.title ??
            projection.projection.id,
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      markerPath,
      `${JSON.stringify(
        {
          format: 'yarramate/likec4-generated-project/v1',
          projection: projectionIdentity,
          mapping: mappingIdentity,
          files: [
            'likec4.config.json',
            'model.likec4',
            'specification.likec4',
          ],
        },
        null,
        2,
      )}\n`,
    )
    return {
      exitCode: 0,
      stdout: updating
        ? `Updated LikeC4 project at ${projectPath}\n`
        : `Wrote LikeC4 project to ${projectPath}\n`,
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
  const result = runLikeC4Cli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
