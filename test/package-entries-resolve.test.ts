import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

// Every published JavaScript entry, imported from the BUILT package the way a
// consumer imports it. Everything else in the suite imports `src/`, which is
// how 1.41.0 shipped a `yarramate/adapter/visual-graph` that could not load:
// `canvas-scene.ts` imported a helper under `src/visual-app/`, which the
// package build excludes, so `dist/` had no such file and the whole subpath -
// `foldTree` and `edgeLabelText` with it - threw ERR_MODULE_NOT_FOUND. The
// source tests, the purity test and a green verify all passed.
//
// Runs after `pnpm build` inside `pnpm verify`. The editor entry is excluded:
// it mounts into a DOM and is exercised by the browser-safety test instead.

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  readonly exports: Record<string, string | { readonly import?: string }>
}

const entries = Object.entries(pkg.exports)
  .map(([subpath, target]) => [subpath, typeof target === 'string' ? target : target.import] as const)
  .filter((entry): entry is readonly [string, string] => entry[1] !== undefined && entry[1].endsWith('.js'))
  .filter(([subpath]) => subpath !== './visual-app')

describe('published entries resolve from the built package', () => {
  it('has something built to check', () => {
    expect(entries.length).toBeGreaterThan(5)
    expect(existsSync(join(root, 'dist/adapters/visual-graph-entry.js'))).toBe(true)
  })

  it.each(entries)('%s loads', async (_subpath, target) => {
    const module = (await import(pathToFileURL(join(root, target)).href)) as Record<string, unknown>
    expect(Object.keys(module).length).toBeGreaterThan(0)
  })

  it('adapter/visual-graph carries what adopters import from it', async () => {
    const module = (await import(
      pathToFileURL(join(root, 'dist/adapters/visual-graph-entry.js')).href
    )) as Record<string, unknown>
    for (const name of ['foldTree', 'edgeLabelText', 'canvasSceneInput', 'resolveCanvasScene']) {
      expect(typeof module[name], name).toBe('function')
    }
  })
})
