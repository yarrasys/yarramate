import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { createLocalHost } from '../src/visual-app/local-host.js'
import type {
  PendingWrite,
  SourceStore,
  StoredSource,
  WriteOutcome,
} from '../src/source-store.js'
import type { ResolvedWorkspace } from '../src/workspace.js'
import type { VisualServerFrame } from '../src/adapters/visual/wire.js'
import type { VisualBrowserInput } from '../src/adapters/visual/protocol-contract.js'

/**
 * The editor with no server behind it (#252).
 *
 * These drive the host the way the browser does — one input in, frames out —
 * over a store that is a `Map`. That the store is a Map rather than a disk is
 * the whole point: ADR 0100 made Core a pure function from sources to sources
 * so an embedder over D1 or an object store could hand the editor its own.
 */

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: checkout
    kind: applicationComponent
    name: Checkout
  - id: ledger
    kind: applicationComponent
    name: Ledger
  - id: teller
    kind: businessActor
    name: Teller
relationships:
  - id: checkout-serves-teller
    kind: serving
    from: checkout
    to: teller
`

const projection = `format: yarramate/projection/v1
id: apps
version: "1.0"
query:
  kinds: [yarramate/core@0.1#applicationComponent]
presentation:
  title: Applications
  description: Every application component
`

/** A store over a Map, which is what an embedder builds after fetching. */
const memoryStore = (
  files: Readonly<Record<string, string>>,
): SourceStore & {
  readonly held: Map<string, string>
  readonly writeBatches: PendingWrite[][]
} => {
  const writeBatches: PendingWrite[][] = []
  const held = new Map(Object.entries(files))
  // A revision is opaque and only its own store compares two (ADR 0100); a
  // counter bumped on write is a perfectly good one.
  const revisions = new Map<string, string>(
    [...held.keys()].map((path) => [path, '1'] as const),
  )
  return {
    held,
    writeBatches,
    list: () => [...held.keys()],
    read: (path: string): StoredSource | undefined => {
      const source = held.get(path)
      return source === undefined
        ? undefined
        : { source, revision: revisions.get(path) ?? '1' }
    },
    writeAll: (writes: readonly PendingWrite[]): WriteOutcome => {
      writeBatches.push([...writes])
      for (const write of writes) {
        const current = held.has(write.path)
          ? (revisions.get(write.path) ?? '1')
          : null
        if (current !== write.expected) {
          return {
            ok: false,
            conflicts: [{ path: write.path, reason: 'changed' }],
          }
        }
      }
      for (const write of writes) {
        if (write.source === null) {
          held.delete(write.path)
          revisions.delete(write.path)
          continue
        }
        held.set(write.path, write.source)
        revisions.set(
          write.path,
          String(Number(revisions.get(write.path) ?? '0') + 1),
        )
      }
      return { ok: true, revisions: new Map(revisions) }
    },
  }
}

const workspace: ResolvedWorkspace = {
  id: 'embedded',
  documents: ['architecture/main.yaml'],
  profiles: [],
  projections: ['projections/apps.yaml'],
  adapterMappings: [],
  patterns: [],  evidence: [],
  contracts: [],
}

const openHost = (
  files: Readonly<Record<string, string>> = {
    'architecture/main.yaml': document,
    'projections/apps.yaml': projection,
  },
  extra: {
    readonly catalogue?:
      | { readonly path: string; readonly source: string }
      | readonly { readonly path: string; readonly source: string }[]
  } = {},
) => {
  const store = memoryStore(files)
  const host = createLocalHost({ store, workspace, ...extra })
  const frames: VisualServerFrame[] = []
  const stop = host.open({
    frame: (frame) => frames.push(frame),
    connected: () => {},
    lost: () => {},
    session: () => ({ lastSequence: 0, closed: false }),
  })
  const send = (input: VisualBrowserInput) => host.send(input)
  return { store, host, frames, send, stop }
}

const input = (
  type: VisualBrowserInput['type'],
  payload: unknown,
): VisualBrowserInput =>
  ({ type, lastAcknowledgedSequence: 0, payload }) as VisualBrowserInput

describe('an editor over a store, with no server', () => {
  it('compiles the workspace and opens on a ready frame', () => {
    const { frames } = openHost()
    const ready = frames[0]

    expect(ready?.kind).toBe('ready')
    if (ready?.kind !== 'ready') return
    expect(ready.snapshot.model.graph.nodes.map(({ name }) => name)).toEqual([
      'Checkout',
      'Ledger',
      'Teller',
    ])
    expect(ready.snapshot.views.map(({ title }) => title)).toEqual([
      'Applications',
    ])
  })

  it('ships the interrogation overlay from the bundled catalogue (#292)', () => {
    const { frames } = openHost()
    const ready = frames[0]
    expect(ready?.kind).toBe('ready')
    if (ready?.kind !== 'ready') return
    const overlay = ready.snapshot.model.interrogation
    // Presence and shape only - counts move with every catalogue version,
    // and pinning them here would fail each honest deepening (ADR 0063).
    expect(overlay).toBeDefined()
    expect(overlay!.catalogue).toMatch(/^core-enrichment@/)
    expect(overlay!.semantics.length).toBeGreaterThan(0)
    expect(overlay!.workspace.length).toBeGreaterThan(0)
    // This thin fixture leaves subject-scoped questions open somewhere.
    expect(Object.keys(overlay!.subjects).length).toBeGreaterThan(0)
  })

  it('evaluates the composed catalogue SET a host hands the mount (#369)', () => {
    // The overlay beneath took the array since ADR 0129; the option was the
    // last single-width seam, and a pane evaluating fewer catalogues than
    // the host's Open-items surface is a disagreement with no symptom.
    const pack = (id: string) =>
      `format: yarramate/question-catalogue/v1
id: ${id}
version: "0.1"
profile: yarramate/core@0.1
waves:
  - id: ${id}-wave
    name: ${id}
questions:
  - id: goal-missing
    wave: ${id}-wave
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds:
          - yarramate/core@0.1#goal
    question: Where is the goal, per ${id}?
    materiality: M
    resolution: R
    authority: human
`
    const { frames } = openHost(undefined, {
      catalogue: [
        { path: 'questions/alpha.yaml', source: pack('alpha') },
        { path: 'questions/beta.yaml', source: pack('beta') },
      ],
    })
    const ready = frames[0]
    expect(ready?.kind).toBe('ready')
    if (ready?.kind !== 'ready') return
    const overlay = ready.snapshot.model.interrogation
    expect(overlay).toBeDefined()
    // Both packs ask, under their own qualified identities: two catalogues
    // may carry the same local id and remain two questions (ADR 0129).
    expect(
      overlay!.workspace.map(({ questionId }) => questionId).sort(),
    ).toEqual(['alpha#goal-missing', 'beta#goal-missing'])
  })

  it('counts a view by its SUBJECTS, not by its match set', () => {
    // Concepts and relationships come back together; a view over two
    // components would read as three if the relationship were counted.
    const { frames } = openHost()
    const ready = frames[0]
    if (ready?.kind !== 'ready') throw new Error('no ready frame')

    expect(ready.snapshot.views[0]?.subjectCount).toBe(2)
  })

  it('refuses a filter over a workspace that does not compile, rather than matching nothing', () => {
    // `matchedIds: []` is a claim about the subjects - every one of them
    // failed the query - and the canvas honours it by hiding the whole model.
    // A workspace that does not compile cannot answer the question at all,
    // so the host says that instead, leaving the last good model standing
    // the same way `recompile` itself does (#307).
    const { frames, send } = openHost({
      'architecture/main.yaml': `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: nope
    kind: notAKind
    name: Nope
`,
      'projections/apps.yaml': projection,
    })
    send(input('filter.query', { query: {} }))
    const refused = frames.at(-1)

    expect(refused?.kind).toBe('rejected')
    if (refused?.kind !== 'rejected') return
    expect(refused.refused).toBe('filter.query')
    expect(refused.diagnostics[0]?.code).toBe('YMVS318')
  })

  it('answers a filter with what matched and what it dropped', () => {
    const { frames, send } = openHost()
    send(
      input('filter.query', {
        query: { kinds: ['yarramate/core@0.1#businessActor'] },
      }),
    )
    const result = frames.at(-1)

    expect(result?.kind).toBe('filter-result')
    if (result?.kind !== 'filter-result') return
    expect(result.result.matchedIds).toContain('teller')
    expect(
      result.result.excluded.map(({ id, facet }) => `${id}:${facet}`),
    ).toEqual(['checkout:kinds', 'ledger:kinds'])
  })

  it('lands a commit through the store and redraws from what landed', () => {
    const { store, frames, send } = openHost()
    send(
      input('changeset.commit', {
        operations: [
          {
            op: 'add-concept',
            document: 'architecture/main.yaml',
            concept: {
              id: 'settlement',
              kind: 'applicationComponent',
              name: 'Settlement',
            },
          },
        ],
        viewOperations: [],
        sourceDigests: {},
      }),
    )

    const applied = frames.find((frame) => frame.kind === 'apply-result')
    expect(applied?.kind === 'apply-result' && applied.result.ok).toBe(true)
    expect(store.held.get('architecture/main.yaml')).toContain('settlement')

    // The model frame that follows is what the canvas redraws from.
    const model = frames.at(-1)
    expect(model?.kind).toBe('model')
    if (model?.kind !== 'model') return
    expect(model.model.graph.nodes.map(({ name }) => name)).toContain(
      'Settlement',
    )
    expect(model.views[0]?.subjectCount).toBe(3)
  })

  it('writes nothing when the batch would not compile', () => {
    const { store, frames, send } = openHost()
    const before = store.held.get('architecture/main.yaml')
    send(
      input('changeset.commit', {
        operations: [
          {
            op: 'add-concept',
            document: 'architecture/main.yaml',
            concept: { id: 'nope', kind: 'notAKind', name: 'Nope' },
          },
        ],
        viewOperations: [],
        sourceDigests: {},
      }),
    )

    const applied = frames.at(-1)
    expect(applied?.kind).toBe('apply-result')
    if (applied?.kind !== 'apply-result') return
    expect(applied.result.ok).toBe(false)
    expect(store.held.get('architecture/main.yaml')).toBe(before)
  })

  it('lands a staged view beside the model, in one write', () => {
    const { store, frames, send } = openHost()
    send(
      input('changeset.commit', {
        operations: [],
        viewOperations: [
          {
            op: 'write-view',
            path: 'projections/apps.yaml',
            projection: {
              format: 'yarramate/projection/v1',
              id: 'apps',
              version: '1.0',
              query: { kinds: ['yarramate/core@0.1#businessActor'] },
              presentation: { title: 'Actors', description: 'Who acts' },
            },
          },
        ],
        sourceDigests: {},
      }),
    )

    expect(frames.find((frame) => frame.kind === 'apply-result')).toMatchObject({
      result: { ok: true },
    })
    expect(store.held.get('projections/apps.yaml')).toContain('Actors')
  })

  it('writes fold state beside the positions, in one document (#473)', () => {
    // One document and full state every time, never a patch: a box and the
    // positions of what is inside it are one fact, and the sidecar is written
    // by a browser that may have reloaded between any two saves.
    const { store, frames, send } = openHost()
    send(
      input('layout.save', {
        projectionId: 'apps',
        positions: { checkout: { x: 1, y: 2 } },
        folded: ['checkout'],
        unfolded: [],
      }),
    )
    const saved = frames.at(-1)
    expect(saved?.kind).toBe('layout-save-result')
    const sidecar = parse(store.held.get('.yarramate/visual-layout/apps.yaml') ?? '')
    expect(sidecar).toEqual({
      format: 'yarramate/visual-layout/v1',
      projectionId: 'apps',
      positions: { checkout: { x: 1, y: 2 } },
      folded: ['checkout'],
      unfolded: [],
    })
  })

  it('writes no fold keys at all when the host sends none', () => {
    // Every sidecar written before #473 has neither list, and a host that
    // never folds should keep producing exactly those bytes.
    const { store, send } = openHost()
    send(
      input('layout.save', {
        projectionId: 'apps',
        positions: { checkout: { x: 1, y: 2 } },
      }),
    )
    const sidecar = parse(store.held.get('.yarramate/visual-layout/apps.yaml') ?? '') as Record<string, unknown>
    expect('folded' in sidecar).toBe(false)
    expect('unfolded' in sidecar).toBe(false)
  })

  it('persists a known view layout across the next model frame', () => {
    const { store, frames, send } = openHost()
    const positions = {
      checkout: { x: 120, y: 80 },
      ledger: { x: 360, y: 240 },
    }

    send(input('layout.save', { projectionId: 'apps', positions }))

    const saved = frames.at(-1)
    expect(saved?.kind).toBe('layout-save-result')
    if (saved?.kind !== 'layout-save-result') return
    expect(saved.result).toEqual({
      ok: true,
      path: '.yarramate/visual-layout/apps.yaml',
    })
    const sidecar = store.held.get('.yarramate/visual-layout/apps.yaml')
    expect(sidecar).toBeDefined()
    expect(store.writeBatches).toHaveLength(1)
    expect(store.writeBatches[0]).toHaveLength(1)
    expect(store.writeBatches[0]).toMatchObject([
      { path: '.yarramate/visual-layout/apps.yaml', expected: null },
    ])
    expect(parse(sidecar ?? '')).toEqual({
      format: 'yarramate/visual-layout/v1',
      projectionId: 'apps',
      positions,
    })

    send(
      input('changeset.commit', {
        operations: [
          {
            op: 'add-concept',
            document: 'architecture/main.yaml',
            concept: {
              id: 'settlement',
              kind: 'applicationComponent',
              name: 'Settlement',
            },
          },
        ],
        viewOperations: [],
        sourceDigests: {},
      }),
    )

    const model = frames.at(-1)
    expect(model?.kind).toBe('model')
    if (model?.kind !== 'model') return
    expect(model.model.layouts.apps).toEqual(positions)
  })

  it('refuses an unknown view layout without changing the store', () => {
    const { store, frames, send } = openHost()
    const before = [...store.held.entries()]

    send(
      input('layout.save', {
        projectionId: 'missing',
        positions: { checkout: { x: 120, y: 80 } },
      }),
    )

    const refused = frames.at(-1)
    expect(refused?.kind).toBe('layout-save-result')
    if (refused?.kind !== 'layout-save-result') return
    expect(refused.result.ok).toBe(false)
    expect([...store.held.entries()]).toEqual(before)
    expect(store.writeBatches).toHaveLength(0)
  })

  it('adds a manifest-covered new view to the next model frame', () => {
    const { store, frames, send } = openHost()
    const path = 'projections/joined.yaml'
    send(
      input('changeset.commit', {
        operations: [],
        viewOperations: [
          {
            op: 'write-view',
            path,
            projection: {
              format: 'yarramate/projection/v1',
              id: 'joined',
              version: '1.0',
              query: { kinds: ['yarramate/core@0.1#businessActor'] },
              presentation: { title: 'Joined', description: 'Added in-session' },
            },
          },
        ],
        sourceDigests: {},
      }),
    )

    const applied = frames.at(-2)
    expect(applied?.kind).toBe('apply-result')
    if (applied?.kind !== 'apply-result') return
    expect(applied.result.ok).toBe(true)
    expect(store.held.get(path)).toContain('Joined')
    const model = frames.at(-1)
    expect(model?.kind).toBe('model')
    if (model?.kind !== 'model') return
    expect(model.views.map(({ id }) => id)).toContain('joined')
  })

  it('removes a view that joined during this session from the next model frame', () => {
    const { store, frames, send } = openHost()
    const path = 'projections/joined.yaml'
    const write = {
      operations: [],
      viewOperations: [
        {
          op: 'write-view' as const,
          path,
          projection: {
            format: 'yarramate/projection/v1' as const,
            id: 'joined',
            version: '1.0',
            query: { kinds: ['yarramate/core@0.1#businessActor'] },
            presentation: { title: 'Joined', description: 'Added in-session' },
          },
        },
      ],
      sourceDigests: {},
    }
    send(input('changeset.commit', write))

    const joined = frames.at(-1)
    expect(joined?.kind).toBe('model')
    if (joined?.kind !== 'model') return
    expect(joined.views.map(({ id }) => id)).toContain('joined')

    send(
      input('changeset.commit', {
        operations: [],
        viewOperations: [{ op: 'delete-view', path }],
        sourceDigests: {},
      }),
    )

    const applied = frames.at(-2)
    expect(applied?.kind).toBe('apply-result')
    if (applied?.kind !== 'apply-result') return
    expect(applied.result.ok).toBe(true)
    expect(store.held.has(path)).toBe(false)
    const model = frames.at(-1)
    expect(model?.kind).toBe('model')
    if (model?.kind !== 'model') return
    expect(model.views.map(({ id }) => id)).not.toContain('joined')
  })

  it('says plainly that it has no agent, rather than going quiet', () => {
    // Chat, a choice and an end are questions for an agent. There is not one,
    // and a host that swallowed them would leave the reviewer waiting on a
    // reply that is never coming.
    const { frames, send } = openHost()
    for (const type of ['chat.message', 'choice.selected', 'session.end'] as const) {
      send(input(type, {}))
      const refused = frames.at(-1)
      expect(refused?.kind).toBe('rejected')
      if (refused?.kind !== 'rejected') continue
      expect(refused.refused).toBe(type)
      expect(refused.diagnostics[0]?.code).toBe('YMVS316')
    }
  })

  it('reports no chat capability, so the composer never offers to send', () => {
    const { frames } = openHost()
    const ready = frames[0]
    if (ready?.kind !== 'ready') throw new Error('no ready frame')

    expect(ready.snapshot.chatEnabled).toBe(false)
    expect(ready.snapshot.capabilities.chat).toBe(false)
  })

  it('delivers nothing once it is stopped', () => {
    const { frames, send, stop } = openHost()
    const seen = frames.length
    stop()
    send(input('filter.query', { query: {} }))

    expect(frames).toHaveLength(seen)
  })
})

/**
 * Following a model that moved under an open canvas (#444).
 *
 * A host whose store changes while a reviewer watches - an agent writing over
 * MCP is the case this exists for - previously had only `unmount` plus mounting
 * again, which discards everything staged. The delivery half already worked: a
 * mid-session `model` frame replaces the compilation and leaves the staged
 * changeset alone. What was missing was any way to ask for one, and any way to
 * find out that asking would strand staged work.
 */
describe('local host refresh', () => {
  const bump = (
    store: ReturnType<typeof memoryStore>,
    path: string,
    source: string,
  ): void => {
    const outcome = store.writeAll([
      { path, source, expected: store.read(path)?.revision ?? null },
    ])
    expect(outcome.ok).toBe(true)
  }

  it('delivers the fresh model when nothing is staged', () => {
    const { store, host, frames } = openHost()
    const before = frames.length
    bump(
      store,
      'architecture/main.yaml',
      document.replace('name: Checkout', 'name: Checkout Service'),
    )

    expect(host.refresh({})).toEqual({ applied: true })
    const model = frames.slice(before).find((frame) => frame.kind === 'model')
    expect(model?.kind).toBe('model')
    if (model?.kind !== 'model') return
    expect(model.model.graph.nodes.map(({ name }) => name)).toContain(
      'Checkout Service',
    )
  })

  it('refuses when staged work pins a document that moved, and delivers nothing', () => {
    const { store, host, frames } = openHost()
    // What the reviewer's staged edit vouched for: the revision the document
    // held when they staged it.
    const staged = {
      'architecture/main.yaml':
        store.read('architecture/main.yaml')?.revision ?? '',
    }
    bump(
      store,
      'architecture/main.yaml',
      document.replace('name: Ledger', 'name: General Ledger'),
    )
    const before = frames.length

    expect(host.refresh(staged)).toEqual({
      applied: false,
      reason: 'staged-against-changed-documents',
      documents: ['architecture/main.yaml'],
    })
    // The canvas is untouched, which is the point: the reviewer's staged rows
    // are exactly where they left them and no frame moved under them.
    expect(frames.slice(before)).toEqual([])
  })

  it('refreshes when the pin still matches what the store holds', () => {
    const { store, host } = openHost()
    const staged = {
      'architecture/main.yaml':
        store.read('architecture/main.yaml')?.revision ?? '',
    }

    // Nothing moved, so staged work is not stranded and the refresh proceeds.
    expect(host.refresh(staged)).toEqual({ applied: true })
  })

  it('counts a document that is gone as changed', () => {
    const { store, host } = openHost()
    const staged = {
      'architecture/main.yaml':
        store.read('architecture/main.yaml')?.revision ?? '',
    }
    store.writeAll([
      {
        path: 'architecture/main.yaml',
        source: null,
        expected: store.read('architecture/main.yaml')?.revision ?? null,
      },
    ])

    // The edit was staged against something no longer there, which is what
    // `YMVS312` says at commit; saying it here is the same fact, earlier.
    expect(host.refresh(staged)).toEqual({
      applied: false,
      reason: 'staged-against-changed-documents',
      documents: ['architecture/main.yaml'],
    })
  })

  it('reports why rather than blanking the canvas when the store stops compiling', () => {
    const { store, host, frames } = openHost()
    bump(store, 'architecture/main.yaml', 'format: yarramate/v1\nid: main\n')
    const before = frames.length

    const outcome = host.refresh({})
    expect(outcome.applied).toBe(false)
    if (outcome.applied) return
    expect(outcome.reason).toBe('refused')
    if (outcome.reason !== 'refused') return
    expect(outcome.diagnostics.length).toBeGreaterThan(0)
    // No model frame: the last good one stays on screen, the same posture
    // every other failing recompile takes (#349).
    expect(frames.slice(before).filter((frame) => frame.kind === 'model')).toEqual([])
  })
})
