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

  it('notation/archimate import graph stays free of Node, ws, session, and compiler runtime', () => {
    const { hits } = runtimeImportGraph('notation/archimate.ts')
    expect(hits).toEqual([])
  })

  it('workbook import graph stays free of Node, ws, session, and compiler runtime', () => {
    // ApertureX generates workbooks inside a Cloudflare Worker (#355), where
    // `fs` does not exist and bundle size is a budget. The xlsx container is
    // written by hand for the same reason: every library on npm is larger than
    // the file that replaces it and built for Node. The compiler is reached
    // for types only, so Ajv and YAML stay out of a Worker that only wants to
    // write a spreadsheet.
    const { hits } = runtimeImportGraph('workbook-entry.ts')
    expect(hits).toEqual([])
  })

  it('workbook/import graph stays free of Node, ws, session, and compiler runtime', () => {
    // The half that INGESTS a workbook, published separately from the half
    // that writes one so a Worker that only generates never carries it.
    const { files, hits } = runtimeImportGraph('workbook-import-entry.ts')
    expect(hits).toEqual([])
    // Asserted on the FILES, not only on the hits. A purity check that walks
    // an entry reaching nothing passes for the wrong reason, and would keep
    // passing if an export were dropped from the entry - the emptiness would
    // read as cleanliness. Naming the three files makes the graph prove it
    // actually visited the code the claim is about.
    expect(files).toEqual(
      expect.arrayContaining([
        'workbook-read.ts',
        'workbook-merge.ts',
        'workbook-operations.ts',
      ]),
    )
  })

  it('the two workbook entries stay disjoint, so generating never pulls in reading', () => {
    // The reason `workbook/import` is its own subpath: the package declares no
    // `sideEffects`, so a bundler must assume every module might have one and
    // cannot shake an unused re-export away. If the writer entry ever reaches
    // the reader, ApertureX's generate-only Worker silently grows by the whole
    // import half.
    const writer = runtimeImportGraph('workbook-entry.ts').files
    expect(writer).not.toContain('workbook-read.ts')
    expect(writer).not.toContain('workbook-merge.ts')
    expect(writer).not.toContain('workbook-operations.ts')
  })

  it('interrogation import graph stays free of Node, ws, session, and compiler runtime', () => {
    // The engine is the one piece a Durable Object runs on every model write,
    // so the compiler's Ajv/YAML weight and every Node builtin have to stay
    // out of its import graph. The compiler is reached for types only.
    const { hits } = runtimeImportGraph('interrogation-entry.ts')
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

describe('the interrogation barrel', () => {
  it('publishes composition, not only evaluation', async () => {
    // A host is told to compose UNCONDITIONALLY, even with one catalogue, so
    // its question ids never change later (#345, ADR 0129). Advice it cannot
    // follow is worse than no advice: `yarramate/workbook` shipped a writer
    // with no reader the same week, and this is the same defect one import
    // away.
    const entry = await import('../src/interrogation-entry.js')
    expect(typeof entry.composeCatalogues).toBe('function')
    expect(typeof entry.qualifiedQuestionId).toBe('function')
    expect(typeof entry.evaluateCatalogue).toBe('function')

    const barrel = await import('../src/index.js')
    expect(typeof barrel.composeCatalogues).toBe('function')
    expect(typeof barrel.qualifiedQuestionId).toBe('function')
  })

  it('publishes every interrogation TYPE the barrel does', () => {
    // The omission this test exists for, reported by the ApertureX session
    // against 1.18.0: `CataloguePatternVacancy` reached the barrel and not
    // this subpath, so a Durable Object host - the one consumer the subpath
    // exists FOR, since it may not import Node builtins - had to derive the
    // row type as `NonNullable<Parameters<typeof evaluateCatalogue>[6]>[number]`.
    //
    // The runtime assertions above could not catch it, and no addition to them
    // could: types are erased before any of this runs. So the check reads the
    // SOURCE, and it is a rule rather than a list - every type the barrel
    // re-exports from `interrogate-command` must reach the subpath too, so a
    // type added to one and forgotten on the other fails here rather than in
    // an adopter's editor.
    const typeExports = (file: string): readonly string[] => {
      const source = readFileSync(join(root, file), 'utf8')
      const block = source
        .split(/from ['"]\.\/interrogate-command\.js['"]/)[0]!
        .split(/export \{|import \{/)
        .pop()!
      return [...block.matchAll(/type\s+(\w+)/g)]
        .map((match) => match[1]!)
        .sort()
    }
    const barrel = typeExports('index.ts')
    const subpath = typeExports('interrogation-entry.ts')
    // A sanity floor: if the extraction stops finding anything, the assertion
    // below would pass vacuously and this check would quietly stop working.
    expect(barrel.length).toBeGreaterThan(5)
    expect(subpath.length).toBeGreaterThan(5)
    expect(barrel.filter((name) => !subpath.includes(name))).toEqual([])
  })

  it('composes end to end from the published entry alone', async () => {
    // Through the entry, not through the module: an export that resolves but
    // does not work is what a barrel test is for.
    const { composeCatalogues } = await import('../src/interrogation-entry.js')
    // Only the BASE declares the wave; the second joins it, which is the rule
    // and is what a project catalogue actually does. Written the other way
    // first, and YM915 refused it, which is the check earning its keep on its
    // own test.
    const catalogue = (id: string, declaresWave: boolean) => ({
      path: `${id}.yaml`,
      source: `format: yarramate/question-catalogue/v1
id: ${id}
version: "1.0"
profile: yarramate/core@0.1
${declaresWave ? 'waves:\n  - id: only\n    name: Only\n' : 'waves: []\n'}questions:
  - id: same-name
    wave: only
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#goal
    question: Why?
    materiality: Because.
    resolution: Answer it.
    authority: human
`,
    })
    const composed = composeCatalogues([
      catalogue('base', true),
      catalogue('extra', false),
    ])
    if (!composed.ok) throw new Error(JSON.stringify(composed.diagnostics.map(({ code, message }) => `${code} ${message}`)))
    expect(composed.composed.catalogue.questions.map(({ id }) => id)).toEqual([
      'base#same-name',
      'extra#same-name',
    ])
    expect(composed.composed.catalogues).toEqual(['base@1.0', 'extra@1.0'])
  })
})

describe('workbook barrels', () => {
  it('yarramate/workbook hands a host everything it needs to WRITE one', async () => {
    const mod = await import('../src/workbook-entry.js')
    expect(typeof mod.workbookFrom).toBe('function')
    expect(typeof mod.buildWorkbookSheets).toBe('function')
    expect(typeof mod.writeXlsx).toBe('function')
  })

  it('yarramate/workbook/import hands a host the whole way back to operations', async () => {
    // Read -> merge -> operations. A host missing any one of the three has no
    // route from an edited file to something `apply` can take, which is the
    // state this entry exists to end.
    const mod = await import('../src/workbook-import-entry.js')
    expect(typeof mod.readWorkbook).toBe('function')
    expect(typeof mod.baselineSheets).toBe('function')
    expect(typeof mod.mergeWorkbook).toBe('function')
    expect(typeof mod.operationsFrom).toBe('function')
    expect(typeof mod.operationsDocument).toBe('function')
  })
})
