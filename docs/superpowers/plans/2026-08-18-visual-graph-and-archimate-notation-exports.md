# Visual-graph and ArchiMate notation exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Workers-safe `yarramate/adapter/visual-graph` and `yarramate/notation/archimate` package subpaths, and tighten `canvasNode.layer` / `aspect` to profile enums ∪ null.

**Architecture:** Extract pure claim-value helpers so `projectGraphForCanvas` no longer runtime-imports `compiler.ts`. Export the projector through a thin adapter barrel. Lift canvas ArchiMate colours, shapes, glyphs, and edge styles into `src/notation/archimate.ts` as the single source of truth; point the visual app at it. Schema enums close free strings without changing projector output.

**Tech Stack:** TypeScript (NodeNext package build + Bundler visual app), Vitest, Ajv 2020 JSON Schema, existing `src/profile.ts` core vocabulary.

**Spec:** `docs/superpowers/specs/2026-08-18-visual-graph-and-archimate-notation-exports-design.md`  
**Issue:** [#201](https://github.com/yarrasys/yarramate/issues/201)

## Global Constraints

- Purity: `./adapter/visual-graph` and `./notation/archimate` import graphs MUST NOT include `node:*`, `ws`, or `src/adapters/visual/*`.
- No apply / operations / compiler semantic changes; no session protocol changes.
- Layer colours = visual-app canvas palette (not LikeC4 DSL).
- Full core `conceptKinds` + all 11 `relationshipKinds`; missing glyphs are `null`.
- Profile aliases (`compiler-module`, `repository-file`) stay app-local, not in core vocabulary export.
- No main-entry re-exports; subpaths only.
- No ArchiMate conformance claim (ADR 0087).
- Prefer TDD; do not run full `pnpm verify` every task — focused tests per task; full verify once at the end.
- Skip formatters/linters beyond what the task needs; no drive-by refactors.

## File structure

| File | Responsibility |
|---|---|
| `src/graph-claims.ts` | Pure attestation/constraint claim encode/decode + predicate prefix |
| `src/graph-projection.ts` | Canvas projector; runtime-imports only pure modules + type-only compiler types |
| `src/compiler.ts` | Re-export claim helpers for in-repo callers (`reconciliation`, `rtm`) |
| `src/adapters/visual-graph-entry.ts` | Public barrel for `yarramate/adapter/visual-graph` |
| `src/notation/archimate.ts` | Renderer-neutral ArchiMate notation vocabulary |
| `src/visual-app/kind-icons.ts` | Thin wrapper: core glyphs via notation + local profile aliases |
| `src/visual-app/graph-canvas.tsx` | Consume shared colours/shapes/edge notation |
| `schema/yarramate-visual-graph.schema.json` | `layer` / `aspect` enum ∪ null |
| `package.json` | Two new `exports` entries |
| `tsconfig.visual.json` | Include `src/notation/**/*.ts` (and `src/profile.ts` if imported) |
| `test/graph-claims.test.ts` | Parser round-trip / reject cases |
| `test/export-purity.test.ts` | Import-graph purity for the two subpath entries |
| `test/archimate-notation.test.ts` | Vocabulary completeness + colour/glyph contracts |
| `test/visual-graph-schema.test.ts` | Enum accept/reject cases |
| `test/kind-icons.test.ts` | Unchanged expectations (aliases still work) |
| `test/badges.test.ts` | Still imports `LAYER_COLORS` from graph-canvas re-export or notation |
| `docs/CONSUMING-YARRAMATE.md` | Consumer note for the two subpaths |
| `docs/VISUAL-ADAPTER.md` | Point ArchiMate mode at shared vocabulary |
| `CHANGELOG.md` | Unreleased bullets |

---

### Task 1: Extract pure `graph-claims` module

**Files:**
- Create: `src/graph-claims.ts`
- Modify: `src/compiler.ts` (move bodies out; re-export)
- Modify: `src/graph-projection.ts` (import claims from `graph-claims`, types-only from compiler)
- Create: `test/graph-claims.test.ts`
- Test: `test/graph-claims.test.ts`, `test/graph-projection.test.ts`

**Interfaces:**
- Consumes: existing parser implementations currently at `src/compiler.ts` ~310–366
- Produces:
  - `ATTESTATION_PREDICATE_PREFIX: 'yarramate/attestation/'`
  - `attestationClaimValue(attestation): string`
  - `parseAttestationClaimValue(value): AttestationClaimParts | undefined`
  - `parseConstraintExpectsValue(value): ConstraintExpectsParts | undefined`
  - types `AttestationClaimParts`, `ConstraintExpectsParts`

- [ ] **Step 1: Write the failing parser tests**

Create `test/graph-claims.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ATTESTATION_PREDICATE_PREFIX,
  attestationClaimValue,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
} from '../src/graph-claims.js'

describe('graph-claims', () => {
  it('exposes the attestation predicate prefix', () => {
    expect(ATTESTATION_PREDICATE_PREFIX).toBe('yarramate/attestation/')
  })

  it('round-trips attestation values with and without recordedBy', () => {
    expect(parseAttestationClaimValue(attestationClaimValue({ by: 'a', on: '2026-08-01' }))).toEqual({
      by: 'a',
      on: '2026-08-01',
    })
    expect(
      parseAttestationClaimValue(
        attestationClaimValue({ by: 'a', on: '2026-08-01', recordedBy: 'bot' }),
      ),
    ).toEqual({ by: 'a', on: '2026-08-01', recordedBy: 'bot' })
  })

  it('rejects malformed attestation values', () => {
    expect(parseAttestationClaimValue('only-one-token')).toBeUndefined()
    expect(parseAttestationClaimValue('a not-a-date')).toBeUndefined()
  })

  it('parses constraint expects with spaces in the value', () => {
    expect(parseConstraintExpectsValue('terraform-scan region ap-southeast-2')).toEqual({
      provider: 'terraform-scan',
      key: 'region',
      value: 'ap-southeast-2',
    })
    expect(parseConstraintExpectsValue('p k value with spaces')).toEqual({
      provider: 'p',
      key: 'k',
      value: 'value with spaces',
    })
  })

  it('rejects malformed constraint expects', () => {
    expect(parseConstraintExpectsValue('only-one')).toBeUndefined()
    expect(parseConstraintExpectsValue('one two')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/graph-claims.test.ts`  
Expected: FAIL — cannot resolve `../src/graph-claims.js`

- [ ] **Step 3: Create `src/graph-claims.ts` with the moved implementations**

Move these symbols **verbatim** from `compiler.ts` (keep comments):

- `ATTESTATION_PREDICATE_PREFIX`
- `attestationClaimValue`
- `AttestationClaimParts`
- `parseAttestationClaimValue`
- `ConstraintExpectsParts`
- `parseConstraintExpectsValue`

File must have **zero** imports (pure strings only).

- [ ] **Step 4: Point `compiler.ts` at the module and re-export**

At top of `compiler.ts` (or beside previous definitions):

```ts
export {
  ATTESTATION_PREDICATE_PREFIX,
  attestationClaimValue,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
  type AttestationClaimParts,
  type ConstraintExpectsParts,
} from './graph-claims.js'
```

Delete the original bodies from `compiler.ts` so there is a single definition.

Leave `reconciliation.ts` and `rtm.ts` importing from `./compiler.js` — re-exports preserve them.

- [ ] **Step 5: Point `graph-projection.ts` at pure modules**

Replace the compiler value import with:

```ts
import {
  ATTESTATION_PREDICATE_PREFIX,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
} from './graph-claims.js'
import type {
  GraphClaim,
  ResolvedProfileContext,
  SemanticGraph,
} from './compiler.js'
import { kindLabelOf } from './kind-label.js'
```

Also narrow `CanvasNode.layer` / `aspect` types now or in Task 5 — **prefer Task 5** so this task stays extraction-only. Keep `string | null` until Task 5.

- [ ] **Step 6: Run tests**

Run:
```bash
pnpm exec vitest run test/graph-claims.test.ts test/graph-projection.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/graph-claims.ts src/compiler.ts src/graph-projection.ts test/graph-claims.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract pure graph claim value helpers

Move attestation/constraint claim encode/decode out of compiler.ts so
the visual-graph projector can import them without node:module/Ajv.
EOF
)"
```

---

### Task 2: Publish `yarramate/adapter/visual-graph` + purity test

**Files:**
- Create: `src/adapters/visual-graph-entry.ts`
- Modify: `package.json` (`exports`)
- Create: `test/export-purity.test.ts`
- Test: `test/export-purity.test.ts`

**Interfaces:**
- Consumes: `projectGraphForCanvas`, `CanvasGraph`, `CanvasNode`, `CanvasEdge` from `src/graph-projection.ts`
- Produces: package subpath `yarramate/adapter/visual-graph`

- [ ] **Step 1: Write the failing purity + export smoke tests**

Create `test/export-purity.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const root = join(process.cwd(), 'src')

const FORBIDDEN = /^(node:|ws$|fs$|path$|os$|child_process$|crypto$|net$|http$|https$)/

function runtimeImportGraph(entryRelative: string): { files: string[]; hits: string[] } {
  const seen = new Set<string>()
  const queue = [entryRelative]
  const hits: string[] = []
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (seen.has(rel)) continue
    seen.add(rel)
    const full = join(root, rel)
    if (!existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    // Strip type-only imports so `import type` from compiler.js is allowed.
    const withoutTypeImports = text.replace(
      /^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm,
      '',
    )
    for (const match of withoutTypeImports.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]!
      if (FORBIDDEN.test(spec) || spec === 'ws') {
        hits.push(`${rel} -> ${spec}`)
        continue
      }
      if (spec.includes('adapters/visual/') || spec.endsWith('/visual/session-server.js')) {
        hits.push(`${rel} -> ${spec}`)
        continue
      }
      // Disallow runtime import of compiler.js (Node/Ajv).
      if (spec.endsWith('/compiler.js') || spec === './compiler.js' || spec === '../compiler.js') {
        hits.push(`${rel} -> ${spec} (runtime)`)
        continue
      }
      if (spec.startsWith('.')) {
        let p = spec
        if (!p.endsWith('.ts') && !p.endsWith('.js') && !p.endsWith('.json')) p += '.ts'
        p = p.replace(/\.js$/, '.ts')
        const target = normalize(join(dirname(rel), p)).replace(/\\/g, '/')
        if (!seen.has(target)) queue.push(target)
      }
    }
  }
  return { files: [...seen].sort(), hits }
}

describe('package export purity', () => {
  it('adapter/visual-graph import graph stays free of Node, ws, session, and compiler runtime', () => {
    const { hits } = runtimeImportGraph('adapters/visual-graph-entry.ts')
    expect(hits).toEqual([])
  })

  it('notation/archimate import graph stays free of Node, ws, session, and compiler runtime', () => {
    // Task 3 creates the module; until then this may fail — implement Task 3
    // before expecting green, or gate with existsSync.
    const entry = 'notation/archimate.ts'
    if (!existsSync(join(root, entry))) {
      expect(existsSync(join(root, entry))).toBe(true)
      return
    }
    const { hits } = runtimeImportGraph(entry)
    expect(hits).toEqual([])
  })
})

describe('adapter/visual-graph barrel', () => {
  it('re-exports projectGraphForCanvas', async () => {
    const mod = await import('../src/adapters/visual-graph-entry.js')
    expect(typeof mod.projectGraphForCanvas).toBe('function')
  })
})
```

**Note for implementer:** Prefer splitting the notation purity assertion into Task 3’s commit if Task 2 would stay red. Minimal approach for Task 2: only assert `visual-graph-entry` purity + barrel export; add notation purity case in Task 3.

Recommended Task 2 test body — **visual-graph only**:

```ts
it('adapter/visual-graph import graph stays free of Node, ws, session, and compiler runtime', () => {
  const { hits } = runtimeImportGraph('adapters/visual-graph-entry.ts')
  expect(hits).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/export-purity.test.ts`  
Expected: FAIL — missing entry module and/or forbidden compiler runtime edge

- [ ] **Step 3: Add barrel**

Create `src/adapters/visual-graph-entry.ts`:

```ts
export {
  projectGraphForCanvas,
  type CanvasGraph,
  type CanvasNode,
  type CanvasEdge,
} from '../graph-projection.js'
```

- [ ] **Step 4: Add package export**

In `package.json` `exports`, immediately after `./adapter/graphify`:

```json
"./adapter/visual-graph": {
  "types": "./dist/adapters/visual-graph-entry.d.ts",
  "import": "./dist/adapters/visual-graph-entry.js"
}
```

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm exec vitest run test/export-purity.test.ts test/graph-projection.test.ts
pnpm exec tsc -p tsconfig.build.json --pretty false
```
Expected: PASS; `dist/adapters/visual-graph-entry.js` and `.d.ts` exist

- [ ] **Step 6: Commit**

```bash
git add src/adapters/visual-graph-entry.ts package.json test/export-purity.test.ts
git commit -m "$(cat <<'EOF'
feat: export pure visual-graph projector subpath

Add yarramate/adapter/visual-graph barrel and an import-graph purity
test so hosted/browser consumers can project without Node session code.
EOF
)"
```

---

### Task 3: ArchiMate notation vocabulary module

**Files:**
- Create: `src/notation/archimate.ts`
- Create: `test/archimate-notation.test.ts`
- Modify: `package.json` (`exports`)
- Modify: `test/export-purity.test.ts` (add notation purity case)
- Modify: `tsconfig.visual.json` (include notation + profile for app consumers)
- Test: `test/archimate-notation.test.ts`, `test/export-purity.test.ts`

**Interfaces:**
- Consumes: `conceptKinds`, `layers`, `aspects`, `relationshipKinds`, types from `src/profile.ts`
- Produces:
  - `LAYER_COLORS: Record<Layer, { fill: string; border: string }>`
  - `ASPECT_SHAPES` / concept + relationship notation tables
  - `conceptNotationOf(kindLabel: string): ConceptNotation | null`
  - `relationshipNotationOf(kindLabel: string): RelationshipNotation | null`
  - `kindGlyphDataUriOf(kindLabel: string): string | null`
  - `ICON_SIZE = 14` (same as today’s kind-icons)
  - package subpath `yarramate/notation/archimate`

- [ ] **Step 1: Write failing completeness tests**

Create `test/archimate-notation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { conceptKinds, layers, relationshipKinds } from '../src/profile.js'
import {
  CONCEPT_NOTATION,
  LAYER_COLORS,
  RELATIONSHIP_NOTATION,
  conceptNotationOf,
  kindGlyphDataUriOf,
  relationshipNotationOf,
} from '../src/notation/archimate.js'

const KNOWN_GLYPHS = [
  'applicationComponent',
  'applicationFunction',
  'applicationService',
  'artifact',
  'businessActor',
  'businessFunction',
  'capability',
  'dataObject',
  'deliverable',
  'driver',
  'goal',
  'node',
  'plateau',
  'representation',
  'requirement',
  'systemSoftware',
  'technologyFunction',
] as const

describe('archimate notation vocabulary', () => {
  it('covers every core concept kind exactly once', () => {
    const ids = CONCEPT_NOTATION.map((row) => row.id).sort()
    const expected = conceptKinds.map((k) => k.id).sort()
    expect(ids).toEqual(expected)
  })

  it('covers every core relationship kind exactly once', () => {
    const ids = RELATIONSHIP_NOTATION.map((row) => row.id).sort()
    const expected = [...relationshipKinds].sort()
    expect(ids).toEqual(expected)
  })

  it('uses the locked canvas layer palette', () => {
    expect(LAYER_COLORS.motivation).toEqual({ fill: '#CCCCFF', border: '#8F8FE0' })
    expect(LAYER_COLORS.strategy).toEqual({ fill: '#F5DEAA', border: '#C9A355' })
    expect(LAYER_COLORS.business).toEqual({ fill: '#FFFF99', border: '#C9C355' })
    expect(LAYER_COLORS.application).toEqual({ fill: '#CCFFFF', border: '#4FB8B8' })
    expect(LAYER_COLORS.technology).toEqual({ fill: '#CCFFCC', border: '#5FAE5F' })
    expect(LAYER_COLORS.implementation).toEqual({ fill: '#FFE0E0', border: '#D89999' })
    expect(LAYER_COLORS.physical).toEqual({ fill: '#F0F0F0', border: '#999999' })
    expect(LAYER_COLORS.composite).toEqual({ fill: '#F0F0F0', border: '#999999' })
    for (const layer of layers) {
      expect(LAYER_COLORS[layer]).toEqual(
        expect.objectContaining({ fill: expect.any(String), border: expect.any(String) }),
      )
    }
  })

  it('derives shape tokens from aspect', () => {
    expect(conceptNotationOf('applicationComponent')).toMatchObject({
      aspect: 'active-structure',
      shape: 'rectangle',
    })
    expect(conceptNotationOf('applicationFunction')).toMatchObject({
      aspect: 'behavior',
      shape: 'round-rectangle',
    })
    expect(conceptNotationOf('dataObject')).toMatchObject({
      aspect: 'passive-structure',
      shape: 'rectangle',
      accent: 'top-band',
    })
    expect(conceptNotationOf('goal')).toMatchObject({
      aspect: 'motivation',
      shape: 'octagon',
    })
    expect(conceptNotationOf('grouping')).toMatchObject({
      aspect: 'composite',
      shape: 'rectangle',
      borderStyle: 'dashed',
    })
  })

  it('ships glyphs for the 17 kinds the canvas already drew; null otherwise is allowed', () => {
    for (const id of KNOWN_GLYPHS) {
      expect(conceptNotationOf(id)?.glyph).toEqual(expect.any(String))
      expect(kindGlyphDataUriOf(id)).toMatch(/^data:image\/svg\+xml;utf8,/)
    }
    // A core kind never drawn before may be null — stakeholder is one.
    const stakeholder = conceptNotationOf('stakeholder')
    expect(stakeholder).not.toBeNull()
    // glyph may be null or string; lookup still works
    expect(conceptNotationOf('notAKind')).toBeNull()
    expect(kindGlyphDataUriOf('notAKind')).toBeNull()
  })

  it('maps composition and realization edge notation', () => {
    expect(relationshipNotationOf('composition')).toEqual({
      id: 'composition',
      lineStyle: 'solid',
      sourceArrow: { shape: 'diamond', fill: 'filled' },
      targetArrow: { shape: 'none' },
    })
    expect(relationshipNotationOf('realization')).toEqual({
      id: 'realization',
      lineStyle: 'dotted',
      sourceArrow: { shape: 'none' },
      targetArrow: { shape: 'triangle', fill: 'hollow' },
    })
  })

  it('does not publish profile-extended aliases', () => {
    expect(conceptNotationOf('compiler-module')).toBeNull()
    expect(conceptNotationOf('repository-file')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/archimate-notation.test.ts`  
Expected: FAIL — module missing

- [ ] **Step 3: Implement `src/notation/archimate.ts`**

Structure (implement fully — no placeholders):

```ts
import {
  conceptKinds,
  layers,
  relationshipKinds,
  type Aspect,
  type Layer,
  type RelationshipKind,
} from '../profile.js'

export const ICON_SIZE = 14
const INK = '#182228'

export const LAYER_COLORS = {
  motivation: { fill: '#CCCCFF', border: '#8F8FE0' },
  strategy: { fill: '#F5DEAA', border: '#C9A355' },
  business: { fill: '#FFFF99', border: '#C9C355' },
  application: { fill: '#CCFFFF', border: '#4FB8B8' },
  technology: { fill: '#CCFFCC', border: '#5FAE5F' },
  implementation: { fill: '#FFE0E0', border: '#D89999' },
  physical: { fill: '#F0F0F0', border: '#999999' },
  composite: { fill: '#F0F0F0', border: '#999999' },
} as const satisfies Record<Layer, { readonly fill: string; readonly border: string }>

// Aspect → shape/accent/borderStyle tables from the design.
// BASE_KIND_SVG: copy the 17 bodies from src/visual-app/kind-icons.ts verbatim.
// CONCEPT_NOTATION = conceptKinds.map(...)
// RELATIONSHIP_NOTATION = the 11 rows from graph-canvas ArchiMate edge styles.
// Lookups: Map by id; conceptNotationOf / relationshipNotationOf / kindGlyphDataUriOf
```

**Relationship table (authoritative — copy into code):**

| id | lineStyle | source | target |
|---|---|---|---|
| composition | solid | diamond filled | none |
| aggregation | solid | diamond hollow | none |
| assignment | solid | circle filled | triangle filled |
| realization | dotted | none | triangle hollow |
| specialization | solid | none | triangle hollow |
| serving | solid | none | vee |
| access | dotted | none | vee |
| influence | dashed | none | vee |
| triggering | solid | none | triangle filled |
| flow | dashed | none | triangle filled |
| association | solid | none | none |

**Glyph bodies:** copy exactly from `src/visual-app/kind-icons.ts` `BASE_KIND_SVG` (lines 42–89). Wrapper for data URI must match current chrome:

```ts
function svg(body: string): string {
  // same attributes as kind-icons.ts svg()
}
function toDataUri(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`
}
```

Build `CONCEPT_NOTATION` from `conceptKinds` so coverage cannot drift:

```ts
export const CONCEPT_NOTATION: readonly ConceptNotation[] = conceptKinds.map((kind) => {
  const shapeMeta = aspectShapeOf(kind.aspect)
  return {
    id: kind.id,
    notation: kind.name,
    layer: kind.layer,
    aspect: kind.aspect,
    ...shapeMeta,
    glyph: BASE_KIND_SVG[kind.id] ?? null,
    colors: LAYER_COLORS[kind.layer],
  }
})
```

- [ ] **Step 4: Wire package export + visual tsconfig include**

`package.json` exports:

```json
"./notation/archimate": {
  "types": "./dist/notation/archimate.d.ts",
  "import": "./dist/notation/archimate.js"
}
```

`tsconfig.visual.json` `include` add:

```json
"src/notation/**/*.ts",
"src/profile.ts"
```

(`profile.ts` is imported by notation; visual typecheck must see it.)

Extend `test/export-purity.test.ts` with the notation purity case from Task 2 notes.

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm exec vitest run test/archimate-notation.test.ts test/export-purity.test.ts
pnpm exec tsc -p tsconfig.build.json --pretty false
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/notation/archimate.ts test/archimate-notation.test.ts test/export-purity.test.ts package.json tsconfig.visual.json
git commit -m "$(cat <<'EOF'
feat: publish ArchiMate notation vocabulary export

Add yarramate/notation/archimate with full core kind coverage, canvas
layer colours, aspect shapes, glyphs, and relationship line styles.
EOF
)"
```

---

### Task 4: Point visual app at shared notation

**Files:**
- Modify: `src/visual-app/kind-icons.ts`
- Modify: `src/visual-app/graph-canvas.tsx`
- Test: `test/kind-icons.test.ts`, `test/badges.test.ts`, `test/graph-canvas.test.ts` (if present), `test/graph-canvas-layout.test.ts`

**Interfaces:**
- Consumes: `LAYER_COLORS`, `kindGlyphDataUriOf`, `ICON_SIZE`, `RELATIONSHIP_NOTATION`, aspect shape helpers from `src/notation/archimate.ts`
- Produces: unchanged browser behavior for existing glyphs/colours/edge styles

- [ ] **Step 1: Confirm existing app tests are the regression net**

Run:
```bash
pnpm exec vitest run test/kind-icons.test.ts test/badges.test.ts test/graph-canvas.test.ts test/graph-canvas-layout.test.ts
```
Expected: PASS on current main (baseline before edits)

- [ ] **Step 2: Rewrite `kind-icons.ts` as a thin wrapper**

```ts
import {
  ICON_SIZE,
  kindGlyphDataUriOf as coreKindGlyphDataUriOf,
} from '../notation/archimate.js'

export { ICON_SIZE }

const PROFILE_ALIAS_GLYPH: Record<string, string> = {
  'compiler-module': 'applicationComponent',
  'repository-file': 'artifact',
}

export function kindIconUriOf(kindLabel: string): string | null {
  const aliased = PROFILE_ALIAS_GLYPH[kindLabel]
  if (aliased !== undefined) return coreKindGlyphDataUriOf(aliased)
  return coreKindGlyphDataUriOf(kindLabel)
}
```

Remove local `BASE_KIND_SVG` / URI tables.

- [ ] **Step 3: Rewrite graph-canvas colour + ArchiMate stylesheet sources**

1. Delete local `LAYER_COLORS` definition; re-export from notation so `badges.test.ts` keeps working:

```ts
export { LAYER_COLORS } from '../notation/archimate.js'
import { LAYER_COLORS, RELATIONSHIP_NOTATION, conceptNotationOf } from '../notation/archimate.js'
```

2. Build layer colour rules by iterating `Object.entries(LAYER_COLORS)` (or fixed layer list) instead of six hand-written blocks — include physical/composite now that they have explicit neutrals (behavior: same fill as previous default for those layers).

3. Replace hard-coded `archimateNodeShapes` / `archimateEdgeStyles` arrays with generators from notation:

```ts
// Node shapes: one rule per aspect token used by ASPECT_SHAPES /
// conceptNotation aspect fields — keep the passive-structure gradient and
// composite dashed border exactly as today (DEFAULT_BORDER / DEFAULT_FILL).

// Edges:
for (const rel of RELATIONSHIP_NOTATION) {
  // selector: `edge[coreKindLabel = "${rel.id}"]`
  // map lineStyle / sourceArrow / targetArrow to cytoscape style keys
}
```

Do **not** change arrow mappings; only the source of the table moves.

- [ ] **Step 4: Run visual regression tests + visual typecheck**

Run:
```bash
pnpm exec vitest run test/kind-icons.test.ts test/badges.test.ts test/graph-canvas.test.ts test/graph-canvas-layout.test.ts test/archimate-notation.test.ts
pnpm exec tsc -p tsconfig.visual.json --pretty false
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/visual-app/kind-icons.ts src/visual-app/graph-canvas.tsx
git commit -m "$(cat <<'EOF'
refactor: drive visual app ArchiMate rendering from shared notation

Point kind-icons and graph-canvas at yarramate notation vocabulary so
the local app and package consumers share one source of truth.
EOF
)"
```

---

### Task 5: Tighten `canvasNode.layer` / `aspect` enums

**Files:**
- Modify: `schema/yarramate-visual-graph.schema.json`
- Modify: `src/graph-projection.ts` (`CanvasNode` types)
- Modify: `test/visual-graph-schema.test.ts`
- Test: `test/visual-graph-schema.test.ts`, `test/graph-projection.test.ts`

**Interfaces:**
- Consumes: `Layer`, `Aspect` from `src/profile.ts`
- Produces: schema + types that accept enum values ∪ null only

- [ ] **Step 1: Write failing schema tests**

Append to `test/visual-graph-schema.test.ts` a minimal valid node factory used by new cases, then:

```ts
const baseNode = {
  id: 'main#service',
  localId: 'service',
  document: 'main.yaml',
  kind: 'yarramate/core@0.1#applicationComponent',
  kindLabel: 'applicationComponent',
  layer: 'application',
  aspect: 'active-structure',
  name: 'Service',
  description: null,
  aka: [],
  status: null,
  owner: null,
  distinctFrom: [],
  supersedes: [],
  constraints: [],
  references: [],
  presentIn: [],
  attestations: [],
}

it('accepts every profile layer and aspect enum value and null', () => {
  const layers = [
    'motivation', 'strategy', 'business', 'application',
    'technology', 'physical', 'implementation', 'composite', null,
  ]
  const aspects = [
    'motivation', 'active-structure', 'behavior',
    'passive-structure', 'composite', null,
  ]
  for (const layer of layers) {
    expect(validateVisualGraph({ nodes: [{ ...baseNode, layer }], edges: [] })).toBe(true)
  }
  for (const aspect of aspects) {
    expect(validateVisualGraph({ nodes: [{ ...baseNode, aspect }], edges: [] })).toBe(true)
  }
})

it('rejects free-string layer and aspect values', () => {
  expect(
    validateVisualGraph({ nodes: [{ ...baseNode, layer: 'not-a-layer' }], edges: [] }),
  ).toBe(false)
  expect(
    validateVisualGraph({ nodes: [{ ...baseNode, aspect: 'not-an-aspect' }], edges: [] }),
  ).toBe(false)
})
```

- [ ] **Step 2: Run test to verify reject case fails open (still accepts free strings)**

Run: `pnpm exec vitest run test/visual-graph-schema.test.ts`  
Expected: new reject test FAIL (free strings still valid) or accept test may already pass

- [ ] **Step 3: Update schema**

Replace `layer` / `aspect` property schemas under `canvasNode` with:

```json
"layer": {
  "anyOf": [
    {
      "enum": [
        "motivation",
        "strategy",
        "business",
        "application",
        "technology",
        "physical",
        "implementation",
        "composite"
      ]
    },
    { "type": "null" }
  ]
},
"aspect": {
  "anyOf": [
    {
      "enum": [
        "motivation",
        "active-structure",
        "behavior",
        "passive-structure",
        "composite"
      ]
    },
    { "type": "null" }
  ]
}
```

- [ ] **Step 4: Narrow TypeScript types**

In `graph-projection.ts`:

```ts
import type { Aspect, Layer } from './profile.js'

export interface CanvasNode {
  // ...
  readonly layer: Layer | null
  readonly aspect: Aspect | null
  // ...
}
```

Runtime assignment unchanged (`profileContext.conceptKindLayers.get(kind) ?? null`). If Map values are typed `string`, assert/narrow via `as Layer` only if necessary — prefer typing the maps later; a local helper is fine:

```ts
layer: (profileContext.conceptKindLayers.get(kind) as Layer | undefined) ?? null,
aspect: (profileContext.conceptKindAspects.get(kind) as Aspect | undefined) ?? null,
```

(Only if tsc requires it; avoid if inference already works.)

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm exec vitest run test/visual-graph-schema.test.ts test/graph-projection.test.ts
pnpm exec tsc -p tsconfig.build.json --pretty false
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add schema/yarramate-visual-graph.schema.json src/graph-projection.ts test/visual-graph-schema.test.ts
git commit -m "$(cat <<'EOF'
fix: enum-constrain visual-graph layer and aspect

Close canvasNode.layer/aspect to the profile vocabulary (plus null) so
swimlane placement is not free-string.
EOF
)"
```

---

### Task 6: Docs, changelog, full verification

**Files:**
- Modify: `docs/CONSUMING-YARRAMATE.md`
- Modify: `docs/VISUAL-ADAPTER.md`
- Modify: `CHANGELOG.md`
- Test: full focused suite + build

- [ ] **Step 1: Consumer docs**

In `docs/CONSUMING-YARRAMATE.md`, after the visual conversations section (before MCP), add a short subsection:

```markdown
## Hosted or browser rendering of the visual graph

Consumers that compile a workspace themselves (or receive a compiled
`SemanticGraph` and profile context) and render with their own cytoscape (or
other) host can import the pure projection and notation surfaces — without
starting `yarramate-visual`:

```ts
import { projectGraphForCanvas } from 'yarramate/adapter/visual-graph'
import {
  conceptNotationOf,
  relationshipNotationOf,
  kindGlyphDataUriOf,
  LAYER_COLORS,
} from 'yarramate/notation/archimate'
```

These subpaths are Workers/browser-safe: no Node built-ins, no `ws`, and no
visual session server. The local `yarramate-visual` runtime remains the
optional loopback conversation product and is not required for projection.
`presentation.notation: 'archimate'` is still a rendering mode only
([ADR 0087](adr/0087-archimate-notation-is-a-rendering-mode-not-a-vocabulary.md));
the notation module is descriptive vocabulary for that mode, not an ArchiMate
conformance package.
```

(Fix nested fence if markdown requires indent/ alternate fencing.)

- [ ] **Step 2: Visual adapter docs**

In `docs/VISUAL-ADAPTER.md` ArchiMate notation mode section (~line 101), add one sentence after the opening paragraph:

```markdown
The kind colours, aspect shapes, glyphs, and relationship line styles are
defined once in the published `yarramate/notation/archimate` module; this app
imports that module rather than keeping a parallel table.
```

- [ ] **Step 3: CHANGELOG**

Under `## Unreleased` prepend:

```markdown
- Export a Workers-safe visual-graph projector as
  `yarramate/adapter/visual-graph` (`projectGraphForCanvas`) and a
  renderer-neutral ArchiMate notation vocabulary as
  `yarramate/notation/archimate` (layer colours, aspect shapes, kind glyphs,
  relationship line styles). The local visual app consumes the same
  vocabulary. `canvasNode.layer` / `aspect` in
  `yarramate/visual-graph/v1` are closed on the profile enums (plus null).
  No session-protocol or apply changes (#201).
```

- [ ] **Step 4: Full verification**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.visual.json --pretty false
pnpm exec tsc -p tsconfig.build.json --pretty false
pnpm exec vitest run test/graph-claims.test.ts test/export-purity.test.ts test/archimate-notation.test.ts test/graph-projection.test.ts test/visual-graph-schema.test.ts test/kind-icons.test.ts test/badges.test.ts test/graph-canvas.test.ts test/graph-canvas-layout.test.ts
pnpm build
```
Expected: all PASS; `dist/adapters/visual-graph-entry.js` and `dist/notation/archimate.js` present

Optional broader: `pnpm test` if time allows.

- [ ] **Step 5: Commit**

```bash
git add docs/CONSUMING-YARRAMATE.md docs/VISUAL-ADAPTER.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: document visual-graph and ArchiMate notation package exports

Describe the new subpaths for hosted/browser renderers and note the
shared notation source in the visual adapter guide (#201).
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Pure claim-helper extract | Task 1 |
| `yarramate/adapter/visual-graph` export | Task 2 |
| Purity: no node/ws/session/compiler runtime | Tasks 2–3 |
| `yarramate/notation/archimate` full core coverage | Task 3 |
| Canvas palette locked colours | Task 3 |
| Glyphs for 17 existing; null elsewhere; no profile aliases in export | Task 3 |
| 11 relationship notations | Task 3 |
| visual-app cutover | Task 4 |
| Schema layer/aspect enums ∪ null | Task 5 |
| CanvasNode TS narrowing | Task 5 |
| CONSUMING + VISUAL-ADAPTER + CHANGELOG | Task 6 |
| Non-goals (no apply/session/LikeC4 sync/main re-export) | Honoured throughout |

## Plan self-review

- **Placeholders:** none; relationship table and colour values inlined.
- **Type names:** `ConceptNotation` / `RelationshipNotation` defined in Task 3 implementation; tests use exported values only.
- **tsconfig.visual gap:** Task 3 includes `src/notation/**/*.ts` and `src/profile.ts`.
- **Purity test vs Task 3 ordering:** Task 2 purity is visual-graph-only; notation purity lands in Task 3.
- **badges.test.ts:** continues importing `LAYER_COLORS` from `graph-canvas` via re-export.
