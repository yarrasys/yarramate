import Ajv2020Module from 'ajv/dist/2020.js'
import type { WorkspaceSource } from '../compiler.js'
import type { ProjectionResult } from '../projection.js'
import { loadSourceDocument } from '../source-document.js'
import type { LikeC4PreparationResult } from './likec4-prepare.js'
import {
  exportLikeC4,
  type GitChangeOverlay,
  type LikeC4ExportResult,
} from './likec4-export.js'
import likeC4ProjectSchema from '../../schema/yarramate-likec4-project.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateLikeC4Project = new Ajv2020({ allErrors: true }).compile(
  likeC4ProjectSchema,
)

export interface LikeC4ProjectDefinition {
  readonly format: 'yarramate/likec4-project/v1'
  readonly id: string
  readonly version: string
  readonly title: string
  readonly mapping: string
  readonly kindMapping?: string
  readonly views: ReadonlyArray<{
    readonly id?: string
    readonly projection: string
    readonly folder?: string
    readonly compare?: {
      readonly from: string
      readonly to: string
    }
    readonly dynamic?: {
      readonly steps: ReadonlyArray<{
        readonly relationship: string
        readonly title?: string
      }>
    }
    readonly deployment?: LikeC4Deployment
  }>
}

export interface LikeC4Deployment {
  readonly nodes: ReadonlyArray<{
    readonly id: string
    readonly kind: 'environment' | 'zone' | 'host' | 'runtime'
    readonly name: string
    readonly parent?: string
  }>
  readonly instances: ReadonlyArray<{
    readonly id: string
    readonly subject: string
    readonly node: string
  }>
}

export const loadLikeC4ProjectDefinition = (source: WorkspaceSource) =>
  loadSourceDocument<LikeC4ProjectDefinition>(
    source,
    validateLikeC4Project,
    'LikeC4 project',
  )

export interface PreparedLikeC4ProjectView {
  readonly id?: string
  readonly folder?: string
  readonly prepared: Extract<LikeC4PreparationResult, { readonly ok: true }>
  readonly comparison?: {
    readonly from: string
    readonly to: string
  }
  readonly dynamic?: {
    readonly steps: ReadonlyArray<{
      readonly relationship: string
      readonly title?: string
    }>
  }
  readonly deployment?: LikeC4Deployment
}

const quote = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`

// A folder files the view in LikeC4's sidebar tree: the title becomes a
// path ('Folder / Title') whose last segment is the displayed title (ADR
// 0067). A view without a declared title still needs a title line to
// carry the path, so the view id stands in as the leaf.
const titleLines = (
  folder: string | undefined,
  title: string | undefined,
  viewId: string,
): readonly string[] =>
  folder === undefined
    ? title === undefined
      ? []
      : [`    title ${quote(title)}`]
    : [`    title ${quote(`${folder} / ${title ?? viewId}`)}`]

const unionProjection = (
  project: LikeC4ProjectDefinition,
  views: readonly PreparedLikeC4ProjectView[],
): ProjectionResult => ({
  format: 'yarramate/projection-result/v1',
  projection: `${project.id}@${project.version}`,
  presentation: { title: project.title },
  documents: [
    ...new Map(
      views.flatMap(({ prepared }) =>
        prepared.projection.documents.map((document) => [
          document.id,
          document,
        ]),
      ),
    ).values(),
  ].sort((left, right) => left.id.localeCompare(right.id)),
  subjects: [
    ...new Map(
      views.flatMap(({ prepared }) =>
        prepared.projection.subjects.map((subject) => [
          subject.id,
          subject,
        ]),
      ),
    ).values(),
  ].sort((left, right) => left.id.localeCompare(right.id)),
  claims: [
    ...new Map(
      views.flatMap(({ prepared }) =>
        prepared.projection.claims.map((claim) => [claim.id, claim]),
      ),
    ).values(),
  ].sort((left, right) => left.id.localeCompare(right.id)),
})

const viewBody = (
  {
    id,
    folder,
    prepared,
    dynamic,
    deployment,
  }: PreparedLikeC4ProjectView,
  gitChange?: GitChangeOverlay,
): string => {
  const source = prepared.source
  const startToken = '\nviews {\n'
  const start = source.indexOf(startToken)
  const end = source.lastIndexOf('\n}\n')
  const externalByNative = new Map(
    prepared.subjectMapping.mappings
      .filter(({ type }) => type === 'concept')
      .map(({ native, external }) => [native, external] as const),
  )
  const includedConcepts = prepared.projection.subjects
    .filter(({ type }) => type === 'concept')
    .flatMap(({ id }) => {
      const external = externalByNative.get(id)
      return external === undefined ? [] : [external]
    })
    .sort()
  const includeRule =
    includedConcepts.length === 0
      ? `    include * where metadata.yarramateId is '__yarramate_no_match__'`
      : `    include ${includedConcepts.join(', ')}`
  const relationshipRules = prepared.projection.subjects
    .filter(({ type }) => type === 'relationship')
    .map(
      ({ id }) =>
        `    include * -> * where metadata.yarramateId is '${id}'`,
    )
    .sort()
  if (deployment !== undefined) {
    const roots = deployment.nodes
      .filter(({ parent }) => parent === undefined)
      .map(({ id }) => `${id}.**`)
      .sort()
    const viewId =
      id ?? prepared.projection.projection.split('@')[0]!
    return [
      `  deployment view ${viewId} {`,
      ...titleLines(
        folder,
        prepared.projection.presentation?.title,
        viewId,
      ),
      ...(prepared.projection.presentation?.description === undefined
        ? []
        : [
            `    description ${quote(
              prepared.projection.presentation.description,
            )}`,
          ]),
      `    include ${roots.join(', ')}`,
      '    autoLayout LeftRight',
      '  }',
    ].join('\n')
  }
  if (dynamic !== undefined) {
    const claimsById = new Map(
      prepared.projection.claims.map((claim) => [claim.id, claim]),
    )
    const lines = dynamic.steps.flatMap((step) => {
      const structural = claimsById.get(step.relationship)!
      const source = externalByNative.get(structural.subject)!
      const target =
        'ref' in structural.object
          ? externalByNative.get(structural.object.ref)!
          : ''
      const declaredTitle = prepared.projection.claims.find(
        (claim) =>
          claim.subject === step.relationship &&
          claim.predicate === 'yarramate/relationship/name' &&
          'value' in claim.object,
      )
      const title =
        step.title ??
        (declaredTitle !== undefined && 'value' in declaredTitle.object
          ? declaredTitle.object.value
          : undefined)
      const declaredDescription = prepared.projection.claims.find(
        (claim) =>
          claim.subject === step.relationship &&
          claim.predicate === 'yarramate/relationship/description' &&
          'value' in claim.object,
      )
      const description =
        declaredDescription !== undefined &&
        'value' in declaredDescription.object
          ? declaredDescription.object.value
          : undefined
      const statement = `    ${source} -> ${target}${title === undefined ? '' : ` ${quote(title)}`}`
      return description === undefined
        ? [statement]
        : [
            `${statement} {`,
            `      description ${quote(description)}`,
            '    }',
          ]
    })
    const viewId =
      id ?? prepared.projection.projection.split('@')[0]!
    return [
      `  dynamic view ${viewId} {`,
      ...titleLines(
        folder,
        prepared.projection.presentation?.title,
        viewId,
      ),
      ...(prepared.projection.presentation?.description === undefined
        ? []
        : [
            `    description ${quote(
              prepared.projection.presentation.description,
            )}`,
          ]),
      ...lines,
      '  }',
    ].join('\n')
  }
  const overlayRules =
    gitChange === undefined
      ? []
      : prepared.projection.subjects
          .filter(({ type }) => type === 'concept')
          .flatMap(({ id: nativeId }) => {
            const external = externalByNative.get(nativeId)
            if (external === undefined) return []
            if (gitChange.added.includes(nativeId)) {
              return [`    style ${external} { color green }`]
            }
            if (gitChange.modified.includes(nativeId)) {
              return [`    style ${external} { color amber }`]
            }
            return []
          })
          .sort()
  const membershipRules = [
    includeRule,
    '    exclude * -> *',
    ...relationshipRules,
    ...overlayRules,
  ].join('\n')
  const viewId = id ?? prepared.projection.projection.split('@')[0]!
  const body = source
    .slice(start + startToken.length, end)
    .replace(
      /^  view [A-Za-z_][A-Za-z0-9_-]* \{/,
      `  view ${viewId} {`,
    )
    .replace('    include *', membershipRules)
  if (folder === undefined) return body
  const title = prepared.projection.presentation?.title
  return title === undefined
    ? body.replace(
        `  view ${viewId} {`,
        `  view ${viewId} {\n${titleLines(folder, undefined, viewId).join('\n')}`,
      )
    : body.replace(
        `    title ${quote(title)}`,
        titleLines(folder, title, viewId).join('\n'),
      )
}

const deploymentBody = ({
  deployment,
  prepared,
}: PreparedLikeC4ProjectView): string | undefined => {
  if (deployment === undefined) return undefined
  const externalByNative = new Map(
    prepared.subjectMapping.mappings
      .filter(({ type }) => type === 'concept')
      .map(({ native, external }) => [native, external] as const),
  )
  const childrenByParent = new Map<string | undefined, typeof deployment.nodes>()
  for (const node of deployment.nodes) {
    childrenByParent.set(node.parent, [
      ...(childrenByParent.get(node.parent) ?? []),
      node,
    ])
  }
  const instancesByNode = new Map<string, typeof deployment.instances>()
  for (const instance of deployment.instances) {
    instancesByNode.set(instance.node, [
      ...(instancesByNode.get(instance.node) ?? []),
      instance,
    ])
  }
  const renderNode = (
    node: (typeof deployment.nodes)[number],
    indentation: string,
  ): readonly string[] => [
    `${indentation}${node.kind} ${node.id} ${quote(node.name)} {`,
    ...(childrenByParent.get(node.id) ?? [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((child) => renderNode(child, `${indentation}  `)),
    ...(instancesByNode.get(node.id) ?? [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        (instance) =>
          `${indentation}  ${instance.id} = instanceOf ${externalByNative.get(instance.subject)!}`,
      ),
    `${indentation}}`,
  ]
  return [
    'deployment {',
    ...(childrenByParent.get(undefined) ?? [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((node) => renderNode(node, '  ')),
    '}',
  ].join('\n')
}

// The synthetic review view (ADR 0066): every changed subject with its
// highlight, and a description that doubles as the legend.
const reviewChangesView = (
  views: readonly PreparedLikeC4ProjectView[],
  gitChange: GitChangeOverlay,
): string | undefined => {
  const externalByNative = new Map(
    views.flatMap((view) =>
      view.prepared.subjectMapping.mappings
        .filter(({ type }) => type === 'concept')
        .map(({ native, external }) => [native, external] as const),
    ),
  )
  const changedConcepts = [
    ...new Set(
      [...gitChange.added, ...gitChange.modified].flatMap((nativeId) => {
        const external = externalByNative.get(nativeId)
        return external === undefined ? [] : [external]
      }),
    ),
  ].sort()
  if (changedConcepts.length === 0) return undefined
  const changedRelationships = [
    ...new Set(
      [...gitChange.added, ...gitChange.modified].filter(
        (nativeId) => !externalByNative.has(nativeId),
      ),
    ),
  ].sort()
  const styles = changedConcepts.map((external) => {
    const nativeId = [...externalByNative.entries()].find(
      ([, candidate]) => candidate === external,
    )![0]
    return gitChange.added.includes(nativeId)
      ? `    style ${external} { color green }`
      : `    style ${external} { color amber }`
  })
  return [
    '  view review-changes {',
    `    title ${quote(`Review: ${gitChange.range}`)}`,
    `    description ${quote(
      `Subjects touched in ${gitChange.range}. Legend: green = new, amber = changed; connected context unhighlighted. Derived from git - nothing here is authored (ADR 0066).`,
    )}`,
    `    include ${changedConcepts.join(', ')}`,
    ...changedRelationships.map(
      (id) => `    include * -> * where metadata.yarramateId is '${id}'`,
    ),
    ...styles,
    '    autoLayout LeftRight',
    '  }',
  ].join('\n')
}

export interface LikeC4ProjectExportOptions {
  readonly gitChange?: GitChangeOverlay
}

export function exportLikeC4Project(
  project: LikeC4ProjectDefinition,
  views: readonly PreparedLikeC4ProjectView[],
  options: LikeC4ProjectExportOptions = {},
): LikeC4ExportResult {
  const first = views[0]
  if (first === undefined) {
    throw new Error('LikeC4 project requires at least one view')
  }
  const model = exportLikeC4(
    unionProjection(project, views),
    first.prepared.subjectMapping,
    first.prepared.kindMapping,
    options.gitChange === undefined
      ? {}
      : { gitChange: options.gitChange },
  )
  if (!model.ok) return model
  const startToken = '\nviews {\n'
  const modelEnd = model.source.indexOf(startToken)
  const deployments = views.flatMap((view) => {
    const rendered = deploymentBody(view)
    return rendered === undefined ? [] : [rendered]
  })
  const renderedViews = views.map((view) =>
    viewBody(view, options.gitChange),
  )
  const review =
    options.gitChange === undefined
      ? undefined
      : reviewChangesView(views, options.gitChange)
  const allViews =
    review === undefined ? renderedViews : [...renderedViews, review]
  return {
    ok: true,
    source: `${model.source.slice(0, modelEnd)}${deployments.length === 0 ? '' : `\n${deployments.join('\n')}\n`}\nviews {\n${allViews.join('\n')}\n}\n`,
  }
}
