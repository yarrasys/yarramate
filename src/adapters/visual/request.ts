import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadProjection } from '../../projection.js'
import { loadWorkspaceManifest } from '../../workspace.js'
import type {
  VisualDiagnostic,
  VisualSessionRequest,
} from './protocol-contract.js'
import { digestOf, parseVisualSessionRequest } from './protocol.js'
import { buildVisualModelGraph } from './session-store.js'

/**
 * The one manifest a session can serve. `startVisualServer` resolves exactly
 * this path relative to its own working directory, so the builder reads the
 * same file rather than accepting a path that could name a different workspace
 * than the session about to render it.
 */
const MANIFEST_PATH = '.yarramate/workspace.yaml'

export interface VisualSessionRequestOptions {
  readonly cwd: string
  /** Defaults to the workspace id. */
  readonly title?: string
  /** Defaults to a line naming the workspace and its manifest. */
  readonly description?: string
  /** Defaults to the first projection the workspace declares. */
  readonly initialView?: string
  /** Defaults to `false`: a diagram-only session needs no model provider. */
  readonly chatEnabled?: boolean
}

export type VisualSessionRequestResult =
  | { readonly ok: true; readonly request: VisualSessionRequest }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] }

const requestDiagnostic = (
  code: string,
  message: string,
  path: string = MANIFEST_PATH,
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path,
  pointer: '/',
  line: 1,
  column: 1,
})

/**
 * Builds the `yarramate/visual-session-request/v1` document that `start`
 * consumes, from the workspace on disk.
 *
 * The request carries a whole compiled model — 247 nodes and 338 edges for this
 * repository's own architecture — so it is a machine's transcription of the
 * workspace, never something an agent can honestly hand-author. Every input the
 * document needs is already derivable: the graph from the native compiler, the
 * digests from the same sources that compiled, and the view list from the
 * workspace's declared projections.
 *
 * The result is validated through `parseVisualSessionRequest` before it is
 * returned, so the byte ceiling, digest confinement, and authority agreement
 * are the protocol's own rules rather than a second set restated here. A
 * builder that cannot produce a valid document refuses instead of handing a
 * session something it would reject at start.
 */
export const buildVisualSessionRequest = (
  options: VisualSessionRequestOptions,
): VisualSessionRequestResult => {
  const manifestPath = resolve(options.cwd, MANIFEST_PATH)
  let manifestSource: string
  try {
    manifestSource = readFileSync(manifestPath, 'utf8')
  } catch {
    return {
      ok: false,
      diagnostics: [
        requestDiagnostic(
          'YMVS410',
          `Workspace manifest ${manifestPath} cannot be read`,
        ),
      ],
    }
  }
  const loaded = loadWorkspaceManifest(
    { path: manifestPath, source: manifestSource },
    options.cwd,
  )
  if (!loaded.ok) {
    return { ok: false, diagnostics: loaded.diagnostics }
  }
  const workspace = loaded.workspace

  // Same order the session's own recompile uses, so the request's graph and
  // every graph the session rebuilds after a commit come from one input list.
  // Patterns are compiler input like profiles (#268). Omitting them compiled a
  // different workspace than the manifest describes, and an instance binding
  // parts then failed YM419 for a pattern the manifest declared.
  const sourcePaths = [
    ...workspace.profiles,
    ...workspace.patterns,
    ...workspace.documents,
  ]
  const sources: { readonly path: string; readonly source: string }[] = []
  for (const path of sourcePaths) {
    try {
      sources.push({ path, source: readFileSync(resolve(options.cwd, path), 'utf8') })
    } catch {
      return {
        ok: false,
        diagnostics: [
          requestDiagnostic(
            'YMVS411',
            `Workspace source ${path} cannot be read`,
            path,
          ),
        ],
      }
    }
  }

  const built = buildVisualModelGraph(sources)
  if (!built.ok) return { ok: false, diagnostics: built.diagnostics }

  // A projection that does not load is skipped by the session too: the request
  // names a view the browser will actually be able to open.
  const viewIds = workspace.projections.flatMap((projectionPath) => {
    try {
      const projection = loadProjection({
        path: projectionPath,
        source: readFileSync(resolve(options.cwd, projectionPath), 'utf8'),
      })
      return projection.ok ? [projection.projection.id] : []
    } catch {
      return []
    }
  })
  const initialView = options.initialView ?? viewIds[0]
  if (initialView === undefined) {
    return {
      ok: false,
      diagnostics: [
        requestDiagnostic(
          'YMVS412',
          `Workspace ${workspace.id} declares no loadable projection, so a session has no view to open`,
        ),
      ],
    }
  }
  if (!viewIds.includes(initialView)) {
    return {
      ok: false,
      diagnostics: [
        requestDiagnostic(
          'YMVS413',
          `Workspace ${workspace.id} declares no projection "${initialView}": ${
            viewIds.length === 0 ? 'it declares none' : viewIds.join(', ')
          }`,
        ),
      ],
    }
  }

  const request = {
    format: 'yarramate/visual-session-request/v1',
    authority: 'canonical',
    title: options.title ?? workspace.id,
    description:
      options.description ??
      `Native rendering of workspace ${workspace.id} from ${MANIFEST_PATH}`,
    chatEnabled: options.chatEnabled ?? false,
    initialModel: {
      format: 'yarramate/visual-model/v1',
      authority: 'canonical',
      initialView,
      sourceDigests: Object.fromEntries(
        sources.map(({ path, source }) => [path, digestOf(source)]),
      ),
      graph: built.graph,
    },
  }

  const parsed = parseVisualSessionRequest(request)
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics }
  return { ok: true, request: parsed.value }
}
