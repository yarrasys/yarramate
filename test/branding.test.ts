import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VENDOR_LINE,
  LOOP,
  TOOL_CATALOGUE,
  brandSlug,
  instructionsFor,
  loopFor,
  resolveBranding,
  resolveWorkspaceFrom,
  runTool,
  toolCatalogueFor,
  toolVerbOf,
  type Branding,
  type ToolWorkspace,
} from '../src/tools-entry.js'
import { createFileSystemStore } from '../src/source-store.js'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const repositoryWorkspace = (branding?: Branding): ToolWorkspace => {
  const store = createFileSystemStore(repositoryRoot)
  const manifest = {
    path: '.yarramate/workspace.yaml',
    source: store.read('.yarramate/workspace.yaml')!.source,
  }
  const resolved = resolveWorkspaceFrom(manifest, store.list!())
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
  return {
    store,
    workspace: resolved.workspace,
    manifestDirectory: '.yarramate',
    ...(branding === undefined ? {} : { branding }),
  }
}

const acme: Branding = { productName: 'Acme Architect', toolPrefix: 'acme' }

describe('resolveBranding (#546)', () => {
  it('is the unbranded product when nothing is set', () => {
    expect(resolveBranding()).toEqual({
      productName: 'YarraMate',
      shortName: 'YarraMate',
      vendorLine: null,
      toolPrefix: 'yarramate',
      branded: false,
    })
  })
  it('applies the defaults around a product name', () => {
    expect(resolveBranding({ productName: ' ApertureX ' })).toEqual({
      productName: 'ApertureX',
      shortName: 'ApertureX',
      vendorLine: DEFAULT_VENDOR_LINE,
      toolPrefix: 'yarramate',
      branded: true,
    })
  })
  it('keeps what the host set, and lets it remove the vendor line', () => {
    const resolved = resolveBranding({
      productName: 'Halcyon Architecture',
      shortName: 'Halcyon',
      logo: { url: 'https://example.test/logo.svg' },
      accent: '#123456',
      docsUrl: 'https://example.test/docs',
      vendorLine: null,
      toolPrefix: 'halcyon',
    })
    expect(resolved).toEqual({
      productName: 'Halcyon Architecture',
      shortName: 'Halcyon',
      logo: { url: 'https://example.test/logo.svg' },
      accent: '#123456',
      docsUrl: 'https://example.test/docs',
      vendorLine: null,
      toolPrefix: 'halcyon',
      branded: true,
    })
    expect(resolveBranding({ productName: 'X', shortName: null }).shortName).toBeNull()
    expect(resolveBranding({ productName: 'X', shortName: ' ' }).shortName).toBe('X')
    expect(resolveBranding({ productName: 'X', vendorLine: '' }).vendorLine).toBeNull()
    expect(resolveBranding({ productName: 'X', vendorLine: ' Built on yarramate ' }).vendorLine).toBe(
      'Built on yarramate',
    )
  })
  it('refuses a blank name and a prefix no client could publish', () => {
    expect(() => resolveBranding({ productName: '  ' })).toThrow(/productName/)
    expect(() => resolveBranding({ productName: 'X', toolPrefix: 'acme tools' })).toThrow(/toolPrefix/)
    expect(() => resolveBranding({ productName: 'X', toolPrefix: 'acme_x' })).toThrow(/toolPrefix/)
    expect(() => resolveBranding({ productName: 'X', toolPrefix: '-acme' })).toThrow(/toolPrefix/)
    expect(() => resolveBranding({ productName: 'X', toolPrefix: '' })).toThrow(/toolPrefix/)
  })
  it('slugs the short name for identifiers, falling back to the engine', () => {
    expect(brandSlug(resolveBranding())).toBe('yarramate')
    expect(brandSlug(resolveBranding({ productName: 'Halcyon Architecture' }))).toBe(
      'halcyon-architecture',
    )
    expect(brandSlug(resolveBranding({ productName: 'A/B  Co.', shortName: 'A/B Co.' }))).toBe('a-b-co')
    expect(brandSlug(resolveBranding({ productName: '***' }))).toBe('yarramate')
    expect(brandSlug(resolveBranding({ productName: 'Halcyon Architecture', shortName: null }))).toBe(
      'halcyon-architecture',
    )
  })
})

describe('the tool catalogue under a prefix (#546)', () => {
  it('reads the verb behind any prefix, and nothing else', () => {
    expect(toolVerbOf('yarramate_ask')).toBe('ask')
    expect(toolVerbOf('acme_export')).toBe('export')
    expect(toolVerbOf('my-product_design')).toBe('design')
    expect(toolVerbOf('ask')).toBeUndefined()
    expect(toolVerbOf('_ask')).toBeUndefined()
    expect(toolVerbOf('acme_fly')).toBeUndefined()
    expect(toolVerbOf('')).toBeUndefined()
  })
  it('is TOOL_CATALOGUE row for row unless a prefix is set', () => {
    expect(toolCatalogueFor()).toEqual(TOOL_CATALOGUE)
    expect(toolCatalogueFor({ productName: 'ApertureX' })).toEqual(TOOL_CATALOGUE)
    expect(loopFor()).toBe(LOOP)
    expect(loopFor({ productName: 'ApertureX' })).toBe(LOOP)
  })
  it('puts the prefix in every name, the loop sentence and the sibling mentions', () => {
    const rows = toolCatalogueFor(acme)
    expect(rows.map(({ name }) => name)).toEqual([
      'acme_ask',
      'acme_design',
      'acme_apply',
      'acme_check',
      'acme_reconcile',
      'acme_export',
    ])
    for (const [index, row] of rows.entries()) {
      const canonical = TOOL_CATALOGUE[index]!
      expect(row.description).toContain('acme_design')
      expect(row.description).toContain('acme_apply')
      expect(row.description).not.toContain('yarramate_')
      expect(row.unavailable ?? '').not.toContain('yarramate_')
      // Everything but the words is the contract: schema, access, service.
      expect(row.inputSchema).toEqual(canonical.inputSchema)
      expect(row.access).toBe(canonical.access)
      expect(row.served).toBe(canonical.served)
      expect(row.description.replaceAll('acme_', 'yarramate_')).toBe(canonical.description)
    }
    expect(rows[4]!.unavailable).toMatch(/^acme_reconcile is not served here/)
    expect(loopFor(acme)).toBe(LOOP.replaceAll('yarramate_', 'acme_'))
  })
  it('publishes initialize instructions in the product name', () => {
    expect(instructionsFor()).toBe(
      `The architecture record of a YarraMate workspace. The native documents in the repository are canonical; every read renders them, and yarramate_apply is the one write, the same atomic batch the CLI lands. ${LOOP}`,
    )
    const branded = instructionsFor(acme)
    expect(branded).toContain('of a Acme Architect workspace')
    expect(branded).toContain('acme_apply is the one write')
    expect(branded).toContain(loopFor(acme))
    expect(branded).not.toContain('yarramate_')
  })
})

describe('runTool by a branded name (#546)', () => {
  const tool = repositoryWorkspace()
  it('dispatches on the verb and echoes the name it was called by', () => {
    expect(runTool('acme_check', {}, tool).ok).toBe(true)
    expect(runTool('acme_ask', {}, tool).ok).toBe(true)
    expect(runTool('acme_export', { kind: 'markdown' }, tool).text).toBe(
      'acme_export markdown needs `projection`: the path of the view to render.\n',
    )
    expect(runTool('acme_export', {}, tool).text).toMatch(/^acme_export needs `kind`/)
    expect(runTool('acme_apply', {}, tool).text).toMatch(/^acme_apply needs `operations`/)
    expect(runTool('acme_ask', { mode: 'bogus' }, tool).text).toMatch(/^acme_ask mode must be/)
    expect(runTool('acme_reconcile', {}, tool)).toMatchObject({
      ok: false,
      text: `${toolCatalogueFor(acme)[4]!.unavailable}\n`,
    })
    expect(runTool('yarramate_reconcile', {}, tool).text).toBe(
      `${TOOL_CATALOGUE[4]!.unavailable}\n`,
    )
  })
  it('refuses a name with no tool verb rather than throwing', () => {
    expect(runTool('nonsense', {}, tool)).toEqual({
      kind: 'text',
      ok: false,
      text: 'Unknown tool "nonsense".\n',
    })
    expect(runTool('acme_fly', {}, tool).text).toBe('Unknown tool "acme_fly".\n')
  })
  it('names the product in the exports that carry a name', () => {
    const branded = repositoryWorkspace({
      productName: 'Halcyon Architecture',
      shortName: 'Halcyon',
    })
    const project = runTool(
      'yarramate_export',
      { kind: 'likec4', project: '.yarramate/likec4-project.yaml' },
      branded,
    )
    expect(project.kind).toBe('files')
    if (project.kind !== 'files') return
    const config = project.files.find(({ path }) => path === 'likec4.config.json')!
    expect(JSON.parse(config.text!).name).toMatch(/^halcyon-/)
    const model = project.files.find(({ path }) => path === 'model.likec4')!
    expect(model.text!.split('\n').slice(0, 3)).toEqual([
      '// Generated by Halcyon Architecture. Edit the native documents, not this file.',
      '// Powered by yarramate',
      'model {',
    ])
    const plain = runTool(
      'yarramate_export',
      { kind: 'likec4', project: '.yarramate/likec4-project.yaml' },
      tool,
    )
    if (plain.kind !== 'files') throw new Error('unbranded export failed')
    expect(
      JSON.parse(plain.files.find(({ path }) => path === 'likec4.config.json')!.text!).name,
    ).toMatch(/^yarramate-/)
    expect(plain.files.find(({ path }) => path === 'model.likec4')!.text!.split('\n')[0]).toBe(
      '// Generated by YarraMate. Edit the native documents, not this file.',
    )
  })
})
