import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'vite'
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

/**
 * The same question asked of the BUILT bundle, which is where it is actually
 * answered (#252).
 *
 * The import-graph walk above catches the shape the incident took: a relative
 * import of a module that names `node:`. It cannot catch the class. It follows
 * only relative specifiers, so a bare `import 'ajv'` that reached for
 * `node:module` inside would pass; it greps for `from 'node:'`, so a
 * `createRequire` obtained any other way would pass; and it never looks at
 * what the bundler actually emitted.
 *
 * These read the artifact. A bundle that contains `createRequire(`, a `node:`
 * specifier, or an untransformed Node global will not run in a browser,
 * whatever the source looked like on the way in.
 */
describe('the built bundles carry no Node API', () => {
  const built = (path: string): string | null => {
    const file = resolve(repositoryRoot, path)
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  }

  const bundles = (): readonly (readonly [string, string])[] => {
    const assets = resolve(repositoryRoot, 'dist/visual-app/assets')
    let served: readonly string[] = []
    try {
      served = readdirSync(assets).filter((name) => name.endsWith('.js'))
    } catch {
      served = []
    }
    return [
      ...served.map(
        (name) =>
          [`dist/visual-app/assets/${name}`, built(`dist/visual-app/assets/${name}`) ?? ''] as const,
      ),
      ['dist/visual-app-lib/editor.js', built('dist/visual-app-lib/editor.js') ?? ''] as const,
    ].filter(([, source]) => source !== '')
  }

  it('has something built to check', () => {
    // A green suite over no artifact is the failure mode this whole file
    // exists to prevent, so the absence is itself a failure.
    expect(bundles().length, 'run `pnpm build` first').toBeGreaterThanOrEqual(2)
  })

  type AstNode = Readonly<{
    type: string
    [property: string]: unknown
  }>
  type FormMatcher = (node: AstNode) => boolean

  const isNode = (value: unknown): value is AstNode =>
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'

  const propertyNamed = (node: unknown, propertyName: string) => {
    if (!isNode(node) || node.type !== 'MemberExpression' || node.computed) {
      return false
    }
    return (
      isNode(node.property) &&
      node.property.type === 'Identifier' &&
      node.property.name === propertyName
    )
  }

  const memberNamed = (
    node: unknown,
    objectName: string,
    propertyName: string,
  ) => {
    if (!propertyNamed(node, propertyName) || !isNode(node)) return false
    if (!isNode(node.object) || node.object.type !== 'Identifier') {
      return false
    }
    return node.object.name === objectName
  }

  const isNodeSpecifier = (node: unknown) =>
    isNode(node) &&
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value.startsWith('node:')

  const isJsxDevCallee = (node: unknown): boolean => {
    if (!isNode(node)) return false
    if (node.type === 'Identifier') return node.name === 'jsxDEV'
    if (propertyNamed(node, 'jsxDEV')) return true
    return (
      node.type === 'SequenceExpression' &&
      Array.isArray(node.expressions) &&
      isJsxDevCallee(node.expressions.at(-1))
    )
  }

  const assignsUndefinedJsxDev = (node: AstNode) => {
    if (
      node.type !== 'AssignmentExpression' ||
      !propertyNamed(node.left, 'jsxDEV') ||
      !isNode(node.right)
    ) {
      return false
    }
    return (
      (node.right.type === 'Identifier' && node.right.name === 'undefined') ||
      (node.right.type === 'UnaryExpression' && node.right.operator === 'void')
    )
  }

  const jsxDevMismatch = 'a jsxDEV call with an undefined production runtime'

  const visit = (root: unknown, inspect: (node: AstNode) => void) => {
    if (!isNode(root)) return
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.pop()!
      inspect(node)
      for (const value of Object.values(node)) {
        if (isNode(value)) {
          pending.push(value)
        } else if (Array.isArray(value)) {
          for (const child of value) {
            if (isNode(child)) pending.push(child)
          }
        }
      }
    }
  }

  /**
   * A `node:` SPECIFIER, not the characters anywhere. A bundle legitimately
   * carries `selector: "node:parent"` - cytoscape's - and a guard that flagged
   * it would be turned off within a week.
   */
  const forms: readonly (readonly [string, FormMatcher])[] = [
    [
      'createRequire',
      (node) =>
        node.type === 'CallExpression' &&
        isNode(node.callee) &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'createRequire',
    ],
    [
      'an import of a node: module',
      (node) =>
        (node.type === 'ImportExpression' && isNodeSpecifier(node.source)) ||
        (node.type === 'CallExpression' &&
          isNode(node.callee) &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          Array.isArray(node.arguments) &&
          isNodeSpecifier(node.arguments[0])),
    ],
    [
      'a re-export from a node: module',
      (node) =>
        (node.type === 'ImportDeclaration' ||
          node.type === 'ExportNamedDeclaration' ||
          node.type === 'ExportAllDeclaration') &&
        isNodeSpecifier(node.source),
    ],
    [
      'an executable Buffer.from call',
      (node) =>
        node.type === 'CallExpression' &&
        memberNamed(node.callee, 'Buffer', 'from'),
    ],
    [
      'an unreplaced process.env access',
      (node) => memberNamed(node, 'process', 'env'),
    ],
  ]

  const forbiddenForms = (source: string) => {
    const offenders = new Set<string>()
    let hasJsxDevCall = false
    let hasUndefinedJsxDevRuntime = false
    visit(parseAst(source), (node) => {
      for (const [name, matches] of forms) {
        if (matches(node)) offenders.add(name)
      }
      if (node.type === 'CallExpression' && isJsxDevCallee(node.callee)) {
        hasJsxDevCall = true
      }
      if (assignsUndefinedJsxDev(node)) hasUndefinedJsxDevRuntime = true
    })
    if (hasJsxDevCall && hasUndefinedJsxDevRuntime) {
      offenders.add(jsxDevMismatch)
    }
    return forms
      .map(([name]) => name)
      .concat(offenders.has(jsxDevMismatch) ? [jsxDevMismatch] : [])
      .filter((name) => offenders.has(name))
  }

  const bundleOffenders = new Map<string, readonly string[]>()

  it('distinguishes executable Node forms from permitted bundle text', () => {
    expect(
      forbiddenForms(`
        const yamlError = "Buffer.from cannot be serialized"
        const runtimeNote = "jsxDEV = void 0"
        const selector = "node:parent"
        gl.createBuffer()
        if (typeof process !== "undefined") process.emit("warning")
        const expression = /Buffer.from\\(/`)
    ).toEqual([])
    expect(forbiddenForms('Buffer.from(bytes)')).toEqual([
      'an executable Buffer.from call',
    ])
    expect(forbiddenForms('process.env.MODE')).toEqual([
      'an unreplaced process.env access',
    ])
    expect(
      forbiddenForms(
        'const runtime = {}; runtime.jsxDEV = void 0; runtime.jsxDEV({})',
      ),
    ).toEqual([jsxDevMismatch])
  })

  it.each(forms.map(([name]) => name))('contains no %s', (name) => {
    for (const [path, source] of bundles()) {
      let offenders = bundleOffenders.get(path)
      if (offenders === undefined) {
        offenders = forbiddenForms(source)
        bundleOffenders.set(path, offenders)
      }
      expect(offenders, `${path} contains ${name}`).not.toContain(name)
    }
  })

  it('does not call an undefined jsxDEV production runtime', () => {
    for (const [path, source] of bundles()) {
      let offenders = bundleOffenders.get(path)
      if (offenders === undefined) {
        offenders = forbiddenForms(source)
        bundleOffenders.set(path, offenders)
      }
      expect(offenders, `${path} calls an undefined jsxDEV runtime`).not.toContain(
        jsxDevMismatch,
      )
    }
  })
})
