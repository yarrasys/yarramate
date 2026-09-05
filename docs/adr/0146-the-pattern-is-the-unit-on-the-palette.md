# The pattern is the unit on the palette

Status: accepted

Phase 4 of the fold programme (#473), and the last of it.

Phases 1 to 3 made a pattern instance DRAW as one thing: folded into a box
(ADR 0143), selectable as a closure (ADR 0144), and holding what its slots
name. Authoring one stayed what it had always been. On the ApertureX reference,
adding a Mule HTTP API meant dropping an application, an interface, a service
and a connector from four different layer bands, then binding each into a slot
by editing YAML, because the editor had no way to say "these four are one
thing".

Meanwhile the palette itself had become unusable at that scale: 146 kinds, and
the motivation band opened with `availability-constraint`, `coverage-target`,
`idempotency-constraint`, `java-baseline`, `maven-coordinates`. Forty-six of
its rows were rulings that a reader never drags, because the only way to author
one is to fill a slot with it.

## Decision

**A pattern is a thing you can pick up.** It gets a band, a row, a form, and
the same drag payload every other row has.

### One batch, proven before the form was designed

Item 4.1 was a verification rather than a build, and it went first because its
answer decides the form's shape: can an `add-concept` for a child and an
`add-concept` for the instance that binds it land in the SAME batch?

They can. `apply` compiles the whole candidate workspace atomically before a
byte is written, so the order does not matter, and a claim about an ordering is
worth proving in both orders rather than in the one the form happens to emit.
A bound child that is never minted is refused, so the form cannot stage a
half-built instance and leave the reviewer to find the rest in a compile error.

So the form is one step, and this ADR says so rather than leaving it to be
discovered while building.

### The shape a consumer reads

`ResolvedProfileContext.patterns` gives the pattern document its first public
TypeScript type. Slots come as an ORDERED ARRAY: the order a pattern declares
them is the order a form asks for them, and a consumer must not have to trust a
map's iteration order.

`VisualRenderedModel.vocabulary.patterns` resolves it one step further for an
editor, and the step that matters is `admits`. A slot declaring
`kindMatching: descendants` accepts a family; resolving that needs the lineage
map, and the frame does not carry one. Resolved in the browser it would offer
the declared kind alone and refuse subjects the compiler accepts, so it is
resolved in `workspace-model.ts` where both hosts read it.

Both fields are optional, and both are an empty list for a workspace with no
patterns and absent where nobody looked. Those are different claims (rule 2).

### The band rule, and the lineage rule under it

A band per pattern DOCUMENT sits above the layer bands, because a pattern is
what a reader reaches for first: one gesture that mints an application and its
parts, against five drops and three connections.

A ruling a slot admits moves to a collapsed row under its own layer. **The rule
is constraint LINEAGE and slot admission TOGETHER, never "appears as a slot
kind".** `dataObject` is a slot kind on that reference and is a first-class
thing to draw; keying on slot admission alone would bury it. A ruling nothing
binds stays an ordinary row, because filling a slot is not a way to author it.

### Two surfaces, one staged shape

The instance form mints an instance and its parts. The Slots section fills one
slot of an instance that already exists, which is where a `missing-part`
question (#447, ADR 0140) is answered on the canvas.

They stage the same shape, so the model cannot tell which surface a binding came
from. Both merge BY SLOT per ADR 0062's convention: an operation names only the
slots it is filling, so answering one question cannot unbind another (#448).
Retraction stays the coarse `remove: ['parts']`; filling a slot and clearing
them all are different gestures, and one grammar for both would make the safe
one look like the destructive one.

## What looking at it changed

Every item here passed its tests and then failed in front of a browser, and the
failures are worth recording because they are the same failure three times.

- **The stacked mark rendered at 0x0.** The element was in the DOM and the test
  asserted its class name. Nothing styled it.
- **"Mule API 1 slots."** Invisible to a string assertion.
- **The band header carried the document PATH**, which is right on the wire and
  wrong in a heading: it wrapped onto two lines and pushed the rows down.
- **The instance form's slot rows were a bulleted list** with each label jammed
  against its control, reading as prose with dropdowns in it. Twelve render
  assertions passed on it.

The guard that came out of it: a test that reads `styles.css` and asserts the
mark has a width and a height, and the rows a gap. It is a poor substitute for
looking and it is what a headless suite can do.

**A markup assertion is not a claim about what a reader sees**, and the
programme has now made that mistake in a reducer (1.20.0), in an effect
dependency (1.22.0), and in a stylesheet twice. The pattern is the same each
time: the thing under test was right, and the thing that made it visible was
never exercised.

## Consequences

Additive throughout. A workspace with no patterns has no band, no collapse and
no instance form, and its palette is what it was.

`VisualKindOption` gains `pattern` and `name`; `label` stays the local id,
because that is what a drag payload and an operation carry and the two must not
drift.

The interview's `missing-part` card now has somewhere to be answered. What it
still lacks is a link from the card to the slot, which is a smaller thing than
it was before this phase and is not built here.
