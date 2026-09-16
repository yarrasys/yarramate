import { parseDocument } from 'yaml'
import type { WorkspaceSource } from '../compiler.js'
import { brandSlug, resolveBranding, type Branding } from '../branding.js'
import { sha256Hex } from '../digest.js'
import { LIKEC4_SPECIFICATION_SOURCE } from '../likec4-specification.generated.js'
import { locateSourcePath } from '../source-document.js'
import {
  prepareLikeC4Export,
  type LikeC4PreparationDiagnostic,
} from './likec4-prepare.js'
import type { GitChangeOverlay } from './likec4-export.js'
import {
  exportLikeC4Project,
  loadLikeC4ProjectDefinition,
  type LikeC4ProjectDefinition,
  type PreparedLikeC4ProjectView,
} from './likec4-project.js'

/**
 * A LikeC4 project definition to a generated project, with no filesystem
 * (ADR 0156). `yarramate-likec4 export-project` reads the definition and
 * the files it names from disk, runs this, and writes what comes back;
 * `yarramate/tools` reads them from a store and hands the files to whoever
 * asked. The checks between preparation and export (deployment nodes,
 * dynamic steps, duplicate view identities) live here so both callers
 * refuse the same definitions with the same diagnostics.
 */

export interface LikeC4ProjectExportInput {
  /** The `yarramate/likec4-project/v1` document. */
  readonly project: WorkspaceSource
  /** The workspace's compiler sources: profiles, patterns, documents. */
  readonly sources: readonly WorkspaceSource[]
  /**
   * The mapping, kind mapping and projections the definition names, by the
   * path written in the definition (relative to its directory). `undefined`
   * for one the caller cannot find is reported as YMLC110.
   */
  readonly readReference: (path: string) => WorkspaceSource | undefined
  /** `check` refuses relationships the mapping does not cover; `export` does not. */
  readonly requireMappedRelationships: boolean
  /** The git-derived review overlay, when the CLI derived one. */
  readonly gitChange?: GitChangeOverlay
  /**
   * The host's branding (#546, ADR 0158): the model banner and the project
   * name in `likec4.config.json`. The marker file and its digests are
   * machinery and keep their names.
   */
  readonly branding?: Branding
}

export interface LikeC4ProjectExported {
  readonly ok: true
  readonly project: LikeC4ProjectDefinition
  readonly views: readonly PreparedLikeC4ProjectView[]
  /** The `model.likec4` text. */
  readonly modelSource: string
  readonly projectIdentity: string
  readonly mappingIdentity: string
  readonly kindMappingIdentity?: string
  /** Every source that fed the export, for the marker's input digests. */
  readonly inputs: readonly WorkspaceSource[]
  /** Echoed from the input so `generatedProjectFiles` names the project for it. */
  readonly branding?: Branding
}

export type LikeC4ProjectExportResult =
  | LikeC4ProjectExported
  | {
      readonly ok: false
      readonly diagnostics: readonly LikeC4PreparationDiagnostic[]
    }

const sortDiagnostics = (
  diagnostics: readonly LikeC4PreparationDiagnostic[],
): readonly LikeC4PreparationDiagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )

export const exportLikeC4ProjectFromSources = (
  input: LikeC4ProjectExportInput,
): LikeC4ProjectExportResult => {
  const { project: projectSource, sources } = input
  const loadedProject = loadLikeC4ProjectDefinition(projectSource)
  if (!loadedProject.ok) {
    return { ok: false, diagnostics: loadedProject.diagnostics }
  }
  const definition = loadedProject.document.value
  const referencedSources = new Map<string, WorkspaceSource>()
  const referenceDiagnostics: LikeC4PreparationDiagnostic[] = []
  const readProjectReference = (
    path: string,
    label: 'mapping' | 'kind mapping' | 'projection',
    yamlPath: readonly (string | number)[],
    pointer: string,
  ): WorkspaceSource | undefined => {
    const existing = referencedSources.get(path)
    if (existing !== undefined) return existing
    const source = input.readReference(path)
    if (source !== undefined) {
      referencedSources.set(path, source)
      return source
    }
    const location = locateSourcePath(
      projectSource.path,
      loadedProject.document.yaml,
      loadedProject.document.lineCounter,
      yamlPath,
      pointer,
    )
    referenceDiagnostics.push({
      severity: 'error',
      code: 'YMLC110',
      message: `LikeC4 project ${label} "${path}" does not exist`,
      ...location,
    })
    return undefined
  }
  const subjectMapping = readProjectReference(
    definition.mapping,
    'mapping',
    ['mapping'],
    '/mapping',
  )
  const kindMapping =
    definition.kindMapping === undefined
      ? undefined
      : readProjectReference(
          definition.kindMapping,
          'kind mapping',
          ['kindMapping'],
          '/kindMapping',
        )
  const projections = definition.views.map((view, index) =>
    readProjectReference(
      view.projection,
      'projection',
      ['views', index, 'projection'],
      `/views/${index}/projection`,
    ),
  )
  if (referenceDiagnostics.length > 0 || subjectMapping === undefined) {
    return { ok: false, diagnostics: sortDiagnostics(referenceDiagnostics) }
  }
  const preparedViews = definition.views.map((view, index) => ({
    view,
    prepared: prepareLikeC4Export({
      sources,
      projection: projections[index]!,
      subjectMapping,
      ...(definition.kindMapping === undefined
        ? {}
        : { kindMapping: kindMapping! }),
      ...(view.compare === undefined ? {} : { comparison: view.compare }),
      vocabulary: 'bundled',
      requireMappedRelationships: input.requireMappedRelationships,
    }),
  }))
  const failedView = preparedViews.find(({ prepared }) => !prepared.ok)
  if (failedView !== undefined && !failedView.prepared.ok) {
    return { ok: false, diagnostics: failedView.prepared.diagnostics }
  }
  const successfulViews: PreparedLikeC4ProjectView[] = preparedViews.flatMap(
    ({ view, prepared }) =>
      prepared.ok
        ? [
            {
              ...(view.id === undefined ? {} : { id: view.id }),
              ...(view.folder === undefined ? {} : { folder: view.folder }),
              prepared,
              ...(view.compare === undefined
                ? {}
                : { comparison: view.compare }),
              ...(view.dynamic === undefined ? {} : { dynamic: view.dynamic }),
              ...(view.deployment === undefined
                ? {}
                : { deployment: view.deployment }),
            },
          ]
        : [],
  )

  const refuse = (
    code: string,
    message: string,
    yamlPath: readonly (string | number)[],
    pointer: string,
  ): LikeC4ProjectExportResult => ({
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code,
        message,
        ...locateSourcePath(
          projectSource.path,
          loadedProject.document.yaml,
          loadedProject.document.lineCounter,
          yamlPath,
          pointer,
        ),
      },
    ],
  })

  const renderedViewIds = new Set<string>()
  const deploymentIdentities = new Set<string>()
  for (const [index, view] of successfulViews.entries()) {
    const deployment = view.deployment
    if (deployment !== undefined) {
      const nodeIds = new Set<string>()
      for (const [nodeIndex, node] of deployment.nodes.entries()) {
        const problem = nodeIds.has(node.id)
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
          return refuse(
            'YMLC109',
            problem,
            ['views', index, 'deployment', 'nodes', nodeIndex, field],
            `/views/${index}/deployment/nodes/${nodeIndex}/${field}`,
          )
        }
        nodeIds.add(node.id)
        deploymentIdentities.add(node.id)
      }
      for (const [nodeIndex, node] of deployment.nodes.entries()) {
        if (node.parent !== undefined && !nodeIds.has(node.parent)) {
          return refuse(
            'YMLC109',
            `Deployment parent "${node.parent}" does not exist`,
            ['views', index, 'deployment', 'nodes', nodeIndex, 'parent'],
            `/views/${index}/deployment/nodes/${nodeIndex}/parent`,
          )
        }
        const nodeById = new Map(
          deployment.nodes.map((candidate) => [candidate.id, candidate]),
        )
        const ancestors = new Set([node.id])
        let parent = node.parent
        while (parent !== undefined) {
          if (ancestors.has(parent)) {
            return refuse(
              'YMLC109',
              `Deployment node "${node.id}" participates in a parent cycle`,
              ['views', index, 'deployment', 'nodes', nodeIndex, 'parent'],
              `/views/${index}/deployment/nodes/${nodeIndex}/parent`,
            )
          }
          ancestors.add(parent)
          parent = nodeById.get(parent)?.parent
        }
      }
      const instanceIds = new Set<string>()
      for (const [instanceIndex, instance] of deployment.instances.entries()) {
        const projected = view.prepared.projection.subjects.find(
          ({ id }) => id === instance.subject,
        )
        const problem = instanceIds.has(instance.id)
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
          return refuse(
            'YMLC109',
            problem,
            ['views', index, 'deployment', 'instances', instanceIndex, field],
            `/views/${index}/deployment/instances/${instanceIndex}/${field}`,
          )
        }
        instanceIds.add(instance.id)
        deploymentIdentities.add(instance.id)
      }
    }
    for (const [stepIndex, step] of (view.dynamic?.steps ?? []).entries()) {
      const projected = view.prepared.projection.subjects.find(
        ({ id }) => id === step.relationship,
      )
      if (projected?.type !== 'relationship') {
        return refuse(
          'YMLC108',
          `Dynamic step relationship "${step.relationship}" is not selected as a relationship by its projection`,
          ['views', index, 'dynamic', 'steps', stepIndex, 'relationship'],
          `/views/${index}/dynamic/steps/${stepIndex}/relationship`,
        )
      }
    }
    const renderedId =
      view.id ?? view.prepared.projection.projection.split('@')[0]!
    if (renderedViewIds.has(renderedId)) {
      const field = view.id === undefined ? 'projection' : 'id'
      return refuse(
        'YMLC107',
        `LikeC4 view identity "${renderedId}" is duplicated`,
        ['views', index, field],
        `/views/${index}/${field}`,
      )
    }
    renderedViewIds.add(renderedId)
  }

  const exported = exportLikeC4Project(definition, successfulViews, {
    ...(input.gitChange === undefined ? {} : { gitChange: input.gitChange }),
    ...(input.branding === undefined ? {} : { branding: input.branding }),
  })
  if (!exported.ok) return { ok: false, diagnostics: exported.diagnostics }
  const first = successfulViews[0]!
  return {
    ok: true,
    project: definition,
    views: successfulViews,
    modelSource: exported.source,
    projectIdentity: `${definition.id}@${definition.version}`,
    mappingIdentity: `${first.prepared.subjectMapping.id}@${first.prepared.subjectMapping.version}`,
    ...(first.prepared.kindMapping === undefined
      ? {}
      : {
          kindMappingIdentity: `${first.prepared.kindMapping.id}@${first.prepared.kindMapping.version}`,
        }),
    inputs: [projectSource, ...sources, ...referencedSources.values()],
    ...(input.branding === undefined ? {} : { branding: input.branding }),
  }
}

// ---------------------------------------------------------------------------
// The generated project as files
// ---------------------------------------------------------------------------

export const GENERATED_FILE_NAMES = [
  'likec4.config.json',
  'model.likec4',
  'specification.likec4',
] as const

/** The ownership marker's fields, minus the digests this module computes. */
export interface GeneratedProjectOwnership {
  readonly format: 'yarramate/likec4-generated-project/v2'
  readonly project: string
  readonly mapping: string
  readonly kindMapping?: string
  readonly views: readonly {
    readonly id?: string
    readonly projection: string
    readonly comparison?: { readonly from: string; readonly to: string }
  }[]
}

export const ownershipOf = (
  exported: LikeC4ProjectExported,
): GeneratedProjectOwnership => ({
  format: 'yarramate/likec4-generated-project/v2',
  project: exported.projectIdentity,
  mapping: exported.mappingIdentity,
  ...(exported.kindMappingIdentity === undefined
    ? {}
    : { kindMapping: exported.kindMappingIdentity }),
  views: exported.views.map(({ id, prepared, comparison }) => ({
    ...(id === undefined ? {} : { id }),
    projection: prepared.projection.projection,
    ...(comparison === undefined ? {} : { comparison }),
  })),
})

export const inputDigestsOf = (
  inputs: readonly WorkspaceSource[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    inputs
      .map(({ path, source }) => [path, sha256Hex(source)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )

export const projectNameOf = (
  projectIdentity: string,
  branding?: Branding,
): string =>
  `${brandSlug(resolveBranding(branding))}-${projectIdentity}`.replaceAll(
    /[^A-Za-z0-9_-]/g,
    '-',
  )

/**
 * The four files a generated project holds, exactly as the CLI writes them
 * under its output directory: the config, the model, the specification the
 * package ships, and the `yarramate.generated.json` marker with every
 * digest the freshness check reads back.
 */
export const generatedProjectFiles = (
  exported: LikeC4ProjectExported,
): readonly WorkspaceSource[] => {
  const configSource = `${JSON.stringify(
    {
      $schema: 'https://likec4.dev/schemas/config.json',
      name: projectNameOf(exported.projectIdentity, exported.branding),
      title: exported.project.title,
    },
    null,
    2,
  )}\n`
  const markerSource = `${JSON.stringify(
    {
      ...ownershipOf(exported),
      files: [...GENERATED_FILE_NAMES],
      digests: {
        'likec4.config.json': sha256Hex(configSource),
        'model.likec4': sha256Hex(exported.modelSource),
        'specification.likec4': sha256Hex(LIKEC4_SPECIFICATION_SOURCE),
      },
      inputDigests: inputDigestsOf(exported.inputs),
    },
    null,
    2,
  )}\n`
  return [
    { path: 'likec4.config.json', source: configSource },
    { path: 'model.likec4', source: exported.modelSource },
    { path: 'specification.likec4', source: LIKEC4_SPECIFICATION_SOURCE },
    { path: 'yarramate.generated.json', source: markerSource },
  ]
}

/** Whether a source is a project definition rather than a projection. */
export const isLikeC4ProjectDefinition = (source: string): boolean =>
  parseDocument(source).get('format') === 'yarramate/likec4-project/v1'
