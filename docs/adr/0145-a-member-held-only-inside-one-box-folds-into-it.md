# A member held only inside one box folds into it

Status: accepted

Phase 3 of the fold programme (#473). Two decisions Nabeel took on 2026-09-05,
and one spike measured and held.

## The one-box fold

[ADR 0143](0143-a-folded-instance-is-a-node-and-the-view-says-the-default.md)
kept every shared subject outside the containment tree:

> **Exclusive.** A subject bound into two instances has two owners, and a
> single-parent tree would silently pick one.

That is true where the owners sit in different boxes, and only there. Where both
already sit under one box there is nothing to pick, and the rule was costing
real structure: on the reference Landscape, **14 of 30 data objects sat outside
the single application whose own parts were the things binding them.** The
boundary the fold draws is between applications, and a subject held only by
parts of one application declares nothing to the landscape.

### The rule

A member's HOLDERS are every instance whose slots name it, context bindings
included. At least one of those bindings must be `owned` or `unwired`.

- **One holder**: the parent is that holder. Unchanged.
- **Several**: the parent is their lowest common ancestor, counting each holder
  as an ancestor of itself, so a holder sitting inside another gives the OUTER
  holder rather than something above them both. That is the level at which the
  holders diverge, and therefore the innermost box containing all of them.
- **No common ancestor**: the member stays outside. There is still a choice to
  make and the tree still declines to make it.
- **The member is an ancestor of a holder**: refused.

Rulings still never fold as nodes. A member bound only through context slots
still never folds. A view's own nesting still wins over slot parents. Edge
lifting in `foldGraph` is untouched.

### Resolved in rounds, which is not a detail

A member's holders may themselves be members whose parents are decided in the
same pass. A single forward pass would measure the ancestor against a tree still
missing the levels that separate them, and the reference has five-deep chains
(spec inside mapping inside call inside client inside application), so this is
exercised rather than theoretical. Members whose holders are not yet settled are
deferred to the next round; when a round decides nothing, what is left is a
mutual dependency and stays outside. A test runs the same memberships inside-out
and asserts the identical tree.

### One existing behaviour improves

A member that already contains its holder used to be placed anyway, closing a
loop that the cycle guard then broke by unnesting BOTH nodes, so the holder lost
authored nesting as collateral damage. The placement is now refused, the holder
keeps its parent, and no cycle forms. The guard still runs, as the backstop
rather than the rule.

### Measured

On the ApertureX pack 2.0 reference, nesting `[composition, assignment]`, every
instance folded. Node set is the projection's concepts; edge set is every
compiled edge with both ends in view; boxes are `foldGraph`'s visible nodes.
Reproduced independently by the ApertureX session, to the digit.

| measure | before | after |
|---|---|---|
| Landscape boxes / edges | 73 / 153 | **58 / 120** |
| whole model visible boxes | 173 | **158** |
| whole model top-level | 172 | **157** |
| subjects with a parent | 105 | **120** |

**15 members newly fold on the Landscape, not 14.** The fifteenth is
`salesforce-connector`: six `context` bindings from the system API's own calls
plus the `unwired` `backend` slot on the system API itself, whose common
ancestor is `salesforce-patron-sapi`. It folds under both readings of the rule.
The first measurement iterated data objects only and missed it.

Several members land on a CALL or the API INTERFACE rather than on the
application, because that is where their holders diverge, which is the rule
working rather than an anomaly.

Swept this repository's own model: **22 views, zero containment changes.**

## Rulings as rows

A bound ruling is a box carrying one association edge. On the reference there
are 82 of them, and drawing them as boxes is what takes the whole model to 173.

With `presentation.showConstraints`, a constraint filling an UNWIRED slot of a
visible instance is hidden as a node and drawn as a row in that instance's label
block; its edges are hidden with it. A ruling several instances bind draws in
every holder, marked shared. A constraint nothing binds stays a box: it has no
box to sit in.

**The row carries the RULER, and that is the measured part.** Every one of the
82 rulings has its authored edge from a ruler rather than from its holder, which
reaches the ruling only through the slot. Hide the ruling and the ruler's edge
has nowhere to land, and a role whose every edge ran to a ruling becomes a box
with no edges at all. So the row reads `slot: name · ruler`. The ruler is
derived from the graph, as whoever points at the ruling from outside its own
holders, rather than from a list of business and motivation kinds: a list would
be right for this reference and silently wrong for the next, which is the ninth
rule.

The ruler's own box stays. An edge-less box is the truthful picture once its
relations are rows.

**Presentation only, and off by default.** The model, the query and the selected
set are identical either way. Off by default for the reason `fold` is: rows hide
boxes a reader can see today, and a view that hid them without being asked would
be a surprise its author never wrote down. Node height becomes per-node for
boxes carrying rows; everything else keeps the fixed default. The fold tree does
not change, because rulings never nested as nodes in the first place.

## The edge-label spike: measured, held

Contract objects as labels on lifted edges was measured on the Landscape before
the one-box fold: 11 of 30 data-object boxes would become labels on 6 edges, one
carrying 4 labels at 62 characters inline, longer than both boxes together.
Boxes 73 to 62, edges 153 to 115, but three orphan boxes appear, all 11 labelled
objects are PII-aggregated with no node for that edge to land on, and one object
has no edge to label at all.

**Held, not rejected.** After the one-box fold the objects left on the Landscape
are exactly the ones that cross an application boundary, which is what a
landscape should show as boxes, so the case for labels is weaker than when it
was proposed. It is re-measurable in one run on top of this ADR, and it builds
only on a fresh decision.
