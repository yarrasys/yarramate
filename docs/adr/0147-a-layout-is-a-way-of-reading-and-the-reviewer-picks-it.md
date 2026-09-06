# A layout is a way of reading, and the reviewer picks it

Status: accepted

> Amended after 1.24.0: the route ownership rule below reads "the placement
> it was computed for", not "the placement ELK made". A drag-save writes the
> routes the canvas was drawing beside the positions they were computed for
> (`routes` in the layout sidecar), and a saved route is drawn again wherever
> both ends still sit at their saved place. Without this one drag pinned every
> subject and handed every edge back to the straight line for good, which was
> seen on the reference model. A drag still clears the moved subject's routes.

Two things were reported on the ApertureX reference model on 2026-09-06
(#489): edges were drawn through boxes, and serving read the wrong way. A
layout lab built on that model, six treatments side by side with collision
counts, found the cause of the first and a shape for the second, and the
maintainer's decision was to keep every treatment and let the reviewer choose.

## What was wrong

**Edges through boxes.** The canvas laid out through the `cytoscape-elk`
extension, which hands ELK only node ids and edge endpoints, applies node
positions only, and discards the routes and label positions ELK computes.
cytoscape's `round-taxi` then draws a straight orthogonal line from source to
target through whatever sits between them. Measured on the reference Landscape
(116 subjects in 42 boxes, 206 drawn relationships): **127 of 206 edges cut
through a box that was not one of their endpoints**, 16 labels sat on a box,
and 106 labels sat on a foreign edge. On API tiers, 38 of 72.

**Serving upside down.** ELK's layered algorithm places a source above its
target. ArchiMate draws the served element above what serves it, so a
top-down layout of `system API serves process API serves experience API` put
the system API at the top and the experience API at the bottom, and the label
said `serving` where a reader expects "served by".

**Found on the way.** An edge between a box and one of its own members - an
API box assigned to a requirement nested inside it - is filed by cytoscape as
a compound loop with no geometry (`edgeType: 'compound'`, `badLine: true`),
and is never drawn. 36 of the Landscape's 242 relationships and 24 of API
tiers' 96 are of this shape. [ADR 0139](0139-an-edge-across-a-nesting-boundary-is-not-laid-out.md)
believed cytoscape drew them; it does not. They had been vanishing without
anyone deciding so.

**Also found.** Layout has always resolved asynchronously - elkjs's in-process
"worker" is a `setTimeout(0)` - and the fold anchor
([ADR 0143](0143-a-folded-instance-is-a-node-and-the-view-says-the-default.md))
read its position before ELK had run, so its translation never fired.

## Decision

**A view arranges itself one of four ways, the reviewer can pick another on
the canvas, and a save writes the pick.**

- **`presentation.layout` admits `layered`, `routed`, `served-by` and
  `bands`**, a ladder where each keeps everything below it. `layered` is what
  shipped: ELK places, cytoscape draws its own lines. `routed` has ELK route
  every edge around the nodes and reserve room for each label. `served-by`
  layers serving, realization and specialization UPWARD, so the served,
  realized or general element sits above what serves, realizes or specializes
  it; only the layering turns, and the arrowhead keeps its ArchiMate form.
  `bands` pins every element to its ArchiMate layer's band, motivation at the
  top and physical at the bottom, through ELK's partitioning.
- **A view that declares no `layout` runs `served-by`.** It is the treatment
  that read correctly the first time anyone looked at real tiers. Every
  existing projection stays valid; a view that wants the old picture declares
  `layout: layered`.
- **The canvas talks to elkjs directly.** `src/visual-app/elk-layout.ts`
  builds the ELK graph (hierarchy included, edges at the root with their ends
  swapped for the upward kinds, labels sized) and reads the whole answer
  back; `src/visual-app/edge-routes.ts` draws each route with cytoscape's
  `segments`, projected onto the line between manual endpoints, with the
  label as a source label at the arc position ELK reserved. `cytoscape-elk`
  is removed. Measured with the routed modes: **0 edges through boxes and 0
  labels on boxes on every view tried**, crossings roughly halved (2187 to
  1081 on the Landscape).
- **A route belongs to the placement ELK made.** An edge keeps its route only
  while both ends sit exactly where ELK put them. A saved position or a drag
  hands that node's edges, and its box's, back to the stylesheet's straight
  line. A fold translates the whole graph, and a route survives that intact.
- **Layout and Direction have controls on the canvas**, two selects beside
  the quick filter. This reverses the exclusion in
  [ADR 0121](0121-a-view-says-which-way-it-runs.md), and answers the question
  that ADR raised: a view switch restates the view's own declaration, exactly
  as it does for nesting and direction already, and a save writes the value
  in force, exactly as it writes the badge flags. A view that omits `layout`
  is restored to the default rather than left holding the previous view's
  pick.
- **An unnamed relationship is labelled with its reading, not its kind id.**
  "serves", "realizes", "accesses", "is assigned to" - the table the brief has
  always spoken from, now shared in `src/relationship-reading.ts`. Where the
  layering turns a kind, the label reads from the element drawn above:
  "served by", "realized by", "specialized by". An extension kind is spelled
  out from its own name in the active voice. `presentation.showKindLabels`
  turns the words off for unnamed relationships; the line style and arrowhead
  say the kind either way, and a named relationship keeps its name.
- **A box-to-member edge is hidden deliberately.** Withheld from the layout,
  as ADR 0139 decided, AND not drawn. It stays in the model and the fact
  panel. ADR 0139 is superseded in that one respect.
- **Layout is awaited.** `runLayout` returns a promise; positions land through
  cytoscape's own `preset` layout, which fits the collection and emits
  `layoutstop` exactly as the extension did, so the saved-position pin and the
  framing record run unchanged. Overlapping runs resolve last-request-wins:
  a superseded run applies nothing. The fold anchor works for the first time.
- **Every layout is scoped to what the filter leaves visible**, the first one
  included. The first paint used to lay out the whole model and then hide
  most of it.

## Costs, measured

A routed Landscape is roughly three times today's area (10,983 by 8,188 px
against 7,648 by 3,393), because today's is compact only by drawing through
things. A routed layout of the 157-subject Landscape takes about a second on
the main thread; `layered` stays where it was. Two labelled edges running side
by side can still overlap their labels; `elk.spacing.edgeEdge` went from 20 to
30 for it, and widening `edgeEdgeBetweenLayers` was tried and measured as
canvas height (8,020 to 11,624 px) for no gain. An edge ELK ends on a
container's top border stops 22 px above the drawn box, in the label band.

## Excluded

- **Forking `cytoscape-elk`** to read the sections back. The extension is a
  hundred lines that stand between the canvas and the engine; owning the
  builder and the reader is less code than owning a fork.
- **A Web Worker.** The served page's policy admits a same-origin worker; the
  library bundle a host mounts is one file, and an inline worker needs a
  `blob:` allowance in the HOST's policy that this package cannot promise.
  Tracked as a follow-up for the served page, with the freeze measured (#490).
- **`elk.layered.compaction.postCompaction.strategy: EDGE_LENGTH`.** It
  throws inside ELK on a nested graph ("Invalid hitboxes for scanline
  constraint calculation").
- **Reversing the arrowhead.** "Served by" is a reading, not a change to what
  the notation says; the arrow still points at the served element.
- **Hiding box-to-member edges through a stylesheet class.** `applyFilter`
  hides through a `display` bypass, which outranks any class rule; the hide
  lives where the other hides live.
- **Blanking a routed edge's midpoint label with a bypass.** An empty bypass
  value REMOVES the bypass, and the stylesheet's label shows through beside
  the routed one. The blank is a stylesheet rule on `edge.routed`.
- **Invalidating routes on `position` events.** A fold translates every node
  through `position`, and a route survives a translation; only `dragfree`
  means one end moved alone.
