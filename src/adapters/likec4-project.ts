import Ajv2020Module from 'ajv/dist/2020.js'
import type { WorkspaceSource } from '../compiler.js'
import type { ProjectionResult } from '../projection.js'
import { loadSourceDocument } from '../source-document.js'
import type { LikeC4PreparationResult } from './likec4-prepare.js'
import {
  exportLikeC4,
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
    readonly projection: string
    readonly compare?: {
      readonly from: string
      readonly to: string
    }
  }>
}

export const loadLikeC4ProjectDefinition = (source: WorkspaceSource) =>
  loadSourceDocument<LikeC4ProjectDefinition>(
    source,
    validateLikeC4Project,
    'LikeC4 project',
  )

export interface PreparedLikeC4ProjectView {
  readonly prepared: Extract<LikeC4PreparationResult, { readonly ok: true }>
  readonly comparison?: {
    readonly from: string
    readonly to: string
  }
}

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

const viewBody = (source: string): string => {
  const startToken = '\nviews {\n'
  const start = source.indexOf(startToken)
  const end = source.lastIndexOf('\n}\n')
  return source.slice(start + startToken.length, end)
}

export function exportLikeC4Project(
  project: LikeC4ProjectDefinition,
  views: readonly PreparedLikeC4ProjectView[],
): LikeC4ExportResult {
  const first = views[0]
  if (first === undefined) {
    throw new Error('LikeC4 project requires at least one view')
  }
  const model = exportLikeC4(
    unionProjection(project, views),
    first.prepared.subjectMapping,
    first.prepared.kindMapping,
  )
  if (!model.ok) return model
  const startToken = '\nviews {\n'
  const modelEnd = model.source.indexOf(startToken)
  const renderedViews = views.map(({ prepared }) =>
    viewBody(prepared.source),
  )
  return {
    ok: true,
    source: `${model.source.slice(0, modelEnd)}\nviews {\n${renderedViews.join('\n')}\n}\n`,
  }
}
