import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OUTPUTS } from '../scripts/generate-assets.mjs'
import { SHIPPED_CATALOGUE_SOURCE } from '../src/shipped-catalogue.generated.js'
import { LIKEC4_SPECIFICATION_SOURCE } from '../src/likec4-specification.generated.js'

const at = (relative: string) =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url))

describe('the committed asset modules match the assets', () => {
  it.each(OUTPUTS as readonly (readonly [string, () => string])[])(
    '%s is what regenerating produces, byte for byte',
    (relative, regenerate) => {
      expect(
        readFileSync(at(relative), 'utf8'),
        `${relative} is stale. Run \`pnpm generate:assets\` and commit the result.`,
      ).toBe(regenerate())
    },
  )

  it('carries the catalogue and the specification unchanged', () => {
    expect(SHIPPED_CATALOGUE_SOURCE).toBe(
      readFileSync(at('catalogues/core-enrichment.yaml'), 'utf8'),
    )
    expect(LIKEC4_SPECIFICATION_SOURCE).toBe(
      readFileSync(at('assets/likec4/specification.likec4'), 'utf8'),
    )
  })
})
