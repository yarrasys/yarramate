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

describe('#473 phase 2: a filter that names an instance', () => {
  // The wiring, not the arithmetic. `instanceClosureOf` is covered in
  // `projection-instances.test.ts`; what this asks is whether the HOST hands
  // the evaluator the memberships it needs. Phase 1 shipped folding with every
  // unit test green and nothing wired into the app, so the seam between them is
  // the thing worth a test of its own.
  const profile = `format: yarramate/profile/v1
id: yarrasys/api-led
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

  const pattern = `format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
        required: true
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: component
      - from: component
        kind: yarramate/core@0.1#composition
        to: interface
`

  const patterned = `format: yarramate/v1
id: main
profile: yarrasys/api-led@1.0
concepts:
  - id: sys-api
    kind: api
    name: System API
    parts:
      component: sys-component
      interface: sys-interface
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: deep-part
    kind: applicationComponent
    name: Deep part
  - id: outsider
    kind: applicationComponent
    name: Outsider
relationships:
  - id: component-holds-deep-part
    kind: composition
    from: sys-component
    to: deep-part
`

  const view = `format: yarramate/projection/v1
id: everything
version: "1.0"
query: {}
presentation:
  title: Everything
`

  const openPatternHost = () => {
    const store = memoryStore({
      'profiles/api-led.yaml': profile,
      'patterns/api-led.yaml': pattern,
      'architecture/main.yaml': patterned,
      'projections/everything.yaml': view,
    })
    const host = createLocalHost({
      store,
      workspace: {
        id: 'embedded',
        documents: ['architecture/main.yaml'],
        profiles: ['profiles/api-led.yaml'],
        projections: ['projections/everything.yaml'],
        adapterMappings: [],
        patterns: ['patterns/api-led.yaml'],
        evidence: [],
        contracts: [],
      },
    })
    const frames: VisualServerFrame[] = []
    host.open({
      frame: (frame) => frames.push(frame),
      connected: () => {},
      lost: () => {},
      session: () => ({ lastSequence: 0, closed: false }),
    })
    return { frames, send: (value: VisualBrowserInput) => host.send(value) }
  }

  it('matches the instance and everything it holds', () => {
    const { frames, send } = openPatternHost()
    const ready = frames[0]
    expect(ready?.kind).toBe('ready')

    send(input('filter.query', { query: { instances: ['sys-api'] } }))
    const result = frames.at(-1)

    expect(result?.kind).toBe('filter-result')
    if (result?.kind !== 'filter-result') return
    // Without the memberships the host now threads, this would be `['sys-api']`
    // - one subject, a canvas showing a single empty box, and no error anywhere.
    //
    // The two relationships are the other half of the point. The closure is
    // INITIALLY selected rather than expansion-added, so the edges among its
    // members survive; a view that reached the same members by expansion would
    // draw them as unconnected boxes.
    expect([...result.result.matchedIds].sort()).toEqual([
      'component-holds-deep-part',
      'deep-part',
      'sys-api',
      'sys-api-aggregation-component',
      'sys-api-component-composition-interface',
      'sys-component',
      'sys-interface',
    ])
  })

  it('resolves the closure under the nesting the canvas is drawing with', () => {
    // The ad-hoc projection a filter builds has no presentation, so without the
    // nesting travelling on the payload the closure falls back to the DEFAULT
    // and answers a different question than the canvas. On the ApertureX
    // reference that is 2 subjects where the canvas draws 15 - a wrong number
    // rather than a missing one, which is the failure mode this whole feature
    // is supposed to be against.
    const { frames, send } = openPatternHost()
    send(
      input('filter.query', {
        query: { instances: ['sys-api'] },
        // `sys-component` holds `sys-interface` through a COMPOSITION, so
        // dropping composition from the nesting shrinks the closure.
        nesting: ['assignment'],
      }),
    )
    const narrowed = frames.at(-1)
    if (narrowed?.kind !== 'filter-result') throw new Error('no filter result')

    send(
      input('filter.query', {
        query: { instances: ['sys-api'] },
        nesting: ['composition'],
      }),
    )
    const wider = frames.at(-1)
    if (wider?.kind !== 'filter-result') throw new Error('no filter result')

    // `deep-part` is reached by a COMPOSITION off a member rather than by a
    // slot, so it is the one subject whose membership of the box depends on the
    // nesting rather than on the pattern.
    expect(narrowed.result.matchedIds).not.toContain('deep-part')
    expect(wider.result.matchedIds).toContain('deep-part')
  })

  it('says the facet is why it dropped the rest', () => {
    const { frames, send } = openPatternHost()
    send(input('filter.query', { query: { instances: ['sys-api'] } }))
    const result = frames.at(-1)
    if (result?.kind !== 'filter-result') throw new Error('no filter result')

    expect(
      result.result.excluded.map(({ id, facet }) => `${id}:${facet}`),
    ).toEqual(['outsider:instances'])
  })
})

describe('#473 phase 4: the patterns a workspace declares reach the browser', () => {
  // The frame is what a palette reads. `patternOptionsOf` is arithmetic and is
  // tested on its own; what this asks is whether the HOST actually puts it on
  // the wire, which is the step three features in this programme got wrong.
  const profile = `format: yarramate/profile/v1
id: acme/api
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: Acme API
    parent: yarramate/core@0.1#grouping
  - id: special-service
    name: Special service
    parent: yarramate/core@0.1#applicationService
relationshipKinds: []
`

  const pattern = `format: yarramate/pattern/v1
id: acme-api
version: "1.0"
patterns:
  - kind: acme/api@1.0#api
    parts:
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      upstream:
        kind: yarramate/core@0.1#applicationComponent
      exposed:
        kind: yarramate/core@0.1#applicationService
        kindMatching: descendants
      pinned:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: interface
      - from: upstream
        kind: yarramate/core@0.1#serving
        to: self
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: exposed
      - from: exposed
        kind: yarramate/core@0.1#serving
        to: self
`

  const document = `format: yarramate/v1
id: main
profile: acme/api@1.0
concepts:
  - id: lone
    kind: applicationComponent
    name: Lone
relationships: []
`

  const view = `format: yarramate/projection/v1
id: everything
version: "1.0"
query: {}
presentation:
  title: Everything
`

  const readyFrame = (files: Readonly<Record<string, string>>, patterns: readonly string[]) => {
    const store = memoryStore(files)
    const host = createLocalHost({
      store,
      workspace: {
        id: 'embedded',
        documents: ['architecture/main.yaml'],
        profiles: ['profiles/api.yaml'],
        projections: ['projections/everything.yaml'],
        adapterMappings: [],
        patterns: [...patterns],
        evidence: [],
        contracts: [],
      },
    })
    const frames: VisualServerFrame[] = []
    host.open({
      frame: (frame) => frames.push(frame),
      connected: () => {},
      lost: () => {},
      session: () => ({ lastSequence: 0, closed: false }),
    })
    const ready = frames[0]
    if (ready?.kind !== 'ready') throw new Error('no ready frame')
    return ready.snapshot.model
  }

  const withPatterns = () =>
    readyFrame(
      {
        'profiles/api.yaml': profile,
        'patterns/api.yaml': pattern,
        'architecture/main.yaml': document,
        'projections/everything.yaml': view,
      },
      ['patterns/api.yaml'],
    )

  it('puts each pattern on the frame with its document', () => {
    const patterns = withPatterns().vocabulary.patterns ?? []
    expect(patterns.map(({ kind }) => kind)).toEqual(['acme/api@1.0#api'])
    expect(patterns[0]?.document).toBe('patterns/api.yaml')
    expect(patterns[0]?.label).toBe('api')
    expect(patterns[0]?.coreLabel).toBe('grouping')
    // The profile authored "Acme API"; `label` stays the local id because that
    // is what a drag payload and an operation carry.
    expect(patterns[0]?.name).toBe('Acme API')
  })

  it('resolves each slot to what it admits, and how it is wired', () => {
    expect(withPatterns().vocabulary.patterns?.[0]?.slots).toEqual([
      {
        name: 'interface',
        required: true,
        wiring: 'owned',
        admits: ['applicationInterface'],
      },
      {
        name: 'upstream',
        required: false,
        // `upstream -> self` is what the instance USES, not what it holds.
        wiring: 'context',
        admits: ['applicationComponent'],
      },
      {
        name: 'exposed',
        required: false,
        // Wired BOTH ways, and owned wins: the instance holding something out
        // is the stronger statement (ADR 0143). A fixture with no both-ways
        // slot cannot tell that precedence from its opposite.
        wiring: 'owned',
        // `kindMatching: descendants`, so the family resolves: the declared
        // kind AND the profile's subkind of it. A picker offered only the
        // declared kind would refuse a subject the compiler accepts.
        admits: ['applicationService', 'special-service'],
      },
      {
        name: 'pinned',
        required: false,
        wiring: 'unwired',
        // The SAME kind as `exposed`, declared `exact`. This is the only pair
        // that can tell the two matchings apart: on a kind with no subkinds
        // both branches give the same answer, so a fixture without it lets
        // "resolve descendants everywhere" pass unnoticed.
        admits: ['applicationService'],
      },
    ])
  })

  it('marks the kind that IS a pattern, and names it', () => {
    const kinds = withPatterns().vocabulary.conceptKinds
    const api = kinds.find(({ id }) => id === 'acme/api@1.0#api')
    expect(api?.pattern).toBe('acme/api@1.0#api')
    expect(api?.name).toBe('Acme API')
    // Every other kind carries neither, so a palette can tell them apart.
    expect(kinds.filter(({ pattern }) => pattern !== undefined)).toHaveLength(1)
  })

  it('says nothing at all where the workspace declares no patterns', () => {
    // ABSENT, not empty: an empty list claims the workspace has none, and a
    // host that never looked is a different thing (rule 2).
    const model = readyFrame(
      {
        'profiles/api.yaml': profile,
        'architecture/main.yaml': document,
        'projections/everything.yaml': view,
      },
      [],
    )
    expect(model.vocabulary.patterns).toBeUndefined()
  })
})
