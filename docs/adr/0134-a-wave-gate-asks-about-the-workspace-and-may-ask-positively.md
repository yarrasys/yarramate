# A wave gate asks about the workspace, and may ask positively

Status: accepted

Amended immediately after release (1.12.0). This ADR argued that a list of
names goes stale and that the classification must therefore be a total map the
typechecker enforces — and then restated the list in prose and got it wrong,
saying **five** workspace-scope conditions and omitting `unchallenged-evidence`.
The code was right throughout, because `YM917`'s message is read off the map;
only the prose was wrong, and `docs/INTERROGATION.md` carried the same error.
Corrected to six. The rule earned another instance the day it was written,
which is rule 8: writing about a silent failure mode is when you produce it.

ADR 0125 gave a wave an `opensWhen` gate and wrote it in the condition
vocabulary, so that "a reviewer reads a gate exactly as they read a
trigger". Two things followed from reusing the vocabulary that the ADR did
not say, and both surfaced the same week an adopter first authored
phase-ordered waves.

## The gate is evaluated with no subject, and said so nowhere

`conditionHolds` takes an optional subject, and a gate passes `undefined`:
a wave is a property of the model, not of any one thing in it. But the
catalogue schema offered the **whole** condition vocabulary in `opensWhen`,
and most of the vocabulary asks about a subject.

Authored into a gate, measured against a one-concept workspace, every one
of these loaded without complaint:

| Gate condition | `opened` | What the author got |
|---|---|---|
| `has-linkage`, `near-duplicate`, `fills-pattern-slot` | `false` | a wave that never opens |
| `missing-linkage`, `isolated`, `missing-claim`, `missing-constraint` | `true` | a gate that does nothing |

The split is what made it invisible. Half leave the wave permanently shut
and half leave the gate inert, and an author reviewing the YAML sees a gate
in both cases. The mechanism is a non-null assertion meeting an absent
subject: `missing-constraint` reads `claimsBySubject.get(subjectId!)`,
which is `undefined`, so its `.some(...)` is vacuously false and the
negation is `true`; `has-linkage` guards on `subjectId !== undefined` and
returns `false`. Neither is wrong where it was written. Both are wrong in
this position.

**A subject-scope condition in `opensWhen` is refused (`YM917`).** This is
the same failure `YM914` already refuses from a different cause. `YM914`'s
reasoning is that a gate naming a kind that resolves nowhere never matches,
and "that is indistinguishable from a condition that is simply not met" —
which is precisely this, arrived at by a different route. Only one route
was guarded.

**Refused at load rather than narrowed in the schema.** The schema could
express the restriction as a second `oneOf` over the workspace-scope
conditions, and an editor would then flag it before the engine ran. It
would also report `must match exactly one schema in oneOf`, naming neither
the offending condition nor the ones that would work. A diagnostic that
exists because the author cannot see the problem has to do the seeing.

**The classification is a total map over the union, not a list of names.**
An allowlist cannot fail for the author who wrote it (CONTRIBUTING.md's
ninth rule), and a gate is exactly the position where a missing entry is
silent. `CONDITION_SCOPE` is a `Record<CatalogueCondition['condition'],
'workspace' | 'subject'>`, so a new condition cannot compile until its
scope is declared: the typechecker asks the question rather than the table
remembering the answer. The remedy the diagnostic offers is read off the
same map, so the advice cannot drift from what the engine accepts.

There are **six** workspace-scope conditions, and it is worth writing the
number down because the adopter who hit this counted three. `exists-linkage`
is one of them, and it is a positive existence check that already reads the
whole workspace — the existential lift of `has-linkage`, added by hand in
#206 and easy to miss in a dense list.

## A gate wants the opposite polarity from a question

`no-subject-of-kind` is the right condition for a *question*: "you have no
stakeholders, who are they?" exists to be closed by the absence ending. A
*gate* wants the opposite, and `opensWhen` requires every condition to hold
with no `not`, so inverting was not available.

The consequence was that a wave could say "the model has started"
(`has-any-subject`) and "the model still lacks X" (`no-subject-of-kind`) but
never "the model now has X". A phase-ordered interview needs the third:
without it every wave opens the moment the first concept lands, which is the
situation #334 fixed for the empty model and left in place one step later. A
consultant who has modelled three components is asked who is paged for
interfaces that do not exist yet. The questions are not wrong, they are
premature, which is the distinction ADR 0125 drew when it put the gate on
the wave.

**`has-subject-of-kind` is added**, the positive twin of
`no-subject-of-kind`, with the same `kinds` and the same `kindMatching`
default of `descendants`. ADR 0125 anticipated exactly this shape of
arrival: a further condition "can join later without changing the
mechanism".

It is written as its own existence check rather than as the negation of
`no-subject-of-kind`, so the empty workspace falls out directly rather than
by double negative: no subjects of any kind means every gate using it stays
shut, which is the #334 posture.

## What is deliberately not decided

**No boolean algebra over conditions.** One positive existence check covers
phase ordering. A `not` operator would raise a question about every other
condition, and about how a gate reads, that this does not.

**No existential lift.** A gate could instead evaluate a subject-scope
condition as "some subject satisfies it", which is what `exists-linkage`
already does relative to `has-linkage`. That is more elegant than a refusal
and a larger semantic change, and it should be decided on its own rather
than arrive as a bug fix. The refusal does not foreclose it: a condition
that is refused today can be given a meaning tomorrow, where one that
silently returned the wrong answer would have adopters depending on it.

## Consequences

`YM917` is a new refusal, so a catalogue that authored a subject-scope gate
and appeared to work now fails to load. That is the intent: every such
catalogue had a wave that never opened or a gate that did nothing, and the
refusal names which. No catalogue in this repository authored one.

Both schema and evaluator gain `has-subject-of-kind`; it is additive, and no
existing catalogue changes meaning.

Issues: #398 (the condition), #400 (the gate scope).
