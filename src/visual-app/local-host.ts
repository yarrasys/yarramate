import {
  compileWorkspaceWithProfileContext,
  type PatternMembership,
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
import type {
  VisualRenderedModel,
  VisualServerFrame,
} from '../adapters/visual/wire.js'
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
import { emitYaml } from '../yaml-emission.js'
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
   *
   * One catalogue, or the composed SET a workspace carries (#369). The
   * overlay beneath has taken the array since ADR 0129 made composition the
   * qualification point; this option was the last single-width seam between
   * a host's composed interview and the pane, and a pane evaluating fewer
   * catalogues than the host's own question surfaces is a disagreement with
   * no symptom. A single source stays source-compatible.
   */
  readonly catalogue?:
    | { readonly path: string; readonly source: string }
    | readonly { readonly path: string; readonly source: string }[]
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

/**
 * What a `refresh` did, or why it did nothing (#444).
 *
 * A result rather than a boolean, because the caller needs to tell three
 * different situations apart and act differently on each: it worked, the
 * workspace will not compile, or the reviewer has staged work against content
 * that has since moved. `setDecorations` answers with a bare boolean because
 * decorating is reading and the only failure is a not-there window; refreshing
 * can fail for reasons a host must be able to explain to a person.
 */
export type RefreshOutcome =
  | { readonly applied: true }
  | {
      /**
       * Staged operations pin content this refresh would replace. Nothing was
       * delivered and the canvas is unchanged, so the reviewer's work is
       * exactly where they left it; the named documents are what a host should
       * put in front of them.
       */
      readonly applied: false
      readonly reason: 'staged-against-changed-documents'
      readonly documents: readonly string[]
    }
  | {
      /** The store's current contents do not compile; the last good model stands. */
      readonly applied: false
      readonly reason: 'refused'
      readonly diagnostics: readonly VisualDiagnostic[]
    }

/** A local host, plus the refresh only a store-owning host can perform. */
export type LocalEditorHost = EditorHost & {
  readonly refresh: (
    stagedPins: Readonly<Record<string, string>>,
  ) => RefreshOutcome
}

export const createLocalHost = (options: LocalHostOptions): LocalEditorHost => {
  const { store, workspace } = options
  let compiled:
    | {
        readonly graph: SemanticGraph
        readonly profileContext: ResolvedProfileContext
        readonly patternMemberships?: readonly PatternMembership[]
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
   * Recompiles and rebuilds what the canvas draws. On failure it returns the
   * compiler's own diagnostics and leaves the previous model standing rather
   * than blanking the canvas under the reviewer. Returning them rather than
   * `false` is what lets the caller SAY what broke: a bare failure told the
   * reviewer nothing, and the commit path below did not even do that (#349).
   */
  const recompile = ():
    | { readonly ok: true }
    | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] } => {
    const sources = sourcesOf()
    const result = compileWorkspaceWithProfileContext(sources)
    if (!result.ok) {
      compiled = undefined
      return { ok: false, diagnostics: published(result.diagnostics, sources) }
    }
    const refreshed = {
      graph: result.graph,
      profileContext: result.profileContext,
      patternMemberships: result.patternMemberships,
    }
    compiled = refreshed
    standingDiagnostics = []
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
    return { ok: true }
  }

  /**
   * What the last recompile could not do, held for a browser that has not
   * opened yet. `open` recompiles before `deliver` exists, so a failure there
   * has nobody to tell until the editor arrives (#349).
   */
  let standingDiagnostics: readonly VisualDiagnostic[] = []
  let responses = 0
  const nextResponseId = (): string => {
    responses += 1
    return responses.toString(16).padStart(32, '0')
  }

  const diagnosticFrame = (
    diagnostics: readonly VisualDiagnostic[],
  ): VisualServerFrame => ({
    kind: 'response',
    response: {
      format: 'yarramate/visual-response/v1',
      sessionId: 'local',
      responseId: nextResponseId(),
      eventId: nextResponseId(),
      type: 'diagnostic',
      timestamp: new Date().toISOString(),
      payload: { diagnostics },
    },
  })

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
              source: emitYaml({
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
    const recompiled = recompile()
    if (recompiled.ok) {
      deliver?.frame({ kind: 'model', model, views })
      return
    }
    // Previously this emitted NOTHING: a batch that landed and left the
    // workspace uncompilable reported `ok: true` and then silence, so the
    // browser went on drawing a stale graph with no word that it was stale
    // (#349). A `diagnostic` response rather than a refusal, because the
    // commit did land - refusing it would report the opposite of what
    // happened.
    standingDiagnostics = [
      serverDiagnostic(
        'YMVS319',
        'The batch landed but left the workspace unable to compile; the last good model stays as it is',
      ),
      ...recompiled.diagnostics,
    ]
    deliver?.frame(diagnosticFrame(standingDiagnostics))
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
    /**
     * Re-reads the store and pushes the fresh model, keeping staged work
     * (#444).
     *
     * A host whose model moved underneath an open canvas - an agent writing
     * over MCP while a reviewer watches - previously had only `unmount` plus
     * `mountEditor` again, which discards everything staged. The delivery half
     * of the answer already existed: a mid-session `model` frame replaces the
     * compilation and leaves `pendingChangeset` untouched. What was missing
     * was any way to ASK for one.
     *
     * The staleness question is answered HERE rather than in the handle,
     * because a revision is opaque and only the store that minted it may
     * compare two (ADR 0100). The handle reports what is staged; this decides
     * what that means.
     *
     * Refusing rather than refreshing when staged work pins content that
     * moved is the whole point of the shape. Refreshing anyway would leave
     * operations staged against bytes nobody can see, to be refused at commit
     * by `YMVS312` - correct, but only after more work. Re-pinning them
     * silently would be worse still: it is exactly the unconditional write
     * the pins exist to prevent.
     */
    refresh: (stagedPins: Readonly<Record<string, string>>): RefreshOutcome => {
      const conflicting = Object.keys(stagedPins)
        .filter((path) => {
          const held = store.read(path)
          // Gone counts as changed: the edit was staged against something that
          // is no longer there, which is what `YMVS312` says at commit.
          if (held === undefined) return true
          return held.revision !== stagedPins[path]
        })
        .sort()
      if (conflicting.length > 0) {
        return {
          applied: false,
          reason: 'staged-against-changed-documents',
          documents: conflicting,
        }
      }
      const recompiled = recompile()
      if (!recompiled.ok) {
        // The canvas keeps the last good model, as it does everywhere else a
        // recompile fails: a host asking to refresh gets told why rather than
        // having the graph blanked under its reviewer.
        return { applied: false, reason: 'refused', diagnostics: recompiled.diagnostics }
      }
      deliver?.frame({ kind: 'model', model, views })
      return { applied: true }
    },
    open: (events: EditorHostEvents) => {
      deliver = events
      const opened = recompile()
      if (!opened.ok) standingDiagnostics = opened.diagnostics
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
      // A recompile that failed before the editor opened has had nobody to
      // tell until now (#349).
      if (standingDiagnostics.length > 0) {
        events.frame(diagnosticFrame(standingDiagnostics))
      }
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
              source: emitYaml({
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
