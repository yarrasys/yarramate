import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(process.cwd(), 'src')

const FORBIDDEN = /^(node:|ws$|fs$|path$|os$|child_process$|crypto$|net$|http$|https$)/

function runtimeImportGraph(entryRelative: string): { files: string[]; hits: string[] } {
  const seen = new Set<string>()
  const queue = [entryRelative]
  const hits: string[] = []
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (seen.has(rel)) continue
    seen.add(rel)
    const full = join(root, rel)
    if (!existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    // Strip type-only imports so `import type` from compiler.js is allowed.
    const withoutTypeImports = text.replace(
      /^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm,
      '',
    )
    for (const match of withoutTypeImports.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]!
      if (FORBIDDEN.test(spec) || spec === 'ws') {
        hits.push(`${rel} -> ${spec}`)
        continue
      }
      if (spec.includes('adapters/visual/') || spec.endsWith('/visual/session-server.js')) {
        hits.push(`${rel} -> ${spec}`)
        continue
      }
      // Disallow runtime import of compiler.js (Node/Ajv).
      if (spec.endsWith('/compiler.js') || spec === './compiler.js' || spec === '../compiler.js') {
        hits.push(`${rel} -> ${spec} (runtime)`)
        continue
      }
      if (spec.startsWith('.')) {
        let p = spec
        if (!p.endsWith('.ts') && !p.endsWith('.js') && !p.endsWith('.json')) p += '.ts'
        p = p.replace(/\.js$/, '.ts')
        const target = normalize(join(dirname(rel), p)).replace(/\\/g, '/')
        if (!seen.has(target)) queue.push(target)
      }
    }
  }
  return { files: [...seen].sort(), hits }
}

describe('package export purity', () => {
  it('adapter/visual-graph import graph stays free of Node, ws, session, and compiler runtime', () => {
    const { hits } = runtimeImportGraph('adapters/visual-graph-entry.ts')
    expect(hits).toEqual([])
  })
})

describe('adapter/visual-graph barrel', () => {
  it('re-exports projectGraphForCanvas', async () => {
    // Dynamic import intentionally exercises the module-loading boundary
    // for the published subpath entry point.
    const mod = await import('../src/adapters/visual-graph-entry.js')
    expect(typeof mod.projectGraphForCanvas).toBe('function')
  })
})
