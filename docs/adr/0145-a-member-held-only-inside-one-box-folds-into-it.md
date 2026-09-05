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

## Rulings as rows: shipped in 1.22.0, withdrawn for good

**Superseded. `presentation.showConstraints` is out of the package and is not
coming back.** The design below is kept because the reasoning that killed it is
worth more than the reasoning that proposed it.

### What it was for

A bound ruling is a box carrying one association edge. On the reference there
are 82 of them, and drawing them as boxes is what takes the whole model to 173.
The proposal: hide a ruling that fills an unwired slot and draw it as a row of
text inside the instance that holds it, reading `slot: name · ruler`, marked
where several instances bind the same one. Presentation only, off by default.

### Why it is dead

Nabeel looked at a rendered box, 2026-09-05: *"when we fold, we just need the
element name they are folded into."*

The arithmetic was never the problem. Read on the reference, `salesforce-patron-
sapi` states fourteen rows, and the box that was a NAME becomes a paragraph. A
diagram of paragraphs is not a diagram. The count was the honest measure and it
pointed the wrong way: 82 boxes removed, and in exchange fourteen lines of prose
in a node that a reader has to read rather than see. Removing noise by relocating
it into the thing you were trying to read is not removing it.

The fold already does what the feature was reaching for. A folded box shows its
name and a chip saying how many members went inside; that is the whole ask, and
it was shipped in phases 1 and 2. **Which** rulings govern a subject is a
question for the Slots section of the properties panel, where a list can scroll,
can be clicked through to each ruling, and does not have to fit inside a
rectangle competing with edge routing.

### What it cost, and what it taught

Two builds. The first shipped inert in 1.22.0 and was withdrawn in 1.22.1: rows
were built by REBUILDING the element set, which dropped the fold and the focus
filter, never applied the hiding, and was wiped by the next fold. The second
rebuilt it correctly as element state applied in place, and that build worked -
23 boxes rowed, 82 rulings hidden with none still drawn, the toggle round-
tripping exactly, nine tests on the applier that had never had any.

It was thrown away anyway, and this is the lesson worth keeping: **the second
build was verified against every property except the one that mattered.** Rows
survive a rebuild, the box widens to its longest row, the label uses that width,
rows stay off an open container - all measured, all true, and none of them the
question. The question was whether a person wants to look at the result, and
that was answerable from the first screenshot of the first build. Nobody asked
it until the fourth.

That is the same failure this programme has repeated at every phase, one layer
up: not *the arithmetic was right and the picture was wrong*, but *the picture
was right to spec and the spec was wrong*. Correctness of implementation was
checked continuously; desirability of the artifact was never checked at all,
because a suite cannot ask it and I did not put a rendering in front of anyone
until the feature was finished twice.

**The rule that comes out of it: a presentation feature is reviewed by looking
at it, on real data, BEFORE it is built, not after.** One screenshot of one
box would have cost ten minutes and saved two builds.

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
