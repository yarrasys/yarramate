#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import Ajv2020Module from 'ajv/dist/2020.js'
import { isMap, isSeq, parseDocument } from 'yaml'
import {
  isMainModule,
  resolveCliWorkspaceSources,
  type CliResult,
} from '../cli-support.js'
import { compileWorkspace } from '../compiler.js'
import {
  adapterMappingLocation,
  loadAdapterMapping,
  validateAdapterMapping,
} from '../adapter-mapping.js'
import { locateSourcePath } from '../source-document.js'
import {
  prepareLikeC4Export,
  type LikeC4PreparationDiagnostic,
} from './likec4-prepare.js'
import {
  exportLikeC4Project,
  loadLikeC4ProjectDefinition,
} from './likec4-project.js'
import generatedProjectSchema from '../../schema/yarramate-likec4-generated-project.schema.json' with {
  type: 'json',
}
import generatedProjectV2Schema from '../../schema/yarramate-likec4-generated-project-v2.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateGeneratedProjectMarker = new Ajv2020({
  allErrors: true,
}).compile(generatedProjectSchema)
const validateGeneratedProjectV2Marker = new Ajv2020({
  allErrors: true,
}).compile(generatedProjectV2Schema)
const generatedFileNames = [
  'likec4.config.json',
  'model.likec4',
  'specification.likec4',
] as const

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

const stageFile = (
  destination: string,
  value: string | Buffer,
): { readonly publish: () => void; readonly cleanup: () => void } => {
  const staged = `${destination}.yarramate-${randomUUID()}.tmp`
  const descriptor = openSync(staged, 'wx', 0o666)
  let written = false
  try {
    writeFileSync(descriptor, value)
    written = true
  } finally {
    closeSync(descriptor)
    if (!written && existsSync(staged)) unlinkSync(staged)
  }
  return {
    publish: () => renameSync(staged, destination),
    cleanup: () => {
      if (existsSync(staged)) unlinkSync(staged)
    },
  }
}

const publishFiles = (
  files: readonly {
    readonly destination: string
    readonly value: string | Buffer
  }[],
) => {
  const stagedFiles: ReturnType<typeof stageFile>[] = []
  try {
    for (const file of files) {
      stagedFiles.push(stageFile(file.destination, file.value))
    }
  } catch (error) {
    for (const staged of stagedFiles) staged.cleanup()
    throw error
  }
  try {
    for (const staged of stagedFiles) staged.publish()
  } finally {
    for (const staged of stagedFiles) staged.cleanup()
  }
}

const usage =
  'Usage:\n' +
  '  yarramate-likec4 map --sync [--prune] <mapping.yaml> <workspace-or-source...>\n' +
  '  yarramate-likec4 check <projection.yaml> <mapping.yaml> [--json] [--kinds <kind-mapping.yaml>] [--compare <from-state> <to-state>] <workspace-or-source...>\n' +
  '  yarramate-likec4 check <likec4-project.yaml> [--json] <workspace-or-source...>\n' +
  '  yarramate-likec4 export <projection.yaml> <mapping.yaml> [--kinds <kind-mapping.yaml>] [--compare <from-state> <to-state>] <workspace-or-source...>\n' +
  '  yarramate-likec4 export-project <projection.yaml> <mapping.yaml> <output-dir> [--kinds <kind-mapping.yaml>] [--compare <from-state> <to-state>] <workspace-or-source...>\n' +
  '  yarramate-likec4 export-project <likec4-project.yaml> <output-dir> <workspace-or-source...>\n'

const diagnosticJson = (
  diagnostics: readonly LikeC4PreparationDiagnostic[],
): string =>
  `${JSON.stringify(
    {
      format: 'yarramate/likec4-diagnostic-result/v1',
      diagnostics,
    },
    null,
    2,
  )}\n`

const checkJson = (
  ok: boolean,
  diagnostics: readonly LikeC4PreparationDiagnostic[],
): string =>
  `${JSON.stringify(
    {
      format: 'yarramate/likec4-check-result/v1',
      ok,
      diagnostics,
    },
    null,
    2,
  )}\n`

const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

const lowerCamel = (value: string) =>
  value.replaceAll(/-([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  )

const runLikeC4MapSync = (
  args: readonly string[],
  cwd: string,
): CliResult => {
  const sync = args[0]
  const prune = args[1] === '--prune'
  const mappingPath = args[prune ? 2 : 1]
  const sourcePaths = args.slice(prune ? 3 : 2)
  if (
    sync !== '--sync' ||
    mappingPath === undefined ||
    mappingPath.startsWith('-') ||
    sourcePaths.length === 0 ||
    sourcePaths.some((path) => path.startsWith('-'))
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
    const absoluteMappingPath = resolve(cwd, mappingPath)
    const original = readFileSync(absoluteMappingPath, 'utf8')
    const loaded = loadAdapterMapping({
      path: mappingPath,
      source: original,
    })
    if (!loaded.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(loaded.diagnostics),
        stderr: '',
      }
    }
    if (loaded.mapping.adapter !== 'likec4') {
      const location = adapterMappingLocation(loaded.mapping, 'adapter')
      return {
        exitCode: 1,
        stdout: diagnosticJson([{
          severity: 'error',
          code: 'YMLC101',
          message: `Adapter mapping targets "${loaded.mapping.adapter}", not "likec4"`,
          ...location,
        }]),
        stderr: '',
      }
    }
    const graphSubjects = new Set(
      compilation.graph.subjects.map(({ id }) => id),
    )
    const staleCount = loaded.mapping.mappings.filter(
      ({ native }) => !graphSubjects.has(native),
    ).length
    const validation = validateAdapterMapping(
      compilation.graph,
      loaded.mapping,
    )
    const blockingDiagnostics = validation.ok
      ? []
      : validation.diagnostics.filter(({ code }) => code !== 'YM601')
    if (blockingDiagnostics.length > 0) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(blockingDiagnostics),
        stderr: '',
      }
    }
    const mapped = new Set(
      loaded.mapping.mappings.map(({ native }) => native),
    )
    const claimedExternal = new Set(
      loaded.mapping.mappings
        .filter(({ native }) => !prune || graphSubjects.has(native))
        .map(({ external }) => external),
    )
    const architectureStates = new Set(
      compilation.graph.claims
        .filter(({ predicate }) => predicate === 'yarramate/state/type')
        .map(({ subject }) => subject),
    )
    const additions = compilation.graph.subjects
      .filter(
        ({ id }) => !mapped.has(id) && !architectureStates.has(id),
      )
      .map((subject) => {
        const [documentId, localId] = subject.id.split('#') as [
          string,
          string,
        ]
        const local = lowerCamel(localId)
        let external = local
        if (claimedExternal.has(external)) {
          external = `${lowerCamel(documentId)}_${local}`
        }
        let suffix = 2
        const base = external
        while (claimedExternal.has(external)) {
          external = `${base}_${suffix}`
          suffix += 1
        }
        claimedExternal.add(external)
        return {
          native: subject.id,
          external,
          type: subject.type,
        }
      })
    if (additions.length === 0 && (!prune || staleCount === 0)) {
      return {
        exitCode: 0,
        stdout:
          staleCount === 0
            ? `LikeC4 mapping ${mappingPath} is already synchronized\n`
            : `LikeC4 mapping ${mappingPath} has ${staleCount} stale ${staleCount === 1 ? 'mapping' : 'mappings'} (use --prune)\n`,
        stderr: '',
      }
    }
    const document = parseDocument(original)
    const mappings = document.getIn(['mappings'], true)
    if (prune && isSeq(mappings)) {
      const firstMappingWasPruned =
        mappings.items.length > 0 &&
        isMap(mappings.items[0]) &&
        !graphSubjects.has(String(mappings.items[0].get('native')))
      mappings.items = mappings.items.filter(
        (item) =>
          !isMap(item) ||
          graphSubjects.has(String(item.get('native'))),
      )
      if (firstMappingWasPruned) mappings.commentBefore = undefined
    }
    for (const addition of additions) {
      document.addIn(['mappings'], addition)
    }
    if (isSeq(mappings)) mappings.flow = false
    const candidate = document.toString({ lineWidth: 0 })
    const candidateMapping = loadAdapterMapping({
      path: mappingPath,
      source: candidate,
    })
    if (!candidateMapping.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(candidateMapping.diagnostics),
        stderr: '',
      }
    }
    const candidateValidation = validateAdapterMapping(
      compilation.graph,
      candidateMapping.mapping,
    )
    const candidateBlockingDiagnostics = candidateValidation.ok
      ? []
      : candidateValidation.diagnostics.filter(
          ({ code }) => prune || code !== 'YM601',
        )
    if (candidateBlockingDiagnostics.length > 0) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(candidateBlockingDiagnostics),
        stderr: '',
      }
    }
    const staged = stageFile(absoluteMappingPath, candidate)
    try {
      staged.publish()
    } finally {
      staged.cleanup()
    }
    return {
      exitCode: 0,
      stdout: prune
        ? additions.length > 0
          ? `Added ${additions.length} and pruned ${staleCount} stale LikeC4 ${staleCount === 1 ? 'mapping' : 'mappings'} in ${mappingPath}\n`
          : `Pruned ${staleCount} stale LikeC4 ${staleCount === 1 ? 'mapping' : 'mappings'} from ${mappingPath}\n`
        : `Added ${additions.length} LikeC4 ${additions.length === 1 ? 'mapping' : 'mappings'} to ${mappingPath}` +
          (staleCount === 0
            ? '\n'
            : `; left ${staleCount} stale ${staleCount === 1 ? 'mapping' : 'mappings'} (use --prune)\n`),
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const publishGeneratedProject = (
  cwd: string,
  outputDirectory: string,
  input: {
    readonly projectName: string
    readonly title: string
    readonly modelSource: string
    readonly ownership: Readonly<Record<string, unknown>>
    readonly validateMarker: (value: unknown) => boolean
  },
): CliResult => {
  const projectPath = resolve(cwd, outputDirectory)
  const markerPath = resolve(projectPath, 'yarramate.generated.json')
  const updating = existsSync(projectPath)
  if (updating) {
    const projectStat = lstatSync(projectPath)
    if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Output directory already exists: ${projectPath}\n`,
      }
    }
    const unsafeFile = [
      markerPath,
      ...generatedFileNames.map((file) => resolve(projectPath, file)),
    ].find((path) => {
      if (!existsSync(path)) return false
      const stat = lstatSync(path)
      return stat.isSymbolicLink() || !stat.isFile()
    })
    if (unsafeFile !== undefined) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Generated project contains an unsafe file: ${unsafeFile}\n`,
      }
    }
    let marker: unknown
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    } catch {
      marker = undefined
    }
    if (
      !input.validateMarker(marker) ||
      typeof marker !== 'object' ||
      marker === null ||
      Object.entries(input.ownership).some(
        ([key, value]) =>
          !sameJson(
            (marker as Record<string, unknown>)[key],
            value,
          ),
      )
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Output directory already exists: ${projectPath}\n`,
      }
    }
    if ('digests' in marker && marker.digests !== undefined) {
      const digests = marker.digests as Record<string, string>
      const changedFile = generatedFileNames.find((file) => {
        const path = resolve(projectPath, file)
        return (
          !existsSync(path) ||
          sha256(readFileSync(path)) !== digests[file]
        )
      })
      if (changedFile !== undefined) {
        return {
          exitCode: 2,
          stdout: '',
          stderr: `Generated project file has changed: ${resolve(projectPath, changedFile)}\n`,
        }
      }
    }
  } else {
    mkdirSync(projectPath, { recursive: true })
  }
  const specificationSource = readFileSync(
    fileURLToPath(
      new URL(
        '../../assets/likec4/specification.likec4',
        import.meta.url,
      ),
    ),
  )
  const configSource = `${JSON.stringify(
    {
      $schema: 'https://likec4.dev/schemas/config.json',
      name: input.projectName,
      title: input.title,
    },
    null,
    2,
  )}\n`
  const markerSource = `${JSON.stringify(
    {
      ...input.ownership,
      files: [
        'likec4.config.json',
        'model.likec4',
        'specification.likec4',
      ],
      digests: {
        'likec4.config.json': sha256(configSource),
        'model.likec4': sha256(input.modelSource),
        'specification.likec4': sha256(specificationSource),
      },
    },
    null,
    2,
  )}\n`
  publishFiles([
    {
      destination: resolve(projectPath, 'likec4.config.json'),
      value: configSource,
    },
    {
      destination: resolve(projectPath, 'model.likec4'),
      value: input.modelSource,
    },
    {
      destination: resolve(projectPath, 'specification.likec4'),
      value: specificationSource,
    },
    { destination: markerPath, value: markerSource },
  ])
  return {
    exitCode: 0,
    stdout: updating
      ? `Updated LikeC4 project at ${projectPath}\n`
      : `Wrote LikeC4 project to ${projectPath}\n`,
    stderr: '',
  }
}

export function runLikeC4Cli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  if (args[0] === 'map') {
    return runLikeC4MapSync(args.slice(1), cwd)
  }
  const [command, projectionPath, mappingPath, ...options] = args
  let projectDefinitionMode = false
  if (
    (command === 'check' || command === 'export-project') &&
    projectionPath !== undefined
  ) {
    try {
      projectDefinitionMode =
        parseDocument(
          readFileSync(resolve(cwd, projectionPath), 'utf8'),
        ).get('format') === 'yarramate/likec4-project/v1'
    } catch {
      projectDefinitionMode = false
    }
  }
  const outputDirectory =
    command === 'export-project'
      ? projectDefinitionMode
        ? mappingPath
        : options[0]
      : undefined
  const sourceOptions =
    projectDefinitionMode && command === 'check'
      ? [mappingPath, ...options].filter(
          (value): value is string => value !== undefined,
        )
      : command === 'export-project'
      ? projectDefinitionMode
        ? options
        : options.slice(1)
      : options
  const json = command === 'check' && sourceOptions.includes('--json')
  let invalidOptions = false
  let kindMappingPath: string | undefined
  let comparison:
    | { readonly from: string; readonly to: string }
    | undefined
  const sourcePaths: string[] = []
  for (let index = 0; index < sourceOptions.length; index += 1) {
    const option = sourceOptions[index]!
    if (option === '--json') {
      if (command !== 'check') invalidOptions = true
      continue
    }
    if (option === '--kinds') {
      const value = sourceOptions[index + 1]
      if (
        value === undefined ||
        value.startsWith('-') ||
        kindMappingPath !== undefined
      ) {
        invalidOptions = true
      } else {
        kindMappingPath = value
        index += 1
      }
      continue
    }
    if (option === '--compare') {
      const from = sourceOptions[index + 1]
      const to = sourceOptions[index + 2]
      if (
        from === undefined ||
        to === undefined ||
        from.startsWith('-') ||
        to.startsWith('-') ||
        comparison !== undefined
      ) {
        invalidOptions = true
      } else {
        comparison = { from, to }
        index += 2
      }
      continue
    }
    if (option.startsWith('-')) invalidOptions = true
    else sourcePaths.push(option)
  }
  if (
    (command !== 'check' &&
      command !== 'export' &&
      command !== 'export-project') ||
    projectionPath === undefined ||
    (!projectDefinitionMode && mappingPath === undefined) ||
    (projectDefinitionMode &&
      command === 'export-project' &&
      mappingPath === undefined) ||
    (command === 'export-project' && outputDirectory === undefined) ||
    (projectDefinitionMode &&
      (kindMappingPath !== undefined || comparison !== undefined)) ||
    invalidOptions ||
    sourcePaths.length === 0 ||
    sourcePaths.some((argument) => argument.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const diagnosticOutput = (
    diagnostics: Parameters<typeof diagnosticJson>[0],
  ) => (json ? checkJson(false, diagnostics) : diagnosticJson(diagnostics))

  try {
    const resolved = resolveCliWorkspaceSources(sourcePaths, cwd)
    if (!resolved.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticOutput(resolved.diagnostics),
        stderr: '',
      }
    }
    const sources = resolved.paths.map((path) => ({
      path,
      source: readFileSync(resolve(cwd, path), 'utf8'),
    }))
    if (projectDefinitionMode) {
      const projectSource = {
        path: projectionPath,
        source: readFileSync(resolve(cwd, projectionPath), 'utf8'),
      }
      const loadedProject = loadLikeC4ProjectDefinition(projectSource)
      if (!loadedProject.ok) {
        return {
          exitCode: 1,
          stdout: diagnosticOutput(loadedProject.diagnostics),
          stderr: '',
        }
      }
      const referencedSources = new Map<string, {
        readonly path: string
        readonly source: string
      }>()
      const referenceDiagnostics: LikeC4PreparationDiagnostic[] = []
      const readProjectReference = (
        path: string,
        label: 'mapping' | 'kind mapping' | 'projection',
        yamlPath: readonly (string | number)[],
        pointer: string,
      ) => {
        const existing = referencedSources.get(path)
        if (existing !== undefined) return existing
        try {
          const source = {
            path,
            source: readFileSync(resolve(cwd, path), 'utf8'),
          }
          referencedSources.set(path, source)
          return source
        } catch (error) {
          const location = locateSourcePath(
            projectSource.path,
            loadedProject.document.yaml,
            loadedProject.document.lineCounter,
            yamlPath,
            pointer,
          )
          const absent =
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          referenceDiagnostics.push({
            severity: 'error',
            code: 'YMLC110',
            message: absent
              ? `LikeC4 project ${label} "${path}" does not exist`
              : `LikeC4 project ${label} "${path}" cannot be read`,
            ...location,
          })
          return undefined
        }
      }
      const subjectMapping = readProjectReference(
        loadedProject.document.value.mapping,
        'mapping',
        ['mapping'],
        '/mapping',
      )
      const kindMapping =
        loadedProject.document.value.kindMapping === undefined
          ? undefined
          : readProjectReference(
              loadedProject.document.value.kindMapping,
              'kind mapping',
              ['kindMapping'],
              '/kindMapping',
            )
      const projections = loadedProject.document.value.views.map(
        (view, index) =>
          readProjectReference(
            view.projection,
            'projection',
            ['views', index, 'projection'],
            `/views/${index}/projection`,
          ),
      )
      if (
        referenceDiagnostics.length > 0 ||
        subjectMapping === undefined
      ) {
        return {
          exitCode: 1,
          stdout: diagnosticOutput(
            referenceDiagnostics.sort((left, right) =>
              left.path.localeCompare(right.path) ||
              left.line - right.line ||
              left.column - right.column ||
              left.code.localeCompare(right.code) ||
              left.message.localeCompare(right.message),
            ),
          ),
          stderr: '',
        }
      }
      const preparedViews = loadedProject.document.value.views.map(
        (view, index) => ({
          view,
          prepared: prepareLikeC4Export({
            sources,
            projection: projections[index]!,
            subjectMapping,
            ...(loadedProject.document.value.kindMapping === undefined
              ? {}
              : {
                  kindMapping: kindMapping!,
                }),
            ...(view.compare === undefined
              ? {}
              : { comparison: view.compare }),
            vocabulary: 'bundled',
          }),
        }),
      )
      const failed = preparedViews.find(({ prepared }) => !prepared.ok)
      if (failed !== undefined && !failed.prepared.ok) {
        return {
          exitCode: 1,
          stdout: diagnosticOutput(failed.prepared.diagnostics),
          stderr: '',
        }
      }
      const successfulViews = preparedViews.flatMap(
        ({ view, prepared }) =>
          prepared.ok
            ? [
                {
                  ...(view.id === undefined ? {} : { id: view.id }),
                  prepared,
                  ...(view.compare === undefined
                    ? {}
                    : { comparison: view.compare }),
                  ...(view.dynamic === undefined
                    ? {}
                    : { dynamic: view.dynamic }),
                  ...(view.deployment === undefined
                    ? {}
                    : { deployment: view.deployment }),
                },
              ]
            : [],
      )
      const renderedViewIds = new Set<string>()
      const deploymentIdentities = new Set<string>()
      for (const [index, view] of successfulViews.entries()) {
        const deployment = view.deployment
        if (deployment !== undefined) {
          const nodeIds = new Set<string>()
          for (const [nodeIndex, node] of deployment.nodes.entries()) {
            const problem =
              nodeIds.has(node.id)
                ? `Deployment node "${node.id}" is duplicated`
                : deploymentIdentities.has(node.id)
                  ? `Deployment identity "${node.id}" is duplicated`
                : node.parent === node.id
                  ? `Deployment node "${node.id}" cannot parent itself`
                  : undefined
            if (problem !== undefined) {
              const field =
                nodeIds.has(node.id) || deploymentIdentities.has(node.id)
                  ? 'id'
                  : 'parent'
              const pointer =
                `/views/${index}/deployment/nodes/${nodeIndex}/${field}`
              const location = locateSourcePath(
                projectSource.path,
                loadedProject.document.yaml,
                loadedProject.document.lineCounter,
                ['views', index, 'deployment', 'nodes', nodeIndex, field],
                pointer,
              )
              return {
                exitCode: 1,
                stdout: diagnosticOutput([{
                  severity: 'error',
                  code: 'YMLC109',
                  message: problem,
                  ...location,
                }]),
                stderr: '',
              }
            }
            nodeIds.add(node.id)
            deploymentIdentities.add(node.id)
          }
          for (const [nodeIndex, node] of deployment.nodes.entries()) {
            if (
              node.parent !== undefined &&
              !nodeIds.has(node.parent)
            ) {
              const pointer =
                `/views/${index}/deployment/nodes/${nodeIndex}/parent`
              const location = locateSourcePath(
                projectSource.path,
                loadedProject.document.yaml,
                loadedProject.document.lineCounter,
                [
                  'views',
                  index,
                  'deployment',
                  'nodes',
                  nodeIndex,
                  'parent',
                ],
                pointer,
              )
              return {
                exitCode: 1,
                stdout: diagnosticOutput([{
                  severity: 'error',
                  code: 'YMLC109',
                  message: `Deployment parent "${node.parent}" does not exist`,
                  ...location,
                }]),
                stderr: '',
              }
            }
            const nodeById = new Map(
              deployment.nodes.map((candidate) => [
                candidate.id,
                candidate,
              ]),
            )
            const ancestors = new Set([node.id])
            let parent = node.parent
            while (parent !== undefined) {
              if (ancestors.has(parent)) {
                const pointer =
                  `/views/${index}/deployment/nodes/${nodeIndex}/parent`
                const location = locateSourcePath(
                  projectSource.path,
                  loadedProject.document.yaml,
                  loadedProject.document.lineCounter,
                  [
                    'views',
                    index,
                    'deployment',
                    'nodes',
                    nodeIndex,
                    'parent',
                  ],
                  pointer,
                )
                return {
                  exitCode: 1,
                  stdout: diagnosticOutput([{
                    severity: 'error',
                    code: 'YMLC109',
                    message: `Deployment node "${node.id}" participates in a parent cycle`,
                    ...location,
                  }]),
                  stderr: '',
                }
              }
              ancestors.add(parent)
              parent = nodeById.get(parent)?.parent
            }
          }
          const instanceIds = new Set<string>()
          for (const [instanceIndex, instance] of (
            deployment.instances
          ).entries()) {
            const projected = view.prepared.projection.subjects.find(
              ({ id }) => id === instance.subject,
            )
            const problem =
              instanceIds.has(instance.id)
                ? `Deployment instance "${instance.id}" is duplicated`
                : deploymentIdentities.has(instance.id)
                  ? `Deployment identity "${instance.id}" is duplicated`
                : !nodeIds.has(instance.node)
                  ? `Deployment instance node "${instance.node}" does not exist`
                  : projected?.type !== 'concept'
                    ? `Deployment instance subject "${instance.subject}" is not selected as a concept by its projection`
                    : undefined
            if (problem !== undefined) {
              const field =
                instanceIds.has(instance.id) ||
                deploymentIdentities.has(instance.id)
                  ? 'id'
                  : !nodeIds.has(instance.node)
                    ? 'node'
                    : 'subject'
              const pointer =
                `/views/${index}/deployment/instances/${instanceIndex}/${field}`
              const location = locateSourcePath(
                projectSource.path,
                loadedProject.document.yaml,
                loadedProject.document.lineCounter,
                [
                  'views',
                  index,
                  'deployment',
                  'instances',
                  instanceIndex,
                  field,
                ],
                pointer,
              )
              return {
                exitCode: 1,
                stdout: diagnosticOutput([{
                  severity: 'error',
                  code: 'YMLC109',
                  message: problem,
                  ...location,
                }]),
                stderr: '',
              }
            }
            instanceIds.add(instance.id)
            deploymentIdentities.add(instance.id)
          }
        }
        for (const [stepIndex, step] of (
          view.dynamic?.steps ?? []
        ).entries()) {
          const projected = view.prepared.projection.subjects.find(
            ({ id }) => id === step.relationship,
          )
          if (projected?.type !== 'relationship') {
            const pointer =
              `/views/${index}/dynamic/steps/${stepIndex}/relationship`
            const location = locateSourcePath(
              projectSource.path,
              loadedProject.document.yaml,
              loadedProject.document.lineCounter,
              [
                'views',
                index,
                'dynamic',
                'steps',
                stepIndex,
                'relationship',
              ],
              pointer,
            )
            return {
              exitCode: 1,
              stdout: diagnosticOutput([
                {
                  severity: 'error',
                  code: 'YMLC108',
                  message: `Dynamic step relationship "${step.relationship}" is not selected as a relationship by its projection`,
                  ...location,
                },
              ]),
              stderr: '',
            }
          }
        }
        const renderedId =
          view.id ?? view.prepared.projection.projection.split('@')[0]!
        if (renderedViewIds.has(renderedId)) {
          const field = view.id === undefined ? 'projection' : 'id'
          const pointer = `/views/${index}/${field}`
          const location = locateSourcePath(
            projectSource.path,
            loadedProject.document.yaml,
            loadedProject.document.lineCounter,
            ['views', index, field],
            pointer,
          )
          return {
            exitCode: 1,
            stdout: diagnosticOutput([
              {
                severity: 'error',
                code: 'YMLC107',
                message: `LikeC4 view identity "${renderedId}" is duplicated`,
                ...location,
              },
            ]),
            stderr: '',
          }
        }
        renderedViewIds.add(renderedId)
      }
      const exported = exportLikeC4Project(
        loadedProject.document.value,
        successfulViews,
      )
      if (!exported.ok) {
        return {
          exitCode: 1,
          stdout: diagnosticOutput(exported.diagnostics),
          stderr: '',
        }
      }
      if (command === 'check') {
        const identity = `${loadedProject.document.value.id}@${loadedProject.document.value.version}`
        return {
          exitCode: 0,
          stdout: json
            ? checkJson(true, [])
            : `Checked LikeC4 project ${identity}: no errors\n`,
          stderr: '',
        }
      }
      const first = successfulViews[0]!
      const mappingIdentity = `${first.prepared.subjectMapping.id}@${first.prepared.subjectMapping.version}`
      const kindMappingIdentity =
        first.prepared.kindMapping === undefined
          ? undefined
          : `${first.prepared.kindMapping.id}@${first.prepared.kindMapping.version}`
      const projectIdentity = `${loadedProject.document.value.id}@${loadedProject.document.value.version}`
      return publishGeneratedProject(cwd, outputDirectory!, {
        projectName: `yarramate-${projectIdentity}`.replaceAll(
          /[^A-Za-z0-9_-]/g,
          '-',
        ),
        title: loadedProject.document.value.title,
        modelSource: exported.source,
        ownership: {
          format: 'yarramate/likec4-generated-project/v2',
          project: projectIdentity,
          mapping: mappingIdentity,
          ...(kindMappingIdentity === undefined
            ? {}
            : { kindMapping: kindMappingIdentity }),
          views: successfulViews.map(({ id, prepared, comparison }) => ({
            ...(id === undefined ? {} : { id }),
            projection: prepared.projection.projection,
            ...(comparison === undefined
              ? {}
              : { comparison }),
          })),
        },
        validateMarker: (value) =>
          validateGeneratedProjectV2Marker(value),
      })
    }
    const prepared = prepareLikeC4Export({
      sources,
      projection: {
        path: projectionPath,
        source: readFileSync(resolve(cwd, projectionPath), 'utf8'),
      },
      subjectMapping: {
        path: mappingPath!,
        source: readFileSync(resolve(cwd, mappingPath!), 'utf8'),
      },
      ...(kindMappingPath === undefined
        ? {}
        : {
            kindMapping: {
              path: kindMappingPath,
              source: readFileSync(
                resolve(cwd, kindMappingPath),
                'utf8',
              ),
            },
          }),
      ...(comparison === undefined ? {} : { comparison }),
      vocabulary: command === 'export' ? 'consumer' : 'bundled',
    })
    if (!prepared.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticOutput(prepared.diagnostics),
        stderr: '',
      }
    }
    if (command === 'check') {
      return {
        exitCode: 0,
        stdout: json
          ? checkJson(true, [])
          : `Checked LikeC4 export ${prepared.projection.projection}: no errors\n`,
        stderr: '',
      }
    }
    if (command === 'export') {
      return { exitCode: 0, stdout: prepared.source, stderr: '' }
    }

    const projectionIdentity = prepared.projection.projection
    const mappingIdentity = `${prepared.subjectMapping.id}@${prepared.subjectMapping.version}`
    const kindMappingIdentity =
      prepared.kindMapping === undefined
        ? undefined
        : `${prepared.kindMapping.id}@${prepared.kindMapping.version}`
    const comparisonIdentity = comparison
    return publishGeneratedProject(cwd, outputDirectory!, {
      projectName: ['yarramate', projectionIdentity]
        .join('-')
        .replaceAll(/[^A-Za-z0-9_-]/g, '-'),
      title:
        prepared.projection.presentation?.title ??
        projectionIdentity.slice(0, projectionIdentity.lastIndexOf('@')),
      modelSource: prepared.source,
      ownership: {
        format: 'yarramate/likec4-generated-project/v1',
        projection: projectionIdentity,
        mapping: mappingIdentity,
        ...(kindMappingIdentity === undefined
          ? {}
          : { kindMapping: kindMappingIdentity }),
        ...(comparisonIdentity === undefined
          ? {}
          : { comparison: comparisonIdentity }),
      },
      validateMarker: (value) => validateGeneratedProjectMarker(value),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const result = runLikeC4Cli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
