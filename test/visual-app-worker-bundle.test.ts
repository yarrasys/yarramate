import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The served page runs ELK in a Web Worker (#490). That holds only if vite
// emitted the worker as one more flat asset the session server's asset route
// serves, the page reaches it as a same-origin worker, and the engine is not
// also bundled into the chunk the page loads first. The library bundle, whose
// host's policy is unknown, ships no worker of its own. This reads the built
// output, so it runs after `pnpm build`, as the browser-safety scan does.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const servedAssets = resolve(repositoryRoot, 'dist/visual-app/assets')
const libDir = resolve(repositoryRoot, 'dist/visual-app-lib')

// The session server's `ASSET_NAME`: one path segment, no separator.
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const listOr = (directory: string): readonly string[] => {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

describe('the served page and its layout worker', () => {
  const served = listOr(servedAssets)
  const workers = served.filter((name) => /^elk-worker(\.min)?-[A-Za-z0-9_-]+\.js$/.test(name))
  // Vite names the entry after `index.html`, not after `main.tsx`.
  const entries = served.filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))

  it('has something built to check', () => {
    expect(served.length, 'run `pnpm build` first').toBeGreaterThan(0)
  })

  it('emits exactly one worker file, flat under assets, that the asset route will serve', () => {
    expect(workers).toHaveLength(1)
    expect(ASSET_NAME.test(workers[0] ?? '')).toBe(true)
  })

  it('has the page construct that worker as a same-origin script and load the engine nowhere else first', () => {
    expect(entries).toHaveLength(1)
    const entry = readFileSync(resolve(servedAssets, entries[0] ?? ''), 'utf8')
    expect(entry.includes('new Worker(')).toBe(true)
    expect(entry.includes((workers[0] ?? '').replace(/\.js$/, ''))).toBe(true)
    // The bundled engine is a chunk of its own the page never asks for; it
    // must not be inside the entry, or the page ships ELK twice. ELK's option
    // ids are string literals no minifier renames, so they mark the engine.
    expect(entry.includes('org.eclipse.elk')).toBe(false)
    expect(readFileSync(resolve(servedAssets, workers[0] ?? ''), 'utf8').includes('org.eclipse.elk')).toBe(true)
  })

  it('gives the library no worker of its own', () => {
    const lib = listOr(libDir)
    expect(lib.length, 'run `pnpm build` first').toBeGreaterThan(0)
    expect(lib.filter((name) => name.startsWith('elk-worker'))).toEqual([])
    // One file: the bundled engine is inlined, not split beside it.
    expect(lib.filter((name) => name.endsWith('.js'))).toEqual(['editor.js'])
    expect(readFileSync(resolve(libDir, 'editor.js'), 'utf8').includes('org.eclipse.elk')).toBe(true)
  })
})
