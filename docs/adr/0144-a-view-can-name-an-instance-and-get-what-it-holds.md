# A view can name an instance and get what it holds

Status: accepted

Phase 2 of the fold programme (#473). Phase 1 made a pattern instance draw as
one box ([ADR 0143](0143-a-folded-instance-is-a-node-and-the-view-says-the-default.md)).
It changed how a view DRAWS and nothing about what a view HOLDS, so the view
built around one instance still had to hand-list its members:

```yaml
query:
  subjects: [checkin-xapi, checkin-component, checkin-interface, checkin-service]
```

That list is a copy of something the pattern already states, and it is wrong
the next time somebody binds a slot. Nothing tells the author it went stale;
the view simply draws one box short, which looks like a model that lost a
subject rather than a query that stopped keeping up.

## Decision

**A query may name pattern instances, and the facet selects each one together
with everything the fold tree would draw inside it.**

```yaml
query:
  instances: [checkin-xapi]
```

Three properties make it the same answer the canvas gives:

- **One implementation.** The closure comes from `foldTree` in
  `src/fold-tree.ts`, the module the canvas folds with, over the same nodes,
  edges and memberships. Two implementations of "what is inside this instance"
  would be two answers to one question, and which one a reader saw would depend
  on whether they opened the view or exported it.
- **The view's own nesting.** `presentation.nesting` decides containment, so
  the facet reads it rather than the default. A view that nests on composition
  alone holds less than one that also nests on assignment, and the facet has to
  say so rather than answering for a nesting nobody wrote.
- **Transitive.** A member's own members are inside the box too. Unfolding one
  level reveals folded rows, and a view naming the outer instance wants those.

### The exception to AND, stated rather than smuggled

`docs/PROJECTIONS.md` has always said query fields combine with logical AND,
and every other facet is a drop rule. `instances` adds. Left as an AND it could
not express the case it exists for: apx's experience-API view is one instance's
closure PLUS three named boundary neighbours, and intersecting those two lists
yields the empty set.

**So `subjects` and `instances` are one identity facet spelled two ways, and
their values combine with OR.** That is not a new rule. The document already
says values within a facet combine with OR and different facets with AND; this
places the two lists in the same facet, on the grounds that naming a subject
and naming the instance that holds it are the same act of selection. Every
other field still ANDs over the union. A query with neither still selects
everything.

The alternative was to make `instances` intersect like everything else and let
apx keep the hand-list for the boundary. That preserves a one-line invariant at
the cost of the feature, and the invariant survives in a better form: there is
still exactly one additive facet and it is named in the document.

### The closure is INITIALLY selected, and that is the point

Under `relationships: connected` the evaluator keeps a relationship only when an
endpoint was initially selected, so edges between two expansion-added neighbours
are dropped. On the ApertureX reference Landscape that is 71 of them. A view
that hand-listed an instance's members got them as initial selections and kept
their internal edges; one that reached them by expansion did not.

Because the facet contributes to the initial selection rather than to expansion,
every relationship among closure members is kept. The projection result and the
canvas agree for instance views, which is what the canvas already did by drawing
all edges among visible nodes.

### Measured on the ApertureX reference

Through the workspace's own manifest (`check`: 277 concepts, 431 relationships,
no errors), `instances: [<id>]` with `nesting: [composition, assignment]`,
counting concepts in the projection result:

| instance | expected | measured |
|---|---|---|
| `patron-checkin-xapi` | 15 | **15** |
| `salesforce-patron-sapi` | 28 | **28** |
| `patron-attendance-papi` | 22 | **22** |
| `enquiry-mailbox-reader` | 11 | **11** |
| `attendance-digest-job` | 10 | **10** |
| `pos-purchase-poller` | 8 | **8** |
| `tee-sheet-import` | 8 | **8** |
| `patron-arrival-notifier` | 8 | **8** |

Rulings stay outside every one of them, which is review F5 holding: a policy is
not machinery and is routinely shared, so it is not a part of the instance that
happens to reference it.

### Two ways to be wrong, two diagnostics

`check` resolves the facet the way ADR 0128 resolves every other selector, and
splits the refusal:

- **YM921**: the name is not in the model at all. A typo, and the message
  suggests the nearest subject.
- **YM922**: the name IS in the model but is not a pattern instance. Not a
  typo: the author has named a member where they meant the instance, or meant
  the subject itself, so the message points at `subjects`.

Instance-hood is read from the compile's bound memberships **and** its
vacancies. A membership row exists only for a bound slot, so judging by
bindings alone would call a freshly authored instance "not an instance" on the
day it was written, before anything was wired into it. The honest question is
not whether it bound anything but whether the model knows it as an instance.

- **YM923**: the caller did not say which subjects are instances. Without that
  the facet degrades to each named instance alone: a smaller view that is
  indistinguishable from a correct one. #450 is the record of what silent
  degradation costs, so this is refused rather than answered.

## Focus on this instance

The canvas menu offers **Focus on this instance** on a node the frame's
memberships name as an instance, beside **Focus on this**. Two readings of
"near": one hop of relationships, or what the pattern says this holds.

It composes an ephemeral `{ instances: [id], relationships: 'between' }` and the
server evaluates it, staging nothing, the same contract chat filters have
([ADR 0090](0090-a-chat-filter-is-a-query-not-a-match-set.md)). Composing the
member list in the browser instead would freeze the closure at the moment of the
click and would be the second answer this ADR exists to prevent.

The item is gated on instance-hood, not on containment. A plain component with
a composition contains something and has no parts to focus on, and an item that
can only ever select one subject is worse than no item (#255).

## Consequences

The facet is optional and additive, so every view that reads today reads the
same. `evaluateProjection`, `explainProjection` and `conceptSelector` take
memberships as an optional trailing parameter, which is free for all 58 existing
call sites: a required parameter would be free for readers and a break for
constructors, which is CONTRIBUTING's first rule.

`ConceptFacet` gains `instances`, which IS a break for anything constructing an
exhaustive record over it. Exactly one thing does, the editor's exclusion
labels, and the typecheck named it. That is the record earning its keep rather
than a cost.

Threading memberships is the part that decides whether any of this works.
Phase 1 shipped with folding wired into every unit test and into no part of the
app, so the feature was inert while its tests were green. The authored-projection
call sites all pass memberships now: `export`, `ask`, the LikeC4 adapter, and
the visual path's match set, exclusions and per-view subject count. A site that
builds its own query in code cannot carry `instances` and is left alone.
