import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runVisualClientCli } from '../src/adapters/visual-cli.js'
import { parseVisualSessionRequest } from '../src/adapters/visual/protocol.js'
import { buildVisualSessionRequest } from '../src/adapters/visual/request.js'

// One document, one profile-free projection over it: enough for the native
// compiler to produce a real graph, so the builder is exercised against the
// same projection and digest machinery a session start uses.
const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: checkout
    kind: applicationService
    name: Checkout
    description: Takes payment.
  - id: ledger
    kind: applicationService
    name: Ledger
    description: Records payment.
relationships:
  - id: checkout-serves-ledger
    kind: serving
    from: checkout
    to: ledger
`

const manifest = `format: yarramate/workspace/v1
id: request-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/services.yaml
  - projections/ledger.yaml
adapterMappings: []
evidence: []
contracts: []
`

const servicesProjection = `format: yarramate/projection/v1
id: services
version: "1.0"
query:
  documents:
    - main
  relationships: connected
presentation:
  title: Services
  description: Everything the fixture declares.
`

const ledgerProjection = `format: yarramate/projection/v1
id: ledger
version: "1.0"
query:
  subjects:
    - ledger
  relationships: none
`

let cwd: string

const write = (relative: string, source: string): void => {
  const absolute = join(cwd, relative)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, source, 'utf8')
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yarramate-visual-request-'))
  // Manifest entries are relative to the manifest's own directory, so every
  // fixture document lives under `.yarramate/` exactly as a real repo's does.
  write('.yarramate/workspace.yaml', manifest)
  write('.yarramate/architecture/main.yaml', document)
  write('.yarramate/projections/services.yaml', servicesProjection)
  write('.yarramate/projections/ledger.yaml', ledgerProjection)
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('buildVisualSessionRequest', () => {
  it('transcribes the workspace into a request a session accepts', () => {
    const built = buildVisualSessionRequest({ cwd })
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics))
    const { request } = built
    expect(request.format).toBe('yarramate/visual-session-request/v1')
    expect(request.authority).toBe('canonical')
    expect(request.initialModel.authority).toBe('canonical')
    // The default view is the first projection the workspace resolves - the
    // same list, in the same order, the session offers the browser.
    expect(request.initialModel.initialView).toBe('ledger')
    expect(request.title).toBe('request-fixture')
    expect(request.chatEnabled).toBe(false)
    // Every source that compiled is digested, addressed by its workspace path.
    expect(Object.keys(request.initialModel.sourceDigests)).toEqual([
      '.yarramate/architecture/main.yaml',
    ])
    expect(
      request.initialModel.sourceDigests['.yarramate/architecture/main.yaml'],
    ).toMatch(/^[0-9a-f]{64}$/)
    // The graph is the native projection, not a re-authored one: nodes carry
    // both the qualified id and the authored id a commit addresses.
    expect(
      request.initialModel.graph.nodes.map((node) => node.localId).sort(),
    ).toEqual(['checkout', 'ledger'])
    expect(request.initialModel.graph.nodes.map((node) => node.id)).toContain(
      'checkout',
    )
    expect(request.initialModel.graph.edges).toHaveLength(1)
    expect(request.initialModel.graph.nodes[0]?.document).toBe(
      '.yarramate/architecture/main.yaml',
    )
    expect(parseVisualSessionRequest(request)).toMatchObject({ ok: true })
  })

  it('takes the view, title, description, and chat from its caller', () => {
    const built = buildVisualSessionRequest({
      cwd,
      initialView: 'ledger',
      title: 'Ledger tour',
      description: 'Just the ledger.',
      chatEnabled: true,
    })
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics))
    expect(built.request.initialModel.initialView).toBe('ledger')
    expect(built.request.title).toBe('Ledger tour')
    expect(built.request.description).toBe('Just the ledger.')
    expect(built.request.chatEnabled).toBe(true)
  })

  it('refuses a view the workspace does not declare, and names the ones it does', () => {
    const built = buildVisualSessionRequest({ cwd, initialView: 'missing' })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.diagnostics[0]?.code).toBe('YMVS413')
    expect(built.diagnostics[0]?.message).toContain('ledger, services')
  })

  it('refuses a workspace with no readable manifest', () => {
    rmSync(join(cwd, '.yarramate/workspace.yaml'))
    const built = buildVisualSessionRequest({ cwd })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.diagnostics[0]?.code).toBe('YMVS410')
  })

  it('reports the manifest loader when a declared document is missing', () => {
    rmSync(join(cwd, '.yarramate/architecture/main.yaml'))
    const built = buildVisualSessionRequest({ cwd })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.diagnostics[0]?.pointer).toBe('/documents/0')
  })

  it('reports the compiler when the workspace does not compile', () => {
    write(
      '.yarramate/architecture/main.yaml',
      `${document}  - id: dangling\n    kind: serving\n    from: checkout\n    to: nowhere\n`,
    )
    const built = buildVisualSessionRequest({ cwd })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.diagnostics[0]?.path).toBe('.yarramate/architecture/main.yaml')
  })

  it('refuses a workspace that declares no loadable projection', () => {
    write(
      '.yarramate/workspace.yaml',
      manifest.replace(
        'projections:\n  - projections/services.yaml\n  - projections/ledger.yaml\n',
        'projections: []\n',
      ),
    )
    const built = buildVisualSessionRequest({ cwd })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.diagnostics[0]?.code).toBe('YMVS412')
  })
})

describe('yarramate-visual request', () => {
  it('writes exactly one request document to stdout', async () => {
    const result = await runVisualClientCli(['request'], cwd)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(parseVisualSessionRequest(JSON.parse(result.stdout))).toMatchObject({
      ok: true,
    })
  })

  it('carries its flags into the document', async () => {
    const result = await runVisualClientCli(
      ['request', '--view', 'ledger', '--title', 'Ledger tour', '--chat'],
      cwd,
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      title: 'Ledger tour',
      chatEnabled: true,
      initialModel: { initialView: 'ledger' },
    })
  })

  it('refuses on stderr, leaving stdout empty', async () => {
    const result = await runVisualClientCli(['request', '--view', 'missing'], cwd)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({
      format: 'yarramate/visual-diagnostic-result/v1',
      diagnostics: [{ code: 'YMVS413' }],
    })
  })

  it('answers usage for a flag with no value, a repeat, or an unknown name', async () => {
    for (const args of [
      ['request', '--view'],
      ['request', '--view', '--chat'],
      ['request', '--chat', '--chat'],
      ['request', '--title', 'a', '--title', 'b'],
      ['request', '--depth', '2'],
    ]) {
      const result = await runVisualClientCli(args, cwd)
      expect(result.exitCode, args.join(' ')).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('yarramate-visual request')
    }
  })
})
