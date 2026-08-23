import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const visualAppRoot = resolve(repositoryRoot, 'src/visual-app')

/**
 * The visual app is bundled for a browser. Anything it imports for its VALUE
 * is bundled with it, so a value import of a module that reaches for `node:`
 * puts a Node API in the browser, where it is not a function and the app fails
 * to mount with nothing on screen.
 *
 * This is not hypothetical. `DEFAULT_NESTING` was defined in `projection.ts`,
 * which loads Ajv through `createRequire`, and importing that one constant
 * shipped `(0, cre.createRequire)(import.meta.url)` into the bundle. Every test
 * passed, because vitest runs in Node, and `vite build` succeeded, because a
 * bundler has no opinion about it. The app was broken for four merges.
 *
 * A type import is fine: it is erased before anything is bundled. The
 * distinction between the two is the whole check.
 */
const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(path) && !path.endsWith('.d.ts') ? [path] : []
  })

/** Every `from '...'` whose binding is not entirely erased at build time. */
const valueImports = (source: string): readonly string[] => {
  const specifiers: string[] = []
  const pattern = /import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? ''
    const specifier = match[2]
    if (specifier === undefined) continue
    const trimmed = clause.trim()
    // `import type { ... }` and `import type X` are erased whole.
    if (trimmed.startsWith('type ')) continue
    // `import { type A, type B }` is erased too: every binding is a type.
    const braced = /^\{([\s\S]*)\}$/.exec(trimmed)
    if (braced !== undefined && braced !== null) {
      const bindings = braced[1]!
        .split(',')
        .map((binding) => binding.trim())
        .filter((binding) => binding !== '')
      if (bindings.length > 0 && bindings.every((b) => b.startsWith('type '))) {
        continue
      }
    }
    specifiers.push(specifier)
  }
  return specifiers
}

const resolveLocal = (from: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier).replace(/\.js$/, '')
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not that one
    }
  }
  return null
}

const reachesNode = (entry: string): readonly string[] | null => {
  const seen = new Set<string>()
  const walk = (file: string, chain: readonly string[]): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    if (/from\s*['"]node:/.test(source)) return [...chain, file]
    for (const specifier of valueImports(source)) {
      const next = resolveLocal(file, specifier)
      if (next === null) continue
      const found = walk(next, [...chain, file])
      if (found !== null) return found
    }
    return null
  }
  return walk(entry, [])
}

describe('the visual app stays browser-safe', () => {
  it('value-imports nothing that reaches node:', () => {
    const offenders = sourceFiles(visualAppRoot)
      .map((file) => ({ file, chain: reachesNode(file) }))
      .filter((result) => result.chain !== null)
      .map(({ file, chain }) =>
        `${file.slice(repositoryRoot.length)} -> ${chain!
          .slice(1)
          .map((step) => step.slice(repositoryRoot.length))
          .join(' -> ')}`,
      )

    expect(offenders).toEqual([])
  })

  it('can tell a value import from a type import', () => {
    // The distinction this rests on, asserted rather than assumed.
    expect(valueImports("import type { A } from './a.js'")).toEqual([])
    expect(valueImports("import { type A } from './a.js'")).toEqual([])
    expect(valueImports("import { type A, type B } from './a.js'")).toEqual([])
    expect(valueImports("import { type A, B } from './a.js'")).toEqual([
      './a.js',
    ])
    expect(valueImports("import { A } from './a.js'")).toEqual(['./a.js'])
    expect(valueImports("import A from './a.js'")).toEqual(['./a.js'])
    expect(valueImports("import * as A from './a.js'")).toEqual(['./a.js'])
  })
})
