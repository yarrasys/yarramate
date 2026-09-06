/**
 * The layout sidecar, read back the one way (#503).
 *
 * A drag saves `.yarramate/visual-layout/<projectionId>.yaml` (ADR 0085), and
 * since 1.25.0 the routes and the fold state ride in it beside the positions
 * (ADR 0147, #473). Two hosts write that file and two hosts have to read it:
 * the session server from disk, the local host a product mounts from its
 * store. Until this module the server had a reader and the local host had
 * none, so on a mounted host a saved drag was written faithfully and never
 * applied again - found by ApertureX on 1.25.0 (#503). One reader here, and
 * the two cannot drift apart a second time.
 *
 * Pure: it takes sources and returns what the model carries. Whoever can read
 * a directory or a store hands the bytes over.
 */
import { parse } from 'yaml'
import { validateVisualLayout } from '../../schema-validation.js'
import type {
  VisualLayoutPositions,
  VisualLayoutRoutes,
} from './protocol-contract.js'

/** Where every host writes a projection's sidecar, and reads it back from. */
export const LAYOUT_SIDECAR_DIR = '.yarramate/visual-layout'

export const layoutSidecarPath = (projectionId: string): string =>
  `${LAYOUT_SIDECAR_DIR}/${projectionId}.yaml`

/** A path a store or directory holds that could be a sidecar. */
export const isLayoutSidecarPath = (path: string): boolean =>
  path.startsWith(`${LAYOUT_SIDECAR_DIR}/`) &&
  !path.slice(LAYOUT_SIDECAR_DIR.length + 1).includes('/') &&
  (path.endsWith('.yaml') || path.endsWith('.yml'))

export interface LayoutSidecars {
  readonly layouts: Record<string, VisualLayoutPositions>
  readonly folds: Record<string, { folded: string[]; unfolded: string[] }>
  readonly routes: Record<string, VisualLayoutRoutes>
}

/**
 * What the sidecars say, keyed by the projection id each one names.
 *
 * Presentation state must never fail a session (ADR 0023): a source that does
 * not parse or does not validate is skipped, not reported. A sidecar written
 * before #473 has neither fold list and says nothing about folding rather
 * than "fold nothing" - the view's own default decides - so only a sidecar
 * that STATES a fold yields a `folds` entry. A sidecar written before the
 * routes says nothing about them, and the layout recomputes.
 */
export const readLayoutSidecars = (
  sources: Iterable<{ readonly path: string; readonly source: string }>,
): LayoutSidecars => {
  const layouts: Record<string, VisualLayoutPositions> = {}
  const folds: Record<string, { folded: string[]; unfolded: string[] }> = {}
  const routes: Record<string, VisualLayoutRoutes> = {}
  for (const { source } of sources) {
    let parsed: unknown
    try {
      parsed = parse(source)
    } catch {
      continue
    }
    if (!validateVisualLayout(parsed)) continue
    const sidecar = parsed as {
      readonly projectionId: string
      readonly positions: VisualLayoutPositions
      readonly folded?: readonly string[]
      readonly unfolded?: readonly string[]
      readonly routes?: VisualLayoutRoutes
    }
    layouts[sidecar.projectionId] = sidecar.positions
    if (sidecar.routes !== undefined) routes[sidecar.projectionId] = sidecar.routes
    if (sidecar.folded !== undefined || sidecar.unfolded !== undefined) {
      folds[sidecar.projectionId] = {
        folded: [...(sidecar.folded ?? [])],
        unfolded: [...(sidecar.unfolded ?? [])],
      }
    }
  }
  return { layouts, folds, routes }
}
