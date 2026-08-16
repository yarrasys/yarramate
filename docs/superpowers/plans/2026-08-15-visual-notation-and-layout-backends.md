# Plan: Visual Notation and Layout Backends (Plan 4 of N)

## Context

Design: `docs/superpowers/specs/2026-08-14-visual-cytoscape-native-editing-design.md`
lines 19-82 - the **Rendering**, **Notation**, and badge/toggle paragraphs. Plans
1-3 are landed on `main` (`e9d4a1a`, 60 files / 916 tests passing). Their surface -
`CanvasGraph`/`CanvasNode`/`CanvasEdge` (`src/graph-projection.ts`), `GraphCanvas`
(`src/visual-app/graph-canvas.tsx`), the view picker, structured `FilterPanel`,
quick filter, `SaveViewControl`, direction toggle, the `changeset.commit` /
`layout.save` write paths - is the starting point. Do not restart from Plan 1.

**Plan 4 scope:** close the three honesty gaps between what a projection document
can *declare* and what the renderer actually *draws*.

1. `presentation.layout: 'radial' | 'force'` is declared, saveable, schema-valid -
   and silently renders as `layered`. A user saves a radial view and gets a
   layered one back, with no diagnostic.
2. `presentation.showLifecycle` / `showEvidence` / `showOwnership` are parsed
   (`src/projection.ts:56-58`), carried through the projection result
   (`:118-123`, `:390-407`), reach the browser - and have no renderer at all.
3. ArchiMate notation mode (design lines 25-33) - the one genuinely new feature.

## Grounding (verified against this repo, not assumed)

Measured on **this repository's own graph** (258 concepts / 352 relationships,
220x64 px nodes, exported via `node dist/cli.js export graph`), not a synthetic
one. Overlap counts are pairs of node bounding boxes that intersect.

| backend | dependency | time | overlapping pairs | canvas |
|---|---|---|---|---|
| elk `layered` (today) | installed | 112 ms | 0 | 6272x9827 |
| elk `radial` | installed | 35 ms | **17 578** | 12017x8535 |
| elk `radial` + `sporeOverlap` | installed | **>300 s** | - | - |
| cytoscape `concentric` `spacingFactor 1.4` | **built-in** | **4 ms** | **0** (leaf **and** compound-parent) | 25056x24900 |
| cytoscape `cose` | built-in | 727 ms | 172 | 4622x4939 |
| elk `stress`(320) + `sporeOverlap` | installed | 5.4 s | **0** | 8025x5714 |
| `cytoscape-cola` `avoidOverlap` | NEW dep | 293 ms | 0 | 488x21646 (degenerate strip) |
| `cytoscape-cola` `edgeLength 320` | NEW dep | **180 s** | 0 | 8335x14094 |
| `cytoscape-fcose` | NEW dep | 97 ms | 294 | 3832x1934 |

Three corrections the design's wording does not survive:

- **`radial` is NOT elk `radial`.** ELK's radial is a *tree* algorithm; on a
  352-edge non-tree it piles 17.5k overlapping pairs, and running overlap removal
  over that state does not terminate. `radial` maps to cytoscape's built-in
  **`concentric`** (degree-ranked rings - hubs in the centre, which is the
  reading a radial view is for).
- **`force` earns no new dependency.** `cytoscape-cola` produced a degenerate
  488x21646 strip at defaults and took 180 s tuned; `fcose` left 294 overlaps.
  **`force` = elk `stress` (`desiredEdgeLength: 320`) then a second `sporeOverlap`
  pass over the result** - 0 overlaps, zero new deps.
- **`elk.direction` is meaningless outside `layered`.** ELK radial with
  `direction: DOWN` and `RIGHT` produced byte-identical output (same position
  hash). `concentric` has no direction concept either. The existing App.tsx:817
  rule (honour `direction` only when `layout === 'layered'`) is correct and
  generalises.

`force` scaling, 0 overlaps throughout: 25 nodes 73 ms / 50 nodes 123 ms /
100 nodes 917 ms / 258 nodes **5.4 s**. It is not a per-keystroke layout.

`elk.randomSeed` is INT-typed, but `presentation.seed` is a string on the wire
(`nonEmptyText`), so the browser hashes it (FNV-1a -> int32) before handing it
to elk. Measured per backend on a seed-sensitive fixture: `layered` is
deterministic and ignores the seed outright; `stress` (the `force` backend)
places initial positions randomly and is the one backend the seed visibly
moves; `concentric` is deterministic by construction and is not elk-based.
So `presentation.seed` stays saved for every view but only reproduces a
`force` layout.

Vocabulary, counted from the compiled graph:

- **19 distinct concept kinds** in use (17 from `yarramate/core@0.1`, plus
  `repository-file` and `compiler-module` from `.yarramate/profiles/yarramate-development.yaml`,
  which inherit `artifact` / `applicationComponent`). That is where the design's
  "19 kind icons" comes from - it is this repo's actual usage, not the 62-kind
  core vocabulary (`src/profile.ts:68-165`, counted from `dist/profile.js`).
- **10 distinct relationship kinds** in use: 9 of the **11** the core vocabulary
  defines (`src/profile.ts:198-237`) - realization 102, access 76, serving 48,
  association 40, assignment 39, influence 9, composition 4, triggering 3,
  flow 2 (`specialization` and `aggregation` unused here) - plus
  `yarramate/development@1.0#implements` (29), which inherits `realization` and
  is already mapped to it in `docs/ADAPTER-MAPPINGS.md:291-292`. That is the
  design's "9 of 10 ... verbatim" claim, confirmed. The notation table covers
  all 11 core kinds, so unused ones cost nothing and pre-empt nothing.

Cytoscape can express every ArchiMate line convention - enums read from
`node_modules/cytoscape/dist/cytoscape.cjs.js`:

- `arrowShape`: `tee triangle triangle-tee circle-triangle triangle-cross
  triangle-backcurve vee square circle diamond chevron none`
- `arrowFill`: `filled hollow` (per side: `source-arrow-fill` / `target-arrow-fill`)
- `lineStyle`: `solid dotted dashed`
- `nodeShape`: `rectangle round-rectangle cut-rectangle barrel ellipse octagon
  round-octagon hexagon tag diamond star polygon` (+ `shape-polygon-points`)

Badge data is **already on the wire**. `CanvasNode` (`src/graph-projection.ts:10-40`)
carries `status`, `owner`, `attestations`, `presentIn`, `constraints`,
`references` - so lifecycle/evidence/ownership badges need no protocol change.

`aspect` is **not** on the wire and is needed for ArchiMate shapes.
`ResolvedProfileContext` (`src/compiler.ts:205-213`) exposes `conceptKindLayers`
but no aspect map, even though the resolved kind carries `.aspect` and
propagates it through inheritance (`src/compiler.ts:389`, `:573`). Task 8 adds
`conceptKindAspects` mirroring the `conceptKindLayers` build at `src/compiler.ts:1983-1987`.

## New/changed wire shapes

Additive only; same `$id`s, same no-external-consumers rationale Plans 1-3 recorded.

1. `schema/yarramate-projection.schema.json` `$defs/presentation` gains
   `"notation": { "enum": ["native", "archimate"] }`. The existing
   `layout`->`seed` conditional is untouched.
2. `schema/yarramate-visual-graph.schema.json` `$defs/canvasNode` gains a
   required `"aspect": { "type": ["string", "null"] }`, alongside `layer`.
3. `ProjectionDefinition['presentation']` (`src/projection.ts:40-70`) and
   `CanvasNode` (`src/graph-projection.ts:10-40`) gain the matching fields.

No new events, no new response kinds. `view.save` already carries the whole
`presentation` object.

## Plan-level decisions (flag before implementing)

- **`radial` -> cytoscape `concentric`, `force` -> elk `stress`+`sporeOverlap`.**
  Overrides the design's implied elk-radial / cytoscape-cola reading. Evidence in
  Grounding. **No new npm dependency in this plan.**
- **`concentric` default `spacingFactor: 1.4`.** Measured: 1.0 leaves 4 leaf
  overlaps; 1.4 is the first overlap-free value (0 leaf, 0 compound-parent);
  1.75 and 2.5 only inflate the canvas (31k/44k px square). Radial views are
  large by construction - 258 boxes 220 px wide on rings do not fit in 6k px.
- **`force` is a busy-state layout.** 5.4 s at repo scale. It runs on view
  switch and on explicit backend change, never on a quick-filter keystroke; the
  filter path keeps re-running the *current* backend only when that backend is
  cheap (`layered` 112 ms / `concentric` 4 ms) and otherwise re-fits without
  re-laying-out. Alternative considered and rejected: run `force` always and
  accept a 5 s stall per keystroke.
- **Notation is presentation, saved like `layout`/`direction`,** not a query
  dimension - same rule ADR 0085 already fixed for layout.
- **ArchiMate mode pins `elk.layered.direction: DOWN`** regardless of the stored
  `direction`, because layer bands only read top-down. Switching back to Native
  restores whatever the projection declared (design line 30).
- **ArchiMate notation mode is not the externally-blocked ArchiMate
  compatibility profile.** `docs/BACKLOG-DISPOSITION.md:56-57` lists, under
  **Externally blocked**, "ArchiMate or another external-language compatibility
  profile needs licensing confirmation and independently governed mappings."
  That entry is about a *profile* - an interchange/conformance mapping of
  yarramate's kind vocabulary onto ArchiMate's. This plan ships neither: it
  draws boxes and arrowheads. No kind is renamed, no mapping document is
  published, no conformance or "Certified" claim is made, and the trademark is
  not used in product naming. The design doc (line 28) reads those same lines as
  clearing descriptive notation; that reading is recorded here explicitly rather
  than inherited silently, because the cited lines do not say it. **If that
  reading is wrong, Tasks 9-12 drop and Tasks 1-8 still stand on their own.**

## Tasks

### Task 1: three layout backends in `buildLayoutConfig`

`src/visual-app/graph-canvas.tsx:134-144`. Change the signature from
`buildLayoutConfig(direction)` to
`buildLayoutConfig(layout: 'layered' | 'radial' | 'force', direction: 'top-down' | 'left-right', seed?: string)`
returning `cytoscape.LayoutOptions`:

- `layered` - today's elk config unchanged (`ELK_SPACING`, `nodeLayoutOptions`,
  `elk.direction` from `direction`). No seed: measured to have no effect.
- `radial` - `{ name: 'concentric', avoidOverlap: true, spacingFactor: 1.4,
  animate: false, nodeDimensionsIncludeLabels: false }`. Cytoscape's built-in
  concentric filters compound parents itself (`eles.nodes().not(':parent')`), so
  parents wrap their children; measured 0 parent overlaps on the repo graph.
- `force` - returns the **first** pass only:
  `{ name: 'elk', elk: { algorithm: 'stress', 'org.eclipse.elk.stress.desiredEdgeLength': 320 }, ... }`,
  plus `elk.randomSeed` (the FNV-1a int32 of `seed`) when `seed` is given -
  this is the only backend the seed affects. The second `sporeOverlap` pass is
  Task 3's business (it needs the first pass to have finished).

Keep it a pure function with no cytoscape instance argument so
`test/graph-canvas-layout.test.ts` can assert on it headlessly.

**Testing:** extend `test/graph-canvas-layout.test.ts` - for each backend, run it
over a fixture graph in headless cytoscape and assert 0 overlapping bounding
boxes; assert `radial`/`force` configs carry no `elk.direction`; assert a `force`
config built with two different seeds produces different positions and the same
seed twice produces identical positions.

### Task 2: thread `layout` through props, state, and App

- `GraphCanvasProps` (`src/visual-app/graph-canvas.tsx:583-594`) gains
  `readonly layout: 'layered' | 'radial' | 'force'` beside the existing
  `direction`.
- `graph-canvas.tsx` mount effect, graph-change effect, and `relayoutVisible`
  (`:500-503`) take `layout` and pass it to `buildLayoutConfig`. The existing
  `pendingViewFitRef` arming effect (`:738-745`) must watch `layout` too, exactly
  as it already watches `direction`.
- `src/visual-app/workspace-state.ts` gains `layout` in `VisualWorkspaceState`
  and a `layout.set` action mirroring the `direction.set` case (`:238`),
  including the same "a view switch adopts the view's own presentation" rule.
- `src/visual-app/App.tsx:817` currently reads `view.presentation.layout` only to
  decide whether to honour `direction`; it now dispatches both
  `layout.set` and `direction.set` on view select.
- `CommandStrip` (`App.tsx:88-175`) gains a 3-way layout control beside the
  existing direction button; the direction button becomes `disabled` unless
  `layout === 'layered'` (grounded: measured no-op elsewhere).

**Testing:** `test/visual-app-state.test.ts` - `layout.set` reducer, and a view
switch adopting the selected view's declared layout. `test/visual-app-render.test.ts` -
direction control disabled under `radial`/`force`.

### Task 3: `force` second pass and busy state

In `graph-canvas.tsx`, when `layout === 'force'`, run the stress layout, await
`layoutstop`, then run `{ name: 'elk', elk: { algorithm: 'sporeOverlap' } }` over
the same collection, then fit. Guard with a ref so a second request while one is
in flight cancels/supersedes rather than stacking (`cy.layout(...).stop()`).

Surface a busy state through the existing `waiting` prop path (`App.tsx:268`
destructure / `:276` type, rendered at `:336`) - `"Laying out..."` - so a 5.4 s
pass is not a frozen canvas.

The filter effect (`graph-canvas.tsx:831-838`, `applyFilter` then a gated
`relayoutVisible`) already scopes relayouts to the `pendingViewFitRef`-armed
case - a view, layout, or direction change - so bare quick-filter/structural-
filter narrowing never re-runs a layout under any backend, `force` included.
No change to that gate; `relayoutVisible` itself gains the supersede ref and
busy callback so a `force` view switch shows `"Laying out..."` too.

**Testing:** `test/graph-canvas-layout.test.ts` - `force` over the fixture ends
with 0 overlapping node pairs; a second layout request superseding one still
in flight neither stacks a second `sporeOverlap` pass nor lets the superseded
run's `layoutstop` flip busy state back to idle.

### Task 4: `buildPayload` carries the real presentation

`src/visual-app/save-view.tsx:37-49` hardcodes
`presentation: { layout: 'layered', direction, seed: SAVE_SEED }`. It takes the
live `layout` (and, after Tasks 7 and 9, the toggles and notation) from
`BuildPayloadParams` and writes them through. `SAVE_SEED` stays the placeholder
constant Task 17 of Plan 3 left, with its comment intact.

**Testing:** `test/save-view.test.ts` - a payload built under `radial` round-trips
`layout: 'radial'` and omits nothing else.

### Task 5: lifecycle / evidence badges on the canvas

`STYLESHEET` (`graph-canvas.tsx:149-273`). Badges are drawn with cytoscape's
multi-value background-image properties, verified present in the installed
version: `background-image` (space-separated list), `background-position-x/y`,
`background-width/height`, `background-image-containment: over`, `background-clip: none`.
Each badge is an inline `data:image/svg+xml;utf8,` URI built by a small pure
module `src/visual-app/badges.ts` (`encodeURIComponent`'d SVG - the same shape
already probed working).

- **Lifecycle** (`showLifecycle`): top-right chip driven by `data('status')` -
  `planned` / `current` / `retired`, using the existing CSS custom properties
  from `src/visual-app/styles.css:11-21` (`--ink`, `--eucalyptus`, `--failure`,
  `--quiet`), no invented palette.
- **Evidence** (`showEvidence`): bottom-left chip, shown only when the node has
  `attestations.length > 0`; opacity gated by presence, never a dimmed "maybe"
  state (same binary rule `applyFilter` uses).

Node data gains `hasAttestations: boolean` and `ownerInitials: string | null`
in `graphToElements` (`:356-379`) - derived, not new wire fields.

**Testing:** `test/graph-canvas-layout.test.ts` (or a new `test/badges.test.ts`) -
pure assertions on the generated data-URI per status, and that a node with no
attestations gets no evidence badge in its `background-image` list.

### Task 6: ownership chip with a deterministic palette hash

`src/visual-app/badges.ts` - bottom-right circle carrying the owner's initials,
filled by hashing `CanvasNode.owner` (a ref string) onto the hue-bearing tokens
that actually exist in `src/visual-app/styles.css:11-16`: `--eucalyptus`
(`#416f65`), `--ochre` (`#8c4d18`), `--cobalt` (`#2457a6`), `--ink` (`#182228`).
Four slots. `--failure` (`#a3403a`) is deliberately excluded - Task 5 spends it
on `retired`, and a red circle must never read as "this concept is in trouble"
when it only means "Dana owns it". Same no-invented-palette discipline as
`LAYER_COLORS` (`graph-canvas.tsx:24-34`). Hash must be stable across reloads and
across machines - a plain FNV-1a over the ref string, modulo palette length.

**Measured caveat:** this repo declares exactly **one** owner across all 102
`yarramate/ownership/owner` claims (`yarramate-product#yarramate-maintainers`),
so on this graph every chip renders the same colour and the hash is untestable
from live data. The chip still earns its place - initials identify the owner at
a glance and the feature is for repos with several teams - but do not expect the
palette to be visible here.

**Testing:** same ref -> same colour across two calls; a fixed set of synthetic
refs spreads across all four slots and no ref ever maps outside the palette.

### Task 7: the three presentation checkboxes

`src/visual-app/filter-panel.tsx` renders query dimensions; these three are
**presentation**, so they render in the panel's own section but dispatch
presentation state, not `filter.query`. Add to `workspace-state.ts` a
`presentation.toggled` action carrying which flag changed. Feed them into
`GraphCanvasProps` and into `buildPayload` (Task 4).

**Testing:** `test/filter-panel.test.ts` - toggling a badge checkbox does not
compose a `ProjectionQuery` and does not fire the debounced `filter.query`
round-trip; `test/visual-app-state.test.ts` - reducer case.

### Task 8: `aspect` reaches the browser

- `src/compiler.ts:205-213` - `ResolvedProfileContext` gains
  `readonly conceptKindAspects: ReadonlyMap<string, string>`, built at `:1983-1987`
  exactly like `conceptKindLayers` but reading `kind.aspect` (already resolved
  and inherited at `:389` / `:573`).
- `src/graph-projection.ts` - `CanvasNode` gains `readonly aspect: string | null`,
  populated at `:217` beside `layer`.
- `schema/yarramate-visual-graph.schema.json` - `aspect` added to `canvasNode`
  properties **and** to `required` (the schema is `additionalProperties: false`,
  so this is not optional).

**Testing:** `test/graph-projection.test.ts` / `test/visual-graph-schema.test.ts` -
a projected node carries the aspect its kind declares, and an inherited kind
(`repository-file` -> `artifact`) carries `passive-structure`.

### Task 9: the `notation` presentation field

- `schema/yarramate-projection.schema.json` `$defs/presentation` gains
  `notation: { enum: ['native', 'archimate'] }`.
- `src/projection.ts:40-70` - `ProjectionDefinition['presentation']` gains
  `readonly notation?: 'native' | 'archimate'`, carried through the same
  `...(presentation.notation === undefined ? {} : { notation })` spread pattern
  the three `show*` flags already use (`:118-123`, `:390-407`).
- `workspace-state.ts` + `CommandStrip` - a 4th toggle, orthogonal to the layout
  control, defaulting to `native`.
- `buildPayload` carries it.

**Testing:** `test/projection.test.ts` - notation round-trips through a saved
projection document; an unknown value is rejected by the schema.

### Task 10: 19 kind icons

`src/visual-app/kind-icons.ts` - a `Record<string, string>` from **kind label**
(`kindLabelOf`, `src/kind-label.ts`) to an inline SVG data-URI, covering the 19
kinds this repo uses (list in Grounding). Icons follow ArchiMate's element
glyphs. See the licensing decision above: this is descriptive notation, not the
externally-blocked compatibility profile, and no trademark or conformance claim
is made.

Drawn 14x14 px, single-stroke, `currentColor`-free (explicit hex, since they are
background images not inline SVG). Unknown kind -> no icon, no crash: the
top-right slot simply stays empty.

**Testing:** `test/kind-icons.test.ts` - every one of the 19 kinds in this repo's
graph resolves to a non-empty URI; an unmapped kind returns `null`.

### Task 11: ArchiMate shapes and relationship notation

Two stylesheet blocks in `graph-canvas.tsx`, active only under
`notation === 'archimate'` (build the stylesheet from a parameter rather than
mutating a module constant).

**Node shape by aspect** (`data('aspect')`, from Task 8):

| aspect | cytoscape `shape` |
|---|---|
| `active-structure` | `rectangle` |
| `behavior` | `round-rectangle` |
| `passive-structure` | `rectangle` + top accent band |
| `motivation` | `octagon` |
| `composite` | `rectangle`, dashed border |

**Relationship notation by kind label** - all 11 core kinds, expressible with the
enums verified in Grounding:

| kind | `line-style` | source arrow | target arrow |
|---|---|---|---|
| composition | solid | `diamond` filled | `none` |
| aggregation | solid | `diamond` hollow | `none` |
| assignment | solid | `circle` filled | `triangle` filled |
| realization | dotted | `none` | `triangle` hollow |
| specialization | solid | `none` | `triangle` hollow |
| serving | solid | `none` | `vee` |
| access | dotted | `none` | `vee` |
| influence | dashed | `none` | `vee` |
| triggering | solid | `none` | `triangle` filled |
| flow | dashed | `none` | `triangle` filled |
| association | solid | `none` | `none` |

Kind labels come from the existing `kindLabel` node/edge data, so a *derived*
kind (`implements` -> `realization`) needs its lineage: use the edge's resolved
core ancestor. `relationshipKindLineages` is already on `ResolvedProfileContext`
(`src/compiler.ts:207`) - project the terminal core kind onto `CanvasEdge` as
`coreKindLabel` if it is not already there, same one-line pattern as Task 8.

**Testing:** `test/graph-canvas-layout.test.ts` - under `archimate`, a
`realization` edge resolves to dotted + hollow triangle, and a
`yarramate/development@1.0#implements` edge resolves to the *same* style through
its lineage.

### Task 12: ArchiMate mode pins direction

Under `notation === 'archimate'`, `buildLayoutConfig` forces
`elk.direction: 'DOWN'` for `layered` regardless of the stored `direction`, and
the direction control is disabled with the reason shown. Switching back to
`native` restores the projection's declared direction (nothing is overwritten in
state - the pin is applied at layout-config build time only).

**Testing:** `buildLayoutConfig('layered', 'left-right', ..., 'archimate')`
yields `DOWN`; the same call under `native` yields `RIGHT`.

### Task 13: docs, ADRs, and the architecture model

- `docs/VISUAL-ADAPTER.md` - the layout backends table (with the measured
  numbers), the four toggles, notation mode.
- New ADR: **"radial is concentric and force is stress-then-spore"** - records
  that the layout backends are chosen by measurement on this repo's own graph,
  that elk radial is a tree algorithm unusable on this shape, and that no new
  layout dependency was taken. Supersedes nothing; complements ADR 0085.
- New ADR: **"ArchiMate notation is a rendering mode, not a vocabulary"** -
  no schema change to kinds, no new relationship kinds, notation is presentation
  saved beside layout; licensing position (notation implementable, trademark and
  conformance claims not made).
- `.yarramate/architecture/engine.yaml` + `repository.yaml` - concepts for the
  new modules (`badges.ts`, `kind-icons.ts`), the `conceptKindAspects` access,
  and repository-file subjects for every new source and test file, wired with
  relationships the way Plan 3's closeout did.
- `skills/yarramate-architecture/references/visual-conversations.md` - the
  reviewer-visible toggles, so an agent driving the journey knows they exist.

**Testing:** `node dist/cli.js check .yarramate/workspace.yaml --json` clean, and
`node dist/adapters/likec4-cli.js check .yarramate/likec4-project.yaml` clean
(new concepts need LikeC4 kind mappings in
`.yarramate/integrations/likec4/subject-mapping.yaml`, as Plan 3 found the hard way).

## Testing

- `tsconfig.visual.json` lists visual test files **explicitly** (no glob), so
  `test/badges.test.ts` and `test/kind-icons.test.ts` must be added to its
  `include` array or they are silently never typechecked.
- `pnpm typecheck` - `tsc --noEmit` on both `tsconfig.json` and
  `tsconfig.visual.json`, clean.
- `pnpm build` - both bundles.
- `pnpm test` - full suite green including every new/updated test above.
- **Live browser smoke** against this repo's own 258-subject workspace, since
  every layout claim in this plan was measured headlessly: start
  `yarramate-visual`, switch a view through all three backends, confirm the busy
  state appears for `force` and the canvas is overlap-free in each; toggle all
  four presentation switches; save the view and reload, confirming layout,
  notation, and badge flags come back.

## Non-goals (explicitly deferred)

- In-app undo/redo for presentation toggles - `git revert` remains the mechanism
  (Plan 3 non-goal, unchanged).
- Icons for the 32 core kinds this repo does not use. The mapping is open for
  extension; nothing crashes on a miss.
- ArchiMate swimlane/grouping partitions (`elk.partitioning`) - Task 12 pins
  direction, it does not band the canvas by layer.
- Any LikeC4 re-entry. `likec4-compiler.ts` and `likec4/react` are gone from the
  visual path and stay gone.
