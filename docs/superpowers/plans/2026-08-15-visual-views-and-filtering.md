# Plan: Visual Views and Filtering (Plan 2 of N)

## Context

Design: `docs/superpowers/specs/2026-08-14-visual-cytoscape-native-editing-design.md` (Views/Chat/Wire-protocol-v2
sections revised this session with the concrete shapes below — same file, same approval, additive addendum).

Depends on Plan 1 (`docs/superpowers/plans/2026-08-15-visual-native-rendering-foundation.md`, PR #192, branch
`visual-native-rendering-foundation`): `CanvasGraph`/`CanvasNode`/`CanvasEdge`, `graph-projection.ts`, and the
cytoscape `GraphCanvas` component must land first. This plan branches from that branch (or from `main` once
#192 merges) — do not restart from Plan 1's starting point.

**Plan 2 scope:** a real view picker (saved `yarramate/projection/v1` documents), a structured filter panel that
composes/edits a view's 13-dimension query, Save/Save-As writing new projection files, a client-side quick-filter
text box, and threading chat's already-computed `yarramate_ask` result into the same filter-apply mechanic. All
filter evaluation happens server-side through the one real `evaluateProjection` implementation — the browser
never re-implements query matching. No editing of the model itself (drag-to-reposition, field edits, commit) —
that is Plan 3, unaffected by this plan's wire additions.

## Grounding (verified against this repo, not assumed)

- `src/projection.ts:22-51` — `ProjectionDefinition.query` has exactly 13 optional fields (`subjects`,
  `documents`, `kinds`, `layers`, `statuses`, `excludeStatuses`, `states`, `owners`, `constraints`,
  `relationshipKinds`, `kindMatching: 'exact'|'descendants'`, `relationships: 'between'|'connected'|'none'`,
  `isolatedConcepts: 'include'|'exclude'`) and `.presentation` (`title`, `description`, `layout`, `direction`,
  `seed`, `showLifecycle`, `showEvidence`, `showOwnership`). Neither is exported as a standalone named type today
  — both are inlined in `ProjectionDefinition`.
- `src/projection.ts:153` — `evaluateProjection(graph: SemanticGraph, projection: ProjectionDefinition,
  profileContext: ResolvedProfileContext): ProjectionResult` is the one real query-matching implementation.
  `ProjectionResult.subjects`/`.claims` is what "matchedIds" comes from.
- `src/ask-command.ts:385-410` (`sliceProjection`) and `:1122-1131` are the exact precedent for what this plan's
  server-side filter handler does: build a synthetic `{ format: 'yarramate/projection/v1', id, version, query,
  ... }` object inline and pass it straight to `evaluateProjection` — no on-disk projection file required for an
  ad-hoc query.
- `check-command.ts:194-201` / `ask-command.ts:1122-1131` — the existing tolerant-load-many pattern:
  `resolved.projections.flatMap(path => { const loaded = loadProjection(...); return loaded.ok ? [...] : [...]
  })`. `resolved.projections` is `ResolvedWorkspace.projections` (`src/workspace.ts:35-42`), the glob-expanded
  form of `.yarramate/workspace.yaml`'s `projections: ['projections/*.yaml']` pattern (confirmed against this
  repo's actual `.yarramate/workspace.yaml`). A new file written by Save-As that matches the existing glob and
  lives in `.yarramate/projections/` is picked up automatically on the next session start; **no
  `.yarramate/workspace.yaml` edit is needed for Save/Save-As.**
- **Correction (verified against this worktree, not assumed):** `ResolvedWorkspace` is *not* already in scope in
  `session-server.ts` — grepped, `loadWorkspaceManifest` has zero call sites there or in `session-store.ts` or
  `visual-cli.ts`, and neither `VisualServerOptions` (`session-server.ts:199-216`) nor `VisualSessionRequest`
  (`protocol-contract.ts:58-65`) carries a workspace path or `cwd` today. The session's compiled graph arrives
  pre-built (`request.initialModel.graph`) from a caller outside this codebase; nothing about workspace-on-disk
  ever reaches `startVisualServer`. Task 7 must add `readonly cwd: string` to `VisualServerOptions` and thread it
  from `visual-cli.ts`'s `runVisualStart` (`visual-cli.ts:265-282`), which already receives `cwd` but currently
  drops it before calling `startVisualServer({ request: request.value, baseDir })` — add `cwd` to that call.
  Inside `session-server.ts`, resolve the manifest at the fixed conventional path exactly like `cli.ts:153` does
  (`resolve(cwd, '.yarramate/workspace.yaml')`), `readFileSync` it, and call `loadWorkspaceManifest({ path:
  manifestPath, source }, cwd)` (same call shape as `apply-command.ts:511-514`) to get `ResolvedWorkspace`. Do
  this once at session start and hold the result in a closure variable — Task 9's slug-collision check and its
  write-path resolution both reuse it, they must not reload it. If the manifest file does not exist or fails to
  parse, degrade to `views: []` rather than failing session start (an ad-hoc/what-if session with no on-disk
  workspace is explicitly in scope per this doc's own framing — see Question 5 discussion above).
- `src/adapters/visual/wire.ts:24-56` — the actual runtime socket protocol (distinct from the JSON-schema-mirrored
  request/response types in `protocol-contract.ts`): `VisualRenderedModel { authority, initialView, graph }`,
  `VisualSessionSnapshot { protocolVersion, sessionId, authority, ..., model: VisualRenderedModel, transcript,
  ... }` sent once via `{ kind: 'ready', snapshot }` at connect (`session-server.ts:1147`), and `VisualServerFrame`
  = `'ready' | 'accepted' | 'rejected' | 'response' | 'model' | 'closing'` (`wire.ts:81-95`). `'response'` wraps
  the agent-mediated `VisualResponse` union (`chat.response`/`agent.status`/`choice.present`/`handoff.complete`).
  `'model'` is a separate top-level frame kind, not nested in `'response'`.
- `src/visual-app/state.ts:383-416` (`visualBrowserInputFor`) — browser-side intent → wire-event translation,
  switches on `intent.kind` (`'ask' | 'choice' | 'navigate' | 'end'` today). `:422-476`
  (`visualAppActionsForFrame`) — server frame → app-action translation, switches on `frame.kind`.
- `src/adapters/visual/session-server.ts:416-418` — `view.navigate` is handled today by pure pass-through
  (`{ ...envelope, type: input.type, payload: input.payload }`) into the journal; no evaluation happens.
- `src/adapters/visual/session-store.ts:55-69` (`ACTIONABLE_EVENT_TYPES`, `isActionableVisualEvent`) —
  `view.navigate` only wakes the agent when `requiresAttention` is true (browser always sends `false` per
  `state.ts:407`, so today it never does). `:751-778` — the reconcile-report's `visited`/`finalViews` tracking
  scans the journal for `view.navigate` records after the fact; this stays exactly as-is, decoupled from the new
  filtering mechanism (design doc's explicit decision — `view.navigate` keeps its current bookkeeping-only shape
  and handling; filtering is carried entirely by the new `filter.query`/`filter.result` pair).
- `schema/yarramate-projection.schema.json:19-151` — the query/presentation shapes are inlined directly under
  the document's own `properties`, not extracted into `$defs`. Two new event/response payloads need the identical
  shape (`filter.query`'s `query`, `view.save`'s `query`+`presentation`) — extracting `$defs/query` and
  `$defs/presentation` here and `$ref`-ing them from both this schema and the new event schema entries avoids a
  second hand-maintained copy of 13 typed fields.
- `schema/yarramate-visual-event.schema.json` / `schema/yarramate-visual-response.schema.json` — current v1
  event/response `oneOf` sets (read earlier this session): four browser→server event types, four server→browser
  response types, no filter/save/query-carrying payload of any kind today.

## New/changed wire shapes

Everything below is additive to the wire protocol v2 bump Plan 1 already scoped (schema `$id`s stay at `v1`,
same pre-1.0/no-external-consumers rationale the design doc already states for the graph-shape change — this is
a second field-level addition to the same in-flight version, not a new version number).

```ts
// schema/yarramate-projection.schema.json — extracted, $ref'd from both this schema's own
// properties and the new event/response payloads below.
// $defs/query   == ProjectionDefinition['query']        (13 fields, see Grounding)
// $defs/presentation == ProjectionDefinition['presentation']

// protocol-contract.ts — new types
export interface VisualViewSummary {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly query: ProjectionQuery // = ProjectionDefinition['query'], newly exported from projection.ts
  readonly presentation: ProjectionDefinition['presentation']
}

export interface VisualFilterQueryPayload {
  readonly query: ProjectionQuery
}

export interface VisualFilterResultPayload {
  readonly query: ProjectionQuery
  readonly matchedIds: readonly string[]
}

export interface VisualViewSavePayload {
  readonly id?: string // present = overwrite; absent = Save-As, server assigns an id
  readonly title: string
  readonly description: string
  readonly query: ProjectionQuery
  readonly presentation: ProjectionDefinition['presentation']
}

export type VisualViewSaveResultPayload =
  | { readonly ok: true; readonly id: string; readonly path: string }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] }

// VisualEvent gains:
//   VisualEventEnvelope<'filter.query', VisualFilterQueryPayload>
//   VisualEventEnvelope<'view.save', VisualViewSavePayload>
// VisualChatResponsePayload gains:
//   readonly appliedQuery?: VisualFilterResultPayload

// wire.ts — VisualSessionSnapshot gains:
//   readonly views: readonly VisualViewSummary[]
// VisualServerFrame gains two kinds, parallel to 'model' (both handled synchronously in
// session-server.ts, bypassing the agent poll loop — same as 'model' is today):
//   | { readonly kind: 'filter-result'; readonly result: VisualFilterResultPayload }
//   | { readonly kind: 'view-save-result'; readonly result: VisualViewSaveResultPayload }
```

Determinism/parity note: the client never evaluates a query. `filter-result`, `view-save-result`, and
`chat.response.appliedQuery` are the only three places `matchedIds` ever originates, and all three carry the
identical `{ query, matchedIds }` shape so one client-side `applyFilter` function handles all three.

## Tasks

### Task 1: `src/projection.ts` — export `ProjectionQuery` type

Add `export type ProjectionQuery = ProjectionDefinition['query']` next to the existing `ProjectionDefinition`
export. No behavior change — this just gives the protocol layer a name to import instead of retyping the 13
fields.

### Task 2: `schema/yarramate-projection.schema.json` — extract `$defs/query` and `$defs/presentation`

Move the inline `query` (lines ~19-114) and `presentation` (lines ~115-151) property definitions into
`$defs/query` and `$defs/presentation`, replace the two top-level `properties` entries with `$ref`s to them.
Byte-identical validation behavior for existing projection documents — this is a pure refactor. Run
`pnpm test test/projection.test.ts` (or the closest existing schema-validation test file for this schema) before
and after to confirm zero diagnostic changes against this repo's real 21 projection documents.

### Task 3: `schema/yarramate-visual-event.schema.json` — add `filter.query`, `view.save`

Add two new browser→server event payload `$def`s and their `oneOf` branches:
- `filter.query`: `{ query }`, `query` `$ref`s `yarramate-projection.schema.json#/$defs/query` (cross-file
  `$ref` — check how this schema already cross-references `yarramate-graph-v2.schema.json` or similar, if it
  does, for the correct `$id`-based reference form used elsewhere in `schema/`).
- `view.save`: `{ id?, title, description, query, presentation }`, `query`/`presentation` `$ref` the same two
  extracted defs.

### Task 4: `schema/yarramate-visual-response.schema.json` — add `filter.result`, `view.save.result`; extend `chat.response`

- Add `filter.result: { query, matchedIds: string[] }` and `view.save.result: { ok: true, id, path } | { ok:
  false, diagnostics }` response `$def`s and `oneOf` branches (mirror the existing diagnostic-array shape used
  elsewhere in this schema for the failure branch).
- Add optional `appliedQuery: { query, matchedIds }` to the existing `chatResponsePayload` `$def` (same shape as
  `filter.result`'s payload — reuse the `$def`, do not redeclare it).

### Task 5: `src/adapters/visual/protocol-contract.ts`

Add `VisualViewSummary`, `VisualFilterQueryPayload`, `VisualFilterResultPayload`, `VisualViewSavePayload`,
`VisualViewSaveResultPayload` per the shapes above (import `ProjectionQuery`/`ProjectionDefinition` from
`../../projection.js`). Extend the `VisualEvent` union with the two new envelope variants. Extend
`VisualChatResponsePayload` with optional `appliedQuery: VisualFilterResultPayload`. Update
`VISUAL_LIMITS`/validators in `protocol.ts` if the Ajv compilation list there enumerates event/response types
explicitly (check before assuming it auto-derives from the schema `oneOf`).

### Task 6: `src/adapters/visual/wire.ts`

Add `views: readonly VisualViewSummary[]` to `VisualSessionSnapshot`. Add the two new `VisualServerFrame` kinds
(`'filter-result'`, `'view-save-result'`) per the shapes above, parallel to the existing `'model'` kind — both
carry a payload, neither wraps `VisualResponse`.

### Task 7: `src/adapters/visual/session-server.ts` — build and send the views list

Add `readonly cwd: string` to `VisualServerOptions` (`session-server.ts:199-216`) and thread it through from
`visual-cli.ts`'s `runVisualStart` (`visual-cli.ts:265-282` already receives `cwd`, it just isn't passed to
`startVisualServer` today — add it to that call). At session-start, before the `VisualSessionSnapshot` closure
is first built (`session-server.ts:690` today), resolve the manifest exactly like `cli.ts:153` does
(`resolve(cwd, '.yarramate/workspace.yaml')`), `readFileSync` it, and call `loadWorkspaceManifest({ path:
manifestPath, source }, cwd)` (same call shape as `apply-command.ts:511-514`) to get `ResolvedWorkspace` once;
hold it in a closure variable (Task 9 reuses it — do not reload it there). If the manifest file is missing or
fails to parse, degrade to an empty `ResolvedWorkspace.projections` list rather than failing session start (an
ad-hoc/what-if session with no on-disk workspace stays valid, it just has no saved views to list). Then iterate
`resolved.projections`, `loadProjection` each, skip-and-log (not session-killing) any that fail, and build the
`views: VisualViewSummary[]` array from the survivors. Mirror `check-command.ts:194-201`'s tolerant-collect
shape, but `continue`/skip instead of failing the whole session (this is a live browser session, not a CI gate).
Wire the built `views` array into `VisualSessionSnapshot`'s new `views` field (Task 6).

### Task 8: `session-server.ts` — handle `filter.query` synchronously

Add a case alongside the existing `input.type` switch (`session-server.ts:416-419` area) that, for
`filter.query`, builds a synthetic `ProjectionDefinition` inline exactly like `ask-command.ts:392-410`'s
`sliceProjection` does (`{ format: 'yarramate/projection/v1', id: 'ad-hoc', version: '0', query: input.payload
.query }`) and calls `evaluateProjection(graph, synthetic, profileContext)`.

**`graph`/`profileContext` do not exist in this process today — Task 7 did not create them.**
`request.initialModel.graph` (`VisualRenderedModel.graph`) is a `CanvasGraph` (`graph-projection.ts`), a
browser-shaped node/edge projection already derived *from* a `SemanticGraph` by `projectGraphForCanvas` in a
separate, earlier process (`buildVisualModelGraph`, `session-store.ts:867-878`) — that `SemanticGraph` and its
`profileContext` are never passed into `startVisualServer`/`session-server.ts` and are not recoverable from the
`CanvasGraph`. `evaluateProjection` needs the `SemanticGraph`, not the `CanvasGraph`.

So this task must compile them itself, once, at session start, reusing Task 7's already-resolved
`resolvedWorkspace` (`resolvedWorkspace.profiles`, `resolvedWorkspace.documents` — both `readonly string[]`
paths): `compileWorkspaceWithProfileContext([...resolvedWorkspace.profiles, ...resolvedWorkspace.documents]
.map((path) => ({ path, source: readFileSync(resolve(cwd, path), 'utf8') })))` — the exact same call shape
`ask-command.ts:840-843` uses. Hold `{ graph, profileContext }` in the session's closure state alongside
`resolvedWorkspace` (Task 7); do not recompile per `filter.query` frame — compile once, reuse for every query
in the session. A compile failure, or an ad-hoc session with no resolved workspace (`resolvedWorkspace
.profiles`/`.documents` both empty per Task 7's degrade path), leaves no graph to filter against: respond `{
kind: 'filter-result', result: { query: input.payload.query, matchedIds: [] } }` rather than throwing — mirrors
Task 7's "gracefully degrade, never fail the whole session" precedent for workspace-less sessions.

On success, extract subject ids from `ProjectionResult.subjects` (`result.subjects.map(({ id }) => id)`) and
send `sendFrame(socket, { kind: 'filter-result', result: { query: input.payload.query, matchedIds } })`
directly — **not** through the journal/poll/agent loop (same "bypasses the agent poll loop entirely" rule the
design doc states for `changeset.commit`/`layout.save`). Still journal the raw browser event for audit
(`appendVisualEvent`), matching how every other browser input is recorded, but do not mark it actionable (leave
`ACTIONABLE_EVENT_TYPES` untouched — `filter.query`/`view.save` must not wake the agent).

### Task 9: `session-server.ts` — handle `view.save` synchronously

For `view.save`: validate the constructed `ProjectionDefinition` (`{ format: 'yarramate/projection/v1', id:
input.payload.id ?? generateId(input.payload.title), version: '1', query, presentation }`) against
`schema/yarramate-projection.schema.json` (reuse the same Ajv validator `loadProjection`/`validateProjection`
already wraps — do not hand-roll a second validation call). On success, `writeFileSync` to
`resolve(cwd, '.yarramate/projections/<id>.yaml')` (same `cwd` Task 7 threads into `VisualServerOptions` and
resolved the workspace manifest against — not `process.cwd()`) — serialize with `stringify` from the `yaml`
package (already a dependency; `apply-command.ts` already imports and uses this exact function —
YAML rendering elsewhere in this codebase, the only existing precedent for object→YAML serialization here) and
respond `{ kind: 'view-save-result', result: { ok: true, id, path } }`. On validation failure, respond `{ ok:
false, diagnostics }` without writing anything. Overwrite-vs-create is purely whether `input.payload.id` is
present — no separate code path. Generate a slug id from `title` for Save-As (`id` pattern is
`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` per `schema/yarramate-projection.schema.json`'s `$defs/id`). No slug helper
exists in this codebase today (verified) — write a small local slugify in this task; it is not a new shared
utility, just enough to turn a title into a valid id, with a numeric suffix on collision against the already-
resolved `resolved.projections` list.

### Task 10: `session-server.ts` — thread `yarramate_ask`'s result into `chat.response.appliedQuery`

Find where the agent's `yarramate_ask` MCP tool call result is currently composed into the outgoing
`chat.response` payload (agent-side response construction path). The MCP tool already returns matched subject
ids (confirmed: `yarramate ask` CLI output includes a `Slice for "..."` summary with concrete subject ids — the
MCP tool wraps the same `sliceProjection`/`evaluateProjection` call). Thread `{ query, matchedIds }` from that
result into `VisualChatResponsePayload.appliedQuery` when the agent's turn resolved a filter/focus request (vs.
a pure explain request, which sends no `appliedQuery`). This is server-side response construction only — no new
resolution engine, per the design doc.

### Task 11: `src/visual-app/state.ts` — client-side wire glue

- `visualBrowserInputFor`: add `'filter'` and `'save-view'` cases producing `{ type: 'filter.query', ...,
  payload: { query } }` and `{ type: 'view.save', ..., payload }`.
- `visualAppActionsForFrame`: add `'filter-result'` → `{ type: 'filter.applied', query, matchedIds }` and
  `'view-save-result'` → `{ type: 'view.saved', result }`. Extend the `'response'` sub-switch's `'chat.response'`
  case to also emit `{ type: 'filter.applied', ... }` when `payload.appliedQuery` is present (same action type
  as the filter-panel/view-picker path — one reducer branch handles all three producers).
- `visualAppSnapshotFrom` (or wherever `VisualSessionSnapshot` → initial app state is built): read `snapshot
  .views` into the new `views` state slice.

### Task 12: `src/visual-app/workspace-state.ts` (or wherever `VisualAppState`/reducer lives) — filter state slice

Add `activeFilter: { query: ProjectionQuery; matchedIds: readonly string[]; source: 'view' | 'panel' | 'chat' }
| null` to app state (`null` = unfiltered). Reducer case for `'filter.applied'` sets it; a `'filter.cleared'`
action (fired by "Show all", or by starting to type in the quick-filter box, or by opening the structured panel
to build a new ad-hoc query) sets it back to `null`. Quick-filter text is a **separate, independent** state
field (`quickFilterText: string`) — client-side substring narrowing layers on top of `activeFilter`, it does not
replace it or go through the server at all.

### Task 13: `src/visual-app/graph-canvas.tsx` — shared `applyFilter`

Add `applyFilter(cy: cytoscape.Core, matchedIds: readonly string[] | null, quickFilterText: string)`: compute the
visible id set as `matchedIds` intersected with the quick-filter substring match (or just the quick-filter match
alone when `matchedIds` is `null`), then `cy.elements().hide(); cy.$(visibleSelector).show()` (never dimming —
same rule Plan 1 already established for selection highlighting). Wire it from a `useEffect` keyed on
`[activeFilter, quickFilterText]` in the component that owns `GraphCanvas`.

### Task 14: New component `src/visual-app/view-picker.tsx`, plus a direction toggle

Toolbar dropdown: "All (unfiltered)" pinned first, then `state.views` by `title`. `onSelect(view)`: dispatches
both the existing `navigate` intent (`{ viewId: view.id }`, unchanged shape/purpose — bookkeeping only) and a new
`filter` intent (`{ query: view.query }`) to get real `matchedIds`. Selecting "All" dispatches `filter.cleared`
and does not fire `view.navigate` (no view was actually visited).

Plan 1 never built a layout/direction picker (`graph-canvas.tsx` hardcodes `algorithm: 'layered'`,
`elk.direction: 'DOWN'` — verified, no toolbar state for it exists in `App.tsx`/`workspace-state.ts`). Add the
minimal piece this plan actually needs: a `direction: 'top-down' | 'left-right'` toggle in `CommandStrip`
(`App.tsx:81-160`), stored in `VisualWorkspaceState`, mapped to `elk.direction: 'DOWN' | 'LEFT'` when calling
`graph-canvas.tsx`'s layout run. `presentation.layout` stays hardcoded to `'layered'` everywhere in this plan —
`radial`/`force` have no cytoscape backend wired (Plan 1 explicitly deferred them; out of scope here too). When
`onSelect(view)` applies `view.presentation.direction`, it sets this same toggle state (no round trip, per the
design doc); a view with `presentation.layout !== 'layered'` has nothing to apply and is left at the current
direction.


### Task 15: New component `src/visual-app/filter-panel.tsx`

Structured multi-select form for all 13 `ProjectionQuery` fields listed in the Grounding section. Debounced
(~300ms) `onChange` dispatches the `filter` intent with the live-composed query object. Pre-populates from
`activeFilter.query` when a view was just loaded (so picking a view and then opening the panel shows what's
applied, ready to tweak) or starts empty for a from-scratch ad-hoc query. No client-side validation beyond basic
form constraints (min/max lengths already in the schema, enum values already fixed lists). A malformed query
never reaches `evaluateProjection` in the first place — the event-level Ajv validation from Tasks 3/5 rejects it
before the server-side handler runs, so `filter-result` itself has no separate failure branch (unlike
`view-save-result`, which does). Any protocol-level rejection surfaces through the same `App.tsx` `Faults`
component (`App.tsx:162-177`, `state.diagnostics`) every other rejected browser input already uses today.

### Task 16: Quick-filter text box

Client-side only, wired into `graph-canvas.tsx`'s `applyFilter` per Task 13. Matches against `CanvasNode.name`/
`kindLabel` (id substring match too, per the design doc's "name/id substring"). No new component if the mockup's
existing quick-filter box markup is already present in `App.tsx` from the original design mockups — otherwise a
small new component. Never touches `activeFilter` or the server.

### Task 17: Save/Save-As UI

Form (title, description) plus a confirm-before-overwrite dialog when `id` is present (same new-file/overwrite
confirm affordance Plan 3 builds for Commit — if Plan 3 hasn't landed yet, build the minimal confirm dialog
here and let Plan 3 reuse it, don't duplicate). `presentation.layout` is always written as `'layered'`;
`presentation.direction` is read from Task 14's toggle state. Schema requires `seed` whenever `layout` is
present (`schema/yarramate-projection.schema.json`'s `$defs/presentation` if/then) — write a constant
`seed: 'default'`; the layered/elk algorithm is deterministic given its input, so there is no real seed to
capture yet (this is a placeholder until a later plan wires a non-deterministic layout that needs one).
Dispatches `save-view` intent. On `view.saved` with `ok: true`, show a "View saved" pill (same
precedent as the planned "Layout saved" pill) and refresh `state.views` with the new/updated entry (append if
new id, replace if overwrite — do not require a full session reconnect to see a just-saved view in the picker).
On `ok: false`, show the diagnostics verbatim (ADR 0062).

### Task 18: Chat filter pill

"Filtered by chat: `<label>` · Show all" pill, rendered whenever `activeFilter.source === 'chat'`. `<label>` is
derived from `activeFilter.query` via a small `describeQuery(query): string` helper (e.g. `"layers:
application"`, `"connected to Checkout Service"`) — reuse this same helper for the structured filter panel's own
summary text if one is needed there, don't build two label-renderers for the same 13-field shape. "Show all"
dispatches `filter.cleared`.

### Task 19: Tests

- `test/projection.test.ts` (or wherever `evaluateProjection`/`loadProjection` are already tested) — no new
  tests needed for the extracted `$defs` refactor beyond re-running existing coverage (Task 2's note); add one
  new test asserting `filter.query`'s synthetic-`ProjectionDefinition` construction pattern produces identical
  `ProjectionResult.subjects` to an equivalent on-disk projection file for the same query.
- `test/visual-session-server.test.ts` (or equivalent) — new cases: session-start views list building (skip
  invalid, survivors correct), `filter.query` → `filter-result` round trip against this repo's real compiled
  workspace, `view.save` create + overwrite + validation-failure paths (assert the file actually lands / doesn't
  land on disk in a temp workspace fixture), `filter.query`/`view.save` never journaled as actionable (agent
  poll loop untouched).
- `test/visual-protocol.test.ts` — schema validation round-trips for the four new payload shapes (`filter.query`,
  `filter.result`, `view.save`, `view.save.result`) plus `chat.response` with `appliedQuery` present/absent.
- `test/visual-workspace-state.test.ts` / `test/visual-app-state.test.ts` — reducer coverage for
  `filter.applied`/`filter.cleared`/`view.saved`, and that quick-filter text and `activeFilter` compose correctly
  (both narrow; clearing one doesn't clear the other).
- `test/visual-app-render.test.ts` — extend the existing whole-`App` render coverage (mocks `useVisualSession`,
  renders via `renderToStaticMarkup`; no separate per-component test files exist in this repo today, e.g. there
  is no `graph-canvas.test.ts`) with cases for the view picker, filter panel, quick-filter box, and Save/Save-As
  form: each of the 13 query fields round-trips through its own change handler into the dispatched `filter`
  intent payload.

### Task 20: Audit remaining visual tests / docs

`grep` `test/visual-cli.test.ts`, `test/visual-journey.test.ts` for any hard-coded assumption that
`view.navigate` is a pure no-op (Task 8 doesn't change `view.navigate`'s own handling, but confirm no test
asserts "the agent is never told about filtering" in a way that's now stale once `filter.query` exists as a
sibling event). Update `docs/superpowers/plans/2026-08-15-visual-native-rendering-foundation.md`'s own
"Non-goals" section if useful cross-referencing — optional, not required for this plan to ship.

## Testing

- `pnpm typecheck` — both `tsc --noEmit` and `tsc -p tsconfig.visual.json` clean.
- `pnpm test` — full suite green, including every new/updated test in Task 19.
- `pnpm build:visual` — bundle still builds; watch for the same chunk-size warning Plan 1 already flagged as
  pre-existing/non-blocking, don't newly regress it further without checking.
- Live smoke test (same pattern Plan 1's report used): start a real session against this repo's own
  `.yarramate/workspace.yaml`, confirm the view picker lists this repo's real 21 projections, select one, confirm
  the canvas actually narrows to real matched node ids (not just that a request was sent), type in the
  quick-filter box, open the structured panel and toggle one dimension, Save As a new view and confirm the file
  lands under `.yarramate/projections/` and reappears in the picker without a reconnect, ask chat something that
  should resolve to a filter and confirm the pill appears with real matched ids.

## Non-goals (explicitly deferred to later plans)

- Editing the model itself: drag-to-reposition, field edits, `yarramate apply` wiring, undo stack, Commit button,
  layout persistence (`layout.save`) — Plan 3, separately scoped, this plan's `view.save` writes a *projection*
  document, never a model/graph document.
- ArchiMate-style notation toggle, status/evidence/ownership badges — separately scoped design sections, not
  touched by this plan's wire additions.
- Any change to `src/adapters/likec4-cli.ts`/`likec4-export.ts`/`likec4-project.ts`/`likec4-prepare.ts` or the
  `yarramate export --kind likec4` feature (same exclusion Plan 1 already states).
- Multi-tab/concurrent Save-As conflict resolution (two browsers Save-As to the same generated id) — not raised;
  single-writer working-tree model assumed, same as Plan 1.
- Renaming/deleting saved views — Save/Save-As only; delete-a-view is a plausible Plan 3+/later addition, out of
  scope here.
