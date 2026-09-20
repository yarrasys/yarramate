# What a view selects is what it draws

Status: accepted

A projection's query says which relationships a view holds. `relationships`
chooses `between`, `connected` or `none`; `relationshipKinds` narrows by kind.
Every read surface honoured that. The canvas did not.

`projectGraphForCanvas(graph, profileContext)` takes **no query argument**
(`src/graph-projection.ts:394`). It walks `graph.subjects` and emits every
concept as a node and every relationship as an edge, so the canvas holds the
entire model. The view arrives separately as `matchedIds`, and `applyFilter`
read it as a set of *nodes*: an edge was drawn whenever both its ends were
visible, whatever the query had said about it.

Measured on this repository's own model, comparing each projection's selected
relationships against every model edge between the nodes the canvas actually
shows. That set is not the query's selected concepts: `applyFilter` pulls in
every visible node's ancestor chain along the view's nesting kinds
(`graph-canvas.tsx:1014-1022`), selected or not, so a box shown to hold a
member brought its own edges with it.

| projection | `relationships` | selected | extra drawn |
|---|---|---|---|
| starter-information-structure | connected | 117 | **46** |
| starter-landscape | connected | 180 | **33** |
| starter-technology-deployment | connected | 36 | 7 |
| engine-components | **none** | **0** | **6** |
| starter-strategy | connected | 30 | 5 |
| starter-application-cooperation | between | 69 | 2 |
| starter-implementation-roadmap | connected | 9 | 2 |
| starter-motivation | connected | 25 | 2 |

Eight of twenty-two projections, 103 edges. `starter-information-structure`
asks for `access`, `aggregation`, `association` and `composition`, and drew 26
`serving` edges on top: a view about how information is structured, carrying
the application layer's service wiring through it, 39% more edges than the
query selected. `engine-components` declares `relationships: none` and drew
six.

Two of these are only reachable through the ancestor pull-in, which is why it
is stated above: `starter-landscape` and `starter-technology-deployment` each
draw one edge belonging to a box the query never selected. And the defect is
not confined to `connected` views. `starter-application-cooperation` is
`between`, where a relationship needs both endpoints selected, and still drew
two `implements` edges because `between` is narrowed by `relationshipKinds`
and the canvas was not. A `between` view with nesting can move for the
ancestor reason as well.

## The decision

**What a view selects is what it draws.** An edge is drawn only where the view
selected it and both its ends are on screen.

Both conditions are necessary and neither is sufficient. The endpoints,
because an edge to nowhere is not a relationship anyone can read. The
selection, because a view that names what it draws means it.

The alternative reading was arguable and is rejected. It says `relationships`
and `relationshipKinds` only ever selected subjects *into* a view, and hiding
a real relationship between two subjects on screen is a lie of omission. The
trouble is that it leaves `relationships: none` meaning nothing at all on the
one surface people actually look at, and it makes a viewpoint unable to be a
viewpoint: the whole purpose of an information-structure view is to leave the
service wiring out.

`applyFilter`'s existing endpoint rule was a sound answer to a different
question — *may an edge keep itself on screen once its ends are gone?* — and
it stays, alongside the selection it was never asked about.

## What this cost and did not cost

**Nothing new is computed and nothing moves on the wire.** `matchedIdsOf`
(`src/adapters/visual/workspace-model.ts:398`) is
`evaluateProjection(…).subjects.map(({ id }) => id)`, and `ProjectionResult`'s
`subjects` holds relationships as well as concepts. The matched relationship
ids were already being computed, already sent, and already arriving at the
canvas, which named them in a comment and then ignored them for visibility.

**A lifted edge is judged by what it stands for.** Its `lift:` id is synthetic
and never in a match set, so it draws while the view selected any of the
relationships it aggregates and goes when it selected none. Its count is still
taken over the model rather than the view, which is unchanged by this decision
and is only reachable where a projection both folds and names relationship
kinds; nothing in this repository or the reference adopter does.

**One inconsistency was fixed on the way.** The match set was seeded whole into
the visible set, so an edge the view named survived even after the quick filter
had taken one of its ends — the opposite of what the function documents. Edge
visibility is now decided explicitly rather than inherited from that seed.

## Consequences

Behaviour-changing, and in one direction only: views lose edges, never gain
them. Every adopter with `relationshipKinds` or `relationships: none` on a view
sees a canvas that draws less than it did, and what it stops drawing is what the
view had already excluded. A view with no structural filter at all is untouched.

No schema moves, no protocol field is added, and `check`, `compile` and `apply`
are not involved. The interrogation semantics fingerprint is untouched: no
catalogue condition reads canvas visibility.

An adopter mirroring the canvas to publish figures elsewhere converges rather
than diverges: the reference adopter's SVG export already honoured the view's
own edge set, and this removes their one known divergence from the canvas.
