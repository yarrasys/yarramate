# Radial is concentric and force is stress-then-spore

Status: accepted

> Superseded in 1.0: `radial` and `force` are removed, leaving `layered` as
> the only backend, and `presentation.seed` is removed with them because only
> `force` read it. Measured on every view of the contact-update journey,
> both lost to `layered` on edge crossings, total edge length, and how large
> the graph draws once fitted to the canvas. What this ADR decided remains
> true of the code it described: `radial` was cytoscape `concentric`, not ELK
> radial, and `force` was `stress` followed by `sporeOverlap`. A future layout
> mechanism will be recorded in its own ADR.

[ADR 0085](0085-a-dragged-position-is-presentation-the-repository-keeps.md)
settled where a layout's *output* lives once a reviewer touches it by hand.
This ADR settles what an *automatic* layout actually runs, because the
design's naming — `presentation.layout: 'layered' | 'radial' | 'force'` —
implied three variants of the one engine already wired in, and that
implication does not survive contact with this repository's own graph.

## Why measurement, not the obvious mapping

The obvious reading of `radial` and `force` is "the elk algorithms with
those names" — `cytoscape-elk` was already a dependency, `layered` already
used it, and adding two more `elk.algorithm` values looks like a one-line
change. Before writing that line, all three candidates were measured
against this repository's own compiled graph — 258 concepts, 352
relationships, 220×64 px nodes, exported via `node dist/cli.js export
graph` — because a synthetic fixture graph would not have caught the
failure below, and a layout that only works on a toy graph is not a real
backend.

| backend | dependency | time | overlapping pairs | canvas |
|---|---|---|---|---|
| elk `layered` (unchanged) | installed | 112 ms | 0 | 6272×9827 |
| elk `radial` | installed | 35 ms | **17 578** | 12017×8535 |
| elk `radial` + `sporeOverlap` | installed | **>300 s** | — | — |
| cytoscape `concentric` `spacingFactor 1.4` | **built-in** | **4 ms** | **0** (leaf and compound-parent) | 25056×24900 |
| cytoscape `cose` | built-in | 727 ms | 172 | 4622×4939 |
| elk `stress`(320) + `sporeOverlap` | installed | 5.4 s | **0** | 8025×5714 |
| `cytoscape-cola` `avoidOverlap` | NEW dep | 293 ms | 0 | 488×21646 (degenerate strip) |
| `cytoscape-cola` `edgeLength 320` | NEW dep | **180 s** | 0 | 8335×14094 |
| `cytoscape-fcose` | NEW dep | 97 ms | 294 | 3832×1934 |

## Rejected: elk `radial` for `radial`

ELK's `radial` is a *tree* algorithm. Run over a 352-edge non-tree graph it
piles up 17,578 overlapping node-bounding-box pairs — worse than doing no
layout at all — and running `sporeOverlap` afterward to clean that up does
not terminate inside five minutes. There is no tuning knob that turns a
tree layout into a general-graph one; the algorithm's structural
assumption is the wrong one for this data, not a parameter choice.

`radial` maps instead to cytoscape's own built-in `concentric`: nodes rank
by degree onto concentric rings, hubs in the centre — which is the reading
a "radial" view is for, and it is 4 ms and zero overlaps on this graph,
compound parents included, with no separate overlap pass.

## Rejected: a new dependency for `force`

`force` is the one name that plausibly means "a force-directed layout",
and the two force-directed cytoscape extensions were tried on their own
merits, not dismissed on principle:

- `cytoscape-cola` with `avoidOverlap` produced a degenerate 488×21646
  strip at its defaults — zero overlaps only because every node is
  crushed into a near-1D line, which is not a readable layout.
- `cytoscape-cola` tuned with `edgeLength: 320` fixed the strip but took
  180 s, three orders of magnitude slower than what shipped.
- `cytoscape-fcose` was fast (97 ms) but left 294 overlapping pairs —
  better than raw `cose`, still not zero.

Neither justified a new dependency. `force` = elk `stress`
(`desiredEdgeLength: 320`), already installed for `layered`, run as a
first pass, then a second `sporeOverlap` pass over the settled result: 5.4
s and zero overlaps on the full graph, and no new package in `package.json`.

## Decided

Three backends, one dependency (`cytoscape-elk`, already present) plus
cytoscape's own built-ins — no `cytoscape-cola`, no `cytoscape-fcose`:

- **`layered`** — elk `layered`, unchanged from before this plan. Honours
  `direction` (`elk.direction: DOWN | RIGHT`); the only backend that does.
- **`radial`** — cytoscape's built-in `concentric`, `spacingFactor: 1.4`,
  `avoidOverlap: true`. Not elk-based, deterministic by construction, no
  `direction` and no seed.
- **`force`** — a two-pass `runLayout`: elk `stress`
  (`org.eclipse.elk.stress.desiredEdgeLength: 320`) first, then, once its
  `layoutstop` fires, a second elk `sporeOverlap` pass over the same
  collection. A ref-guarded supersede check (`cy.layout(...).stop()`)
  cancels a run superseded by a newer request instead of stacking a second
  `sporeOverlap` chain on top, and the browser shows a `"Laying out..."`
  busy notice for the run's duration rather than a canvas that appears
  frozen mid-recompute. Measured scaling, zero overlaps throughout: 25
  nodes 73 ms / 50 nodes 123 ms / 100 nodes 917 ms / 258 nodes **5.4 s** —
  not a per-keystroke layout, which is exactly why it needs the busy state
  and the supersede guard.

`elk.randomSeed` is INT-typed; `presentation.seed` is a string on the wire
(`nonEmptyText`), so the browser FNV-1a-hashes it to a signed int32
(`Math.imul`) before handing it to elk. Measured per backend on a
seed-sensitive fixture: `layered` is deterministic and ignores the seed
outright, `concentric` is deterministic by construction and never reaches
elk, and `stress` — the `force` backend's first pass — is the one backend
whose initial placement the seed visibly moves. `presentation.seed` stays
saved for every view; it only reproduces a `force` layout.

`elk.direction` is meaningless outside `layered` — identical output
(same position hash) for `DOWN` and `RIGHT` on `stress`, and `concentric`
has no direction concept at all — so only `layered` reads `direction`;
`radial` and `force` ignore it.

## What this costs

- **`radial` is a misleading name for what runs.** A reviewer who expects
  ELK's radial tree layout gets cytoscape's concentric-ring layout
  instead. The name describes the reading the view is for, not the
  algorithm underneath, and nothing in the UI currently says "concentric."
- **`force` is not interactive.** 5.4 s on this repository's own graph
  means it is a deliberate, occasional choice, not something a reviewer
  reaches for while narrowing a filter — which is also why the filter
  effect's relayout gate stays scoped to view/layout/direction changes,
  never to quick-filter narrowing, for every backend.
- **The seed only ever does one thing.** A reviewer who sets a seed
  expecting it to also reorder a `radial` or `layered` view will see no
  effect and no diagnostic explaining why — that is `elk`'s own contract,
  not a bug this plan introduces, but it is a surprise the UI does not
  currently flag.

This complements [ADR 0085](0085-a-dragged-position-is-presentation-the-repository-keeps.md)
— that ADR settled where a hand-dragged position is kept once a reviewer
overrides any of the three backends above — and supersedes nothing.
