import { SHIPPED_CATALOGUE_SOURCE } from '../shipped-catalogue.generated.js'

/**
 * The shipped question catalogue, bundled into the browser build so the
 * embedded editor computes the same interrogation overlay the session
 * server does (#292). The path is a diagnostic label, not a file: nothing
 * in the browser resolves it. The bytes come from the generated module the
 * path-free entries share (ADR 0156), not from a bundler's raw import, so
 * the same constant serves `tsc` and Vite alike.
 */
export const SHIPPED_CATALOGUE = {
  path: 'core-enrichment.yaml',
  source: SHIPPED_CATALOGUE_SOURCE,
} as const
