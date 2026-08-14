# Plan: Visual Native Rendering Foundation (Plan 1 of N)

## Context

Design: `docs/superpowers/specs/2026-08-14-visual-cytoscape-native-editing-design.md` (approved, committed `9d78328`).

The full design covers rendering, editing, ArchiMate notation toggle, saved views, status/evidence/ownership
badges, and chat-as-controller. That is too large for one plan. This is **Plan 1**: rip out the LikeC4
DSL/compiler pipeline and replace it with direct server-side projection + client-side cytoscape.js rendering,
in Native notation, Layered (elk) layout only, read-only. It is a complete, independently shippable,
independently testable vertical slice: a visual session starts, compiles this repo's real workspace in-process,
serves a real node/edge graph, and the browser renders it with cytoscape and supports click-to-select against
real resolved fields. No editing, no ArchiMate toggle, no other layouts, no saved-views dropdown, no
explain/filter/focus chat mechanic — those are later plans built on this foundation.

## Grounding (verified against this repo, not assumed)

- `schema/yarramate-graph-v2.schema.json` (`format: yarramate/graph/v2`) is a **claims triple-store**:
  `{format, profiles, documents, subjects, claims}`, each claim `{id, subject, predicate, object, origin, source}`.
  Produced by `compileWorkspace`/`compileWorkspaceWithProfileContext` in `src/compiler.ts` (in-process, no
  subprocess) and serialized by `serializeSemanticGraph` in `src/graph.ts`. `yarramate export graph` just calls
  `serializeSemanticGraph(compilation.graph)` (`src/export-command.ts:271-274`).
- No function anywhere in `src/` folds claims into flat concept/relationship records. Concept claims all use
  `subject = "${document}#${concept.id}"` directly. Relationship claims are asymmetric: the **defining claim**
  (`claims.find(c => c.id === relationshipSubjectId)`, i.e. `claim.id` with no `~suffix`) has
  `subject = from-concept-id`, `predicate = relationship-kind-identity`, `object.ref = to-concept-id`; every
  *other* claim about that relationship (`~name`, `~description`, `~mode`, `~content`, `~status`, reference/
  presentIn claims) uses `subject = relationshipSubjectId` directly. Verified by reading
  `src/compiler.ts:1483-1850` claim-by-claim.
- Concept claim predicates observed: `yarramate/concept/kind` (object.value = resolved kind identity),
  `/concept/name`, `/concept/description` (optional), `/concept/alias` (repeated → `aka[]`),
  `/lifecycle/status` (optional), `/identity/distinct-from` (repeated, object.ref → `distinctFrom[]`),
  `/lineage/supersedes` (repeated, object.ref → `supersedes[]`), `/ownership/owner` (optional, object.ref),
  `/constraint/requires` (repeated, object.ref → `constraints[].ref`, id-paired via
  `${subject}~constraint-${constraint.id}`), `/constraint/expects` (paired via
  `${subject}~expects-${constraint.id}`, object.value = `"<provider> <key> <value>"` encoded string),
  `/reference/refers-to` (repeated, object.ref → `references[].ref`), attestation predicates
  (`${ATTESTATION_PREDICATE_PREFIX}${topic}`, repeated), `/state/present-in` (repeated, object.ref →
  `presentIn[]`).
- Relationship metadata predicates (subject = relationship id): `yarramate/relationship/name`,
  `/relationship/description`, `/access/mode`, `/flow/content`, `/lifecycle/status`, `/reference/refers-to`
  (repeated), `/state/present-in` (repeated).
- `ResolvedProfileContext.conceptKindLayers: ReadonlyMap<string, string>` (`src/compiler.ts:196-204`,
  returned as `profileContext` alongside `graph` from `compileWorkspaceWithProfileContext`) maps a resolved
  kind identity string to its ArchiMate layer — reuse this for badge/fill coloring, do not re-derive layers
  from string parsing.
- Today's pipeline: yarramate workspace → `compileWorkspaceWithProfileContext` → `SemanticGraph` → (delegated
  chat agent hand-authors `.c4`/`.likec4` DSL text) → staged as `VisualModel.files` → `likec4-compiler.ts`
  shells out to the `likec4` CLI to validate+export → browser renders via `ReactLikeC4`/`LikeC4ModelProvider`
  (from the `likec4` package's `/react` subpath, `src/visual-app/App.tsx:1-7`). `VisualModel` today
  (`src/adapters/visual/protocol-contract.ts:47-53`): `{format, authority, initialView, sourceDigests, files}`.
- `likec4`/`@likec4/core` devDependencies stay in `package.json` — they back the **separate**, unrelated
  `./adapter/likec4` publish target (`src/adapters/likec4-cli.ts`, `pnpm self:export:likec4`,
  `pnpm docs:dev`, `pnpm validate`). Only the visual session's internal usage goes away. Do not touch that
  adapter, its schemas (`yarramate-likec4-*.schema.json`), `assets/likec4`, or `pnpm validate`.
- `test/visual-session-server.test.ts` starts real `VisualServerHandle`s against `test/fixtures/visual/`
  (`fake-likec4.mjs` fake compiler subprocess, `model.json` fake LikeC4 export). Both go away; tests instead
  build a `SemanticGraph` from a tiny literal `WorkspaceSource` via `compileWorkspace` and project it.
- Root `pnpm test` = plain `vitest run` and already includes both `src/adapters/visual/*` tests and
  `src/visual-app/*` React tests (jsdom) from the same config — no separate visual test command exists.
  `pnpm typecheck` runs `tsc --noEmit && tsc -p tsconfig.visual.json` (two separate project references —
  both must pass). `pnpm verify` = `typecheck && build && test && self:check && validate`.

## New wire shape: `CanvasGraph`

Not the raw claims format, not a new schema version number (still `yarramate/visual-model/v1`, field-level
change only — pre-1.0, no consumers outside this repo). This is the exact resolved shape already demoed live
and approved throughout the brainstorm (`real-model.json`, all `write_*_mockup.py` generators):

```ts
interface CanvasNode {
  readonly id: string                    // subject id, e.g. "yarramate-engine#compiler-module"
  readonly kind: string                  // resolved kind identity, e.g. "yarramate/core@0.1#applicationComponent"
  readonly kindLabel: string             // local id stripped of profile prefix, e.g. "applicationComponent"
  readonly layer: string | null          // from profileContext.conceptKindLayers, null if unresolved
  readonly name: string
  readonly description: string | null
  readonly aka: readonly string[]
  readonly status: string | null
  readonly owner: string | null          // ref
  readonly distinctFrom: readonly string[]   // refs
  readonly supersedes: readonly string[]     // refs
  readonly constraints: ReadonlyArray<{ readonly ref: string; readonly expects: string | null }>
  readonly references: readonly string[]     // refs
  readonly presentIn: readonly string[]      // refs
  readonly attestations: ReadonlyArray<{ readonly topic: string; readonly value: string }>
}

interface CanvasEdge {
  readonly id: string
  readonly kind: string
  readonly kindLabel: string
  readonly from: string   // node id
  readonly to: string     // node id
  readonly name: string | null
  readonly description: string | null
  readonly mode: string | null
  readonly content: string | null
  readonly status: string | null
  readonly references: readonly string[]
  readonly presentIn: readonly string[]
}

interface CanvasGraph {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}
```

Determinism: sort `nodes`/`edges` by `id` (stable diffs, stable test fixtures, no dependency on claims array
order).

## Tasks

### Task 1: `src/graph-projection.ts` — claims → CanvasGraph (pure, no I/O)

Export `CanvasNode`, `CanvasEdge`, `CanvasGraph`, and
`projectGraphForCanvas(graph: SemanticGraph, profileContext: ResolvedProfileContext): CanvasGraph`.

Algorithm:
- Group `graph.claims` by `claim.subject` into a `Map<string, GraphClaim[]>`.
- For each `subjects` entry with `type: 'concept'`: read its claim group, pull `yarramate/concept/kind` →
  `kind` (fall back to `''` only if genuinely absent — every real concept always has one, so treat absence as
  a defensive `throw` with the subject id in the message, not a silent default: a subject registered without
  a kind claim is a compiler bug, not valid input this function should paper over). Derive `kindLabel` by
  taking the substring after the last `#` in `kind`. Look up `layer` via
  `profileContext.conceptKindLayers.get(kind) ?? null`. Pull `name` (required, same throw-on-missing rule).
  Pull optional `description`/`status`/`owner` (single-valued predicates — take the claim's `object.value`/
  `object.ref`). Collect repeated predicates (`alias`→`aka`, `distinct-from`→`distinctFrom`, `supersedes`,
  `reference/refers-to`→`references`, `state/present-in`→`presentIn`) preserving claim order, then
  `.sort()` each for determinism. For `constraints`: collect `constraint/requires` claims, and for each pull
  its paired `constraint/expects` claim by matching `claim.id` suffix (`~expects-<constraintId>` where
  `<constraintId>` is the same suffix segment as the `~constraint-<constraintId>` id) — extract the
  constraint's own local id from the `requires` claim's `id` field (`id.split('~constraint-')[1]`), look up
  the sibling `~expects-<that-id>` claim in the same group. For `attestations`: collect claims whose
  `predicate` starts with the attestation prefix, `topic = predicate.slice(prefixLength)`,
  `value = claim.object.value`.
- For each `subjects` entry with `type: 'relationship'`: find the **defining claim** —
  `claims.find(c => c.id === relationshipId)` searched across the *whole* `graph.claims` array (its `subject`
  is the from-concept, not this relationship id, so it will not be in the subject-keyed group) —
  `from = definingClaim.subject`, `kind = definingClaim.predicate`, `to = definingClaim.object.ref`. Then read
  the relationship's own claim group (`claims.subject === relationshipId`) for `name`/`description`/`mode`/
  `content`/`status` (optional, single-valued) and `references`/`presentIn` (repeated).
- Assert every `object.ref`/`object.value` narrows correctly per predicate (ref-typed predicates must carry
  `object.ref`, value-typed must carry `object.value`) — throw with subject+predicate context on mismatch
  rather than silently coercing; this is compiler-internal data, a mismatch means a real bug upstream that
  must not be hidden behind an empty string.
- Sort `nodes`/`edges` by `id` before returning.

### Task 2: `test/graph-projection.test.ts`

Do not hand-author claims. Build tiny literal `WorkspaceSource` documents (YAML text, one or two documents),
run them through `compileWorkspace` (already imported/used this way in other adapter tests — check
`test/visual-likec4-compiler.test.ts` and `test/visual-session-server.test.ts` for the existing pattern before
writing a new one), assert `compilation.ok`, then feed `compilation.graph` + `compilation.profileContext`
into `projectGraphForCanvas`. Cover:
- A concept with every optional field populated (aka ×2, distinctFrom, supersedes, owner, one constraint with
  `expects`, one constraint without, one reference, one presentIn, one attestation) — assert every field
  round-trips correctly and array ordering is sorted.
- A concept with only required fields (kind, name) — every optional field is `null`/`[]`.
- A relationship — assert `from`/`to` resolve to the correct concept ids (not swapped), `kindLabel` strips the
  profile prefix, metadata fields round-trip.
- `layer` resolves to a real value for a kind with known ArchiMate lineage and is `null` for an out-of-lineage
  test kind (if the test profile has one; otherwise assert non-null for a core kind and document why null
  isn't separately exercised).
- Two concepts/relationships fed in reverse declaration order come back sorted by id.

### Task 3: New schema `schema/yarramate-visual-graph.schema.json`

`$id: https://yarramate.org/schema/visual-graph/v1`, `additionalProperties: false` throughout, mirroring
`CanvasGraph` exactly (nodes/edges arrays, required fields per the interface above, nullable fields as
`["string", "null"]`, `constraints`/`attestations` as typed object arrays). Add to `package.json` `exports`
as `"./schema/visual-graph": "./schema/yarramate-visual-graph.schema.json"` alongside the other `visual-*`
schema entries (follow existing naming/ordering convention in that block exactly).

### Task 4: Edit `schema/yarramate-visual-model.schema.json`

Remove `files`, `modelFilePath`, `textFile` properties/$defs and their `allOf` canonical/ad-hoc constraint on
`sourceDigests` stays (it is about source-document staleness, not DSL staging — keep it unchanged). Add
required `graph` property: `{"$ref": "https://yarramate.org/schema/visual-graph/v1"}`. Update `required` array.

### Task 5: Edit `schema/yarramate-visual-session-request.schema.json`

Remove the `compiler` property and its `VisualCompilerCommand`-shaped `$def` entirely. Update `required`.

### Task 6: Edit `schema/yarramate-visual-response.schema.json`

Remove the `model.replace` branch from the response `oneOf` and its `modelReplacePayload` `$def`. Chat
responses may no longer carry a model mutation.

### Task 7: Edit `src/adapters/visual/protocol-contract.ts`

- Remove `VisualCompilerCommand` interface.
- `VisualSessionRequest`: remove `compiler` field.
- `VisualModel`: replace `sourceDigests`+`files` pair's `files` with `graph: CanvasGraph` (import the type
  from `../../graph-projection.js`); keep `sourceDigests`.
- Remove `VisualModelReplacePayload` and the `'model.replace'` arm of whatever discriminated union represents
  response payloads.
- Run `xd://lsp` `references` on every removed export before deleting it (`VisualCompilerCommand`,
  `VisualModelReplacePayload`, the `files`/`sourceDigests`-as-pair usage) to catch every call site — this is
  the authoritative check, not grep.

### Task 8: Delete `src/adapters/visual/likec4-compiler.ts` and `test/visual-likec4-compiler.test.ts`

Confirm via `xd://lsp` `references` on every exported symbol from `likec4-compiler.ts`
(`compileVisualModel`, `VISUAL_COMPILER_DOCUMENT`, `VISUAL_COMPILER_EXPORT_FILE`, `VISUAL_COMPILER_LIMITS`,
`CompileVisualModelOptions`, `CompiledVisualModel`, `LikeC4CompilationResult`) before deleting, and remove
every call site (expected: `session-server.ts`, possibly `session-store.ts`).

### Task 9: Edit `src/adapters/visual/session-store.ts`

Remove `promoteCompiledModel`, `ModelPromotion`, `ModelPromotionResult`, and any `.likec4-export.json`-specific
path handling (check `xd://lsp` references first, same rule as task 8). Add whatever construction step now
builds `VisualModel.graph`: at session-start staging time, call `compileWorkspaceWithProfileContext` on the
session's workspace source documents, and on success call `projectGraphForCanvas(graph, profileContext)` to
produce `graph`. On compile failure, surface the existing diagnostic-shaped rejection path unchanged (no new
error shape — reuse whatever `VisualDiagnostic` construction already exists for compile failures elsewhere in
this file/`session-server.ts`).

### Task 10: Edit `src/adapters/visual/session-server.ts`

Remove the compiler-subprocess wiring: `VISUAL_COMPILER_LIMITS` references, the compile-on-connect subprocess
call path, `compilerAbort`/its `AbortController`, and the `'model.replace'` case in `acceptResponse`/wherever
outgoing agent responses are routed to the browser. Keep every other admission/session-lifecycle/journal path
untouched. `xd://lsp` `diagnostics` on this file after edits — it is large (2500+ lines per the earlier grep)
and easy to leave an unreachable branch or unused import behind.

### Task 11: Fixtures

- Delete `test/fixtures/visual/fake-likec4.mjs`.
- Delete `test/fixtures/visual/model.json` (LikeC4-shaped fake export, no longer meaningful).
- In `test/visual-session-server.test.ts`: remove the `fakeCompiler`/`assetRoot`-for-compiler wiring tied to
  the deleted fixture, remove `compiler` from the `request`/`VisualSessionRequest` test fixture, replace the
  `modelWith(marker)` helper's LikeC4-shaped `files` output with a `CanvasGraph`-shaped one (either a small
  literal object matching the new schema, or — preferred, matches task 2's pattern — built via
  `compileWorkspace` + `projectGraphForCanvas` on a tiny literal workspace source, so the fixture can never
  drift out of schema sync). Update every assertion in this file that reads `.files`/`.sourceDigests` as a
  DSL-staging pair, or exercises `model.replace`, to match the new contract (some of these tests may no
  longer apply at all — e.g. `model.replace` acceptance tests — remove them, don't stub them out).

### Task 12: Frontend deps

Add to `package.json` `devDependencies` (visual-app only consumers, `pnpm typecheck`'s
`tsconfig.visual.json`/`pnpm build:visual` pull them in): `cytoscape`, `cytoscape-elk`, `elkjs`,
`@types/cytoscape`. Do not remove `likec4`/`@likec4/core`/`@types/react`/`@types/react-dom` — `react`/
`react-dom` stay too (the visual-app shell, chat panel, inspector panel are still React; only the diagram
canvas itself moves off `ReactLikeC4`).

### Task 13: `src/visual-app/graph-canvas.tsx`

New component: `GraphCanvas({ graph: CanvasGraph, selectedId, onSelect }: Props)`. Mounts a `cytoscape` instance
on a ref'd `<div>` inside a `useEffect` (create once, `cy.destroy()` on unmount), registers the `elk` extension
(`cytoscape.use(elk)`), loads `graph.nodes`/`graph.edges` as cytoscape elements (`data: { id, label: name,
kind, kindLabel, layer, status }` on nodes; `data: { id, source: from, target: to, label: name ?? kindLabel }`
on edges), applies a style stylesheet coloring node fill by `data(layer)` against a small fixed
layer→color map (reuse the exact ArchiMate layer palette already used in the approved mockups — motivation
`#CCCCFF`/strategy `#F5DEAA`/business `#FFFF99`/application `#CCFFFF`/technology `#CCFFCC`/`#D89999`
implementation-migration, per the mockup scripts read earlier in this session — grep
`.superpowers/brainstorm/28342-1786692781/content/` mockup generator scripts for the exact hex values rather
than re-deriving from memory), runs `cy.layout({ name: 'elk', elk: { algorithm: 'layered', 'elk.direction':
'DOWN' } }).run()` once on load and again whenever `graph` reference changes, and wires a `tap` handler on
`node`/`edge` to call `onSelect(id, type)`. No notation toggle, no drag-to-reposition, no edit affordances in
this component yet — those are later plans.

### Task 14: Edit `src/visual-app/App.tsx`

Replace the `LikeC4ModelProvider`/`ReactLikeC4` usage inside `DiagramWorkspace` (`App.tsx:246-393` per the
earlier structural read) with `<GraphCanvas graph={state.drawing.graph} .../>`. `xd://lsp` `references` on
`AnyLikeC4Model`/`LikeC4ModelProvider`/`ReactLikeC4` imports first to confirm no other file in `visual-app`
depends on them before removing the import lines. Selection callback wiring (`onSelect`/`onNavigate` props)
stays structurally the same — only the element/edge id shape it receives changes (real `CanvasNode`/
`CanvasEdge` ids, not LikeC4 fqn-shaped ids).

### Task 15: Edit `src/visual-app/workspace-state.ts`

Replace the LikeC4-shaped `DiagramElementInput`/`DiagramRelationshipInput` interfaces (`modelRef`,
`deploymentRef`, `technology`, `tags`, `notation`, etc. per the earlier structural read) with fields matching
`CanvasNode`/`CanvasEdge` from `graph-projection.ts` (reuse those types directly rather than redeclaring a
parallel shape — `import type { CanvasNode, CanvasEdge } from '../graph-projection.js'`). Update
`SelectedElement`/`SelectedRelationship` and `normalizeSelectedElement`/`normalizeSelectedRelationship`
(`workspace-state.ts:34-97` per the earlier read) to read/normalize the new field names. Keep
`flattenMarkdownOrString`/`optionalText`/`visualDescriptionText` helpers as-is if they still apply (`name`/
`description` on `CanvasNode`/`CanvasEdge` are plain strings, not `MarkdownOrString` — confirm and simplify
those call sites rather than keeping unused markdown-flattening for fields that are no longer markdown-typed).

### Task 16: `test/visual-app-render.test.ts`, `test/visual-app-state.test.ts`

Update the hoisted `baseState`/session mocks in both files to the new `VisualAppState.drawing`/model shape.
None of the assertions about session lifecycle labels, End/handoff banners, or the "Beta" command-strip label
should need behavioral changes — only the fixture data feeding them. If any assertion turns out to depend on
LikeC4-specific rendering details (element/deployment node shapes, tags), replace it with the equivalent
assertion against `CanvasNode`/`CanvasEdge` fields, don't delete coverage.

### Task 17: Audit remaining visual tests

`grep` `test/visual-cli.test.ts`, `test/visual-journey.test.ts`, `test/visual-protocol.test.ts`,
`test/visual-workspace-state.test.ts` for `compiler`, `files`, `sourceDigests` (as a DSL-staging field, not
the canonical/ad-hoc constraint itself), `model.replace`, `likec4-compiler`, `ReactLikeC4`,
`LikeC4ModelProvider`. Fix every hit to match the new contract.

## Testing

- `pnpm typecheck` — both `tsc --noEmit` and `tsc -p tsconfig.visual.json` must pass clean (catches every
  stale LikeC4 type reference across `src/visual-app`).
- `pnpm test` — full `vitest run`, including the new `test/graph-projection.test.ts` and every edited visual
  test file.
- `pnpm self:check` — proves this repo's own real `.yarramate/workspace.yaml` still compiles (unrelated to
  this change but part of `verify`, cheap to confirm nothing in `compiler.ts` was touched incorrectly).
- `pnpm validate` — proves the untouched `./adapter/likec4` publish path (self:export:likec4 → likec4
  validate) still works, confirming task 12/14's dependency changes didn't leak into the wrong build target.
- `pnpm verify` runs all of the above in the right order — run it as the final gate.
- **Live smoke test (required, not optional — this is a UI change):** start a real visual session against
  this repo's actual `.yarramate/workspace.yaml` (same harness used throughout the brainstorm: spin
  `session-server.ts` for real, drive it with the `browser`/chrome-devtools tools), confirm the browser
  renders the real ~242-concept/~330-relationship graph via cytoscape (not a mock), confirm clicking a node
  opens the inspector with real resolved fields (kind/name/description/status/owner/etc., not LikeC4 fields),
  confirm zero console errors, screenshot as evidence.

## Non-goals (explicitly deferred to later plans)

- Editing (drag-to-reposition, field edits, `yarramate apply` wiring, undo stack, commit button).
- ArchiMate notation toggle / alternate node shapes.
- Radial (concentric) / Force (cola) layouts — Layered (elk) only in this plan.
- Saved-views dropdown / `.yarramate/projections/*.yaml` loading.
- Status/evidence/ownership badges on nodes.
- Chat-as-controller (explain/filter/focus query mechanic, `appliedQuery` field). Chat keeps its existing
  explain-only behavior in this plan; only its now-impossible mutation path (`model.replace`) is removed.
