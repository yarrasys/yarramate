import catalogueSource from '../../catalogues/core-enrichment.yaml?raw'

/**
 * The shipped question catalogue, bundled into the browser build so the
 * embedded editor computes the same interrogation overlay the session
 * server does (#292). The path is a diagnostic label, not a file: nothing
 * in the browser resolves it.
 */
export const SHIPPED_CATALOGUE = {
  path: 'core-enrichment.yaml',
  source: catalogueSource,
} as const
