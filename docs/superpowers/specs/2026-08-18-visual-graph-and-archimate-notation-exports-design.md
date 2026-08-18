# Design: Export visual-graph projector and ArchiMate notation vocabulary

Issue: [#201](https://github.com/yarrasys/yarramate/issues/201) — export the
visual-graph projector and ArchiMate notation vocabulary as supported package
surfaces.

## Problem

Hosted and browser-side consumers want to render a compiled YarraMate model with
the same contracts the local visual app uses (cytoscape.js + cytoscape-elk),
without reimplementing projection or ArchiMate-inspired notation.

`yarramate@0.21.0` already publishes `./schema/visual-graph` and types
`presentation.notation: 'native' | 'archimate'`, but three gaps block supported
consumption:

1. **Visual-graph projector is not a public export.**  
   `projectGraphForCanvas` (`src/graph-projection.ts`) produces a
   `yarramate/visual-graph/v1` document from a `SemanticGraph` +
   `ResolvedProfileContext`. It is only reached through the visual session path
   under `dist/adapters/visual/*`. Deep-importing is unsupported and risks
   pulling Node-only session code (`ws`, `node:path`, session-server) into a
   Workers/browser bundle. The projector logic itself is pure, but it
   value-imports claim helpers from `compiler.ts`, which loads `node:module` +
   Ajv at init — the same seam `src/kind-label.ts` already documents.

2. **ArchiMate notation vocabulary is not available as data.**  
   Notation mode is a public presentation contract (ADR 0087), but the per-kind
   glyph/shape mapping and relationship line styles live only inside the
   prebuilt visual app (`src/visual-app/kind-icons.ts`,
   `src/visual-app/graph-canvas.tsx`). The nearest shipped asset is
   `assets/likec4/specification.likec4`, which expresses layer tags and notation
   labels in LikeC4 DSL for a different renderer and a different palette.

3. **`layer` and `aspect` are untyped on `canvasNode`.**  
   Both are `string | null` in `schema/yarramate-visual-graph.schema.json`,
   while profile already defines closed enums
   (`schema/yarramate-profile.schema.json`, `src/profile.ts`). Swimlane and
   aspect placement should not depend on free strings.

## Goals

1. Publish a **Workers-safe** `SemanticGraph + ResolvedProfileContext →
   visual-graph/v1` function as a supported package export.
2. Publish a **renderer-neutral ArchiMate notation vocabulary** (concept kind →
   label/shape/glyph/layer colours; relationship kind → line notation) as a
   supported export, sourced from the visual-app tables + core
   `conceptKinds` / `relationshipKinds`.
3. Tighten `canvasNode.layer` / `aspect` to the existing profile enums (still
   nullable).

## Non-goals

- No `apply` / operations / compiler semantic changes.
- No visual session protocol or `yarramate-visual` runtime changes as a product
  surface. Local-only assumptions (loopback bind, Git working tree,
  `.yarramate-out/`) stay out of the supported consumer contract.
- No ArchiMate conformance claim; no kind → ArchiMate-element-type metamodel
  mapping. Standing remains ADR 0087: notation is a rendering mode, not a
  vocabulary fork.
- No LikeC4 palette sync. `assets/likec4/specification.likec4` stays
  adapter-owned.
- No requirement that every core kind ship a glyph on day one (`glyph: null` is
  valid).
- No main-entry (`yarramate`) purity rewrite. Main stays Node-capable; purity is
  a **subpath** guarantee.
- No profile-extended kind aliases in the core vocabulary export
  (`compiler-module`, `repository-file` remain app/consumer-local).

## Decisions locked in design review

| Topic | Choice |
|---|---|
| Packaging | Dedicated pure subpaths (Approach B), not main-entry-only and not a fat `./adapter/visual` barrel |
| Layer colours | Visual-app canvas `LAYER_COLORS`, not LikeC4 DSL colours |
| Kind coverage | Full core `conceptKinds` + all 11 `relationshipKinds` |
| Missing glyphs | Allowed (`null`) |
| JSON twin of vocabulary | Not required for v1; TypeScript module is the source of truth |
| Main-entry re-exports | None by default; subpaths are the supported surface |

## Grounding — verified in this repo

| Fact | Where |
|---|---|
| Projector symbol | `projectGraphForCanvas` in `src/graph-projection.ts` |
| Call sites | `src/adapters/visual/session-server.ts`, `session-store.ts` (`buildVisualModelGraph`) |
| Schema already exported | `package.json` → `./schema/visual-graph` |
| Adapter export pattern | `./adapter/likec4`, `./adapter/graphify` barrels under `src/adapters/` |
| Build includes projector | `tsconfig.build.json` includes `src/**/*.ts`, excludes `src/visual-app` |
| Node leak path | `graph-projection.ts` value-imports parsers from `compiler.ts` → `node:module` |
| Kind label already pure | `src/kind-label.ts` (comment documents the Ajv/`node:module` problem) |
| Layer/aspect enums | `src/profile.ts` `layers` / `aspects`; mirrored in profile + projection schemas |
| Canvas colours | `src/visual-app/graph-canvas.tsx` `LAYER_COLORS` (6 coloured + neutral default) |
| Aspect shapes + edge styles | `buildStylesheet` ArchiMate branch in `graph-canvas.tsx` |
| Glyphs today | 17 base bodies + 2 profile aliases in `kind-icons.ts` |
| Notation is rendering-only | ADR 0087 |

## Public export surface

### New package exports

| Subpath | Built module | Publishes |
|---|---|---|
| `yarramate/adapter/visual-graph` | `dist/adapters/visual-graph-entry.js` | `projectGraphForCanvas`, `CanvasGraph`, `CanvasNode`, `CanvasEdge` |
| `yarramate/notation/archimate` | `dist/notation/archimate.js` | notation tables + lookup helpers |
| `yarramate/schema/visual-graph` | *(existing)* | schema; `layer` / `aspect` enums tightened in place |

`package.json` `exports` gains the two code subpaths using the same
`types` + `import` shape as `./adapter/likec4`. `files` is unchanged (`dist`
already ships).

### Consumer shape

```ts
import {
  projectGraphForCanvas,
  type CanvasGraph,
} from 'yarramate/adapter/visual-graph'

import {
  LAYER_COLORS,
  conceptNotationOf,
  relationshipNotationOf,
  kindGlyphDataUriOf,
} from 'yarramate/notation/archimate'
```

### Purity contract (normative)

The import graphs of `./adapter/visual-graph` and `./notation/archimate` MUST
NOT include:

- `node:*` built-ins
- `ws`
- `src/adapters/visual/*` (session server, protocol wire, client)
- filesystem loaders

Enforced by a focused test over the source (or emitted) import graph for those
entry modules.

## Purity cut and module layout

### New / changed modules

```
src/graph-claims.ts                 # NEW — pure predicate constants + claim value parsers
src/graph-projection.ts             # runtime: graph-claims + kind-label; type-only from compiler
src/compiler.ts                     # imports graph-claims (behavior unchanged; may re-export)
src/adapters/visual-graph-entry.ts  # NEW — public barrel for ./adapter/visual-graph
src/notation/archimate.ts           # NEW — vocabulary for ./notation/archimate
src/visual-app/kind-icons.ts        # thin wrapper over notation module
src/visual-app/graph-canvas.tsx     # import LAYER_COLORS / shapes / edge styles from notation
schema/yarramate-visual-graph.schema.json  # layer/aspect enum ∪ null
package.json                        # exports map
```

### `graph-claims.ts`

Move these value exports out of `compiler.ts` without behavior change:

- `ATTESTATION_PREDICATE_PREFIX`
- `parseAttestationClaimValue`
- `parseConstraintExpectsValue`
- any tiny types those parsers need (`AttestationClaimParts`,
  `ConstraintExpectsParts`)

`compiler.ts` continues to expose them if anything external already imported
them from the compiler surface (prefer re-export for compatibility inside the
repo). No public package API change is required for these helpers.

### `graph-projection.ts` after the cut

Runtime imports only:

- `./graph-claims.js`
- `./kind-label.js`
- `import type { GraphClaim, ResolvedProfileContext, SemanticGraph }` from
  `./compiler.js` (type-only; erased at emit)

### `visual-graph-entry.ts`

```ts
export {
  projectGraphForCanvas,
  type CanvasGraph,
  type CanvasNode,
  type CanvasEdge,
} from '../graph-projection.js'
```

### Compatibility

- Session path keeps importing `projectGraphForCanvas` from
  `../../graph-projection.js` — same symbol, same behavior.
- Existing tests keep importing from `src/graph-projection.js`.
- No wire/format version bump: document format remains
  `yarramate/visual-graph/v1`. Schema enum tightening accepts every value the
  projector already emits.

## Notation vocabulary shape

### Module

`src/notation/archimate.ts` → `yarramate/notation/archimate`

Renderer-neutral data + small lookups. No cytoscape, no DOM, no Node.

### Layer colours (canvas palette)

```ts
export const LAYER_COLORS: Record<Layer, { readonly fill: string; readonly border: string }>
```

| Layer | fill | border |
|---|---|---|
| motivation | `#CCCCFF` | `#8F8FE0` |
| strategy | `#F5DEAA` | `#C9A355` |
| business | `#FFFF99` | `#C9C355` |
| application | `#CCFFFF` | `#4FB8B8` |
| technology | `#CCFFCC` | `#5FAE5F` |
| implementation | `#FFE0E0` | `#D89999` |
| physical | `#F0F0F0` | `#999999` (today’s neutral default) |
| composite | `#F0F0F0` | `#999999` (today’s neutral default) |

### Aspect → shape

| Aspect | shape | extra |
|---|---|---|
| active-structure | `rectangle` | — |
| behavior | `round-rectangle` | — |
| passive-structure | `rectangle` | `accent: 'top-band'` |
| motivation | `octagon` | — |
| composite | `rectangle` | `borderStyle: 'dashed'` |

`accent` and `borderStyle` are renderer-neutral tokens. The local app keeps
mapping `top-band` to the existing cytoscape gradient and `dashed` to
`border-style: dashed`.

### Concept kind entry

One row per core `conceptKinds` entry in `src/profile.ts`:

```ts
interface ConceptNotation {
  readonly id: string                 // local kind id
  readonly notation: string           // profile human name
  readonly layer: Layer
  readonly aspect: Aspect
  readonly shape: 'rectangle' | 'round-rectangle' | 'octagon'
  readonly accent?: 'top-band'
  readonly borderStyle?: 'dashed'
  readonly glyph: string | null       // bare SVG body, or null
  readonly colors: { readonly fill: string; readonly border: string }
}
```

- **Coverage:** every core concept kind.
- **Glyphs:** lift the 17 existing bodies from `kind-icons.ts`; all other core
  kinds ship `glyph: null`.
- **Profile aliases** (`compiler-module`, `repository-file`) are **not** in this
  table. The visual app keeps a local alias → parent glyph map (as today).

### Relationship kind entry

One row per core relationship kind (all 11), matching the ArchiMate branch of
`buildStylesheet` in `graph-canvas.tsx`:

```ts
interface RelationshipNotation {
  readonly id: RelationshipKind
  readonly lineStyle: 'solid' | 'dotted' | 'dashed'
  readonly sourceArrow: {
    readonly shape: 'none' | 'triangle' | 'circle' | 'diamond' | 'vee'
    readonly fill?: 'filled' | 'hollow'
  }
  readonly targetArrow: {
    readonly shape: 'none' | 'triangle' | 'circle' | 'diamond' | 'vee'
    readonly fill?: 'filled' | 'hollow'
  }
}
```

### Public API

```ts
export const LAYER_COLORS
export const ASPECT_SHAPES
export const CONCEPT_NOTATION: readonly ConceptNotation[]
export const RELATIONSHIP_NOTATION: readonly RelationshipNotation[]

export function conceptNotationOf(kindLabel: string): ConceptNotation | null
export function relationshipNotationOf(kindLabel: string): RelationshipNotation | null
export function kindGlyphDataUriOf(kindLabel: string): string | null
// wraps glyph body with the same stroke chrome kind-icons uses today (INK, 14px)
```

Optional convenience bag `archimateNotation` may group the tables; not required
if named exports are clearer. No separate JSON asset in v1.

### App cutover

- `kind-icons.ts` becomes a thin wrapper over `kindGlyphDataUriOf` (and may keep
  `ICON_SIZE` + the two profile aliases).
- `graph-canvas.tsx` imports `LAYER_COLORS`, aspect shape table, and relationship
  notation from the shared module and builds cytoscape selectors from that data.
- Pixels and behavior for kinds that already had glyphs/colours stay unchanged.

## Schema enums

In `schema/yarramate-visual-graph.schema.json`, replace free strings using the
same `anyOf: [enum, null]` pattern already used elsewhere in this package's
schemas (e.g. visual-graph attestation fields, visual-status):

```json
"layer": {
  "anyOf": [
    {
      "enum": [
        "motivation", "strategy", "business", "application",
        "technology", "physical", "implementation", "composite"
      ]
    },
    { "type": "null" }
  ]
},
"aspect": {
  "anyOf": [
    {
      "enum": [
        "motivation", "active-structure", "behavior",
        "passive-structure", "composite"
      ]
    },
    { "type": "null" }
  ]
}
```

TypeScript `CanvasNode` in `graph-projection.ts` narrows to
`Layer | null` and `Aspect | null` (import types from `profile.ts` — pure,
already Workers-safe).

Projector output is unchanged: values already come from
`profileContext.conceptKindLayers` / `conceptKindAspects`, which are populated
from those enums.

## Documentation touchpoints

Minimal, only where consumers look today:

- `docs/CONSUMING-YARRAMATE.md` — short note that hosted/browser renderers can
  import `yarramate/adapter/visual-graph` and `yarramate/notation/archimate`,
  and that the local visual runtime remains optional/local-only.
- `docs/VISUAL-ADAPTER.md` — point ArchiMate notation mode at the shared
  vocabulary module as source of truth (still ADR 0087 standing).
- `CHANGELOG.md` — under Unreleased: two new export subpaths + schema enum
  tighten.

No new ADR required unless implementation discovers a decision that contradicts
0087; this work implements 0087’s packaging consequence rather than replacing it.

## Verification

| Check | Evidence |
|---|---|
| Projector behavior preserved | Existing `test/graph-projection.test.ts` green |
| Schema enums | Extend `test/visual-graph-schema.test.ts`: accept each enum value + `null`; reject free strings |
| Notation completeness | New unit test: every `conceptKinds` id present; every `relationshipKinds` id present; colours match the locked table; 17 known glyphs non-null |
| Purity | New test walks import graph from `visual-graph-entry.ts` and `notation/archimate.ts`; fails on `node:`, `ws`, or `adapters/visual/` |
| App still builds | `pnpm` visual build / existing visual-app unit tests (`graph-canvas*.test.ts`, kind-icon tests if any) |
| Package exports | `package.json` exports resolve; `tsc` build emits `dist/adapters/visual-graph-entry.*` and `dist/notation/archimate.*` |

## Implementation order

1. Extract `src/graph-claims.ts`; point `compiler.ts` + `graph-projection.ts` at it.
2. Add `src/adapters/visual-graph-entry.ts` + package export; purity test.
3. Add `src/notation/archimate.ts` with full core tables; unit tests; package export.
4. Point `kind-icons.ts` + `graph-canvas.tsx` at the notation module; keep profile aliases local.
5. Tighten visual-graph schema + `CanvasNode` types; schema tests.
6. Docs + CHANGELOG.
7. Full focused verification pass above.

## Risks

| Risk | Mitigation |
|---|---|
| Draft-2020-12 `enum` with `null` quirks in Ajv | Prefer the formulation already used elsewhere in-repo if one exists; cover with schema tests |
| Glyph SVG chrome drift (wrapper attributes) | `kindGlyphDataUriOf` owns the wrapper; app stops duplicating it |
| Accidental session import into pure subpath | Purity test on CI path for those entries |
| Consumers expecting profile aliases in core vocabulary | Document that aliases are consumer-local; only core kinds are exported |

## Out of scope follow-ups (not this change)

- Syncing LikeC4 specification colours to the canvas palette.
- Generating glyphs for every core kind.
- Exporting visual session protocol helpers for non-local hosts.
- Re-exporting the projector from the main `yarramate` entry.
