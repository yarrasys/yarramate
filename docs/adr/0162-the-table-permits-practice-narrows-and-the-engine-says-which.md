# The table permits, practice narrows, and the engine says which

Status: accepted

`connectableKinds` answers "which relationship kinds may I draw between these
two subjects". Between an application component and an application function it
answers with six. Across this repository's own model and the ApertureX
reference, 970 relationships over 72 core-kind pairs, the author wrote
`assignment` there 87 times out of 88. For 34 of the 72 pairs, carrying 232
relationships, the table permitted more than one kind and the author used
exactly one.

The table is a permission table. That is the right thing for it to be, and
`check` is right to refuse only what the table refuses. But permission was the
only thing the engine could say, so the convention lived in our heads: the
palette offered six in vocabulary order, an agent reading `connectableKinds`
guessed, and a reviewer could never be told "this pair is almost always
`assignment` and yours is `serving`, deliberate?".

The gap surfaced from an unexpected direction. A decision model asked to check
authored relationship kinds failed on two independently authored records, and
the dominant error on both was `assignment` read as `realization` for exactly
this pair. The model was missing knowledge we hold and never write down. The
experiment is closed (#571 and the `research/typesafe-judgments` branch); the
measurement it produced is the evidence above.

## Decision

**A second, quieter question beside the permission: `conventionalRelationshipKind(from, to)`,
answering the kind ArchiMate practice expects, or `null` where practice has no
expectation.**

It is a separate function in a separate module, not a field on the permitted
set, because the two answer different questions and only one of them is a
guarantee. `check`, `compile` and `apply` never read it.

**The answers are read off ArchiMate's definitions, never fitted to a
record.** Eight ordered rules over aspect, layer and the service and interface
elements, each with a name and a sentence a reviewer can argue with, carried
into the answer so guidance can always say why. Both records agree that a
business actor points at a constraint with `association`, 87 times out of 87,
and this module is silent there: that is ApertureX recording sign-off their
way, not a rule of the language, and deriving conventions from usage would
have shipped one adopter's habit and told every other adopter their style was
wrong.

The records are the check, not the source. `test/relationship-convention.test.ts`
asserts that every declared convention matches real practice on every pair the
self-model has enough of to have a habit, five relationships or more, and
prints the disagreements when it does not. It reads nine pairs carrying over
four hundred relationships and agrees with all of them. Measured across both
records before this shipped: the conventions answer 30 of 72 used pairs and
match the author on 613 of 631 relationships, 97 per cent, with the only
disagreements on pairs of three edges or fewer.

**Silence is the common answer, and is load-bearing.** An artifact pointing at
an application function is `realization` 41 times and `association` 16; a
capability pointing at a goal splits evenly; two application functions relate
by composition, triggering, flow or serving depending on what the author
means. Declaring a convention there would manufacture confidence the language
does not have. Roughly two hundred of the 62 × 62 pairs get an answer and the
rest get `null`, which a caller renders as the palette it rendered before.

**Guidance never contradicts the table.** An answer is returned only when the
table also permits it, so a rule that lands outside the permission resolves to
silence rather than pointing an author at an edge `check` would refuse.

**It marks, it does not filter, and it does not reorder a list someone is
reading.** The connection panel, where a kind is being chosen, leads with the
usual one and labels it `usually`; every other permitted kind stays where it
was. The properties form's `<select>` keeps vocabulary order and carries the
convention for marking only, because reordering a list under a reader's cursor
is worse than annotating it.

## Consequences

`yarramate/tools` and the package root export `conventionalRelationshipKind`
and the rule list, so an agent choosing a kind can read the convention the same
way it reads the permission. Nothing on the wire changes and no schema moves.
The interrogation semantics fingerprint is untouched: no catalogue condition
reads this.

What this does not do: it does not diagnose. An unusual kind is not a finding,
and making it one would turn a convention into a rule and punish the adopter
whose house style is deliberate, which is the exact failure this decision was
written to avoid. A catalogue question that asks whether an unusual choice was
deliberate is a reasonable later move and is deliberately not taken here.

The rules are a small authored artifact that will need revisiting as the
vocabulary grows. The test is the guard: a new concept kind that makes a rule
wrong on a real record fails the build with the disagreement printed.
