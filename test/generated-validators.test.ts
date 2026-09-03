import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  generate,
  generateOperations,
} from '../scripts/generate-validators.mjs'

const at = (name: string) =>
  fileURLToPath(new URL(`../src/${name}`, import.meta.url))
const MODULES = [
  ['schema-validators.generated.ts', generate],
  ['schema-validators-operations.generated.ts', generateOperations],
] as const

/**
 * The validators are compiled from the schemas at BUILD time, so the committed
 * module can disagree with the schemas it claims to enforce. A schema edited
 * without regenerating would ship a validator that checks the OLD shape, and
 * nothing else would notice: the package would keep validating, just against
 * something that is no longer the contract.
 *
 * The only honest check is to regenerate and compare, which is what
 * `test/archimate-relationships.test.ts` does for the other generated module.
 */
describe('the committed validators match the schemas', () => {
  it.each(MODULES)('%s is what regenerating produces, byte for byte', (name, regenerate) => {
    expect(
      readFileSync(at(name), 'utf8'),
      `schema/ and src/${name} disagree. Run \`pnpm generate:validators\` ` +
        'and commit the result.',
    ).toBe(regenerate())
  })

  it.each(MODULES)('%s generates no code and needs no compiler at runtime', (name) => {
    const source = readFileSync(at(name), 'utf8')
    // The property the whole exercise is for. `workerd` forbids code
    // generation at request time and budgets it at startup; precompiled
    // validators do neither, and there is no compile step left for anyone to
    // move into the wrong place.
    expect(source).not.toMatch(/new Function/)
    expect(source).not.toMatch(/\beval\s*\(/)
    // `require` would not load in an ES module at all; Ajv emits it for its
    // runtime helpers and the generator hoists those to static imports.
    expect(source).not.toMatch(/\brequire\s*\(/)
    // Everything the runtime still takes from ajv, named so a change is
    // visible in the diff rather than inferred.
    // Everything the runtime still takes from ajv, named so a change is
    // visible in the diff rather than inferred.
    for (const specifier of [
      ...source.matchAll(/^import .* from '([^']+)'/gm),
    ].map((m) => m[1])) {
      expect(specifier).toMatch(/^ajv\/dist\/runtime\//)
    }
  })
})
