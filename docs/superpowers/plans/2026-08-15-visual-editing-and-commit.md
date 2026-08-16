# Plan: Visual Editing and Commit (Plan 3 of N)

## Context

Design: `docs/superpowers/specs/2026-08-14-visual-cytoscape-native-editing-design.md` — the **Editing**,
**Commit**, **Layout persistence**, and **Wire protocol v2** sections (lines 83-145). Approved as-is; the three
plan-level decisions below are flagged separately because they are additions the design's tables do not spell out.

Plans 1 and 2 are **landed on `main`** (`dd3e718`, fast-forwarded; `tsc` clean on both configs, 55 files /
853 tests passing). Their surface — `CanvasGraph`/`CanvasNode`/`CanvasEdge` (`src/graph-projection.ts`),
`GraphCanvas` (`src/visual-app/graph-canvas.tsx`), the view picker, structured filter panel, quick filter,
Save/Save-As, direction toggle, `filter.query`/`filter.result`, `view.save`/`view.save.result` — is the
starting point. Do not restart from Plan 1.

**Plan 3 scope:** browser-authored *mechanical* model editing (dropdown-constrained fields, full field
coverage), a client-side changeset committed as one atomic `yarramate/operations/v1` batch through an extracted
programmatic `applyOperations` core, per-projection drag-position persistence, and the removal of the ad-hoc
(non-canonical) rendering path. No `git commit` is ever run: a commit lands as an ordinary uncommitted
working-tree diff, so "revert" is `git revert`/`git checkout` through normal Git flow (design lines 92-93) —
there is no in-app undo stack in this plan.

## Grounding (verified against this repo, not assumed)

- `src/apply-command.ts:478-844` — `runApplyCommand(options, cwd): CliResult` is CLI-shaped: argv parse
  (`:482-492`), `readFileSync` of manifest + operations (`:495`, `:518`), then the real work (`:511-808`), then
  output formatting (`:812-839`). The success payload it already builds (`:815-826`) is exactly
  `yarramate/apply-result/v1`: `{ format, workspace, applied: counts, documents: touched }`. The atomic gate is
  `compileWorkspace` over the candidate sources at `:795-804`; writes happen only after it passes (`:806-808`).
- `schema/yarramate-apply-result.schema.json` — `required: [format, workspace, applied, documents]`; `applied`
  requires all six counters. The extracted core can return this document verbatim.
- `schema/yarramate-operations.schema.json` — **every** operation variant requires `document`
  (`$defs/operation.oneOf[*].required: [op, document, …]`), addressed by *manifest path*
  (`apply-command.ts:531-533` maps `resolve(cwd, path)` → the manifest-relative path, and rejects anything not
  in the manifest). `conceptFields` has exactly the 13 fields; `relationshipFields` exactly 10 (plus `status`).
  Constrained enums: `status: planned|current|retired`, `mode: read|write|read-write|unspecified`. `kind`,
  `from`, `to`, `id` are `nonEmptyText`.
- `src/graph-projection.ts` — `CanvasNode` carries 15 fields, `CanvasEdge` 11, and **no document path**
  (`grep document src/graph-projection.ts` → no match). `kindLabelOf` (`:91`) strips the profile prefix;
  `kindLabel` is the local id the YAML documents actually author (`:169`, `:226`).
- `src/compiler.ts:165-180` — `GraphSource` carries `{ document, path, pointer, line, column }` and every
  `GraphClaim` carries one. `path` is the manifest-relative document path (session-server passes
  `resolvedWorkspace.documents` entries straight through as `path` at `session-server.ts:602-604`), i.e. exactly
  the value an operation's `document` field needs.
- **Three real projection lossiness gaps** (verified against `schema/yarramate-operations.schema.json` `$defs`,
  not assumed — `presentIn`/`aka`/`distinctFrom`/`supersedes` are plain `nonEmptyText[]` in the operations schema
  too, so they are **not** gaps; do not "fix" them):
  1. `constraints` — operations want `constraintReference` `{ id, ref, expects?: { provider, key, value } }`.
     The projection emits `{ ref, expects: string | null }` with `expects` flattened to the compiler's
     `"provider key value"` encoding (`compiler.ts:1642-1648`) and **no `id`**.
  2. `attestations` — operations want `{ topic, by, on, recordedBy? }`. The projection emits `{ topic, value }`
     where `value` is the packed encoding (`compiler.ts:267-297`). `parseAttestationClaimValue`
     (`compiler.ts:288`) already decodes it and is exported.
  3. `references` — operations want `identifiedReference` `{ id, ref }`. The projection emits refs without the
     authored `id` (recoverable from the claim id, `compiler.ts:1668-1673`: `${subject}~reference-${id}`).
  - For `expects`, `reconciliation.ts:176-201`'s private `parseExpectation` already owns a regex mirroring the
    compiler's encoding. Do not add a third copy.
- `src/adapters/visual/session-server.ts` — `resolvedWorkspace` (`:541-554`) and `compiledWorkspace`
  (`:594-613`) are `const`, computed once at session start, both `| undefined` with **silent degradation** on a
  missing/unreadable manifest. `rendered` (`:526-530`) is built from `request.initialModel` because the caller
  pre-compiled it (`buildVisualModelGraph`, `session-store.ts:867`). `filterMatchedIds` (`:615-623`) reads
  `compiledWorkspace`. `admitBrowserInput` (`:1015`) journals via `appendVisualEvent` (`:1134`) then switches on
  `input.type`; `filter.query` answers with a `filter-result` frame (`:1156`), `view.save` with
  `view-save-result` (`:1188`, `:1198`), and only actionable events get `accepted` (`:1204`). `sendFrame`
  (`:884`) / `broadcast` (`:888`) exist.
- `src/adapters/visual/wire.ts:28-32` — `VisualRenderedModel` is `{ authority, initialView, graph }`. The
  `{ kind: 'model', model }` frame kind exists (`:99`) but is **never broadcast anywhere today** (`grep "kind:
  'model'" src/adapters/visual/session-server.ts` → no match): Plan 1 deleted `model.replace`. Design line 137's
  `model.snapshot` therefore needs no new frame kind — it needs this existing kind wired up, plus the layout
  field below. The client reducer case `model.replaced` already exists (`state.ts:210`).
- `schema/yarramate-visual-response.schema.json` — `type` enum is `[chat.response, agent.status,
  choice.present, handoff.complete, diagnostic, filter.result, view.save.result]`. Plan 2's precedent is that a
  synchronous browser-facing result is **both** a response `$def`/enum member **and** a `VisualServerFrame`
  kind; follow it (do not make the new results frame-only).
- **Ad-hoc authority removal surface** (design line 89) is exactly 6 source sites plus schemas and 8 test files:
  `protocol-contract.ts:25` (`VisualAuthority = 'canonical' | 'ad-hoc'`), `session-store.ts:290`,
  `protocol.ts:198-204` (the "ad-hoc must not claim canonical digests" rule),
  `state.ts:160` (initial state) and `:203-204` (`visualAuthorityLabel`), `App.tsx:132-133` (the badge),
  `schema/yarramate-visual-model.schema.json:60,77`. **Not in scope and not to be touched:** the unrelated
  ad-hoc *projection literal* (`session-server.ts:619` `id: 'ad-hoc'`), `filter-panel.tsx:228`'s comment, and
  ADR 0041 — different concept, same words.
- `layout.save`/saved positions do not exist anywhere yet (`grep -rn "layout.save\|positions" src schema` → no
  hits). Fully greenfield.

## New/changed wire shapes

Additive to the same v1 `$id`s (same pre-1.0/no-external-consumers rationale Plans 1-2 already recorded).

Browser → server (new events, both handled **synchronously**, bypassing the agent poll loop — design line 144):

| Event | Payload |
|---|---|
| `changeset.commit` | `{ operations: readonly YarramateOperation[] }` — the only mutation entrypoint |
| `layout.save` | `{ projectionId: string, positions: Readonly<Record<string, { x: number; y: number }>> }` |

Server → browser (new results, each a response `$def` + enum member **and** a `VisualServerFrame` kind):

| Response | Payload |
|---|---|
| `apply.result` | `{ ok: true, result: YarramateApplyResult } \| { ok: false, diagnostics: Diagnostic[] }` |
| `layout.save.result` | `{ ok: true, path: string } \| { ok: false, message: string }` |

`VisualRenderedModel` gains three fields (all required, all derived server-side):

```ts
readonly documents: readonly string[]          // manifest document paths — the add-concept target dropdown
readonly vocabulary: {
  readonly conceptKinds:      ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly relationshipKinds: ReadonlyArray<{ readonly id: string; readonly label: string }>
}
readonly layouts: Readonly<Record<string, Readonly<Record<string, { x: number; y: number }>>>>
```

`CanvasNode` and `CanvasEdge` each gain `readonly document: string`.

## Plan-level decisions (flag before implementing)

1. **`layouts` carries every saved sidecar, not just the active projection's.** Design line 137 says "saved
   layout for the active projection", but a view switch is entirely client-side (Plan 2's `filter.query` returns
   `matchedIds` only, no re-render), so a per-active-projection payload would need a `layout.load` round-trip the
   design does not have. One `{x,y}` pair per positioned node per projection is far smaller than the graph the
   snapshot already carries, and keeps view switching instant.
2. **`layout.save.result` exists.** The design's server→browser table omits it, but the browser must not claim
   "Layout saved" optimistically (ADR 0062's rule, and the same reason `view.save.result` exists). Mirrors
   `view.save.result` exactly.
3. **A session with no resolvable workspace manifest now fails to start** instead of degrading to
   "no views, no filtering" (`session-server.ts:541-554`, `:594-613`). With editing, silent degradation would
   mean a Commit button over nothing. This is the honest consequence of design line 89 removing ad-hoc mode.
   Use `YMVS132` — the 1xx band runs YMVS101-131 with gaps at 114 and 117-120 (verified:
   `grep -rhn "YMVS[0-9]*" src/adapters/visual/`); take the next contiguous code rather than backfilling a gap.

## Tasks

### Task 1: `src/graph-projection.ts` — carry each subject's document path

Add `readonly document: string` to `CanvasNode` (`:9-31`) and `CanvasEdge` (`:33-45`). Populate it in
`projectConcept` and `projectRelationship` from the subject's kind claim's `source.path`
(`CONCEPT_KIND_PREDICATE` at `:52`; the relationship kind claim for edges) — the one claim guaranteed to exist
for every subject. A subject whose kind claim is somehow absent is a compiler invariant violation, not a
projection concern: throw rather than emit an empty string.

Acceptance: an existing `test/graph-projection.test.ts` fixture asserts `document` equals the fixture's
authored path, and the value round-trips — a `document` read off a `CanvasNode` is accepted verbatim by
`applyOperations` (asserted in Task 20, not here).

### Task 2: `src/compiler.ts` — export one `expects` decoder, and make `reconciliation.ts` use it

Beside `parseAttestationClaimValue` (`:288`), add
`export const parseConstraintExpectsValue = (value: string): { provider, key, value } | undefined` using the
same `/^(\S+) (\S+) ([\s\S]+)$/` rule that `reconciliation.ts:185` already applies, with the comment explaining
why the first two spaces delimit (`compiler.ts:270-272`'s reasoning). Rewrite
`reconciliation.ts:176-201`'s `parseExpectation` to call it instead of running its own regex — the encoding
gets exactly one authority, in the module that writes it.

Acceptance: `test/reconciliation.test.ts` and `test/compiler.test.ts` pass unchanged; a value containing spaces
still parses (existing coverage).

### Task 3: `src/graph-projection.ts` — close the three structured-array gaps

Per the Grounding section's enumeration, so an editable form can round-trip these fields:
- `constraints`: emit `{ id, ref, expects: { provider, key, value } | null }`. `id` comes from the constraint
  claim id's `~constraint-<id>` suffix (`compiler.ts:1624-1627`); `expects` via Task 2's decoder.
- `attestations`: emit `{ topic, by, on, recordedBy }` via `parseAttestationClaimValue`, replacing the packed
  `value`.
- `references`: emit `{ id, ref }`, `id` from the claim id's `~reference-<id>` suffix
  (`compiler.ts:1668-1673`).

Keep `presentIn`/`aka`/`distinctFrom`/`supersedes` as plain string arrays — the operations schema wants strings.
Update `schema/yarramate-graph-v2.schema.json`'s canvas-shape definitions if they pin these item shapes
(`grep constraints schema/yarramate-graph-v2.schema.json` first).

Acceptance: projecting this repo's own workspace yields, for a concept with a constraint carrying an
expectation, an object whose `expects` re-encodes to the original claim value; snapshot/round-trip test in
`test/graph-projection.test.ts`.

### Task 4: `src/apply-command.ts` — extract the programmatic `applyOperations` core

```ts
export type ApplyOutcome =
  | { readonly ok: true;  readonly result: YarramateApplyResult }   // yarramate/apply-result/v1, verbatim
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export const applyOperations = (
  operations: { readonly path: string; readonly source: string },
  workspace:  { readonly path: string; readonly source: string },
  cwd: string,
): ApplyOutcome
```

Takes *sources*, not a parsed array, so `loadSourceDocument` + `locateSourcePath` keep producing diagnostics
that point at `/operations/<i>/<field>` — that pointer is what Task 18 maps back onto a changeset row. The core
is `:494-808` with `failed()` returning `{ ok: false, diagnostics }` and success returning the
`yarramate/apply-result/v1` object currently built at `:815-826`. `runApplyCommand` keeps argv parsing
(`:482-492`), the manifest-format precheck (`:496-505`), `readFileSync` for both paths, the `--json` vs human
formatting (`:812-839`), and the `catch` (`:840-843`). No shell-out, no temp files, no `process.cwd()`, no
module-level mutable state (`validateOperations` is a stateless Ajv validator — safe to reuse across calls).

Acceptance: `test/apply-command.test.ts` unchanged and green (the CLI contract must not shift by one byte);
new unit tests in Task 20 call `applyOperations` directly with in-memory sources.

### Task 5: `schema/yarramate-visual-layout.schema.json` — new sidecar document schema

`yarramate/visual-layout/v1`: `{ format, projectionId, positions }`, `positions` an object whose
`propertyNames` are subject ids and whose values are `{ x: number, y: number }` (`additionalProperties: false`,
both required). Register it wherever the other schemas are registered for the core contract (`grep -rn
"yarramate-projection.schema.json" src/ package.json` for the pattern) and export it from `package.json`
`exports` like every other machine format.

Adapter-owned presentation state (ADR 0023): never validated by Core, never routed through `apply`.

### Task 6: `schema/yarramate-visual-event.schema.json` — add `changeset.commit`, `layout.save`

Two new `$defs` payloads + `oneOf` branches + `eventId`/`type` enum entries (`:27-41` is the enum;
`:50-113` the branches). `changeset.commit.operations` `$ref`s
`yarramate-operations.schema.json#/$defs/operation` (cross-file `$ref` precedent: Plan 2 Task 3 did this for
`projection#/$defs/query`), `minItems: 1` — an empty changeset is a client bug, not a valid commit.
`layout.save` payload matches Task 5's `projectionId`/`positions`.

### Task 7: `schema/yarramate-visual-response.schema.json` — add `apply.result`, `layout.save.result`

Two `$defs` + `oneOf` branches + `type` enum members, following `viewSaveResultPayload`'s existing
ok/diagnostics union shape. `apply.result`'s success arm `$ref`s
`yarramate-apply-result.schema.json` (whole document, `format` included) rather than restating its shape.

### Task 8: `schema/yarramate-visual-model.schema.json` + session-request — model shape, minus ad-hoc

- Add `documents`, `vocabulary`, `layouts` per the wire-shapes section; all three `required`.
- Delete the `ad-hoc` enum member (`:77`) and the `oneOf` branch pairing it with empty `sourceDigests` (`:60`).
  `authority` becomes `{ "const": "canonical" }`; keep the field (the browser badge and every existing
  document keep validating) rather than deleting it.
- Verify `schema/yarramate-visual-session-request.schema.json` picks both up through its `$ref` and needs no
  separate edit.

### Task 9: `src/adapters/visual/protocol-contract.ts` — new payload types

`VisualChangesetCommitPayload`, `VisualLayoutSavePayload`, `VisualLayoutPositions`,
`VisualApplyResultPayload`, `VisualLayoutSaveResultPayload`, and `VisualKindOption`. Import
`YarramateOperation`/`YarramateApplyResult` from the operations/apply modules rather than restating them
(same discipline as Plan 2 importing `ProjectionQuery`). Narrow `VisualAuthority` (`:25`) to `'canonical'`.
Extend the `VisualBrowserInput` union (`:72-93`) with the two new event types.

### Task 10: `src/adapters/visual/wire.ts` — rendered-model fields and two frame kinds

Add `documents`, `vocabulary`, `layouts` to `VisualRenderedModel` (`:28-32`). Add
`{ kind: 'apply-result'; result: VisualApplyResultPayload }` and
`{ kind: 'layout-save-result'; result: VisualLayoutSaveResultPayload }` to `VisualServerFrame` (`:87-102`),
parallel to `'view-save-result'`. Type-only module — keep it free of Node imports.

### Task 11: Remove the ad-hoc authority path; fail fast without a workspace

- `protocol.ts:198-204`: delete the ad-hoc/digest rule (a canonical model always carries digests).
- `session-store.ts:290`: drop the `'ad-hoc'` alternative.
- `state.ts:160`: initial `authority: 'canonical'`; `:203-204`: `visualAuthorityLabel` collapses to the single
  canonical label — if it now has one caller and one branch, inline it at `App.tsx:132-133` and delete the
  helper rather than leaving a one-armed function.
- `session-server.ts:541-554`: on unresolvable manifest, refuse the session with `YMVS132` (see Decision 3)
  instead of returning `undefined`; `resolvedWorkspace` becomes non-optional and `:594-613`'s
  `compiledWorkspace`/`:615-623`'s degrade-to-empty branch go away with it.
- Update the 8 test files that reference ad-hoc authority (`grep -rln "ad-hoc" test/`) — delete the ad-hoc
  cases outright, do not convert them into skipped tests. Leave `session-server.ts:619`'s `id: 'ad-hoc'`
  projection literal, `filter-panel.tsx:228`, and ADR 0041 untouched.

Acceptance: `pnpm test` green with no `ad-hoc` authority references left in `src/` or `schema/`
(`grep -rn "'ad-hoc'" src schema` → only the projection literal).

### Task 12: `session-server.ts` — recompile and broadcast after a write

- Turn `compiledWorkspace` (`:594-613`) and `rendered` (`:526-530`) into `let`, and extract the compile block
  into `recompileWorkspace(): boolean` that re-reads `[...profiles, ...documents]` from disk, reassigns
  `compiledWorkspace`, rebuilds the `CanvasGraph` via `projectGraphForCanvas`, reassigns `rendered`
  (carrying forward `authority`/`initialView`/`documents`/`vocabulary`/`layouts`), and returns whether it
  compiled. Reuse it for the initial computation — one code path, not two.
- Build `documents` from `resolvedWorkspace.documents` and `vocabulary` from the compiled
  `ResolvedProfileContext`'s `conceptKindLineages`/`relationshipKindLineages` keys, labelled with
  `graph-projection.ts:91`'s `kindLabelOf` (export it).
- After a successful commit (Task 13), `broadcast({ kind: 'model', model: rendered })`. A post-write compile
  failure is a bug, not a user error: journal a `diagnostic` response and freeze rather than silently serving a
  stale graph (`frozen` already exists at `:630`).

### Task 13: `session-server.ts` — handle `changeset.commit` synchronously

In `admitBrowserInput`'s switch, after journaling: serialise the payload to an in-memory operations document
(`stringify({ format: 'yarramate/operations/v1', operations: input.payload.operations })` with a synthetic path
like `changeset.yaml`, so diagnostics point at `/operations/<i>/…`), call `applyOperations` with the manifest
path/source the session already resolved, then send `{ kind: 'apply-result', result }`. On success, call
Task 12's `recompileWorkspace()` and broadcast the model frame; on failure, write nothing and forward the
diagnostics verbatim (ADR 0062 — the browser shows exactly what landed). Do **not** run `git commit`, and do
not mark the event actionable (no `accepted` frame, no agent wake — same treatment as `filter.query`).

Acceptance: covered by Task 20's protocol test (commit → `apply-result` + `model` frames, working tree shows
exactly the expected file diff, `git log` unchanged).

### Task 14: `session-server.ts` — handle `layout.save`; load sidecars at session start

- At session start, read every `.yarramate/visual-layout/*.yaml` under `options.cwd`, validate against Task 5's
  schema, and build `rendered.layouts` keyed by `projectionId`. An invalid or unreadable sidecar is skipped
  (same tolerance as `views` at `:556-583`) — presentation state must never fail a session.
- On `layout.save`: validate the payload, `writeFileSync` to
  `.yarramate/visual-layout/<projectionId>.yaml` (`mkdirSync` the directory, matching `:1193`'s pattern for
  projections), update the in-memory `layouts` entry, and answer `{ kind: 'layout-save-result', result }`.
  Reject a `projectionId` that is not a known view id — a sidecar for a nonexistent projection is unreachable
  state. Never routed through `apply`, never `git commit`ed.

### Task 15: `src/visual-app/state.ts` — changeset slice and model-snapshot merge

- `VisualAppState` gains `pendingChangeset: { operations: readonly YarramateOperation[] }`,
  `commitStatus: 'idle' | 'committing'`, `commitDiagnostics: readonly Diagnostic[] | null`,
  `layoutNotice: string | null`.
- `visualBrowserInputFor`: add `'commit-changeset'` and `'save-layout'` cases.
- New actions: `changeset.staged` (append/replace-by-target — staging a second edit to the same
  field of the same subject must replace the first, not queue two `update-concept`s),
  `changeset.discarded` (one row, by index), `changeset.cleared`, `changeset.committed` (clears the changeset,
  clears diagnostics), `apply.failed` (holds diagnostics, **keeps** the changeset so the user can fix the
  offending row and retry — design line 165's explicit rule), `layout.saved`.
- Extend the existing `model.replaced` case (`:210`): a mid-session model frame must preserve
  `activeView`, `activeFilter`, `quickFilterText`, and `selectedId` (dropping `selectedId` only if that subject
  no longer exists in the new graph). Today it is only ever hit at session start, so it currently resets them.

### Task 16: Concept inspector → editable form (all 13 fields)

Replace `SelectedSubjectInspector`'s read-only rows (`App.tsx:394-445` region) with dropdown-constrained
controls: `<select>` for `kind` (from `model.vocabulary.conceptKinds`, labelled by `label`, written as `label`)
and `status` (`planned|current|retired`); text inputs for `name`/`description`/`owner`; repeatable-row controls
for `aka`, `distinctFrom`, `supersedes` (plain strings), `presentIn` (plain strings), `references`
(`{ id, ref }`), `constraints` (`{ id, ref, expects? }` — `expects` a 3-field sub-row), `attestations`
(`{ topic, by, on, recordedBy? }`). `id` is displayed read-only: renaming an id is a
`supersedes`/rename concern, not a field edit, and is out of scope here.

Each committed field change dispatches `changeset.staged` with an `update-concept` op carrying **only** the
changed fields plus `document` (from Task 1) and `concept.id`. Scalars replace, lists append (ADR 0057) — so
list *removal* must emit the `remove` retraction form, not a shortened list. Every staged row is visibly
attributed in the tray (Task 18) before anything is sent.

### Task 17: Relationship inspector → editable form (all 10 fields) + endpoint reconnect

Same pattern for edges: `<select>` for `kind` (`vocabulary.relationshipKinds`), `mode`
(`read|write|read-write|unspecified`), `status`; text for `name`/`description`/`content`; repeatable rows for
`references`/`presentIn`. `from`/`to` are `<select>`s over the current graph's node ids (design line 87 —
`update-relationship` already permits replacing them, no schema change). Dragging an endpoint on canvas is
**not** in this task; the dropdown is the mechanism.

### Task 18: Changeset tray, Commit button, diagnostics mapping

Panel listing every pending operation as one human row (`update-concept · Checkout Service · name`), each with
a discard control. **Commit changes** dispatches `commit-changeset`; the button is disabled while
`commitStatus === 'committing'` and when the changeset is empty. On `apply-result` failure, render each
diagnostic against the row its pointer names (`/operations/<i>/…` → row `i`), leaving the changeset intact so
the user corrects and retries; on success show a "Committed · N files" notice naming
`result.documents`, exactly the list the server reported. Never render an optimistic local guess.

### Task 19: Drag-end → debounced `layout.save`; pin saved positions

- `graph-canvas.tsx` already has `cy.on('tap')` handlers; add `cy.on('dragfree', 'node')` (fires once per
  drag, unlike `position`), debounce ~500ms, and dispatch `save-layout` with the **full** current position map
  for the active projection (a whole-sidecar write, matching Task 5's document shape — not a partial patch).
  Fires independently of the changeset (design line 114).
- After each layout run completes, override positions for nodes present in `layouts[activeViewId]`
  (`node.position(saved)`) — sidecar-listed nodes stay pinned, absent nodes keep the auto-layout result
  (design line 113). This runs *after* layout, so no ELK configuration changes: do not try to pin via
  `elk` options.
- Show the "Layout saved" pill from `layoutNotice`, on `layout-save-result` only.

### Task 20: Tests

- `test/apply-command.test.ts` — unchanged, proving the CLI contract held through Task 4's extraction.
- New `test/apply-operations.test.ts` — `applyOperations` called directly with in-memory sources: success
  counts/documents, a schema-invalid operation, an operation aimed at a non-manifest document, a
  compile-failing batch writing **nothing**, and two sequential calls in one process with different workspaces
  (no state bleed).
- `test/graph-projection.test.ts` — `document` on nodes/edges; the three structured-array shapes; an
  `expects`/`attestation` re-encode round-trip.
- `test/visual-protocol.test.ts` — `changeset.commit`/`layout.save` accept valid and reject invalid payloads
  (empty `operations`, unknown fields); `apply.result`/`layout.save.result` both arms.
- `test/visual-session-server.test.ts` — commit → `apply-result` + `model` frames, file written, **no git
  commit**; a failing commit writes nothing and returns diagnostics; `layout.save` round-trips to disk and into
  a subsequent session's `layouts`; `layout.save` for an unknown `projectionId` is rejected; a session with no
  manifest refuses to start (Task 11).
- `test/visual-app-state.test.ts` — staging replaces a same-field edit, discard by index, `apply.failed` keeps
  the changeset, `model.replaced` preserves view/filter/selection.
- Reuse existing fixtures; assert state and payloads, not snapshots (matching the suite's convention).

### Task 21: Docs, ADRs, and the architecture model

- `docs/VISUAL-ADAPTER.md` — the two new events, two new results, the layout sidecar, ad-hoc removal.
- `skills/yarramate-architecture/references/visual-conversations.md` — the canonical sequence gains the
  synchronous commit path and states that chat can no longer author a mutation.
- New ADR: browser-authored mechanical edits land through `apply`, never through the chat agent, and never
  `git commit` — superseding ADR 0081's "a diagram drawn in the browser never becomes canonical" clause
  explicitly (cite it, record what changed and why: a mechanical operation batch is not an inferred model).
- New ADR or an addendum to ADR 0023: the visual-layout sidecar is adapter-owned, git-committed presentation
  state, deliberately outside `.yarramate-out/` (ADR 0027).
- `.yarramate/architecture/{engine,repository,product}.yaml` — all three already model visual-adapter concepts
  (verified), so the new commit/layout surface belongs there. Edit them with `yarramate apply` through a
  changeset — this repo's own model is the first real consumer of the feature being built, and dogfooding it
  is the cheapest end-to-end proof. `yarramate check` must stay clean afterwards.

## Testing

- `pnpm typecheck` — `tsc --noEmit` and `tsc -p tsconfig.visual.json` both clean.
- `pnpm test` — full suite green including every new/updated test in Task 20.
- `pnpm build:node && pnpm build:visual` — both bundles build.
- Live browser verification against this repo's own 289-node `yarradev-ai` workspace (the model Plans 1-2 were
  verified against): commit a rename through the inspector, confirm `git diff` shows exactly the expected
  one-file change and `git log` is unchanged, reload the session and confirm the rename reproduces; drag a node,
  confirm the sidecar file appears, reload and confirm the position reproduces; stage an invalid edit and
  confirm the diagnostic lands on the right changeset row with no file written.

## Non-goals (explicitly deferred)

- ArchiMate notation mode, kind icons, status/evidence/ownership badges, `radial`/`force` layout backends
  (design lines 25-81) — Plan 4.
- In-app undo/redo. Revert is `git revert`/`git checkout` on the working-tree diff (design lines 92-93).
- Renaming a subject id, and multi-tab/concurrent-edit conflict resolution (design line 175 — single-writer
  working-tree model assumed).
- Dragging an edge endpoint on canvas to reconnect it (Task 17's dropdown is the mechanism this plan ships).
- Any change to `src/adapters/likec4-*.ts` or the `yarramate export --kind likec4` feature (design lines
  13-14, 176) — untouched, different feature.
