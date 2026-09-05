# A folded instance is a node, and the view says the default

Status: accepted

> Amends ADR 0101's assignment-nesting rule. The exception it adds is stated
> below under "The service rule".

A pattern instance draws as a scatter of member boxes. On the ApertureX
reference — 277 subjects, 431 relationships — nothing collapses, so eight
applications put 102 of their members on the canvas as peers of everything
else. The structure the pattern already knows is invisible at the grain a
reader wants (#473).

**Folding** makes an instance one node that carries its members inside it, with
the edges into and out of those members lifted onto the box.

## The containment tree

One tree, built in `src/fold-tree.ts`, which imports nothing. A VIEW says which
relationships nest (ADR 0101); a PATTERN says which subjects are parts
(ADR 0123). Both produce a parent-of map over the same ids, and folding reads
that one map — answering them apart would mean two trees that can disagree
about who owns a node.

A slot member joins the tree only when all three hold, and each exclusion is a
different way of getting the answer wrong:

- **Exclusive.** A subject bound into two instances has two owners, and a
  single-parent tree would silently pick one.
- **`owned` or `unwired`, never `context`.** A context slot names what the
  instance USES and does not contain — the upstream API it calls, the plane it
  runs on. Folding those would swallow half the landscape into whichever box
  happened to name it.
- **Not a ruling.** A ruling is a policy, not machinery, and is routinely
  shared, which a single-parent tree cannot represent anyway (review F5). Phase
  3 gives them rows.

**A slot wired in BOTH directions is `owned`.** Not in the brief; decided here
and accepted by the requesting session. Holding something out is the stronger
statement, and it is what a reader means by drawing the box around it.

Same-rank conflicts are RETURNED rather than resolved, and cycles are guarded
in the combined tree — slot membership can close a loop neither half closed
alone, so the guard runs again after memberships join.

## The service rule

ADR 0101 said assignment nests internal behaviour but never a service, because
a service is the promise the layer above consumes and burying it inside the
component that implements it inverts what it is for. That stands, with one
exception:

> Assignment nests unless the target's **core** kind ends with `Service`, and a
> service **is** nested when the source's core kind ends with `Interface`.

An interface assigned a service is the opposite relation to implementation: the
interface is the exposure and the service is what it exposes, so it belongs
inside.

**Both tests read CORE kinds.** The rule this replaces tested the profile
kind's label, so a profile that named a service `mule-api-operation` slipped
through and nested while a plain `applicationService` beside it did not — one
relation drawn two ways depending on what somebody called it.

Measured before adopting, over this repository's own model: **362 subjects, 47
assignment edges, and zero verdict changes** across all **22** authored views.
Measured by running the old rule and the new one over the same edges and
diffing the parent-of maps, not by trusting that nothing moved.

> The brief called this a "28-view sweep". This repository has 22 authored
> projections and the sweep covers all of them. Whatever 28 counted, it is not
> `.yarramate/projections/*.yaml` on `main`.

## What ships beside it

- `PatternMembership.wiring?: 'owned' | 'context' | 'unwired'`, read from the
  pattern so it holds whether or not the slot is bound. `yarramate/graph/v2` is
  unchanged: this is compile CONTEXT like the rest of membership (ADR 0131).
- `presentation.fold?: 'instances' | 'none'` on a view, defaulting to `none`. A
  view that hid detail without being asked would be a surprise its author never
  wrote down.
- Optional `folded` / `unfolded` on the layout sidecar, written WITH the
  positions in one document and in full every time. Still
  `yarramate/visual-layout/v1`: the addition is optional, so every sidecar
  already on disk stays valid, and a v2 would force every reader to branch on a
  version for a field it can simply not find.
- `foldTree` / `foldGraph` on the runtime-neutral `yarramate/adapter/visual-graph`
  subpath, because a host that never renders still has to answer "what is
  inside this box".

## Two override sets, not one flag

`fold.set` restates the view's default on every view switch — the rule
`nesting.set` follows. A reader who opened a box must not have it shut again
the moment that default is read back, so state keeps both what was shut beyond
the default and what was opened against it. That regression has its own test.

## Hide, never remove

A folded box's members stay in the element list with their positions
(review F4). Opening a box then has nothing to rebuild, and `layout.save` still
names every member — removing them would lose exactly the coordinates a save is
for. A test fails if they are removed.

A folded ancestor hides its descendants **even where the view names them**: a
reader who shut a box asked not to see inside it, and a view chosen earlier
cannot overrule a gesture made later.

## Gate F7: measured, failed, fallback taken

Interactive placement was proposed so that shutting one box would not rearrange
the nine the reader was not looking at. Reference Landscape view, 157 subjects,
one fold and one unfold, anchored on the toggled node before measuring:

| case | placement | untouched | median displacement | crossings | layout |
|---|---|---|---|---|---|
| fold | INTERACTIVE | 140 | **1156 px** | 3312 → 4021 | 66 ms |
| unfold | INTERACTIVE | 140 | **2799 px** | 4027 → 4586 | 65 ms |
| fold | NETWORK_SIMPLEX | 140 | 1203 px | 3312 → 4027 | 49 ms |
| unfold | NETWORK_SIMPLEX | 140 | 1203 px | 4027 → 3312 | 40 ms |

The gate was a median under one node width (170 px) with crossings not rising.
**Missed by an order of magnitude, on both strategies.**

INTERACTIVE is not merely short of the gate — it is **worse than the fallback**:
2799 px against 1203 px on an unfold, and it raises crossings on both cases
where network simplex lowers them on the unfold. So the fallback is taken on
the head-to-head comparison, not only on the threshold. There was nothing to
trade away.

The interactive plumbing is **removed rather than left switched off**: dead
configuration invites someone to switch it back on without re-measuring.

**Caveat on the absolute figures.** The harness is headless cytoscape with no
stylesheet, so nodes carry default dimensions rather than the canvas's real
ones, and the pixel numbers are not directly comparable to a threshold defined
by a real node's width. The relative comparison is sound — one harness, one
fixture, one variable — and it is what decides this.

**What ships is the anchor**, not the strategy: lay out, translate the whole
result so the toggled box keeps its screen position, and re-frame only if the
change would otherwise be off screen. Anchoring is what actually keeps the
reader's place.

## Acceptance, reproduced against the reference

Compiled through the reference's own manifest — `check` reports 277 concepts
and 431 relationships, matching what the adopter's tests compile.

| claim | expected | measured |
|---|---|---|
| top-level, whole model | 172 | **172** |
| absorbed by the eight applications | 102 | **102** |
| lifted app→app servings | 7 | **7**, exact counts |
| interface→service assignments nested | 15 / 15 | **15 / 15** |
| Landscape view | 157 → 73 | **157 → 73** |
| conflicts / cycles, all six views | — | **0 / 0** |

## Excluded

- **A `visual-layout/v2`.** The addition is optional; a version bump would make
  every reader branch for a field it can simply not find.
- **Folding by default.** A view says where to START, not what may be seen.
- **Removing members instead of hiding them.** Review F4, and it would lose the
  positions a `layout.save` exists to keep.
- **Rulings as nested nodes.** They are shared and they are not parts.
