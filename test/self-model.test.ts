import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'
import { evaluateProjection, loadProjection } from '../src/projection.js'

const model = (name: string) => ({
  path: `architecture/${name}.yaml`,
  source: readFileSync(
    fileURLToPath(new URL(`../architecture/${name}.yaml`, import.meta.url)),
    'utf8',
  ),
})

const developmentProfile = {
  path: 'profiles/yarramate-development.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL(
        '../profiles/yarramate-development.yaml',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
}

const currentEngineProjection = {
  path: 'projections/current-engine.yaml',
  source: readFileSync(
    fileURLToPath(
      new URL('../projections/current-engine.yaml', import.meta.url),
    ),
    'utf8',
  ),
}

describe('YarraMate repository model', () => {
  it('conforms through the native compiler and exposes core architecture claims', () => {
    const result = compileWorkspace([
      developmentProfile,
      model('product'),
      model('engine'),
      model('repository'),
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.graph.claims.some(
          ({ id }) =>
            id === 'yarramate-engine#compiler-delivers-compilation',
        ),
      ).toBe(true)
      expect(
        result.graph.claims.some(
          ({ id }) =>
            id ===
            'yarramate-repository#contract-realizes-tool-neutral-core',
        ),
      ).toBe(true)
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'yarramate-engine#compiler~kind',
        ),
      ).toMatchObject({
        object: {
          value: 'yarramate/development@1.0#compiler-module',
        },
      })
      expect(
        result.graph.claims.find(
          ({ id }) => id === 'yarramate-engine#compiler~status',
        ),
      ).toMatchObject({
        object: { value: 'current' },
      })
      expect(
        result.graph.claims.find(
          ({ id }) =>
            id === 'yarramate-repository#compiler-source~kind',
        ),
      ).toMatchObject({
        object: {
          value: 'yarramate/development@1.0#repository-file',
        },
      })

      const loaded = loadProjection(currentEngineProjection)
      expect(loaded.ok).toBe(true)
      if (loaded.ok) {
        const context = evaluateProjection(result.graph, loaded.projection)
        expect(
          context.subjects.every(({ id }) =>
            id.startsWith('yarramate-engine#'),
          ),
        ).toBe(true)
        expect(context.subjects.length).toBeGreaterThan(0)
      }
    }
  })
})
