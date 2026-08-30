# An edge across a nesting boundary is not laid out

Status: accepted

From ApertureX (#439), field-reported on a live consulting engagement: the
canvas drew two shapes and a stack of superimposed labels for a 66-subject
project. Bisected by the adopter to a four-edge minimal case, reproduced and
generalised here.

## The defect

Composition maps 1:1 onto cytoscape's compound `parent` field (ADR 0004): the
container is the relationship's `from`, the nested child its `to`. So a pair
that **also** carries any other relationship produces an edge from a container
to its own child, and ELK cannot lay that out. The pair renders; **every
unrelated node loses its geometry** and stacks at coincident coordinates with
no shape. `Fit` then zooms IN, because only the surviving fragment
contributes to the drawn bounding box.

Measured on the five-concept minimal model, 1600x1000 viewport, painted-alpha
samples at stride 4 over the top canvas layer:

| model | painted | drawn box |
|---|---|---|
| composition + realization on the pair | 543 | 124 x 64 |
| the same, realization removed | **10,612** | **832 x 452** |
| composition + **serving** on the pair | 543 | 124 x 64 |

**One edge, a twentyfold difference.**

## It is about nesting, not about realization

The third row is why. The field report was composition + realization;
substituting `serving` reproduces **byte-identically**. Anything drawn between
an ancestor and its descendant does it, so a fix keyed to relationship kinds
would have been keyed to the wrong thing.

## Why it reaches real models

Both edges are elicited by catalogue questions doing their jobs: "which
application composes this flow?" and "which application implements this?". A
consultant answering both correctly for one interface produces the pair, and
the adopter's field model had it three times over from ordinary work. **The
model compiles clean** - the pair is legal, and ADR 0004's rule only forbids
composition and aggregation over one ordered pair - so the first sign anyone
gets is the canvas losing every bystander.

This repository's own 358-subject self-model renders only because it happens
never to pair composition with another edge.

## Decision

An edge whose ends are nested one inside the other is **withheld from the
layout, never from the graph**. cytoscape draws an edge between its endpoints
wherever they land, so the relationship stays on the canvas and the nesting
stays too.

That is the point of this shape. `resolveNestingParents` already handles two
nesting anomalies - two compositions naming one `to`, and a composition cycle
- by leaving the affected subjects **unnested**, so the conflicting claims stay
visible. Doing that here would have been consistent and wrong: those two
anomalies are modelling mistakes, and this pair is legitimate. Throwing away a
correct nesting to work around a layout limitation would make the picture
worse to make the layout easier.

## The rule lives in its own module

`spansNesting` is in `nesting-span.ts` rather than inside `graph-canvas.tsx`,
following `subject-filter.ts`: the canvas is type-checked with JSX and a test
that imports it is not, so a pure rule lives where a test can reach it. It
walks the parent chain in both directions, because a model may declare the
edge either way and ELK is handed the same degenerate pair regardless.

The walk is bounded by a seen-set. A composition cycle should be unreachable,
since `resolveNestingParents` refuses to nest one, but the cost of being wrong
there is a frozen canvas rather than a bad picture.

## Not fixed here

The edge is withheld from layout, so ELK does not route it and cytoscape draws
it between endpoints that may sit one inside the other. For a container and
its own child that is a short stub inside the container box. It is honest and
it is not pretty; a container-to-child relationship may deserve its own
rendering one day. This ADR buys back every bystander node, which is the part
that made the canvas unusable.
