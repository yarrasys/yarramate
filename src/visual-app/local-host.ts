import {
  compileWorkspaceWithProfileContext,
  type ResolvedProfileContext,
  type SemanticGraph,
  type WorkspaceSource,
} from '../compiler.js'
import { planOperations } from '../apply-command.js'
import type { SourceStore, WriteOutcome } from '../source-store.js'
import type { ResolvedWorkspace } from '../workspace.js'
import { loadProjection } from '../projection.js'
import { VISUAL_PROTOCOL_VERSION } from '../adapters/visual/protocol-contract.js'
import type {
  VisualBrowserInput,
  VisualDiagnostic,
  VisualViewSummary,
} from '../adapters/visual/protocol-contract.js'
import type { VisualRenderedModel } from '../adapters/visual/wire.js'
import {
  adoptLandedViews,
  exclusionsOf,
  matchedIdsOf,
  planViewWrites,
  published,
  renderedWorkspaceOf,
  serverDiagnostic,
  viewSummaryOf,
} from '../adapters/visual/workspace-model.js'
import { stringify } from 'yaml'
import { SHIPPED_CATALOGUE } from './shipped-catalogue.js'
import type { EditorHost, EditorHostEvents } from './editor-host.js'

/**
 * The editor with no server behind it (#252).
 *
 * The session server answers three of the seven browser inputs itself, inline,
 * without ever waking an agent: a filter, a commit and a layout save are
 * questions for the ENGINE. The other four - a chat message, a choice, a
 * navigation, an end - are questions for an AGENT. This host answers the
 * engine's three over a store the embedder owns, and says plainly that it
 * cannot answer the rest.
 *
 * That split is why the issue says chat is the section a host leaves out. It is
 * not a feature withheld: with no agent there is nobody to talk to and nothing
 * to hand control back to.
 *
 * SYNCHRONOUS, per ADR 0100. An embedder whose backing store is asynchronous -
 * D1, S3 - fetches its sources, builds a store over what it fetched, and writes
 * back what `writeAll` is given. That is the shape the ADR chose over an async
 * interface, and it is the shape this host is built for.
 */
export interface LocalHostOptions {
  /** Where the sources come from and where a commit lands (ADR 0100). */
  readonly store: SourceStore
  /**
   * The manifest, already resolved. Resolving one means expanding globs
   * against a filesystem, which is the one part of the engine that cannot run
   * here - so the embedder resolves and hands over the result.
   */
  readonly workspace: ResolvedWorkspace
  /** What the editor calls this model. Cosmetic; nothing is derived from it. */
  readonly title?: string
  readonly description?: string
  /** Told after every landed commit, so a host can persist what it was given. */
  readonly onCommit?: (documents: readonly string[]) => void
  /**
   * The question catalogue the questions section evaluates, or the shipped
   * `core-enrichment` one when absent (#328).
   *
   * The engine is yarramate's and so is the UI; the QUESTIONS belong to
   * whoever adopted it. `core-enrichment` is a general modelling interview,
   * right for this repository's own CLI and for a host with no domain of its
   * own, and wrong for a product whose interview is about its own subject
   * matter. Until this existed a host could have the questions UI only by
   * also running yarramate's catalogue, so a product with its own interview
   * had to omit the section and show its questions on a separate surface,
   * away from the model they are about.
   *
   * Bytes rather than a parsed catalogue, matching what the seam beneath
   * already takes: a catalogue that does not load leaves the overlay absent
   * rather than failing the mount, because the overlay is a garnish on the
   * model and a model frame must not be blocked by it.
   */
  readonly catalogue?: { readonly path: string; readonly source: string }
  /**
   * Questions this host has already dealt with and does not want asked again
   * (#328).
   *
   * A host-supplied catalogue alone does not close this: the editor evaluates
   * the catalogue itself and cannot know that a reviewer set a question aside,
   * with a reason, recorded somewhere the editor cannot see. Without this the
   * pane would go on asking a question its own product had answered.
   *
   * `subject` absent dismisses the question wherever it appears - the
   * workspace-scoped entry and every subject's - which is "stop asking this".
   * `subject` present dismisses it for that subject alone, which is "not for
   * this one". Dismissal hides a question from the pane and changes nothing
   * about the model or about what `ask --open` reports; the interview is not
   * the editor's to settle.
   */
  readonly dismissed?: readonly {
    readonly questionId: string
    readonly subject?: string
  }[]
}

const EMPTY_MODEL: VisualRenderedModel = {
  authority: 'canonical',
  initialView: '',
  graph: { nodes: [], edges: [] },
  documents: [],
  vocabulary: { conceptKinds: [], relationshipKinds: [] },
  layouts: {},
  sourceDigests: {},
  projectionDigests: {},
}

export const createLocalHost = (options: LocalHostOptions): EditorHost => {
  const { store, workspace } = options
  let compiled:
    | {
        readonly graph: SemanticGraph
        readonly profileContext: ResolvedProfileContext
      }
    | undefined
  let model: VisualRenderedModel = EMPTY_MODEL
  const readViewSummary = (path: string): VisualViewSummary | undefined => {
    const held = store.read(path)
    if (held === undefined) return undefined
    const loaded = loadProjection({ path, source: held.source })
    // A broken saved view skips rather than failing the editor, the same way
    // the session server treats one.
    return loaded.ok ? viewSummaryOf(loaded.projection, path) : undefined
  }
  // `ResolvedWorkspace` is static, so this starts from its projections once;
  // successful view operations keep the live list current afterwards.
  let views: readonly VisualViewSummary[] = workspace.projections.flatMap(
    (path) => {
      const summary = readViewSummary(path)
      return summary === undefined ? [] : [summary]
    },
  )
  let deliver: EditorHostEvents | undefined

  /**
   * Every source the workspace resolves to, read once per compile.
   *
   * PROFILES INCLUDED. `applyOperations` reads nothing it is not handed
   * (ADR 0100) and compiles from `[...profiles, ...documents]`, so a compile
   * shown no profile is shown an empty string where one should be.
   */
  const sourcesOf = (): readonly WorkspaceSource[] =>
    [
      ...workspace.profiles,
      ...workspace.patterns,
      ...workspace.documents,
    ].flatMap((path) => {
      const held = store.read(path)
      return held === undefined ? [] : [{ path, source: held.source }]
    })

  const revisionsOf = (
    paths: readonly string[],
  ): Readonly<Record<string, string>> =>
    Object.fromEntries(
      paths.flatMap((path) => {
        const held = store.read(path)
        return held === undefined ? [] : [[path, held.revision] as const]
      }),
    )

  /**
   * Recompiles and rebuilds what the canvas draws. `false` when the workspace
   * does not compile, which leaves the previous model standing rather than
   * blanking the canvas under the reviewer.
   */
  const recompile = (): boolean => {
    const sources = sourcesOf()
    const result = compileWorkspaceWithProfileContext(sources)
    if (!result.ok) {
      compiled = undefined
      return false
    }
    const refreshed = {
      graph: result.graph,
      profileContext: result.profileContext,
    }
    compiled = refreshed
    const workspaceModel = renderedWorkspaceOf(refreshed, views, {
      authority: 'canonical',
      initialView: views[0]?.id ?? '',
      documents: workspace.documents,
      layouts: model.layouts,
      // THE STORE'S OWN REVISIONS, not a sha256 of the bytes. A revision is
      // opaque and only the store that minted it may compare two (ADR 0100),
      // which is exactly what `planOperations` does at commit time - so the
      // browser carries what the store said rather than a hash this host
      // would have to invent a crypto library to compute.
      sourceDigests: revisionsOf([
        ...workspace.profiles,
        ...workspace.patterns,
        ...workspace.documents,
      ]),
      // The manifest's resolved projections are static. Pins belong to the
      // live list so a view created or removed during this editor session is
      // represented exactly as it is in the rail.
      projectionDigests: revisionsOf(views.map(({ path }) => path)),
    }, options.catalogue ?? SHIPPED_CATALOGUE, options.dismissed)
    views = workspaceModel.views
    model = workspaceModel.model
    return true
  }

  const refuse = (
    input: VisualBrowserInput,
    diagnostics: readonly VisualDiagnostic[],
  ): void => deliver?.frame({ kind: 'rejected', refused: input.type, diagnostics })

  const noAgent = (input: VisualBrowserInput): void =>
    refuse(input, [
      serverDiagnostic(
        'YMVS316',
        `This editor has no agent behind it, so "${input.type}" cannot be answered`,
      ),
    ])

  const commit = (input: VisualBrowserInput): void => {
    if (input.type !== 'changeset.commit') return
    const { operations, viewOperations } = input.payload
    // The browser's pins are not checked here, and deliberately: the store's
    // own compare-and-swap is a stronger form of the same question, asked at
    // the moment of writing rather than a compile earlier (ADR 0100). The
    // session server checks pins because its store is a filesystem other
    // writers share; an embedder's store answers for itself.
    const planned =
      operations.length === 0
        ? null
        : planOperations(store, {
            workspace,
            operations: {
              path: 'changeset.yaml',
              source: stringify({
                format: 'yarramate/operations/v1',
                operations,
              }),
            },
            manifestDirectory: '',
          })
    if (planned !== null && !planned.ok) {
      deliver?.frame({
        kind: 'apply-result',
        result: {
          ok: false,
          diagnostics: published(planned.outcome.diagnostics, sourcesOf()),
        },
      })
      return
    }
    const viewWrites = planViewWrites(viewOperations, workspace, store)
    if (!viewWrites.ok) {
      deliver?.frame({
        kind: 'apply-result',
        result: { ok: false, diagnostics: viewWrites.diagnostics },
      })
      return
    }
    const writes = [...(planned?.writes ?? []), ...viewWrites.writes]
    // Nothing to write is not a conflict; a store asked to write nothing is
    // a store asked a question it should not have to answer.
    const written =
      writes.length === 0
        ? ({ ok: true, revisions: new Map() } satisfies WriteOutcome)
        : store.writeAll(writes)
    if (!written.ok) {
      deliver?.frame({
        kind: 'apply-result',
        result: {
          ok: false,
          diagnostics: [
            serverDiagnostic(
              'YMVS317',
              'A document changed after this batch was staged; nothing was written',
            ),
          ],
        },
      })
      return
    }
    views = adoptLandedViews(views, viewOperations, readViewSummary)
    const documents = writes.map(({ path }) => path)
    const result = planned?.outcome.ok === true ? planned.outcome.result : undefined
    deliver?.frame({
      kind: 'apply-result',
      result:
        result === undefined
          ? { ok: true, result: emptyResult(workspace.id, documents) }
          : { ok: true, result: { ...result, documents } },
    })
    options.onCommit?.(documents)
    if (recompile()) deliver?.frame({ kind: 'model', model, views })
  }

  /** What a batch that changed no subject reports. */
  const emptyResult = (id: string, documents: readonly string[]) => ({
    format: 'yarramate/apply-result/v1' as const,
    workspace: id,
    applied: {
      addedConcepts: 0,
      addedRelationships: 0,
      updatedConcepts: 0,
      updatedRelationships: 0,
      deletedConcepts: 0,
      deletedRelationships: 0,
      renamedConcepts: 0,
      renamedRelationships: 0,
      addedObservations: 0,
      updatedObservations: 0,
      deletedObservations: 0,
    },
    documents,
  })

  return {
    open: (events: EditorHostEvents) => {
      deliver = events
      recompile()
      events.connected(true)
      events.frame({
        kind: 'ready',
        snapshot: {
          protocolVersion: VISUAL_PROTOCOL_VERSION,
          sessionId: 'local',
          authority: 'canonical',
          title: options.title ?? workspace.id,
          description: options.description ?? '',
          // No agent, so no chat and no choices. The editor reads this and the
          // composer never offers to send.
          chatEnabled: false,
          capabilities: {
            chat: false,
            choices: false,
            navigation: true,
            transcript: false,
          },
          webSocketUrl: '',
          model,
          transcript: [],
          views,
          agentTurnOpen: false,
          pendingChoice: null,
          styleNonce: '',
          lastSequence: 0,
          frozen: false,
        },
      })
      return () => {
        deliver = undefined
      }
    },

    send: (input: VisualBrowserInput) => {
      switch (input.type) {
        case 'filter.query':
          // A workspace that does not compile has no graph to evaluate a
          // query against. This used to answer `matchedIds: []`, which the
          // canvas reads as "every subject failed the query" and hides the
          // whole model - a claim about the subjects, when the truth is the
          // question could not be asked at all (#307). Refuse with the
          // reason instead, the way every other unanswerable input is
          // refused, leaving whatever filter and model were standing - the
          // same keep-the-last-good-model posture `recompile` itself takes.
          if (compiled === undefined) {
            refuse(input, [
              serverDiagnostic(
                'YMVS318',
                'The workspace does not compile, so a filter cannot be evaluated; the last good model stays as it is',
              ),
            ])
            return
          }
          deliver?.frame({
            kind: 'filter-result',
            result: {
              query: input.payload.query,
              matchedIds: matchedIdsOf(
                compiled.graph,
                input.payload.query,
                compiled.profileContext,
              ),
              excluded: exclusionsOf(
                compiled.graph,
                input.payload.query,
                compiled.profileContext,
              ),
            },
          })
          return
        case 'changeset.commit':
          commit(input)
          return
        case 'layout.save': {
          const { projectionId, positions } = input.payload
          if (!views.some((view) => view.id === projectionId)) {
            deliver?.frame({
              kind: 'layout-save-result',
              result: {
                ok: false,
                message: `"${projectionId}" is not a known view id`,
              },
            })
            return
          }
          const path = `.yarramate/visual-layout/${projectionId}.yaml`
          const held = store.read(path)
          const written = store.writeAll([
            {
              path,
              source: stringify({
                format: 'yarramate/visual-layout/v1',
                projectionId,
                positions,
              }),
              expected: held?.revision ?? null,
            },
          ])
          if (!written.ok) {
            deliver?.frame({
              kind: 'layout-save-result',
              result: {
                ok: false,
                message: `Layout for "${projectionId}" changed before it could be saved`,
              },
            })
            return
          }
          model = {
            ...model,
            layouts: { ...model.layouts, [projectionId]: positions },
          }
          deliver?.frame({
            kind: 'layout-save-result',
            result: { ok: true, path },
          })
          return
        }
        case 'view.navigate':
          // Nothing to tell: navigation is the browser's own state, and the
          // session server only journals it so an agent can read where the
          // reviewer went.
          return
        case 'chat.message':
        case 'choice.selected':
        case 'session.end':
          noAgent(input)
          return
      }
    },
  }
}
