# A view says what nesting means in it

Status: accepted

Drawing one box inside another is the most compact thing a diagram can say, and
until now the canvas said it in exactly one circumstance: a `composition` edge
consumed into cytoscape's parent field, decided by
`resolveCompositionParents` and written down nowhere. Other relationships that
ArchiMate conventionally nests, `assignment` above all, drew as lines.

This ADR makes the nestable set a property of the view rather than of the
renderer, and settles what a nested box is allowed to mean.

## Why

**Assignment is worth nesting.** A component's functions and processes happen
*inside* it, and drawing them inside it is how ArchiMate itself renders that.
Left as lines they scatter across the canvas, and the reader reconstructs
containment edge by edge.

**But nesting two relationships in one view makes containment ambiguous.** A
nested box carries no label saying how it got there. If both `composition` and
`assignment` nest, an inner box means either "is a part of" or "is behaviour
performed by", and nothing on screen distinguishes them. This is the real flaw
in nested notation, and it is the reason the set could not simply be widened.

**The renderer is the wrong place to decide.** Which relationships should nest
depends on what the view is for: a structural decomposition wants
`composition`, a behavioural allocation wants `assignment`, and a view that
wants both is accepting the ambiguity knowingly. That is an authoring
judgement, and every other such judgement in a projection already lives under
`presentation`.

## Decided

**`presentation.nesting` names the relationship kinds that nest in this view,
in precedence order.**

```yaml
presentation:
  nesting: [composition, assignment]
```

It defaults to `[composition]`, which is exactly today's behaviour, now stated
rather than assumed. `[]` turns nesting off and draws every relationship as a
line.

**Ambiguity is removed by declaration, not by decoration.** A view that lists
one kind has no ambiguity to resolve: every nested box in it means that one
thing, and the view can say so once. A view that lists two has accepted the
trade knowingly, which is a different thing from stumbling into it. Marking
each nested child with the relationship that placed it is deliberately not
attempted here: it competes for the corners that already carry the kind glyph
and the lifecycle badge, and no view yet exists where the ambiguity has been
measured rather than imagined.

**Precedence decides a child claimed more than once.** A child claimed by both
a `composition` and an `assignment` nests under the composition, because
`composition` is listed first. Two claims at the *same* rank naming *different*
parents remain undecidable and fall through to the existing unnest-and-warn
path unchanged: the child draws at top level and every claim stays drawn as a
line, so the conflict stays visible rather than being silently resolved.

**Assignment never nests a service.** A service is the promise a layer above
consumes; burying it inside the thing that exposes it inverts what it is for.
This is a *drawing* rule, not a validity one, and the distinction matters:
`applicationComponent -assignment-> applicationService` is permitted by the
ArchiMate 3.2 table this repository validates against (ADR 0097), so the model
is correct and only the rendering declines to collapse it. Composition is
unaffected: a composed service is a part, and parts nest.

## Consequences

**Nothing changes for a view that says nothing.** The default is the behaviour
that shipped, so every existing projection renders as it did.

**`YM501` still does not cover this.** It rejects one `(from, to)` pair
declaring both composition and aggregation. It does not reject two different
relationships of the same kind naming one `to`, nor a nesting chain that loops,
and cytoscape's single-parent field can represent neither. Both remain
modelling anomalies this layer surfaces by unnesting rather than resolving.

**The cycle walk now spans the whole nestable set.** A composition into an
assignment into a composition is a cycle that could not previously be
constructed. The existing walk already handles it, because it follows
`parentOf` rather than any one relationship kind.

## Rejected

**Aggregation in the nestable set.** ArchiMate nests it, and a `grouping`
aggregating its members is the obvious candidate. It is left out because it
answers a question nobody asked here, and adding a kind to the set later is
purely additive: a view opts in by naming it. The parked question was
assignment, and this ADR answers that one.

**Marking each nested child with the relationship that placed it.** The honest
fix for a view that nests two kinds, and deferred rather than rejected. The
corners of a node already carry the kind glyph and the lifecycle badge, so this
needs notation invented rather than borrowed, and inventing it before a view
exists that needs it would be guessing at the shape of a problem.

**Inferring the nestable set from the kinds present.** A renderer that decides
for itself makes the same view draw differently as the model grows, which is
exactly the property `presentation` exists to prevent.

**Nesting by relationship kind globally rather than per view.** One setting for
the whole workspace makes the structural view and the allocation view fight
over one answer, and neither is wrong.
