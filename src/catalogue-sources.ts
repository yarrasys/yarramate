import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WorkspaceSource } from './compiler.js'
import type { ResolvedWorkspace } from './workspace.js'

// The catalogue ships inside the package, versioned with it, and harnesses
// never pass catalogue paths. The relative hop works from both src/ (dev) and
// dist/ (shipped). Defined ONCE: `design`, `ask` and `check` all need it, and
// three copies of a path constant is three chances for them to disagree about
// which catalogue is the base.
const here = dirname(fileURLToPath(import.meta.url))

export const shippedCataloguePath = join(
  here,
  '..',
  'catalogues',
  'core-enrichment.yaml',
)

/** The base catalogue as a source, read from disk. */
export const shippedCatalogueSource = (): WorkspaceSource => ({
  path: shippedCataloguePath,
  source: readFileSync(shippedCataloguePath, 'utf8'),
})

/**
 * The catalogues a verb should compose: the base, then whatever the workspace
 * carries (#345, ADR 0129).
 *
 * Built in ONE place because every verb that interviews has to make the same
 * choice, and a verb that forgot the workspace half would silently ask fewer
 * questions than the workspace declares - a failure with no symptom, which is
 * the shape this repository keeps being bitten by.
 *
 * The base is REPLACED by `--catalogue` and ADDED TO by `questions:`. Those
 * are different powers on purpose: a host controls the catalogue that is not
 * in the workspace (#328), and a consultant adds to it mid-engagement without
 * a product release.
 */
export const catalogueSources = (
  base: WorkspaceSource,
  workspace: Pick<ResolvedWorkspace, 'questions'>,
  cwd: string,
): readonly WorkspaceSource[] => [
  base,
  // `?? []` because `questions` is optional on the published type: adding a
  // required field to `ResolvedWorkspace` broke a consumer's production module
  // once already.
  ...(workspace.questions ?? []).map((path) => ({
    path,
    source: readFileSync(resolve(cwd, path), 'utf8'),
  })),
]
